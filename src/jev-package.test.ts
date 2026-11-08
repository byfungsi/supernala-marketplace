import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Result, Schema } from "effect";
import { expect, it } from "vitest";
import { buildPluginOpenApiReleaseBundle } from "./plugin-openapi-release-bundle.js";
import { digestReleaseSharedInputs, releaseReviewFile, ReleaseReview } from "./release-bundle.js";
import { PluginReleaseIdentity } from "./release-machine.js";

const sharedInputs = async () =>
  digestReleaseSharedInputs(
    Schema.decodeUnknownSync(Schema.Struct({ sharedInputs: Schema.Array(Schema.NonEmptyString) }))(
      JSON.parse(await readFile("releases/index.json", "utf8")),
    ).sharedInputs,
  );

it.each([
  ["jev", "api.typesafe.ai", ["jev-latest", "jev-1.14.0"]],
  ["jev-openrouter", "openrouter.ai", ["typesafe/jev-latest", "typesafe/jev-1.14"]],
] as const)("binds the %s review and offers one read tool, Ask Jev", async (slug, host, models) => {
  const review = Schema.decodeUnknownSync(ReleaseReview, { onExcessProperty: "error" })(
    JSON.parse(
      await readFile(
        releaseReviewFile(
          PluginReleaseIdentity.make({
            marketplaceId: "supernala-public",
            publisherNamespace: "supernala",
            pluginSlug: slug,
            semanticVersion: "1.0.0",
          }),
        ),
        "utf8",
      ),
    ),
  );
  const outputDirectory = await mkdtemp(path.join(os.tmpdir(), `${slug}-release-`));
  try {
    const built = await buildPluginOpenApiReleaseBundle({
      sourceDirectory: `plugins/${slug}`,
      outputDirectory,
      sharedInputDigest: await sharedInputs(),
      mergeCommit: "a".repeat(40),
      releaseOrdinal: 1,
      review,
      previousPublished: null,
    });
    if (Result.isFailure(built)) throw new Error(built.failure);
    const candidate = built.success;
    expect(candidate.version.allowedHosts).toEqual([host]);
    // The same tool id in both components lets the app treat either connection alike.
    expect(
      candidate.version.catalog.tools.map((tool) => [
        tool.id,
        tool.classification,
        tool.defaultPolicy,
      ]),
    ).toEqual([["jev.ask", "read", "allow"]]);
    expect(candidate.version.catalog.tools[0]?.inputSchema).toMatchObject({
      properties: { body: { properties: { model: { enum: models } } } },
    });
    expect(candidate.authStrategy).toMatchObject({
      profile: "api-key",
      verification: { kind: "https-json" },
    });
  } finally {
    await rm(outputDirectory, { recursive: true });
  }
});
