import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { expect, it } from "@effect/vitest";
import { Result } from "effect";
import { preparePluginAuthoringSource, validatePluginAuthoringSource } from "./plugin-authoring.js";
import { validateManagedRemotePluginRelease } from "./remote-release.js";

it("prepares all three captured providers while retaining the independent review gate", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "marketplace-provider-candidates-"));
  try {
    for (const slug of ["atlassian", "canva", "buffer"]) {
      const sourcePath = `plugins/remotes/${slug}.json`;
      const validated = await validatePluginAuthoringSource(sourcePath);
      expect(validated).toMatchObject({
        _tag: "Success",
        success: {
          plugin: `supernala/${slug}`,
          publicationEligible: false,
          publicationBlocker: "remote-release-not-reviewed",
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

it("binds Buffer discovery to the advertised resource and dynamic authorization server", async () => {
  const parsed = validateManagedRemotePluginRelease(
    JSON.parse(await readFile("plugins/remotes/buffer.json", "utf8")),
    "authoring",
  );
  if (Result.isFailure(parsed)) throw new Error(parsed.failure);
  expect(parsed.success).toMatchObject({
    endpoint: "https://mcp.buffer.com/mcp",
    allowedHosts: ["mcp.buffer.com"],
    oauthRegistrationMode: "dynamic",
    authStrategy: {
      resourceMetadataUrl: "https://mcp.buffer.com/.well-known/oauth-protected-resource/mcp",
      clientRegistration: {
        kind: "dynamic",
        authorizationServerMetadataUrl:
          "https://auth.buffer.com/.well-known/oauth-authorization-server",
      },
    },
  });
  expect(parsed.success.scopes).not.toContain("offline_access");
  expect(parsed.success.scopes).toContain("posts:write");
});
