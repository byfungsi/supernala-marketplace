import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Result, Schema } from "effect";
import { expect, it } from "vitest";
import { buildPluginOpenApiReleaseBundle } from "./plugin-openapi-release-bundle.js";
import { digestReleaseSharedInputs, releaseReviewFile, ReleaseReview } from "./release-bundle.js";
import { PluginReleaseIdentity } from "./release-machine.js";

const decodeReview = async (semanticVersion: string) =>
  Schema.decodeUnknownSync(ReleaseReview, { onExcessProperty: "error" })(
    JSON.parse(
      await readFile(
        releaseReviewFile(
          PluginReleaseIdentity.make({
            marketplaceId: "supernala-public",
            publisherNamespace: "supernala",
            pluginSlug: "atlassian-api",
            semanticVersion,
          }),
        ),
        "utf8",
      ),
    ),
  );

it("binds the 1.0.1 review to the current source, with lineage from the published 1.0.0", async () => {
  const index = Schema.decodeUnknownSync(
    Schema.Struct({ sharedInputs: Schema.Array(Schema.NonEmptyString) }),
  )(JSON.parse(await readFile("releases/index.json", "utf8")));
  const previous = await decodeReview("1.0.0");
  const review = await decodeReview("1.0.1");
  // Output limits and descriptions changed; no tool's authority did, so existing grants carry over.
  expect(review.authorityAfter).toEqual(previous.authorityAfter);
  const outputDirectory = await mkdtemp(path.join(os.tmpdir(), "atlassian-api-release-"));
  try {
    const built = await buildPluginOpenApiReleaseBundle({
      sourceDirectory: "plugins/atlassian-api",
      outputDirectory,
      sharedInputDigest: await digestReleaseSharedInputs(index.sharedInputs),
      mergeCommit: "a".repeat(40),
      releaseOrdinal: 1,
      review,
      previousPublished: {
        status: "published",
        durableStateVerified: true,
        identity: previous.identity,
        releaseDigest: previous.releaseDigest,
        authorityDigest: previous.authorityDigest,
      },
    });
    if (Result.isFailure(built)) throw new Error(built.failure);
    const candidate = built.success;
    // Only Atlassian's gateway is reachable; the token is verified at the selected site.
    expect(candidate.version.allowedHosts).toEqual(["api.atlassian.com"]);
    expect(candidate.authStrategy).toMatchObject({
      profile: "api-key",
      providerRegistrationId: "atlassian-rest-v1",
      verification: { kind: "https-json-resource", pathBeforeResource: "/ex/jira/" },
      resources: { kind: "credential-origin", lookup: { idPath: ["cloudId"] } },
    });
    const tools = candidate.version.catalog.tools;
    expect(tools).toHaveLength(14);
    // Reads that can return large issues get the platform maximum; the rest keep 256 KiB.
    const limits = Object.fromEntries(tools.map((tool) => [tool.id, tool.maximumOutputBytes]));
    for (const id of [
      "jira.search_issues",
      "jira.get_issue",
      "jira.list_comments",
      "jira.list_issue_type_fields",
    ]) {
      expect(limits[id]).toBe(1_048_576);
    }
    expect(limits["jira.create_issue"]).toBe(262_144);
    // The Bot is told to keep searches small rather than ask for every field.
    const search = tools.find((tool) => tool.id === "jira.search_issues");
    expect(search?.description).toContain("Always pass `fields`");
    expect(search?.description).toContain("nextPageToken");
    expect(tools.every((tool) => !JSON.stringify(tool.inputSchema).includes("cloudId"))).toBe(true);
    // Reads run freely; every change asks the Owner first.
    expect(
      tools
        .filter((tool) => tool.classification === "write")
        .every((tool) => tool.defaultPolicy === "require-approval"),
    ).toBe(true);
  } finally {
    await rm(outputDirectory, { recursive: true });
  }
});
