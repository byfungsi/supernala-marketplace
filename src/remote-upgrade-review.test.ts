import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "@effect/vitest";
import { Result, Schema } from "effect";
import { digestReleaseSharedInputs, ReleaseReview } from "./release-bundle.js";
import {
  buildManagedRemoteReleaseBundle,
  draftManagedRemoteUpgradeReview,
} from "./remote-release-bundle.js";

const ReleaseIndex = Schema.Struct({ sharedInputs: Schema.Array(Schema.String) });

const readReview = async (file: string) =>
  Schema.decodeUnknownSync(ReleaseReview)(JSON.parse(await readFile(file, "utf8")));

const sourceFile = "plugins/remotes/supernala-social.json";
const previousFile = "releases/reviews/supernala-public__supernala__supernala-social__1.0.0.json";

describe("managed remote upgrade reviews", () => {
  it("drafts a later version on its published predecessor's authority, which the build accepts", async () => {
    const index = Schema.decodeUnknownSync(ReleaseIndex)(
      JSON.parse(await readFile("releases/index.json", "utf8")),
    );
    const sharedInputDigest = await digestReleaseSharedInputs(index.sharedInputs);
    const previous = await readReview(previousFile);
    const drafted = await draftManagedRemoteUpgradeReview({
      sourceFile,
      sharedInputDigest,
      reviewId: "offline-upgrade",
      reviewer: "offline-check",
      reviewedAt: 1,
      previousReview: previous,
    });
    if (Result.isFailure(drafted)) throw new Error(drafted.failure);
    const review = drafted.success;
    expect(review.identity.semanticVersion).not.toBe(previous.identity.semanticVersion);
    expect(review.authorityBeforeIdentity).toEqual(previous.identity);
    expect(review.authorityBeforeReleaseDigest).toBe(previous.releaseDigest);
    expect(review.authorityBefore).toEqual(previous.authorityAfter);
    expect(review.authorityBeforeDigest).toBe(previous.authorityDigest);

    const outputDirectory = await mkdtemp(path.join(tmpdir(), "remote-upgrade-review-"));
    try {
      const build = (
        previousPublished: Parameters<
          typeof buildManagedRemoteReleaseBundle
        >[0]["previousPublished"],
      ) =>
        buildManagedRemoteReleaseBundle({
          sourceFile,
          outputDirectory,
          sharedInputDigest,
          mergeCommit: "a".repeat(40),
          releaseOrdinal: 2,
          review,
          previousPublished,
        });
      const accepted = await build({
        status: "published",
        durableStateVerified: true,
        identity: previous.identity,
        releaseDigest: previous.releaseDigest,
        authorityDigest: previous.authorityDigest,
      });
      expect(Result.isSuccess(accepted)).toBe(true);
      // Without a published predecessor the upgrade review's lineage is refused.
      expect(await build(null)).toEqual(
        Result.fail("release-bootstrap-authority-baseline-mismatch"),
      );
    } finally {
      await rm(outputDirectory, { recursive: true, force: true });
    }
  });

  it("refuses a predecessor review of another Plugin", async () => {
    const index = Schema.decodeUnknownSync(ReleaseIndex)(
      JSON.parse(await readFile("releases/index.json", "utf8")),
    );
    const drafted = await draftManagedRemoteUpgradeReview({
      sourceFile,
      sharedInputDigest: await digestReleaseSharedInputs(index.sharedInputs),
      reviewId: "offline-upgrade",
      reviewer: "offline-check",
      reviewedAt: 1,
      previousReview: await readReview(
        "releases/reviews/supernala-public__supernala__tebar__1.0.0.json",
      ),
    });
    expect(drafted).toEqual(Result.fail("previous-review-mismatch"));
  });
});
