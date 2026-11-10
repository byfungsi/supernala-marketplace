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

const decodeReview = async (slug: string, semanticVersion: string) =>
  Schema.decodeUnknownSync(ReleaseReview, { onExcessProperty: "error" })(
    JSON.parse(
      await readFile(
        releaseReviewFile(
          PluginReleaseIdentity.make({
            marketplaceId: "supernala-public",
            publisherNamespace: "supernala",
            pluginSlug: slug,
            semanticVersion,
          }),
        ),
        "utf8",
      ),
    ),
  );

// OpenRouter rejects the `typesafe/jev-latest` alias with HTTP 400, so 1.0.1 offers only the
// pinned model; its review has lineage from the published 1.0.0.
it.each([
  ["jev", "1.0.0", null, "api.typesafe.ai", ["jev-latest", "jev-1.14.0"]],
  ["jev-openrouter", "1.0.1", "1.0.0", "openrouter.ai", ["typesafe/jev-1.14"]],
] as const)(
  "binds the %s %s review and offers one read tool, Ask Jev",
  async (slug, semanticVersion, previousVersion, host, models) => {
    const review = await decodeReview(slug, semanticVersion);
    const previous = previousVersion === null ? null : await decodeReview(slug, previousVersion);
    const outputDirectory = await mkdtemp(path.join(os.tmpdir(), `${slug}-release-`));
    try {
      const built = await buildPluginOpenApiReleaseBundle({
        sourceDirectory: `plugins/${slug}`,
        outputDirectory,
        sharedInputDigest: await sharedInputs(),
        mergeCommit: "a".repeat(40),
        releaseOrdinal: 1,
        review,
        previousPublished:
          previous === null
            ? null
            : {
                status: "published",
                durableStateVerified: true,
                identity: previous.identity,
                releaseDigest: previous.releaseDigest,
                authorityDigest: previous.authorityDigest,
              },
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
  },
);
