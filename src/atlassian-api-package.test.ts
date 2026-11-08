import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Result, Schema } from "effect";
import { expect, it } from "vitest";
import { buildPluginOpenApiReleaseBundle } from "./plugin-openapi-release-bundle.js";
import { digestReleaseSharedInputs, releaseReviewFile, ReleaseReview } from "./release-bundle.js";
import { PluginReleaseIdentity } from "./release-machine.js";

it("binds the Jira REST review to the current source and keeps the site out of Bot input", async () => {
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
            pluginSlug: "atlassian-api",
            semanticVersion: "1.0.0",
          }),
        ),
        "utf8",
      ),
    ),
  );
  const outputDirectory = await mkdtemp(path.join(os.tmpdir(), "atlassian-api-release-"));
  try {
    const built = await buildPluginOpenApiReleaseBundle({
      sourceDirectory: "plugins/atlassian-api",
      outputDirectory,
      sharedInputDigest: await digestReleaseSharedInputs(index.sharedInputs),
      mergeCommit: "a".repeat(40),
      releaseOrdinal: 1,
      review,
      previousPublished: null,
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
