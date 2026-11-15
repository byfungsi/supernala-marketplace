import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Result, Schema } from "effect";
import { expect, it } from "vitest";
import { compilePluginOpenApi } from "./plugin-openapi-compiler.js";
import { buildPluginOpenApiReleaseBundle } from "./plugin-openapi-release-bundle.js";
import { loadPluginOpenApiSource } from "./plugin-openapi-source.js";
import { digestReleaseSharedInputs, ReleaseReview } from "./release-bundle.js";
import { buildManagedRemoteReleaseBundle } from "./remote-release-bundle.js";

const sharedInputDigest = async () =>
  digestReleaseSharedInputs(
    Schema.decodeUnknownSync(Schema.Struct({ sharedInputs: Schema.Array(Schema.NonEmptyString) }))(
      JSON.parse(await readFile("releases/index.json", "utf8")),
    ).sharedInputs,
  );

const decodeReview = async (slug: string) =>
  Schema.decodeUnknownSync(ReleaseReview, { onExcessProperty: "error" })(
    JSON.parse(
      await readFile(`releases/reviews/supernala-public__supernala__${slug}__1.0.0.json`, "utf8"),
    ),
  );

it("binds the WordPress Self-Hosted review and sends every tool to the Owner's own site", async () => {
  const outputDirectory = await mkdtemp(path.join(os.tmpdir(), "wordpress-self-hosted-"));
  try {
    const built = await buildPluginOpenApiReleaseBundle({
      sourceDirectory: "plugins/wordpress-self-hosted",
      outputDirectory,
      sharedInputDigest: await sharedInputDigest(),
      mergeCommit: "a".repeat(40),
      releaseOrdinal: 1,
      review: await decodeReview("wordpress-self-hosted"),
      previousPublished: null,
    });
    if (Result.isFailure(built)) throw new Error(built.failure);
    const candidate = built.success;
    // The destination is whatever site the Owner enters, so no fixed host is admitted.
    expect(candidate.version.allowedHosts).toEqual([]);
    expect(candidate.authStrategy).toMatchObject({
      profile: "api-key",
      providerRegistrationId: "wordpress-site-v1",
      verification: { kind: "https-json-site", path: "/wp-json/wp/v2/users/me" },
      resources: { kind: "credential-site", field: "site" },
      delivery: [{ kind: "basic", usernameField: "username", passwordField: "password" }],
    });
    const tools = candidate.version.catalog.tools;
    expect(tools).toHaveLength(25);
    for (const tool of tools) {
      expect(tool.defaultPolicy).toBe(
        tool.classification === "read" ? "allow" : "require-approval",
      );
    }
    // Removing only ever moves to the trash: no tool can delete permanently.
    expect(
      tools.filter((tool) => tool.classification === "destructive").map((tool) => tool.id),
    ).toEqual(["wordpress.trash_comment", "wordpress.trash_page", "wordpress.trash_post"]);
    expect(tools.some((tool) => JSON.stringify(tool.inputSchema).includes('"force"'))).toBe(false);
  } finally {
    await rm(outputDirectory, { recursive: true, force: true });
  }
});

it("compiles a site server only for a site connection, and every binding to that site", async () => {
  const loaded = await loadPluginOpenApiSource("plugins/wordpress-self-hosted");
  if (Result.isFailure(loaded)) throw new Error(loaded.failure);
  expect(
    loaded.success.compiled.contract.bindings.every(
      (binding) => binding.origin === "connection-site" && binding.authentication === "connection",
    ),
  ).toBe(true);

  const sourceText = await readFile("plugins/wordpress-self-hosted/openapi.json", "utf8");
  const authoring = JSON.parse(
    await readFile("plugins/wordpress-self-hosted/openapi-source.json", "utf8"),
  );
  const fixed = sourceText.replace('"url": "https://{site}"', '"url": "https://example.com"');
  // A fixed server would ignore the site the Owner entered.
  const fixedResult = await compilePluginOpenApi({ sourceText: fixed, authoring });
  expect(Result.isFailure(fixedResult) && fixedResult.failure).toBe("openapi-source-unsupported");
  // A site server without a site connection has nowhere to send requests.
  const { verification: _verification, ...unverified } = authoring.authStrategy;
  const unsited = await compilePluginOpenApi({
    sourceText,
    authoring: { ...authoring, authStrategy: { ...unverified, resources: { kind: "none" } } },
  });
  expect(Result.isFailure(unsited) && unsited.failure).toBe("openapi-source-unsupported");
});

it("binds the WordPress.com review: lookups run freely and execute always asks", async () => {
  const outputDirectory = await mkdtemp(path.join(os.tmpdir(), "wordpress-com-"));
  try {
    const built = await buildManagedRemoteReleaseBundle({
      sourceFile: "plugins/remotes/wordpress-com.json",
      outputDirectory,
      sharedInputDigest: await sharedInputDigest(),
      mergeCommit: "a".repeat(40),
      releaseOrdinal: 1,
      review: await decodeReview("wordpress-com"),
      previousPublished: null,
    });
    if (Result.isFailure(built)) throw new Error(built.failure);
    expect(built.success.version.allowedHosts).toEqual(["public-api.wordpress.com"]);
    expect(
      built.success.version.catalog.tools.map((tool) => [
        tool.mcpName,
        tool.classification,
        tool.defaultPolicy,
      ]),
    ).toEqual([
      ["search", "read", "allow"],
      ["describe", "read", "allow"],
      ["docs", "read", "allow"],
      ["execute", "destructive", "require-approval"],
    ]);
  } finally {
    await rm(outputDirectory, { recursive: true, force: true });
  }
});
