import { readFile } from "node:fs/promises";
import { expect, it } from "@effect/vitest";
import { Result } from "effect";
import { canonicalPluginJson, digestPluginBytes } from "./plugin-contract.js";
import { validateManagedRemotePluginRelease } from "./remote-release.js";

it("binds Resend 1.0.3 to the consented send-only schema and canonical catalog digest", async () => {
  const fixture = JSON.parse(await readFile("fixtures/remotes/resend-live-catalog.json", "utf8"));
  const source = JSON.parse(await readFile("plugins/remotes/resend.json", "utf8"));
  const parsed = validateManagedRemotePluginRelease(source, "publication");
  expect(Result.isSuccess(parsed)).toBe(true);
  if (Result.isFailure(parsed)) return;

  const release = parsed.success;
  expect(fixture).toMatchObject({
    source: "consented-resend-mcp-tools-list",
    scope: "emails:send",
    pageCount: 1,
  });
  expect(fixture.toolNames).toHaveLength(129);
  expect(fixture.toolNames.filter((name: string) => name === "send-email")).toHaveLength(1);
  expect(release.id).toBe("supernala-public:supernala:resend@1.0.3");
  expect(release.runtime).toMatchObject({
    endpointRegistrationId: "resend-mcp-v1",
    providerRegistrationId: "resend-oauth-cimd-v1",
    transport: "streamable-http",
  });
  expect(release.scopes).toEqual(["emails:send"]);
  expect(release.authStrategy).toMatchObject({
    profile: "mcp-oauth",
    requestedScopes: ["emails:send"],
    clientRegistration: {
      kind: "cimd",
      clientIdMetadataDocumentUrl: "https://supernala.com/.well-known/oauth-client/resend.json",
    },
    identity: { kind: "opaque-connection" },
  });
  expect(release.catalog.tools).toHaveLength(1);
  expect(release.catalog.tools[0]).toMatchObject({
    id: "resend.send_email",
    mcpName: "send-email",
    classification: "write",
    defaultPolicy: "require-approval",
  });
  expect(release.catalog.tools[0]?.inputSchema).toEqual(fixture.sendEmailInputSchema);
  expect(Object.keys(fixture.sendEmailInputSchema.properties)).toHaveLength(17);
  expect(fixture.sendEmailInputSchema.required).toEqual([
    "to",
    "subject",
    "text",
    "from",
    "context",
    "llm_model",
  ]);
  expect(fixture.sendEmailInputSchema).not.toHaveProperty("additionalProperties");
  expect(fixture.sendEmailInputSchema.required).not.toContain("conversation_id");
  expect(release.catalog.digest).toBe(
    await digestPluginBytes(
      new TextEncoder().encode(
        canonicalPluginJson({
          schemaVersion: release.catalog.schemaVersion,
          tools: release.catalog.tools,
        }),
      ),
    ),
  );

  const index = JSON.parse(await readFile("releases/index.json", "utf8"));
  expect(
    index.plugins.find(
      (plugin: { sourceDirectory: string }) => plugin.sourceDirectory === "plugins/resend-api",
    ),
  ).toMatchObject({
    publicationEligible: true,
    reason: expect.stringContaining(
      "Owner reauthorized the exact independently reviewed resend-api@1.0.0 release",
    ),
  });
  expect(
    index.plugins.find(
      (plugin: { sourceDirectory: string }) =>
        plugin.sourceDirectory === "plugins/remotes/resend.json",
    ),
  ).toMatchObject({ publicationEligible: true });
});
