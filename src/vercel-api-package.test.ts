import { PluginSha256 } from "./plugin-contract.js";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Result, Schema } from "effect";
import { expect, it } from "vitest";
import { buildPluginOpenApiReleaseBundle } from "./plugin-openapi-release-bundle.js";
import { releaseReviewFile, ReleaseReview } from "./release-bundle.js";
import { PluginReleaseIdentity } from "./release-machine.js";

// These reviews are published, so they stay bound to the shared release inputs of their day
// (main at f056756). Site connections changed those inputs later; rebuilding from today's
// sources against that pinned digest proves the current compiler still yields what was reviewed.
const publishedSharedInputDigest = PluginSha256.make(
  "2f04e09e4690764473d36670e07c34204fa2452877950e56396240baa0094216",
);

it("binds the Vercel review and keeps deletes, secrets and Git tokens out of Bot reach", async () => {
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
      sharedInputDigest: publishedSharedInputDigest,
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
