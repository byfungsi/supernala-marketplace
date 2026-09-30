import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import { expect, it } from "@effect/vitest";
import { Result, Schema } from "effect";
import { preparePluginPackage, validatePluginSource } from "./authoring-validation.js";
import { PackageCatalog, PackageManifest } from "./package-archive.js";
import { digestPluginBytes } from "./plugin-contract.js";
import {
  decodePluginOAuthProviderDefinition,
  digestPluginOAuthProviderDefinition,
  encodePluginOAuthProviderDefinitionCanonicalJson,
} from "./oauth-provider-definition.js";
import { pluginVersionId } from "./release-bundle.js";
import {
  createGmailSendToolHandler,
  encodeGmailSendMime,
  gmailSendToolCatalog,
} from "../plugins/gmail-send/source/server.mjs";

const directory = "plugins/gmail-send";
const scopes = ["email", "https://www.googleapis.com/auth/gmail.send", "openid"];
const sample = {
  from: "sender@example.test",
  to: "recipient@example.test",
  subject: "Hello 🌍",
  bodyText: "First\nSecond",
};

it("declares only send authority under an independent BYO Google OAuth registration", async () => {
  const manifest = Schema.decodeUnknownSync(PackageManifest, { onExcessProperty: "error" })(
    JSON.parse(await readFile(`${directory}/package-manifest.json`, "utf8")),
  );
  const catalog = Schema.decodeUnknownSync(PackageCatalog, { onExcessProperty: "error" })(
    JSON.parse(await readFile(`${directory}/catalog.json`, "utf8")),
  );
  const provider = decodePluginOAuthProviderDefinition(
    JSON.parse(await readFile(`${directory}/oauth-provider.json`, "utf8")),
  );
  if (Result.isFailure(provider)) throw provider.failure;
  const bindings = JSON.parse(await readFile(`${directory}/platform-bindings.json`, "utf8"));
  const candidate = JSON.parse(await readFile(`${directory}/candidate.json`, "utf8"));
  const recipe = JSON.parse(await readFile(`${directory}/build-recipe.json`, "utf8"));
  const configBytes = new Uint8Array(await readFile(`${directory}/config.json`));
  const catalogBytes = new Uint8Array(await readFile(`${directory}/catalog.json`));
  expect(manifest.id).toBe("gmail-send");
  expect(manifest.version).toBe("0.1.0");
  expect(manifest.authentication).toMatchObject({
    kind: "oauth",
    providerRegistration: "google-gmail-send-rest-v1",
    requestedScopes: scopes,
    credentialDelivery: "short-lived-access-token-only",
  });
  if (manifest.authentication.kind !== "oauth")
    throw new Error("Gmail send OAuth authentication lost");
  expect(provider.success.scopes).toEqual(scopes);
  expect(provider.success.tokens.grantedScopes).toEqual({
    whenOmitted: "requested-scopes",
    whenPresent: "exact-match",
  });
  expect(provider.success.account).toMatchObject({
    kind: "https-json",
    endpoint: "https://openidconnect.googleapis.com/v1/userinfo",
    subjectPath: ["sub"],
    displayLabelPath: ["email"],
  });
  const providerDigest = await digestPluginOAuthProviderDefinition(provider.success);
  expect(providerDigest).toBe(
    await digestPluginBytes(encodePluginOAuthProviderDefinitionCanonicalJson(provider.success)),
  );
  expect(manifest.authentication.providerDefinitionDigest).toBe(providerDigest);
  expect(candidate.authentication).toEqual(manifest.authentication);
  expect(candidate.runtime).toEqual(manifest.runtime);
  expect(manifest.catalog.sha256).toBe(await digestPluginBytes(catalogBytes));
  expect(manifest.config.sha256).toBe(await digestPluginBytes(configBytes));
  expect(recipe.packageFiles.map((file: { source: string }) => file.source)).not.toContain(
    `${directory}/oauth-provider.json`,
  );
  expect(bindings.providerDefinition.canonicalSha256).toBe(providerDigest);
  expect(bindings.providerRegistration).toBe("google-gmail-send-rest-v1");
  expect(bindings.providerMetadata.approvedScopes).toEqual(scopes);
  expect(bindings.providerMetadata.provider).toBe(provider.success.provider);
  expect(bindings.providerMetadata.resourceIdentity).toBe(provider.success.resourceIdentity);
  expect(bindings.workspaceOAuthApp).toMatchObject({
    ownership: "workspace-owner",
    credentialFields: ["clientId", "clientSecret"],
    storage: "encrypted-plugin-vault",
  });
  expect(candidate.status).toBe("owner-authorized-publication-ready");
  expect(catalog.tools).toHaveLength(1);
  expect(catalog.tools[0]).toMatchObject({
    id: "gmail.send_message",
    mcpName: "send_message",
    classification: "write",
    defaultPolicy: "require-approval",
  });
  expect(gmailSendToolCatalog).toHaveLength(1);
  expect(gmailSendToolCatalog).toEqual(
    catalog.tools.map((tool) => ({
      name: tool.mcpName,
      description: tool.description,
      inputSchema: tool.inputSchema,
    })),
  );
});

it("constructs bounded text-only MIME and rejects header injection before dispatch", async () => {
  const mime = Buffer.from(encodeGmailSendMime(sample), "base64url").toString("utf8");
  expect(mime).toContain("From: sender@example.test\r\n");
  expect(mime).toContain("To: recipient@example.test\r\n");
  expect(mime).toContain("Content-Type: text/plain; charset=UTF-8\r\n");
  expect(mime).toContain("Content-Transfer-Encoding: base64\r\n");
  expect(mime).not.toContain("text/html");
  const encodedBody = mime.split("\r\n\r\n")[1];
  expect(Buffer.from(encodedBody ?? "", "base64").toString("utf8")).toBe("First\r\nSecond");
  for (const invalid of [
    { ...sample, from: "a@example.test\r\nBcc: victim@example.test" },
    { ...sample, to: "a@example.test\r\nBcc: victim@example.test" },
    { ...sample, subject: "Hello\nBcc: victim@example.test" },
    { ...sample, bodyText: "x".repeat(65_537) },
    { ...sample, html: "<script>send()</script>" },
  ]) {
    expect(() => encodeGmailSendMime(invalid)).toThrow();
  }
  const subjectHeader = mime.split("\r\nMIME-Version:")[0];
  expect(subjectHeader).toContain("=?UTF-8?B?");
});

it("dispatches one POST and never replays an ambiguous or unreadable result", async () => {
  const requests: Array<{ url: string; init: RequestInit }> = [];
  const fetchImplementation: typeof fetch = async (input, init) => {
    requests.push({
      url: input instanceof Request ? input.url : input instanceof URL ? input.href : input,
      init: init ?? {},
    });
    return Response.json({ id: "message-1", extra: "not returned" });
  };
  const send = createGmailSendToolHandler({
    accessToken: "test",
    fetch: fetchImplementation,
  });
  await expect(send("send_message", sample)).resolves.toEqual({ messageId: "message-1" });
  expect(requests).toHaveLength(1);
  expect(requests[0]?.url).toBe("https://gmail.googleapis.com/gmail/v1/users/me/messages/send");
  expect(requests[0]?.init.method).toBe("POST");
  expect(new Headers(requests[0]?.init.headers).get("Authorization")).toBe("Bearer test");
  const requestBody = requests[0]?.init.body;
  if (typeof requestBody !== "string") throw new Error("Gmail send request body must be JSON");
  expect(JSON.parse(requestBody)).toEqual({ raw: encodeGmailSendMime(sample) });
  await expect(send("get_message", sample)).rejects.toThrow("Gmail send tool unavailable");
  await expect(
    send("send_message", { ...sample, from: "bad\r\nBcc: victim@example.test" }),
  ).rejects.toThrow("Gmail send sender invalid");
  expect(requests).toHaveLength(1);

  const rejected = createGmailSendToolHandler({
    accessToken: "test",
    fetch: async () => new Response("sensitive provider payload", { status: 403 }),
  });
  await expect(rejected("send_message", sample)).rejects.toThrow(
    "Gmail send provider rejected request; do not retry automatically",
  );

  for (const brokenFetch of [
    async () => {
      throw new Error("sensitive provider payload");
    },
    async () => new Response("not JSON", { status: 200 }),
    async () => new Response("x".repeat(16_385), { status: 200 }),
  ]) {
    let attempts = 0;
    const ambiguous = createGmailSendToolHandler({
      accessToken: "test",
      fetch: async () => {
        attempts++;
        return brokenFetch();
      },
    });
    await expect(ambiguous("send_message", sample)).rejects.toThrow(
      "Gmail send outcome ambiguous; do not retry automatically",
    );
    expect(attempts).toBe(1);
  }
});

it("serves the send catalog and validates calls over the actual MCP stdio interface", async () => {
  const child = spawn(process.execPath, [`${directory}/source/server.mjs`], {
    env: {},
    stdio: ["pipe", "pipe", "pipe"],
  });
  const output: Buffer[] = [];
  child.stdout.on("data", (chunk: Buffer) => output.push(chunk));
  child.stdin.write(
    `${JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18" } })}\n`,
  );
  child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/list" })}\n`);
  child.stdin.write(
    `${JSON.stringify({ jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "send_message", arguments: { ...sample, subject: "bad\nBcc: victim@example.test" } } })}\n`,
  );
  child.stdin.write(
    `${JSON.stringify({ jsonrpc: "2.0", id: 4, method: "tools/call", params: { name: "send_message", arguments: { ...sample, from: "other@example.test\r\nBcc: victim@example.test" } } })}\n`,
  );
  child.stdin.write(
    '{"jsonrpc":"2.0","id":5,"method":"tools/call","params":{"name":"send_message","arguments":{"bodyText":"private sample"}},"bad":}\n',
  );
  child.stdin.end();
  const exitCode = await new Promise<number | null>((resolve) => child.once("close", resolve));
  expect(exitCode).toBe(0);
  const responses = Buffer.concat(output)
    .toString("utf8")
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line));
  expect(responses).toHaveLength(5);
  expect(responses[0]).toMatchObject({ result: { protocolVersion: "2025-06-18" } });
  expect(responses[1]).toMatchObject({ result: { tools: gmailSendToolCatalog } });
  expect(responses[2]).toMatchObject({ error: { message: "Gmail send subject invalid" } });
  expect(responses[3]).toMatchObject({ error: { message: "Gmail send sender invalid" } });
  expect(responses[4]).toMatchObject({ error: { message: "Gmail send request JSON invalid" } });
  expect(JSON.stringify(responses)).not.toContain("private sample");
});

it("validates source, recipe bytes, and prepared archive without changing existing Gmail", async () => {
  const recipe = JSON.parse(await readFile(`${directory}/build-recipe.json`, "utf8"));
  for (const file of recipe.packageFiles) {
    expect(await digestPluginBytes(new Uint8Array(await readFile(file.source)))).toBe(file.sha256);
  }
  const source = await validatePluginSource(directory);
  if (Result.isFailure(source)) throw source.failure;
  const prepared = await preparePluginPackage({
    source: source.success,
    marketplaceId: "supernala-public",
    versionId: pluginVersionId({
      marketplaceId: "supernala-public",
      publisherNamespace: "supernala",
      pluginSlug: "gmail-send",
      semanticVersion: "0.1.0",
    }),
    publishedAt: 0,
  });
  if (Result.isFailure(prepared)) throw prepared.failure;
  expect(prepared.success).toBeDefined();
});
