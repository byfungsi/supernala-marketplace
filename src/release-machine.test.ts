import { expect, it } from "@effect/vitest";
import { Result, Schema } from "effect";
import { preparePluginPackage, validatePluginSource } from "./authoring-validation.js";
import {
  digestPluginBytes,
  PluginSha256,
  PluginVersion,
  ProviderRegistrationId,
  RemoteMcpEndpointRegistrationId,
} from "./plugin-contract.js";
import { PackagedPluginAuthentication } from "./package-archive.js";
import {
  InMemoryApplicationPublicationAdapter,
  InMemoryImmutableArtifactStore,
  InMemoryReleaseJournal,
  publishIncrementalRelease,
  selectIncrementalReleaseSources,
  type IncrementalReleaseCandidate,
} from "./release-machine.js";

const sha = (value: string): typeof PluginSha256.Type =>
  PluginSha256.make(value.repeat(64).slice(0, 64));

const makeCandidate = async (input: {
  readonly slug: string;
  readonly version: string;
  readonly sourceDigest?: typeof PluginSha256.Type;
  readonly bytes?: Uint8Array;
  readonly ordinal?: number;
}): Promise<IncrementalReleaseCandidate> => {
  const source = await validatePluginSource("plugins/offline-fixture");
  if (Result.isFailure(source)) throw new Error(source.failure.message);
  const prepared = await preparePluginPackage({
    source: source.success,
    marketplaceId: "supernala-public",
    versionId: `${input.slug}-${input.version}`,
    publishedAt: 1,
  });
  if (Result.isFailure(prepared)) throw new Error(prepared.failure.message);
  const artifactBytes = input.bytes ?? prepared.success.archiveBytes;
  const artifactDigest = await digestPluginBytes(artifactBytes);
  const parsedVersion = prepared.success.parsed.version;
  if (parsedVersion.runtime.kind !== "managed-package")
    throw new Error("test package runtime missing");
  const version = PluginVersion.make({
    id: `supernala-public:supernala:${input.slug}@${input.version}` as typeof prepared.success.parsed.version.id,
    marketplaceId: parsedVersion.marketplaceId,
    publisherNamespace: parsedVersion.publisherNamespace,
    pluginSlug: input.slug as typeof prepared.success.parsed.version.pluginSlug,
    version: input.version as typeof prepared.success.parsed.version.version,
    name: parsedVersion.name,
    description: parsedVersion.description,
    license: parsedVersion.license,
    catalog: parsedVersion.catalog,
    config: parsedVersion.config,
    allowedHosts: parsedVersion.allowedHosts,
    runtime: {
      _tag: "ManagedPackage",
      kind: "managed-package",
      artifactDigest,
      manifestDigest: parsedVersion.runtime.manifestDigest,
      entrypoint: parsedVersion.runtime.entrypoint,
      node: "22.x",
    },
    status: parsedVersion.status,
    publishedAt: parsedVersion.publishedAt,
  });
  const sourceInputDigest = input.sourceDigest ?? sha("1");
  const releaseDigest = await digestPluginBytes(
    new TextEncoder().encode(
      JSON.stringify({
        slug: input.slug,
        version: input.version,
        sourceInputDigest,
        artifactDigest,
      }),
    ),
  );
  return {
    identity: {
      marketplaceId: "supernala-public",
      publisherNamespace: "supernala",
      pluginSlug: input.slug,
      semanticVersion: input.version,
    },
    definitionId: `supernala-public:supernala:${input.slug}`,
    version,
    authentication: prepared.success.parsed.authentication,
    kind: "managed-package",
    sourceInputDigest,
    releaseDigest,
    catalogDigest: version.catalog.digest,
    configDigest: prepared.success.parsed.configDigest,
    provenance: prepared.success.parsed.provenance,
    provenanceDigest: await digestPluginBytes(
      new TextEncoder().encode(JSON.stringify(prepared.success.parsed.provenance)),
    ),
    authorityBaselineDigest: sha("6"),
    authorityDigest: sha("2"),
    authorityDiffDigest: sha("3"),
    artifactDigest,
    artifactByteLength: artifactBytes.byteLength,
    artifactBytes,
    mergeCommit: "a".repeat(40),
    releaseOrdinal: input.ordinal ?? 1,
    reviewId: `review-${input.slug}-${input.version}`,
    reviewer: "synthetic-reviewer",
    reviewedAt: 1,
  };
};

const publish = (
  candidate: IncrementalReleaseCandidate,
  journal: InMemoryReleaseJournal,
  artifacts: InMemoryImmutableArtifactStore,
  application: InMemoryApplicationPublicationAdapter,
) => publishIncrementalRelease({ candidate, journal, artifacts, application });

it("selects bootstrap and failed releases but fails closed before skipping published state", async () => {
  const candidate = await makeCandidate({ slug: "alpha", version: "1.0.0" });
  const source = {
    identity: candidate.identity,
    kind: candidate.kind,
    sourceInputDigest: candidate.sourceInputDigest,
    publicationEligible: true,
  };
  expect(selectIncrementalReleaseSources({ sources: [source], journal: [] })).toMatchObject({
    _tag: "Success",
    success: [source],
  });
  const journal = new InMemoryReleaseJournal();
  const artifacts = new InMemoryImmutableArtifactStore();
  const application = new InMemoryApplicationPublicationAdapter();
  await publish(candidate, journal, artifacts, application);
  expect(
    selectIncrementalReleaseSources({ sources: [source], journal: await journal.list() }),
  ).toEqual(
    Result.fail("published-state-reverification-required:supernala-public/supernala/alpha@1.0.0"),
  );
  expect(artifacts.putCount).toBe(1);
});

it("publishes and replays managed remote releases without fabricating artifact bytes", async () => {
  const packaged = await makeCandidate({ slug: "remote-alpha", version: "1.0.0" });
  const authentication = Schema.decodeUnknownSync(PackagedPluginAuthentication)({
    kind: "oauth",
    providerRegistration: "remote-provider-v1",
    providerDefinitionDigest: "a".repeat(64),
    requestedScopes: ["remote.read"],
    credentialDelivery: "short-lived-access-token-only",
  });
  const remote: IncrementalReleaseCandidate = {
    ...packaged,
    version: PluginVersion.make({
      id: packaged.version.id,
      marketplaceId: packaged.version.marketplaceId,
      publisherNamespace: packaged.version.publisherNamespace,
      pluginSlug: packaged.version.pluginSlug,
      version: packaged.version.version,
      name: packaged.version.name,
      description: packaged.version.description,
      license: packaged.version.license,
      runtime: {
        _tag: "ManagedRemoteMcp",
        kind: "managed-remote-mcp",
        endpointRegistrationId: RemoteMcpEndpointRegistrationId.make("remote-endpoint-v1"),
        providerRegistrationId: ProviderRegistrationId.make("remote-provider-v1"),
        transport: "streamable-http",
      },
      catalog: packaged.version.catalog,
      config: packaged.version.config,
      allowedHosts: packaged.version.allowedHosts,
      status: packaged.version.status,
      publishedAt: packaged.version.publishedAt,
    }),
    authentication,
    kind: "managed-remote-mcp",
    artifactDigest: null,
    artifactByteLength: null,
    artifactBytes: null,
  };
  const journal = new InMemoryReleaseJournal();
  const artifacts = new InMemoryImmutableArtifactStore();
  const application = new InMemoryApplicationPublicationAdapter();

  expect(await publish(remote, journal, artifacts, application)).toEqual(
    Result.succeed({ status: "published" }),
  );
  expect(await publish(remote, journal, artifacts, application)).toEqual(
    Result.succeed({ status: "unchanged" }),
  );
  expect(artifacts.putCount).toBe(0);
  expect(application.finalizeCount).toBe(1);
});

it("fails same semantic version when source/shared inputs change", async () => {
  const candidate = await makeCandidate({ slug: "alpha", version: "1.0.0" });
  const journal = new InMemoryReleaseJournal();
  await publish(
    candidate,
    journal,
    new InMemoryImmutableArtifactStore(),
    new InMemoryApplicationPublicationAdapter(),
  );
  const changed = {
    identity: candidate.identity,
    kind: candidate.kind,
    sourceInputDigest: sha("4"),
    publicationEligible: true,
  };
  expect(
    selectIncrementalReleaseSources({ sources: [changed], journal: await journal.list() }),
  ).toEqual(Result.fail("immutable-version-input-conflict:supernala-public/supernala/alpha@1.0.0"));
});

it("keeps exact five-field OAuth authority immutable across journal retries", async () => {
  const candidate = await makeCandidate({ slug: "oauth-alpha", version: "1.0.0" });
  const authentication = Schema.decodeUnknownSync(PackagedPluginAuthentication, {
    onExcessProperty: "error",
  })({
    kind: "oauth",
    providerRegistration: "synthetic-mail-rest-v1",
    providerDefinitionDigest: "a".repeat(64),
    requestedScopes: ["synthetic.mail.read"],
    credentialDelivery: "short-lived-access-token-only",
  });
  const release = { ...candidate, authentication };
  const journal = new InMemoryReleaseJournal();
  expect(Result.isSuccess(await journal.claim(release))).toBe(true);
  expect(Result.isSuccess(await journal.claim(release))).toBe(true);
  const changedAuthentication = Schema.decodeUnknownSync(PackagedPluginAuthentication, {
    onExcessProperty: "error",
  })({
    kind: "oauth",
    providerRegistration: "synthetic-mail-rest-v1",
    providerDefinitionDigest: "b".repeat(64),
    requestedScopes: ["synthetic.mail.read"],
    credentialDelivery: "short-lived-access-token-only",
  });
  expect(
    await journal.claim({
      ...release,
      authentication: changedAuthentication,
    }),
  ).toEqual(Result.fail("immutable-version-conflict"));
});

it("does zero additional PUTs on rerun and under concurrent exact publication", async () => {
  const candidate = await makeCandidate({ slug: "alpha", version: "1.0.0" });
  const journal = new InMemoryReleaseJournal();
  const artifacts = new InMemoryImmutableArtifactStore();
  const application = new InMemoryApplicationPublicationAdapter();
  const results = await Promise.all([
    publish(candidate, journal, artifacts, application),
    publish(candidate, journal, artifacts, application),
  ]);
  expect(results.every(Result.isSuccess)).toBe(true);
  expect(artifacts.putCount).toBe(1);
  expect(application.finalizeCount).toBe(1);
  expect(await publish(candidate, journal, artifacts, application)).toMatchObject({
    _tag: "Success",
    success: { status: "unchanged" },
  });
  expect(artifacts.putCount).toBe(1);
});

it("deduplicates bytes while preserving distinct publisher/version records", async () => {
  const first = await makeCandidate({ slug: "alpha", version: "1.0.0" });
  if (first.artifactBytes === null) throw new Error("test package bytes missing");
  const second = await makeCandidate({
    slug: "beta",
    version: "1.0.0",
    bytes: first.artifactBytes,
  });
  const journal = new InMemoryReleaseJournal();
  const artifacts = new InMemoryImmutableArtifactStore();
  const application = new InMemoryApplicationPublicationAdapter();
  expect(Result.isSuccess(await publish(first, journal, artifacts, application))).toBe(true);
  expect(Result.isSuccess(await publish(second, journal, artifacts, application))).toBe(true);
  expect(artifacts.putCount).toBe(1);
  expect((await journal.list()).filter((record) => record.status === "published")).toHaveLength(2);
});

it("resumes only failed B after A succeeds and handles upload/readback/finalize interruption", async () => {
  const first = await makeCandidate({ slug: "alpha", version: "1.0.0" });
  const second = await makeCandidate({
    slug: "beta",
    version: "1.0.0",
    bytes: new Uint8Array([1, 2, 3]),
  });
  const journal = new InMemoryReleaseJournal();
  const artifacts = new InMemoryImmutableArtifactStore();
  const application = new InMemoryApplicationPublicationAdapter();
  expect(Result.isSuccess(await publish(first, journal, artifacts, application))).toBe(true);
  artifacts.failNextReadback = true;
  expect(await publish(second, journal, artifacts, application)).toEqual(
    Result.fail("artifact-readback-failed"),
  );
  expect(artifacts.putCount).toBe(2);
  application.failNextFinalize = true;
  expect(await publish(second, journal, artifacts, application)).toEqual(
    Result.fail("application-finalize-failed"),
  );
  expect(artifacts.putCount).toBe(2);
  expect(Result.isSuccess(await publish(second, journal, artifacts, application))).toBe(true);
  expect(artifacts.putCount).toBe(2);
  expect(await publish(first, journal, artifacts, application)).toMatchObject({
    success: { status: "unchanged" },
  });
});

it("rejects conflicting identity and keeps monotonic latest version across out-of-order completion", async () => {
  const first = await makeCandidate({ slug: "alpha", version: "1.0.0", ordinal: 1 });
  const second = await makeCandidate({ slug: "alpha", version: "2.0.0", ordinal: 2 });
  const journal = new InMemoryReleaseJournal();
  const artifacts = new InMemoryImmutableArtifactStore();
  const application = new InMemoryApplicationPublicationAdapter();
  expect(Result.isSuccess(await publish(second, journal, artifacts, application))).toBe(true);
  expect(await publish(first, journal, artifacts, application)).toEqual(
    Result.fail("stale-release-conflict"),
  );
  const conflict = { ...second, releaseDigest: sha("9") };
  expect(await publish(conflict, journal, artifacts, application)).toEqual(
    Result.fail("immutable-version-conflict"),
  );
});

it("recovers a missing journal row from exact application and R2 state", async () => {
  const candidate = await makeCandidate({ slug: "alpha", version: "1.0.0" });
  const originalJournal = new InMemoryReleaseJournal();
  const artifacts = new InMemoryImmutableArtifactStore();
  const application = new InMemoryApplicationPublicationAdapter();
  expect(Result.isSuccess(await publish(candidate, originalJournal, artifacts, application))).toBe(
    true,
  );
  const recoveredJournal = new InMemoryReleaseJournal();
  expect(Result.isSuccess(await publish(candidate, recoveredJournal, artifacts, application))).toBe(
    true,
  );
  expect(artifacts.putCount).toBe(1);
  expect((await recoveredJournal.list())[0]?.status).toBe("published");
});

it("does not regress selection when claimed releases finish out of order", async () => {
  const first = await makeCandidate({ slug: "alpha", version: "1.0.0", ordinal: 1 });
  const second = await makeCandidate({ slug: "alpha", version: "2.0.0", ordinal: 2 });
  const journal = new InMemoryReleaseJournal();
  expect(Result.isSuccess(await journal.claim(first))).toBe(true);
  expect(Result.isSuccess(await journal.claim(second))).toBe(true);
  const artifacts = new InMemoryImmutableArtifactStore();
  const application = new InMemoryApplicationPublicationAdapter();
  expect(Result.isSuccess(await publish(second, journal, artifacts, application))).toBe(true);
  expect(Result.isSuccess(await publish(first, journal, artifacts, application))).toBe(true);
  const state = {
    identity: second.identity,
    kind: second.kind,
    sourceInputDigest: second.sourceInputDigest,
    publicationEligible: true,
  };
  expect(
    selectIncrementalReleaseSources({ sources: [state], journal: await journal.list() }),
  ).toEqual(
    Result.fail("published-state-reverification-required:supernala-public/supernala/alpha@2.0.0"),
  );
});

it("dry-run performs no journal, object, or application writes", async () => {
  const candidate = await makeCandidate({ slug: "alpha", version: "1.0.0" });
  const journal = new InMemoryReleaseJournal();
  const artifacts = new InMemoryImmutableArtifactStore();
  const application = new InMemoryApplicationPublicationAdapter();
  expect(
    await publishIncrementalRelease({
      candidate,
      journal,
      artifacts,
      application,
      dryRun: true,
    }),
  ).toMatchObject({ success: { status: "dry-run" } });
  expect(await journal.list()).toEqual([]);
  expect(artifacts.putCount).toBe(0);
  expect(application.finalizeCount).toBe(0);
});
