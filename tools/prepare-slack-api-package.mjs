// SPDX-License-Identifier: MIT
import { readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { format } from "oxfmt";
import { slackApiToolDefinitions } from "../plugins/slack-api/source/slack-tool-catalog.mjs";

// Credential-free deterministic authoring step; it never contacts Slack or publishes.
const directory = new URL("../plugins/slack-api/", import.meta.url);
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const canonical = (value) =>
  Array.isArray(value)
    ? `[${value.map(canonical).join(",")}]`
    : value !== null && typeof value === "object"
      ? `{${Object.keys(value)
          .sort()
          .map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`)
          .join(",")}}`
      : JSON.stringify(value);
const writeJson = async (path, value) => {
  const formatted = await format(
    path.replace(/\.template$/u, ""),
    `${JSON.stringify(value, null, 2)}\n`,
  );
  if (formatted.errors.length !== 0) throw new Error("Slack package JSON formatting failed");
  const encoded = formatted.code;
  await writeFile(new URL(path, directory), encoded);
  return sha256(encoded);
};
const scopes = [...new Set(slackApiToolDefinitions.flatMap((tool) => tool.scopes))].sort();
const definition = {
  schemaVersion: 1,
  protocol: "oauth2-authorization-code",
  issuer: "https://slack.com",
  provider: "slack-web-api",
  resourceIdentity: "slack-web-api",
  authorizationEndpoint: "https://slack.com/oauth/v2_user/authorize",
  tokenEndpoint: "https://slack.com/api/oauth.v2.user.access",
  tokenEndpointAuthMethod: "client_secret_post",
  authorizationResponseIssuer: "not-supported",
  pkce: { method: "S256" },
  authorizationParameters: [],
  scopes,
  account: {
    kind: "https-json",
    endpoint: "https://slack.com/api/auth.test",
    authorization: "bearer",
    subjectPath: ["user_id"],
    displayLabelPath: ["team"],
    subjectStability: "stable",
    maximumResponseBytes: 16384,
    maximumJsonDepth: 8,
    maximumObjectKeys: 100,
    maximumSubjectLength: 300,
    maximumDisplayLabelLength: 160,
  },
  tokens: {
    accessTokenType: "bearer",
    expiresIn: { required: true, minimumSeconds: 1, maximumSeconds: 43200 },
    grantedScopes: {
      whenPresent: "exact-match",
      whenOmitted: "requested-scopes",
      separator: ",",
      implicitScopes: ["identify"],
    },
    initialRefreshToken: "required",
    refreshResponseToken: "retain-current-if-omitted",
  },
  refresh: {
    kind: "standard-form-post",
    invalidGrant: "reauthorization-required",
    ambiguousOutcome: "fail-closed-no-replay",
  },
  revocation: { kind: "none" },
};
await writeJson("oauth-provider.json", definition);
const definitionDigest = sha256(canonical(definition));
const authentication = {
  kind: "oauth",
  providerRegistration: "slack-web-api-oauth-v1",
  providerDefinitionDigest: definitionDigest,
  requestedScopes: scopes,
  credentialDelivery: "short-lived-access-token-only",
};
const catalogDigest = await writeJson("catalog.json", {
  id: "slack-web-api-catalog-v1",
  schemaVersion: 1,
  tools: slackApiToolDefinitions.map(({ name, description, inputSchema, classification }) => ({
    id: `slack.${name}`,
    mcpName: name,
    title: name.replace(/^slack_/u, "").replaceAll("_", " "),
    description,
    inputSchema,
    classification,
    defaultPolicy: classification === "destructive" ? "block" : "require-approval",
    maximumOutputBytes: 262144,
  })),
});
const configDigest = await writeJson("config.json", { revision: 1, fields: [] });
await writeJson("platform-bindings.json", {
  providerRegistration: authentication.providerRegistration,
  providerDefinition: { path: "oauth-provider.json", canonicalSha256: definitionDigest },
  providerMetadata: {
    provider: definition.provider,
    resourceIdentity: definition.resourceIdentity,
    registrationMode: "platform-pre-registered",
    source: "platform",
    approvedScopes: scopes,
  },
  deploymentClient: {
    clientIdBinding: "SLACK_CLIENT_ID",
    clientSecretBinding: "SLACK_CLIENT_SECRET",
    tokenEndpointAuthMethod: "client_secret_post",
  },
});
await writeJson("slack-app-manifest.json.template", {
  display_information: {
    name: "Supernala",
    description: "Connect Supernala agents to Slack through the Slack Web API",
  },
  oauth_config: {
    redirect_urls: ["https://app.supernala.com/v1/plugins/oauth/callback"],
    scopes: { user: scopes },
  },
  settings: { socket_mode_enabled: false, token_rotation_enabled: true },
});
await writeJson("provenance.json", {
  source: { type: "first-party", path: "plugins/slack-api/source/server.mjs", upstream: null },
  build: {
    recipe: "plugins/slack-api/build-recipe.json",
    runtimeDependencies: [],
    networkDuringBuild: false,
  },
  license: {
    spdx: "MIT",
    status: "approved-first-party-source",
    file: "plugins/slack-api/LICENSE",
    notice: "plugins/slack-api/NOTICE",
    copyright: "Copyright (c) 2026 Supernala contributors",
  },
  publication: {
    eligible: false,
    reason:
      "API-backed MCP candidate; exact OAuth client admission, publication approval and live user acceptance remain required",
  },
});
const licenseDigest = sha256(await readFile(new URL("LICENSE", directory)));
const noticeDigest = sha256(await readFile(new URL("NOTICE", directory)));
await writeJson("package-manifest.json", {
  schemaVersion: 1,
  id: "slack",
  publisher: "supernala",
  version: "1.1.0",
  name: "Slack (Preview)",
  description:
    "Supernala's own MCP server for Slack Web API conversations, message and file search, profiles, messages, reactions, files, canvases and lists. User OAuth and agent approvals apply. Preview for pilot testing; Slack Marketplace approval remains pending.",
  license: "MIT",
  licenseEvidence: {
    kind: "spdx-mit-full-text",
    license: { path: "LICENSE", sha256: licenseDigest },
    notice: { path: "NOTICE", sha256: noticeDigest },
  },
  runtime: { kind: "managed-package", type: "node", node: "22.x", entrypoint: "dist/server.mjs" },
  catalog: { path: "catalog.json", sha256: catalogDigest },
  config: { path: "config.json", sha256: configDigest },
  authentication,
  network: { allowedHosts: ["slack.com"] },
  limits: { expandedBytes: 1048576, files: 20 },
  provenance: "provenance.json",
});
const files = [
  ["package-manifest.json", "plugin.json"],
  ["catalog.json", "catalog.json"],
  ["config.json", "config.json"],
  ["provenance.json", "provenance.json"],
  ["LICENSE", "LICENSE"],
  ["NOTICE", "NOTICE"],
  ["source/server.mjs", "dist/server.mjs"],
  ["source/slack-web-api.mjs", "dist/slack-web-api.mjs"],
  ["source/slack-tool-catalog.mjs", "dist/slack-tool-catalog.mjs"],
];
await writeJson("build-recipe.json", {
  schemaVersion: 1,
  source: "plugins/slack-api/source/server.mjs",
  output: "plugins/slack-api/dist/server.mjs",
  manifest: "plugins/slack-api/package-manifest.json",
  runtime: "node-22.x",
  runtimeDependencies: [],
  networkDuringBuild: false,
  lifecycleScripts: false,
  deterministicCopy: true,
  license: "MIT",
  licenseFile: "plugins/slack-api/LICENSE",
  noticeFile: "plugins/slack-api/NOTICE",
  preservedThirdPartyNotices: [],
  packageFiles: await Promise.all(
    files.map(async ([source, destination]) => ({
      source: `plugins/slack-api/${source}`,
      destination,
      sha256: sha256(await readFile(new URL(source, directory))),
    })),
  ),
});
process.stdout.write(
  `Prepared Slack Web API MCP: ${slackApiToolDefinitions.length} tools; ${scopes.length} user scopes. No publication performed.\n`,
);
