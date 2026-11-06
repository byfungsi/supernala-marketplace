import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { expect, it } from "@effect/vitest";
import { Result } from "effect";
import { preparePluginAuthoringSource, validatePluginAuthoringSource } from "./plugin-authoring.js";
import { validateManagedRemotePluginRelease } from "./remote-release.js";

it("prepares Owner-authorized providers while preserving evidence and staged-source gates", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "marketplace-provider-candidates-"));
  try {
    for (const slug of ["atlassian", "canva", "buffer"]) {
      const sourcePath = `plugins/remotes/${slug}.json`;
      const validated = await validatePluginAuthoringSource(sourcePath);
      expect(validated).toMatchObject({
        _tag: "Success",
        success: {
          plugin: `supernala/${slug}`,
          publicationEligible: true,
        },
      });
      const prepared = await preparePluginAuthoringSource({
        sourcePath,
        outputFile: path.join(root, `${slug}.json`),
      });
      expect(Result.isSuccess(prepared)).toBe(true);
      const declaration = validateManagedRemotePluginRelease(
        JSON.parse(await readFile(sourcePath, "utf8")),
        "authoring",
      );
      if (Result.isFailure(declaration)) throw new Error(declaration.failure);
      expect(declaration.success.verificationNotes).toContain("waived");
      expect(
        validateManagedRemotePluginRelease(
          Object.assign({}, declaration.success, { status: "staged-unverified" }),
          "publication",
        ),
      ).toEqual(Result.fail("remote-release-not-reviewed"));
      expect(
        validateManagedRemotePluginRelease(
          Object.assign({}, declaration.success, {
            status: "reviewed-publishable",
            catalog: Object.assign({}, declaration.success.catalog, { tools: [] }),
          }),
          "publication",
        ),
      ).toEqual(Result.fail("remote-release-evidence-incomplete"));
    }
  } finally {
    await rm(root, { recursive: true });
  }
});

it("keeps Canva Developer Portal authority separate from the earlier CIMD surface", async () => {
  const parsed = validateManagedRemotePluginRelease(
    JSON.parse(await readFile("plugins/remotes/canva.json", "utf8")),
    "authoring",
  );
  if (Result.isFailure(parsed)) throw new Error(parsed.failure);
  expect(parsed.success).toMatchObject({
    endpoint: "https://api.canva.com/connect/v1/mcp",
    allowedHosts: ["api.canva.com"],
    oauthRegistrationMode: "platform-pre-registered",
    authStrategy: {
      clientRegistration: { kind: "pre-registered" },
      resourceMetadataUrl:
        "https://api.canva.com/.well-known/oauth-protected-resource/connect/v1/mcp",
    },
  });
});

it("connects Buffer with a per-user Bearer API key instead of dynamic OAuth", async () => {
  const parsed = validateManagedRemotePluginRelease(
    JSON.parse(await readFile("plugins/remotes/buffer.json", "utf8")),
    "publication",
  );
  if (Result.isFailure(parsed)) throw new Error(parsed.failure);
  expect(parsed.success).toMatchObject({
    version: "1.1.1",
    // Name and description live on the shared Plugin definition; finalize rejects any change.
    name: "Buffer",
    description:
      "Buffer hosted MCP integration for social channels, posts, ideas, analytics, and reusable templates; catalog capture and authority review pending",
    endpoint: "https://mcp.buffer.com/mcp",
    allowedHosts: ["mcp.buffer.com"],
    runtime: { endpointRegistrationId: "buffer-mcp-v1", providerRegistrationId: "buffer-oauth-v1" },
    authStrategy: {
      profile: "api-key",
      providerRegistrationId: "buffer-oauth-v1",
      fields: [{ key: "token", secret: true }],
      delivery: [
        { kind: "header", field: "token", headerName: "authorization", encoding: "bearer" },
      ],
      identity: {
        kind: "mcp-tool",
        operation: { toolName: "get_account", resultTextContentIndex: 0 },
      },
      resources: { kind: "none" },
    },
  });
  expect(parsed.success.scopes).toEqual([]);
  expect(parsed.success.oauthProviderDefinition).toBeUndefined();
  expect(parsed.success.providerDefinitionDigest).toBeUndefined();
  expect(parsed.success.verificationNotes).toContain("no API-key tools/list capture");
});
