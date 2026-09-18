import { expect, it } from "@effect/vitest";
import { Result } from "effect";
import { preparePluginPackage, validatePluginSource } from "./authoring-validation.js";
import { PluginAuthoritySnapshot } from "./authority-diff.js";
import { ReleaseReview } from "./release-bundle.js";
import { validatePublicationAuthorityLineage } from "./release-lineage.js";
import { digestPluginBytes, PluginSha256, PluginVersion } from "./plugin-contract.js";
import { verifyPublishedReleaseBaseline } from "./release-baseline.js";
import {
  InMemoryReleaseJournal,
  pluginReleaseIdentityKey,
  selectIncrementalReleaseSources,
  type ApplicationPublicationReader,
  type ImmutableArtifactReader,
  type IncrementalReleaseCandidate,
} from "./release-machine.js";

const publishedCandidate = async (): Promise<IncrementalReleaseCandidate> => {
  const source = await validatePluginSource("plugins/offline-fixture");
  if (Result.isFailure(source)) throw new Error("test-source-invalid");
  const prepared = await preparePluginPackage({
    source: source.success,
    marketplaceId: "supernala-public",
    versionId: "supernala-public:supernala:offline-fixture@1.0.0",
    publishedAt: 1,
  });
  if (Result.isFailure(prepared)) throw new Error("test-package-invalid");
  return {
    identity: {
      marketplaceId: "supernala-public",
      publisherNamespace: "supernala",
      pluginSlug: "offline-fixture",
      semanticVersion: "1.0.0",
    },
    definitionId: "supernala-public:supernala:offline-fixture",
    version: prepared.success.parsed.version,
    authentication: prepared.success.parsed.authentication,
    kind: "managed-package",
    sourceInputDigest: PluginSha256.make("1".repeat(64)),
    releaseDigest: PluginSha256.make("2".repeat(64)),
    catalogDigest: prepared.success.parsed.version.catalog.digest,
    configDigest: prepared.success.parsed.configDigest,
    provenance: prepared.success.parsed.provenance,
    provenanceDigest: PluginSha256.make("3".repeat(64)),
    authorityBaselineDigest: PluginSha256.make("6".repeat(64)),
    authorityDigest: PluginSha256.make("4".repeat(64)),
    authorityDiffDigest: PluginSha256.make("5".repeat(64)),
    artifactDigest: await digestPluginBytes(prepared.success.archiveBytes),
    artifactByteLength: prepared.success.archiveBytes.byteLength,
    artifactBytes: prepared.success.archiveBytes,
    mergeCommit: "a".repeat(40),
    releaseOrdinal: 1,
    reviewId: "synthetic-review",
    reviewer: "synthetic-reviewer",
    reviewedAt: 1,
  };
};

class ControlledApplicationReader implements ApplicationPublicationReader {
  reads = 0;
  constructor(readonly result: Result.Result<"published" | "revoked" | "mismatch", string>) {}
  async readPublicationState(): Promise<
    Result.Result<"published" | "revoked" | "mismatch", string>
  > {
    this.reads += 1;
    return this.result;
  }
}

class ControlledArtifactReader implements ImmutableArtifactReader {
  reads = 0;
  observedByteLength: number | null = null;
  constructor(readonly result: Result.Result<boolean, string>) {}
  async verifyExisting(
    _digest: typeof PluginSha256.Type,
    expectedByteLength: number,
  ): Promise<Result.Result<boolean, string>> {
    this.reads += 1;
    this.observedByteLength = expectedByteLength;
    return this.result;
  }
}

class ControlledLineageReader extends ControlledApplicationReader {
  constructor(
    result: Result.Result<"published" | "revoked" | "mismatch", string>,
    readonly versions: ReadonlyArray<{
      readonly versionId: string;
      readonly status: "published" | "revoked";
    }>,
  ) {
    super(result);
  }
  async listAuthorityVersionStates() {
    return Result.succeed(this.versions);
  }
}

const publishedRecord = async () => {
  const candidate = await publishedCandidate();
  const journal = new InMemoryReleaseJournal();
  const claim = await journal.claim(candidate);
  if (Result.isFailure(claim)) throw new Error("test-claim-failed");
  await journal.markPublished(
    pluginReleaseIdentityKey(candidate.identity),
    claim.success.record.generation,
  );
  const record = (await journal.list())[0];
  if (record === undefined) throw new Error("test-record-missing");
  return { candidate, record };
};

it("marks published baseline rows only after application and complete artifact verification", async () => {
  const { candidate, record } = await publishedRecord();
  const application = new ControlledApplicationReader(Result.succeed("published"));
  const artifacts = new ControlledArtifactReader(Result.succeed(true));
  const result = await verifyPublishedReleaseBaseline({
    records: [record],
    application,
    artifacts,
  });
  expect(Result.isSuccess(result)).toBe(true);
  if (Result.isFailure(result)) return;
  expect(result.success).toMatchObject([{ durableStateVerified: true }]);
  expect(application.reads).toBe(1);
  expect(artifacts.reads).toBe(1);
  expect(artifacts.observedByteLength).toBe(candidate.artifactByteLength);
  expect(
    selectIncrementalReleaseSources({
      sources: [
        {
          identity: candidate.identity,
          kind: candidate.kind,
          sourceInputDigest: candidate.sourceInputDigest,
          publicationEligible: true,
        },
      ],
      journal: result.success,
    }),
  ).toEqual(Result.succeed([]));
});

it("fails closed before artifact reads when application state does not match", async () => {
  const { record } = await publishedRecord();
  const artifacts = new ControlledArtifactReader(Result.succeed(true));
  expect(
    await verifyPublishedReleaseBaseline({
      records: [record],
      application: new ControlledApplicationReader(Result.succeed("mismatch")),
      artifacts,
    }),
  ).toEqual(Result.fail("baseline-application-state-mismatch"));
  expect(artifacts.reads).toBe(0);
});

it("fails closed when complete artifact bytes are absent or mismatched", async () => {
  const { record } = await publishedRecord();
  expect(
    await verifyPublishedReleaseBaseline({
      records: [record],
      application: new ControlledApplicationReader(Result.succeed("published")),
      artifacts: new ControlledArtifactReader(Result.succeed(false)),
    }),
  ).toEqual(Result.fail("baseline-artifact-state-mismatch"));
});

it("rejects duplicate release identities before durable-state reads", async () => {
  const { record } = await publishedRecord();
  const application = new ControlledApplicationReader(Result.succeed("published"));
  const artifacts = new ControlledArtifactReader(Result.succeed(true));
  expect(
    await verifyPublishedReleaseBaseline({
      records: [record, record],
      application,
      artifacts,
    }),
  ).toEqual(Result.fail("baseline-duplicate-release-identity"));
  expect(application.reads).toBe(0);
  expect(artifacts.reads).toBe(0);
});

it("records verified revocation without blocking unrelated source selection", async () => {
  const { candidate, record } = await publishedRecord();
  const result = await verifyPublishedReleaseBaseline({
    records: [record],
    application: new ControlledApplicationReader(Result.succeed("revoked")),
    artifacts: new ControlledArtifactReader(Result.succeed(true)),
  });
  expect(Result.isSuccess(result)).toBe(true);
  if (Result.isFailure(result)) return;
  expect(result.success).toMatchObject([{ durableStateRevoked: true }]);
  expect(
    selectIncrementalReleaseSources({
      sources: [
        {
          identity: candidate.identity,
          kind: candidate.kind,
          sourceInputDigest: candidate.sourceInputDigest,
          publicationEligible: true,
        },
      ],
      journal: result.success,
    }),
  ).toEqual(
    Result.fail("published-version-revoked:supernala-public/supernala/offline-fixture@1.0.0"),
  );
  expect(
    selectIncrementalReleaseSources({
      sources: [
        {
          identity: {
            marketplaceId: "supernala-public",
            publisherNamespace: "supernala",
            pluginSlug: "unrelated-plugin",
            semanticVersion: "1.0.0",
          },
          kind: "managed-package",
          sourceInputDigest: PluginSha256.make("9".repeat(64)),
          publicationEligible: true,
        },
      ],
      journal: result.success,
    }),
  ).toMatchObject({ _tag: "Success" });
});

it("rejects stale or revoked predecessor lineage before publication writes", async () => {
  const { candidate: previousCandidate, record: previous } = await publishedRecord();
  const currentIdentity = {
    marketplaceId: previous.identity.marketplaceId,
    publisherNamespace: previous.identity.publisherNamespace,
    pluginSlug: previous.identity.pluginSlug,
    semanticVersion: "2.0.0",
  };
  const currentVersion = PluginVersion.make({
    id: "supernala-public:supernala:offline-fixture@2.0.0" as typeof previous.version.id,
    marketplaceId: previous.version.marketplaceId,
    publisherNamespace: previous.version.publisherNamespace,
    pluginSlug: previous.version.pluginSlug,
    version: "2.0.0" as typeof previous.version.version,
    name: previous.version.name,
    description: previous.version.description,
    license: previous.version.license,
    catalog: previous.version.catalog,
    config: previous.version.config,
    allowedHosts: previous.version.allowedHosts,
    runtime: previous.version.runtime,
    status: previous.version.status,
    publishedAt: previous.version.publishedAt,
  });
  const current: IncrementalReleaseCandidate = {
    ...previousCandidate,
    identity: currentIdentity,
    version: currentVersion,
    sourceInputDigest: PluginSha256.make("7".repeat(64)),
    releaseDigest: PluginSha256.make("8".repeat(64)),
    releaseOrdinal: 2,
  };
  const authority = PluginAuthoritySnapshot.make({
    runtimeKind: "managed-package",
    authenticationKind: "none",
    requestedScopes: [],
    endpoint: null,
    endpointRegistrationId: null,
    providerRegistrationId: null,
    tools: [],
    allowedHosts: [],
    config: [],
  });
  const review = ReleaseReview.make({
    schemaVersion: 1,
    identity: currentIdentity,
    reviewId: current.reviewId,
    reviewer: current.reviewer,
    reviewedAt: current.reviewedAt,
    sourceInputDigest: current.sourceInputDigest,
    artifactDigest: current.artifactDigest ?? PluginSha256.make("9".repeat(64)),
    authentication: current.authentication,
    catalogDigest: current.catalogDigest,
    configDigest: current.configDigest,
    provenanceDigest: current.provenanceDigest,
    authorityBeforeIdentity: previous.identity,
    authorityBeforeReleaseDigest: previous.releaseDigest,
    authorityBefore: authority,
    authorityBeforeDigest: previous.authorityDigest,
    authorityAfter: authority,
    authorityDigest: current.authorityDigest,
    authorityDiffDigest: current.authorityDiffDigest,
    releaseDigest: current.releaseDigest,
    decision: "approved",
  });
  const applicationVersions = [{ versionId: previous.version.id, status: "published" as const }];
  const mismatchReader = new ControlledLineageReader(
    Result.succeed("published"),
    applicationVersions,
  );
  expect(
    await validatePublicationAuthorityLineage({
      candidate: current,
      review: ReleaseReview.make({
        schemaVersion: review.schemaVersion,
        identity: review.identity,
        reviewId: review.reviewId,
        reviewer: review.reviewer,
        reviewedAt: review.reviewedAt,
        sourceInputDigest: review.sourceInputDigest,
        artifactDigest: review.artifactDigest,
        authentication: review.authentication,
        catalogDigest: review.catalogDigest,
        configDigest: review.configDigest,
        provenanceDigest: review.provenanceDigest,
        authorityBeforeIdentity: review.authorityBeforeIdentity,
        authorityBeforeReleaseDigest: PluginSha256.make("a".repeat(64)),
        authorityBefore: review.authorityBefore,
        authorityBeforeDigest: review.authorityBeforeDigest,
        authorityAfter: review.authorityAfter,
        authorityDigest: review.authorityDigest,
        authorityDiffDigest: review.authorityDiffDigest,
        releaseDigest: review.releaseDigest,
        decision: "approved",
      }),
      records: [previous],
      application: mismatchReader,
    }),
  ).toEqual(Result.fail("release-previous-lineage-stale"));
  expect(mismatchReader.reads).toBe(0);

  const revokedReader = new ControlledLineageReader(Result.succeed("revoked"), applicationVersions);
  expect(
    await validatePublicationAuthorityLineage({
      candidate: current,
      review,
      records: [previous],
      application: revokedReader,
    }),
  ).toEqual(Result.fail("release-previous-lineage-revoked"));
  expect(revokedReader.reads).toBe(1);

  const untrackedReader = new ControlledLineageReader(Result.succeed("published"), [
    ...applicationVersions,
    { versionId: "untracked-version", status: "published" },
  ]);
  expect(
    await validatePublicationAuthorityLineage({
      candidate: current,
      review,
      records: [previous],
      application: untrackedReader,
    }),
  ).toEqual(Result.fail("release-lineage-untracked-application-version"));
  expect(untrackedReader.reads).toBe(0);
});
