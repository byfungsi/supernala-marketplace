import { Result } from "effect";
import {
  pluginReleaseIdentityKey,
  releaseRecordIdentityIsCoherent,
  type ApplicationPublicationReader,
  type ImmutableArtifactReader,
  type IncrementalReleaseCandidate,
  type ReleaseJournalRecord,
} from "./release-machine.js";

/** Verify journal claims against application authority and complete immutable artifact bytes. */
export async function verifyPublishedReleaseBaseline(input: {
  readonly records: ReadonlyArray<ReleaseJournalRecord>;
  readonly application: ApplicationPublicationReader;
  readonly artifacts: ImmutableArtifactReader;
}): Promise<Result.Result<ReadonlyArray<ReleaseJournalRecord>, string>> {
  if (input.records.some((record) => !releaseRecordIdentityIsCoherent(record))) {
    return Result.fail("release-baseline-identity-incoherent");
  }
  const identities = input.records.map((record) => pluginReleaseIdentityKey(record.identity));
  if (new Set(identities).size !== identities.length) {
    return Result.fail("baseline-duplicate-release-identity");
  }
  const verified: Array<ReleaseJournalRecord> = [];
  for (const record of input.records) {
    if (record.status !== "published") {
      verified.push(record);
      continue;
    }
    const candidate: IncrementalReleaseCandidate = { ...record, artifactBytes: null };
    const applicationState = await input.application.readPublicationState(candidate);
    if (Result.isFailure(applicationState)) {
      return Result.fail("baseline-application-read-failed");
    }
    if (applicationState.success === "mismatch") {
      return Result.fail("baseline-application-state-mismatch");
    }
    if (
      record.kind !== "managed-package" ||
      record.artifactDigest === null ||
      record.artifactByteLength === null
    ) {
      return Result.fail("baseline-artifact-evidence-missing");
    }
    const artifactState = await input.artifacts.verifyExisting(
      record.artifactDigest,
      record.artifactByteLength,
    );
    if (Result.isFailure(artifactState)) return Result.fail("baseline-artifact-read-failed");
    if (!artifactState.success) return Result.fail("baseline-artifact-state-mismatch");
    verified.push(
      applicationState.success === "published"
        ? { ...record, durableStateVerified: true }
        : { ...record, durableStateRevoked: true },
    );
  }
  return Result.succeed(verified);
}
