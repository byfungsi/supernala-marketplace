import { readFile } from "node:fs/promises";
import { expect, it } from "@effect/vitest";
import { Result, Schema } from "effect";
import { canonicalPluginJson, digestPluginBytes } from "./plugin-contract.js";
import { digestPluginOAuthProviderDefinition } from "./oauth-provider-definition.js";
import { captureRemoteMcpCatalog } from "./remote-catalog-capture.js";
import { validateManagedRemotePluginRelease } from "./remote-release.js";

it.each([
  ["atlassian", 117],
  ["canva", 49],
  ["buffer", 17],
  ["github", 46],
  ["slack", 27],
] as const)("binds %s authority to all %i consented tool schemas", async (slug, count) => {
  const captured = JSON.parse(
    await readFile(`fixtures/mcp/captures/${slug}-20261028.json`, "utf8"),
  );
  const observed = await captureRemoteMcpCatalog({ tools: captured.tools });
  if (Result.isFailure(observed)) throw new Error(observed.failure);
  expect(observed.success.digest).toBe(captured.digest);
  expect(observed.success.tools).toHaveLength(count);
  const parsed = validateManagedRemotePluginRelease(
    JSON.parse(await readFile(`plugins/remotes/${slug}.json`, "utf8")),
    "authoring",
  );
  if (Result.isFailure(parsed)) throw new Error(parsed.failure);
  const release = parsed.success;
  expect(release.catalog.tools).toHaveLength(count);
  for (const observedTool of observed.success.tools) {
    const reviewedTool = release.catalog.tools.find((tool) => tool.mcpName === observedTool.name);
    expect(reviewedTool?.inputSchema).toEqual(observedTool.inputSchema);
    if (reviewedTool?.classification !== "read") {
      expect(reviewedTool?.defaultPolicy).not.toBe("allow");
    }
  }
  expect(release.catalog.digest).toBe(
    await digestPluginBytes(
      new TextEncoder().encode(
        canonicalPluginJson({ schemaVersion: 1, tools: release.catalog.tools }),
      ),
    ),
  );
  if (release.oauthProviderDefinition === undefined) throw new Error("provider-definition-missing");
  expect(release.providerDefinitionDigest).toBe(
    await digestPluginOAuthProviderDefinition(release.oauthProviderDefinition),
  );
  expect(release.authStrategy?.profile).toBe("mcp-oauth");
});

it("labels the owner-authorized Slack preview without claiming directory approval", async () => {
  const source = JSON.parse(await readFile("plugins/remotes/slack.json", "utf8"));
  const parsed = validateManagedRemotePluginRelease(source, "publication");
  expect(Result.isSuccess(parsed)).toBe(true);
  expect(source.name).toBe("Slack (Preview)");
  expect(source.description).toContain("approval is pending");
  const index = Schema.decodeUnknownSync(
    Schema.Struct({
      plugins: Schema.Array(
        Schema.Struct({
          sourceDirectory: Schema.String,
          publicationEligible: Schema.Boolean,
        }),
      ),
    }),
  )(JSON.parse(await readFile("releases/index.json", "utf8")));
  expect(
    index.plugins.find(
      (entry: { readonly sourceDirectory: string }) =>
        entry.sourceDirectory === "plugins/remotes/slack.json",
    )?.publicationEligible,
  ).toBe(false);
  expect(
    index.plugins.find((entry) => entry.sourceDirectory === "plugins/slack-api")
      ?.publicationEligible,
  ).toBe(true);
});

it("publishes the Owner-authorized Atlassian personal-token preview without claiming an API-token capture", async () => {
  const value = JSON.parse(await readFile("plugins/remotes/atlassian-api-token.json", "utf8"));
  const parsed = validateManagedRemotePluginRelease(value, "authoring");
  if (Result.isFailure(parsed)) throw new Error(parsed.failure);
  const release = parsed.success;
  expect(release.authStrategy).toMatchObject({
    profile: "api-key",
    fields: [
      expect.objectContaining({ key: "email", secret: false }),
      expect.objectContaining({ key: "token", secret: true }),
      expect.objectContaining({ key: "domain", secret: false }),
    ],
    providerRegistrationId: "atlassian-oauth-v2",
    delivery: [
      {
        kind: "basic",
        headerName: "authorization",
        usernameField: "email",
        passwordField: "token",
      },
    ],
  });
  const oauth = JSON.parse(await readFile("plugins/remotes/atlassian.json", "utf8"));
  expect(release.catalog.id).toBe(oauth.catalog.id);
  expect(release.runtime.endpointRegistrationId).toBe(oauth.runtime.endpointRegistrationId);
  expect(release.runtime.providerRegistrationId).toBe(oauth.runtime.providerRegistrationId);
  expect(release.catalog.digest).toBe(oauth.catalog.digest);
  expect(release.scopes).toEqual([]);
  expect(release.oauthProviderDefinition).toBeUndefined();
  expect(release.providerDefinitionDigest).toBeUndefined();
  expect(release.authStrategy?.identity.kind).toBe("mcp-tool");
  expect(release.authStrategy?.resources).toMatchObject({
    kind: "credential-origin",
    field: "domain",
    allowedHostSuffixes: ["atlassian.net"],
  });
  if (release.authStrategy?.resources.kind !== "credential-origin")
    throw new Error("site binding missing");
  const siteTools = release.catalog.tools.filter(
    (tool) =>
      Schema.is(Schema.JsonObject)(tool.inputSchema.properties) &&
      Object.hasOwn(tool.inputSchema.properties, "cloudId"),
  );
  expect(release.authStrategy.resources.binding.appliesTo).toEqual({
    kind: "tool-list",
    toolIds: siteTools.map((tool) => tool.id),
  });
  expect(siteTools.length).toBeGreaterThan(0);
  expect(release.catalog.digest).toBe(
    await digestPluginBytes(
      new TextEncoder().encode(
        canonicalPluginJson({ schemaVersion: 1, tools: release.catalog.tools }),
      ),
    ),
  );
  expect(
    release.catalog.tools
      .filter((tool) => tool.classification !== "read")
      .every((tool) => tool.defaultPolicy === "require-approval"),
  ).toBe(true);
  expect(Result.isSuccess(validateManagedRemotePluginRelease(value, "publication"))).toBe(true);
  expect(release.verificationNotes).toContain("no API-token tools/list capture");
  expect(release.verificationNotes).toContain("Independent review waived, not passed");
  expect(release.protocolPolicy?.catalogCompatibility).toBe("reviewed-subset");
  expect(
    validateManagedRemotePluginRelease({ ...value, status: "staged-unverified" }, "publication"),
  ).toEqual(Result.fail("remote-release-not-reviewed"));
  const index = JSON.parse(await readFile("releases/index.json", "utf8"));
  expect(
    index.plugins.find(
      (entry: { readonly sourceDirectory: string }) =>
        entry.sourceDirectory === "plugins/remotes/atlassian-api-token.json",
    )?.publicationEligible,
  ).toBe(true);
});
