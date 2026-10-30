import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { expect, it } from "@effect/vitest";
import { Result, Schema } from "effect";
import { loadReviewedPackagedOAuthProviderAuthority } from "./packaged-oauth-provider-authority.js";
import { PackagedOAuthAuthentication } from "./oauth-provider-definition.js";

const authenticationFor = async (directory: string) => {
  const manifest = Schema.decodeUnknownSync(
    Schema.fromJsonString(Schema.Struct({ authentication: PackagedOAuthAuthentication })),
  )(await readFile(path.join(directory, "package-manifest.json"), "utf8"));
  return manifest.authentication;
};

it("selects a reviewed platform package without admitting or reading client credentials", async () => {
  expect(
    await loadReviewedPackagedOAuthProviderAuthority({
      sourceDirectory: "plugins/slack-api",
      authentication: await authenticationFor("plugins/slack-api"),
    }),
  ).toEqual(Result.succeed({ kind: "platform-pre-registered" }));
});

it("retains Workspace-owned Gmail provider admission", async () => {
  const result = await loadReviewedPackagedOAuthProviderAuthority({
    sourceDirectory: "plugins/gmail",
    authentication: await authenticationFor("plugins/gmail"),
  });
  expect(result).toMatchObject({
    _tag: "Success",
    success: {
      kind: "workspace-oauth-app",
      authority: { providerRegistrationId: "google-gmail-rest-v1" },
    },
  });
});

it.each([
  (bindings: Readonly<Record<string, Schema.Json>>) => ({
    ...bindings,
    providerRegistration: "other-provider",
  }),
  (bindings: Readonly<Record<string, Schema.Json>>) => ({
    ...bindings,
    unexpectedCredential: "fixture",
  }),
  (bindings: Readonly<Record<string, Schema.Json>>) => ({
    ...bindings,
    providerDefinition: { path: "../outside.json", canonicalSha256: "0".repeat(64) },
  }),
  (bindings: Readonly<Record<string, Schema.Json>>) => ({
    ...bindings,
    deploymentClient: {
      clientIdBinding: "SAME_BINDING",
      clientSecretBinding: "SAME_BINDING",
      tokenEndpointAuthMethod: "client_secret_post",
    },
  }),
  (bindings: Readonly<Record<string, Schema.Json>>) => ({
    ...bindings,
    providerMetadata: {
      provider: "slack-web-api",
      resourceIdentity: "slack-web-api",
      registrationMode: "platform-pre-registered",
      source: "platform",
      approvedScopes: [],
    },
  }),
])(
  "rejects tampered packaged platform bindings without falling back to Workspace admission",
  async (change) => {
    const directory = await mkdtemp(path.join(tmpdir(), "slack-provider-authority-"));
    try {
      await cp(
        "plugins/slack-api/oauth-provider.json",
        path.join(directory, "oauth-provider.json"),
      );
      const bindings = Schema.decodeUnknownSync(Schema.fromJsonString(Schema.JsonObject))(
        await readFile("plugins/slack-api/platform-bindings.json", "utf8"),
      );
      await writeFile(
        path.join(directory, "platform-bindings.json"),
        JSON.stringify(change(bindings)),
      );
      const result = await loadReviewedPackagedOAuthProviderAuthority({
        sourceDirectory: directory,
        authentication: await authenticationFor("plugins/slack-api"),
      });
      expect(Result.isFailure(result)).toBe(true);
    } finally {
      await rm(directory, { recursive: true });
    }
  },
);
