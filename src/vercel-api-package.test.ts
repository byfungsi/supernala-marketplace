import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Result, Schema } from "effect";
import { expect, it } from "vitest";
import { buildPluginOpenApiReleaseBundle } from "./plugin-openapi-release-bundle.js";
import { digestReleaseSharedInputs, releaseReviewFile, ReleaseReview } from "./release-bundle.js";
import { PluginReleaseIdentity } from "./release-machine.js";

it("binds the Vercel review and keeps deletes, secrets and Git tokens out of Bot reach", async () => {
  const index = Schema.decodeUnknownSync(
    Schema.Struct({ sharedInputs: Schema.Array(Schema.NonEmptyString) }),
  )(JSON.parse(await readFile("releases/index.json", "utf8")));
  const review = Schema.decodeUnknownSync(ReleaseReview, { onExcessProperty: "error" })(
    JSON.parse(
      await readFile(
        releaseReviewFile(
          PluginReleaseIdentity.make({
            marketplaceId: "supernala-public",
            publisherNamespace: "supernala",
            pluginSlug: "vercel-api",
            semanticVersion: "1.0.0",
          }),
        ),
        "utf8",
      ),
    ),
  );
  const outputDirectory = await mkdtemp(path.join(os.tmpdir(), "vercel-api-release-"));
  try {
    const built = await buildPluginOpenApiReleaseBundle({
      sourceDirectory: "plugins/vercel-api",
      outputDirectory,
      sharedInputDigest: await digestReleaseSharedInputs(index.sharedInputs),
      mergeCommit: "a".repeat(40),
      releaseOrdinal: 1,
      review,
      previousPublished: null,
    });
    if (Result.isFailure(built)) throw new Error(built.failure);
    const { version } = built.success;
    expect(version.allowedHosts).toEqual(["api.vercel.com"]);
    const tools = version.catalog.tools;
    expect(tools).toHaveLength(26);
    // Writes default to allow at the Owner's request; nothing destructive is offered.
    expect(tools.filter((tool) => tool.classification === "write")).toHaveLength(9);
    expect(tools.every((tool) => tool.defaultPolicy === "allow")).toBe(true);
    expect(tools.some((tool) => tool.classification === "destructive")).toBe(false);
    const schemas = JSON.stringify(tools.map((tool) => tool.inputSchema));
    expect(schemas).not.toContain("gitAccessToken");
    expect(schemas).not.toContain('"decrypt"');
  } finally {
    await rm(outputDirectory, { recursive: true });
  }
});
