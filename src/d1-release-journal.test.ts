import { readFile } from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";
import { expect, it } from "@effect/vitest";
import { Result, Schema } from "effect";
import { preparePluginPackage, validatePluginSource } from "./authoring-validation.js";
import type { D1BatchTransport, D1Statement } from "./cloudflare-adapters.js";
import { D1ReleaseJournal } from "./d1-release-journal.js";
import { canonicalPluginJson, PluginSha256, PluginVersion } from "./plugin-contract.js";
import { PackagedPluginAuthentication } from "./package-archive.js";
import {
  InMemoryApplicationPublicationAdapter,
  InMemoryImmutableArtifactStore,
  publishIncrementalRelease,
  type IncrementalReleaseCandidate,
} from "./release-machine.js";

class SQLiteJournalTransport implements D1BatchTransport {
  constructor(readonly database: DatabaseSync) {}
  async batch(statements: ReadonlyArray<D1Statement>) {
    this.database.exec("BEGIN IMMEDIATE");
    try {
      const results = statements.map((statement) => ({
        changes: Number(this.database.prepare(statement.sql).run(...statement.params).changes),
      }));
      this.database.exec("COMMIT");
      return Result.succeed(results);
    } catch {
      this.database.exec("ROLLBACK");
      return Result.fail("sqlite-batch-failed");
    }
  }
  async query(statement: D1Statement) {
    try {
      const rows = this.database.prepare(statement.sql).all(...statement.params);
      const decoded = [];
      for (const row of rows) {
        const result = Schema.decodeUnknownResult(Schema.JsonObject)(row);
        if (Result.isFailure(result)) return Result.fail("sqlite-row-invalid");
        decoded.push(result.success);
      }
      return Result.succeed(decoded);
    } catch {
      return Result.fail("sqlite-query-failed");
    }
  }
}

const makeCandidate = async (): Promise<
  Extract<IncrementalReleaseCandidate, { readonly kind: "managed-package" }>
> => {
  const source = await validatePluginSource("plugins/offline-fixture");
  if (Result.isFailure(source)) throw new Error(source.failure.message);
  const prepared = await preparePluginPackage({
    source: source.success,
    marketplaceId: "supernala-public",
    versionId: "supernala-public:supernala:offline-fixture@1.0.0",
    publishedAt: 1,
  });
  if (Result.isFailure(prepared)) throw new Error(prepared.failure.message);
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
    provenanceDigest: PluginSha256.make("5".repeat(64)),
    authorityBaselineDigest: PluginSha256.make("6".repeat(64)),
    authorityDigest: PluginSha256.make("3".repeat(64)),
    authorityDiffDigest: PluginSha256.make("4".repeat(64)),
    artifactDigest: prepared.success.artifactDigest,
    artifactByteLength: prepared.success.archiveBytes.byteLength,
    artifactBytes: prepared.success.archiveBytes,
    mergeCommit: "a".repeat(40),
    releaseOrdinal: 7,
    reviewId: "synthetic-review",
    reviewer: "synthetic-reviewer",
    reviewedAt: 1,
  };
};

it("persists exact durable claims, retries, publication status and monotonic baseline", async () => {
  const database = new DatabaseSync(":memory:");
  database.exec(await readFile("tools/infra/migrations/0001_release_journal.sql", "utf8"));
  const journal = new D1ReleaseJournal(new SQLiteJournalTransport(database));
  const release = await makeCandidate();
  const first = await journal.claim(release);
  expect(Result.isSuccess(first)).toBe(true);
  const storedEnvelope = database
    .prepare("SELECT version_json FROM marketplace_release_journal WHERE release_identity = ?")
    .get("supernala-public/supernala/offline-fixture@1.0.0");
  if (
    storedEnvelope === undefined ||
    storedEnvelope === null ||
    typeof storedEnvelope.version_json !== "string"
  ) {
    throw new Error("test-journal-envelope-missing");
  }
  database
    .prepare("UPDATE marketplace_release_journal SET version_json = ? WHERE release_identity = ?")
    .run(canonicalPluginJson(release.version), "supernala-public/supernala/offline-fixture@1.0.0");
  expect(await journal.list()).toMatchObject([{ authentication: { kind: "none" } }]);
  for (const authentication of [
    { kind: "none", tokenName: "SYNTHETIC_TOKEN_OVERRIDE" },
    {
      kind: "github-app",
      providerRegistration: "synthetic-provider",
      credentialDelivery: "short-lived-installation-token-only",
      scopes: ["synthetic-disallowed-scope"],
    },
  ]) {
    database
      .prepare("UPDATE marketplace_release_journal SET version_json = ? WHERE release_identity = ?")
      .run(
        canonicalPluginJson({ schemaVersion: 1, version: release.version, authentication }),
        "supernala-public/supernala/offline-fixture@1.0.0",
      );
    await expect(journal.list()).rejects.toThrow("release-journal-row-invalid");
  }
  database
    .prepare("UPDATE marketplace_release_journal SET version_json = ? WHERE release_identity = ?")
    .run(
      canonicalPluginJson({
        schemaVersion: 1,
        version: release.version,
        authentication: {
          kind: "oauth",
          providerRegistration: "synthetic-mail-rest-v1",
          requestedScopes: ["synthetic.mail.read"],
          credentialDelivery: "short-lived-access-token-only",
        },
      }),
      "supernala-public/supernala/offline-fixture@1.0.0",
    );
  await expect(journal.list()).rejects.toThrow("release-journal-row-invalid");
  database
    .prepare("UPDATE marketplace_release_journal SET version_json = ? WHERE release_identity = ?")
    .run(
      canonicalPluginJson({
        schemaVersion: 1,
        version: release.version,
        authentication: {
          kind: "oauth",
          providerRegistration: "synthetic-mail-rest-v1",
          providerDefinitionDigest: "a".repeat(64),
          requestedScopes: ["synthetic.mail.read"],
          credentialDelivery: "short-lived-access-token-only",
        },
      }),
      "supernala-public/supernala/offline-fixture@1.0.0",
    );
  expect(await journal.list()).toMatchObject([
    {
      authentication: {
        kind: "oauth",
        providerRegistration: "synthetic-mail-rest-v1",
        providerDefinitionDigest: "a".repeat(64),
        requestedScopes: ["synthetic.mail.read"],
      },
    },
  ]);
  database
    .prepare("UPDATE marketplace_release_journal SET version_json = ? WHERE release_identity = ?")
    .run(storedEnvelope.version_json, "supernala-public/supernala/offline-fixture@1.0.0");
  const retry = await journal.claim(release);
  expect(Result.isSuccess(retry)).toBe(true);
  await journal.markFailed(
    "supernala-public/supernala/offline-fixture@1.0.0",
    1,
    "application-provider-verification-failed",
  );
  expect(
    await journal.claim({
      ...release,
      artifactDigest: PluginSha256.make("9".repeat(64)),
      mergeCommit: "c".repeat(40),
      releaseOrdinal: 9,
    }),
  ).toEqual(Result.fail("immutable-version-conflict"));
  expect(await journal.list()).toMatchObject([
    {
      mergeCommit: "a".repeat(40),
      releaseOrdinal: 7,
      status: "failed",
      attempts: 1,
      generation: 1,
      failureType: "application-provider-verification-failed",
    },
  ]);
  const laterMergeRetry = await journal.claim({
    ...release,
    mergeCommit: "b".repeat(40),
    releaseOrdinal: 8,
  });
  expect(Result.isSuccess(laterMergeRetry)).toBe(true);
  if (Result.isSuccess(laterMergeRetry)) {
    expect(laterMergeRetry.success.record).toMatchObject({
      mergeCommit: "b".repeat(40),
      releaseOrdinal: 8,
      status: "claimed",
      attempts: 2,
      generation: 2,
      failureType: null,
    });
  }
  await journal.markArtifactVerified("supernala-public/supernala/offline-fixture@1.0.0", 2);
  await journal.markPublished("supernala-public/supernala/offline-fixture@1.0.0", 2);
  expect(await journal.list()).toMatchObject([
    {
      status: "published",
      attempts: 2,
      artifactByteLength: release.artifactByteLength,
    },
  ]);
  expect(
    database.prepare("SELECT release_ordinal FROM marketplace_release_baselines").get(),
  ).toMatchObject({
    release_ordinal: 8,
  });
  const conflict: IncrementalReleaseCandidate = {
    ...release,
    artifactDigest: PluginSha256.make("9".repeat(64)),
  };
  expect(await journal.claim(conflict)).toEqual(Result.fail("immutable-version-conflict"));
  const stale = {
    ...release,
    identity: {
      marketplaceId: release.identity.marketplaceId,
      publisherNamespace: release.identity.publisherNamespace,
      pluginSlug: release.identity.pluginSlug,
      semanticVersion: "0.9.0",
    },
    definitionId: "supernala-public:supernala:offline-fixture",
    releaseDigest: PluginSha256.make("8".repeat(64)),
    releaseOrdinal: 6,
  };
  expect(await journal.claim(stale)).toEqual(Result.fail("release-journal-claim-failed"));
  expect(await journal.list()).toHaveLength(1);
  database.close();
});

it("persists exact five-field OAuth authority across durable retries", async () => {
  const database = new DatabaseSync(":memory:");
  database.exec(await readFile("tools/infra/migrations/0001_release_journal.sql", "utf8"));
  const journal = new D1ReleaseJournal(new SQLiteJournalTransport(database));
  const release = await makeCandidate();
  const authentication = Schema.decodeUnknownSync(PackagedPluginAuthentication, {
    onExcessProperty: "error",
  })({
    kind: "oauth",
    providerRegistration: "synthetic-mail-rest-v1",
    providerDefinitionDigest: "a".repeat(64),
    requestedScopes: ["synthetic.mail.read"],
    credentialDelivery: "short-lived-access-token-only",
  });
  const oauthRelease = { ...release, authentication };
  expect(Result.isSuccess(await journal.claim(oauthRelease))).toBe(true);
  expect(Result.isSuccess(await journal.claim(oauthRelease))).toBe(true);
  expect(await journal.list()).toMatchObject([{ authentication }]);
  const changedAuthentication = Schema.decodeUnknownSync(PackagedPluginAuthentication, {
    onExcessProperty: "error",
  })({
    ...authentication,
    providerDefinitionDigest: "b".repeat(64),
  });
  expect(await journal.claim({ ...oauthRelease, authentication: changedAuthentication })).toEqual(
    Result.fail("immutable-version-conflict"),
  );
  database.close();
});

it("resumes a partial release after a later merge and reconstructs a missing journal row", async () => {
  const database = new DatabaseSync(":memory:");
  database.exec(await readFile("tools/infra/migrations/0001_release_journal.sql", "utf8"));
  const journal = new D1ReleaseJournal(new SQLiteJournalTransport(database));
  const first = await makeCandidate();
  const secondVersion = PluginVersion.make({
    id: "supernala-public:supernala:offline-fixture-b@1.0.0" as typeof first.version.id,
    marketplaceId: first.version.marketplaceId,
    publisherNamespace: first.version.publisherNamespace,
    pluginSlug: "offline-fixture-b" as typeof first.version.pluginSlug,
    version: first.version.version,
    name: first.version.name,
    description: first.version.description,
    license: first.version.license,
    catalog: first.version.catalog,
    config: first.version.config,
    allowedHosts: first.version.allowedHosts,
    runtime: first.version.runtime,
    status: first.version.status,
    publishedAt: first.version.publishedAt,
  });
  const second: IncrementalReleaseCandidate = {
    ...first,
    identity: {
      marketplaceId: first.identity.marketplaceId,
      publisherNamespace: first.identity.publisherNamespace,
      pluginSlug: "offline-fixture-b",
      semanticVersion: first.identity.semanticVersion,
    },
    definitionId: "supernala-public:supernala:offline-fixture-b",
    version: secondVersion,
    sourceInputDigest: PluginSha256.make("6".repeat(64)),
    releaseDigest: PluginSha256.make("7".repeat(64)),
    releaseOrdinal: 8,
  };
  const artifacts = new InMemoryImmutableArtifactStore();
  const application = new InMemoryApplicationPublicationAdapter();
  expect(
    Result.isSuccess(
      await publishIncrementalRelease({ candidate: first, journal, artifacts, application }),
    ),
  ).toBe(true);
  application.failNextFinalize = true;
  expect(
    await publishIncrementalRelease({ candidate: second, journal, artifacts, application }),
  ).toEqual(Result.fail("application-finalize-failed"));
  expect(await journal.list()).toMatchObject([
    { identity: { pluginSlug: "offline-fixture" }, status: "published" },
    { identity: { pluginSlug: "offline-fixture-b" }, status: "failed" },
  ]);

  const laterMergeRetry = { ...second, mergeCommit: "b".repeat(40), releaseOrdinal: 9 };
  expect(
    Result.isSuccess(
      await publishIncrementalRelease({
        candidate: laterMergeRetry,
        journal,
        artifacts,
        application,
      }),
    ),
  ).toBe(true);
  expect(artifacts.putCount).toBe(1);
  expect(await journal.list()).toMatchObject([
    { identity: { pluginSlug: "offline-fixture" }, status: "published" },
    {
      identity: { pluginSlug: "offline-fixture-b" },
      status: "published",
      mergeCommit: "b".repeat(40),
      releaseOrdinal: 9,
      attempts: 2,
    },
  ]);

  const reconstructedDatabase = new DatabaseSync(":memory:");
  reconstructedDatabase.exec(
    await readFile("tools/infra/migrations/0001_release_journal.sql", "utf8"),
  );
  const reconstructedJournal = new D1ReleaseJournal(
    new SQLiteJournalTransport(reconstructedDatabase),
  );
  expect(
    Result.isSuccess(
      await publishIncrementalRelease({
        candidate: { ...first, mergeCommit: "c".repeat(40), releaseOrdinal: 10 },
        journal: reconstructedJournal,
        artifacts,
        application,
      }),
    ),
  ).toBe(true);
  expect(artifacts.putCount).toBe(1);
  expect(await reconstructedJournal.list()).toMatchObject([
    { identity: { pluginSlug: "offline-fixture" }, status: "published" },
  ]);
  reconstructedDatabase.close();
  database.close();
});

it("keeps the actual D1 baseline monotonic when overlapping versions complete newest first", async () => {
  const database = new DatabaseSync(":memory:");
  database.exec(await readFile("tools/infra/migrations/0001_release_journal.sql", "utf8"));
  const journal = new D1ReleaseJournal(new SQLiteJournalTransport(database));
  const older = { ...(await makeCandidate()), releaseOrdinal: 1 };
  const newerIdentity = {
    marketplaceId: older.identity.marketplaceId,
    publisherNamespace: older.identity.publisherNamespace,
    pluginSlug: older.identity.pluginSlug,
    semanticVersion: "2.0.0",
  };
  const newerVersion = PluginVersion.make({
    id: "supernala-public:supernala:offline-fixture@2.0.0" as typeof older.version.id,
    marketplaceId: older.version.marketplaceId,
    publisherNamespace: older.version.publisherNamespace,
    pluginSlug: older.version.pluginSlug,
    version: "2.0.0" as typeof older.version.version,
    name: older.version.name,
    description: older.version.description,
    license: older.version.license,
    catalog: older.version.catalog,
    config: older.version.config,
    allowedHosts: older.version.allowedHosts,
    runtime: older.version.runtime,
    status: older.version.status,
    publishedAt: older.version.publishedAt,
  });
  const newer: IncrementalReleaseCandidate = {
    ...older,
    identity: newerIdentity,
    version: newerVersion,
    sourceInputDigest: PluginSha256.make("7".repeat(64)),
    releaseDigest: PluginSha256.make("8".repeat(64)),
    releaseOrdinal: 2,
  };
  const olderClaim = await journal.claim(older);
  const newerClaim = await journal.claim(newer);
  expect(Result.isSuccess(olderClaim)).toBe(true);
  expect(Result.isSuccess(newerClaim)).toBe(true);
  if (Result.isFailure(olderClaim) || Result.isFailure(newerClaim)) return;
  await journal.markPublished(
    "supernala-public/supernala/offline-fixture@2.0.0",
    newerClaim.success.record.generation,
  );
  await journal.markPublished(
    "supernala-public/supernala/offline-fixture@1.0.0",
    olderClaim.success.record.generation,
  );
  expect(
    database
      .prepare("SELECT release_identity, release_ordinal FROM marketplace_release_baselines")
      .get(),
  ).toMatchObject({
    release_identity: "supernala-public/supernala/offline-fixture@2.0.0",
    release_ordinal: 2,
  });
  database.close();
});
