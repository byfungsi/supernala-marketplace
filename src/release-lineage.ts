import { Result } from "effect";
import { canonicalPluginJson } from "./plugin-contract.js";
import type { ReleaseReview } from "./release-bundle.js";
import {
  pluginReleaseIdentityKey,
  releaseRecordIdentityIsCoherent,
  type ApplicationAuthorityLineageReader,
  type IncrementalReleaseCandidate,
  type ReleaseJournalRecord,
} from "./release-machine.js";

const samePlugin = (
  left: IncrementalReleaseCandidate["identity"],
  right: IncrementalReleaseCandidate["identity"],
): boolean =>
  left.marketplaceId === right.marketplaceId &&
  left.publisherNamespace === right.publisherNamespace &&
  left.pluginSlug === right.pluginSlug;

/** Revalidate frozen reviewed authority lineage against current durable state before any write. */
export async function validatePublicationAuthorityLineage(input: {
  readonly candidate: IncrementalReleaseCandidate;
  readonly review: ReleaseReview;
  readonly records: ReadonlyArray<ReleaseJournalRecord>;
  readonly application: ApplicationAuthorityLineageReader;
}): Promise<Result.Result<void, string>> {
  if (input.records.some((record) => !releaseRecordIdentityIsCoherent(record))) {
    return Result.fail("release-lineage-journal-invalid");
  }
  const currentIdentity = pluginReleaseIdentityKey(input.candidate.identity);
  const prior = input.records
    .filter(
      (record) =>
        record.status === "published" &&
        pluginReleaseIdentityKey(record.identity) !== currentIdentity &&
        samePlugin(record.identity, input.candidate.identity),
    )
    .toSorted((left, right) => right.releaseOrdinal - left.releaseOrdinal);
  const applicationVersions = await input.application.listAuthorityVersionStates(
    input.candidate.identity,
  );
  if (Result.isFailure(applicationVersions)) {
    return Result.fail("release-lineage-application-list-failed");
  }
  const trackedVersionIds = new Set<string>(prior.map((record) => record.version.id));
  const untracked = applicationVersions.success.some(
    (version) =>
      version.versionId !== input.candidate.version.id && !trackedVersionIds.has(version.versionId),
  );
  if (untracked) return Result.fail("release-lineage-untracked-application-version");
  if (input.review.authorityBeforeIdentity === null) {
    return prior.length === 0
      ? Result.succeed(undefined)
      : Result.fail("release-bootstrap-lineage-stale");
  }
  if (
    !samePlugin(input.review.authorityBeforeIdentity, input.candidate.identity) ||
    input.review.authorityBeforeReleaseDigest === null
  ) {
    return Result.fail("release-previous-lineage-invalid");
  }
  const previous = prior[0];
  if (
    previous === undefined ||
    canonicalPluginJson(previous.identity) !==
      canonicalPluginJson(input.review.authorityBeforeIdentity) ||
    previous.releaseDigest !== input.review.authorityBeforeReleaseDigest ||
    previous.authorityDigest !== input.review.authorityBeforeDigest
  ) {
    return Result.fail("release-previous-lineage-stale");
  }
  const state = await input.application.readPublicationState({
    ...previous,
    artifactBytes: null,
  });
  if (Result.isFailure(state)) return Result.fail("release-previous-lineage-read-failed");
  return state.success === "published"
    ? Result.succeed(undefined)
    : Result.fail(
        state.success === "revoked"
          ? "release-previous-lineage-revoked"
          : "release-previous-lineage-mismatch",
      );
}
