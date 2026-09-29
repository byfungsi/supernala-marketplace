import { readFile } from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";
import { expect, it } from "@effect/vitest";
import { Result, Schema } from "effect";
import { preparePluginPackage, validatePluginSource } from "./authoring-validation.js";
import type { D1BatchTransport, D1Statement } from "./cloudflare-adapters.js";
import { D1ReleaseJournal } from "./d1-release-journal.js";
import {
  canonicalPluginJson,
  PluginSha256,
  PluginVersion,
  ProviderRegistrationId,
} from "./plugin-contract.js";
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

it("claims and stages managed OpenAPI on the production journal schema with foreign keys enabled", async () => {
  const database = new DatabaseSync(":memory:");
  database.exec("PRAGMA foreign_keys = ON");
  for (const migration of ["0001_release_journal", "0002_local_release_attempts"]) {
    database.exec(await readFile(`tools/infra/migrations/${migration}.sql`, "utf8"));
  }
  const journal = new D1ReleaseJournal(new SQLiteJournalTransport(database));
  const packageCandidate = await makeCandidate();
  const previous = await journal.claim(packageCandidate);
  expect(Result.isSuccess(previous)).toBe(true);
  if (Result.isFailure(previous)) throw new Error("test-package-claim-failed");
  await journal.markPublished(
    "supernala-public/supernala/offline-fixture@1.0.0",
    previous.success.record.generation,
  );
  database
    .prepare(`INSERT INTO marketplace_release_attempts
    (attempt_id, merge_commit, release_ordinal, status, created_at)
    VALUES ('prior-attempt', ?, 7, 'completed', 1)`)
    .run(packageCandidate.mergeCommit);
  const before = {
    journal: database.prepare("SELECT * FROM marketplace_release_journal").all(),
    baselines: database.prepare("SELECT * FROM marketplace_release_baselines").all(),
    attempts: database.prepare("SELECT * FROM marketplace_release_attempts").all(),
  };
  const migration = await readFile(
    "tools/infra/migrations/0003_managed_openapi_release_journal.sql",
    "utf8",
  );
  database.exec("BEGIN IMMEDIATE");
  database.exec(migration);
  database.exec("COMMIT");
  expect(database.prepare("SELECT * FROM marketplace_release_journal").all()).toEqual(
    before.journal,
  );
  expect(database.prepare("SELECT * FROM marketplace_release_baselines").all()).toEqual(
    before.baselines,
  );
  expect(database.prepare("SELECT * FROM marketplace_release_attempts").all()).toEqual(
    before.attempts,
  );
  expect(database.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
  expect(database.prepare("PRAGMA foreign_keys").get()).toMatchObject({ foreign_keys: 1 });
  expect(database.prepare("SELECT name FROM sqlite_master WHERE type = 'trigger'").all()).toEqual(
    [],
  );
  expect(database.prepare("PRAGMA index_list(marketplace_release_journal)").all()).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ name: "marketplace_release_journal_plugin_status" }),
    ]),
  );
  expect(database.prepare("PRAGMA index_list(marketplace_release_attempts)").all()).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ name: "marketplace_single_active_release" }),
    ]),
  );
  expect(database.prepare("PRAGMA foreign_key_list(marketplace_release_baselines)").all()).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ table: "marketplace_release_journal", from: "release_identity" }),
    ]),
  );
  expect(() =>
    database
      .prepare(`INSERT INTO marketplace_release_baselines
    (plugin_identity, release_identity, release_ordinal, release_digest, updated_at)
    VALUES ('missing', 'missing', 1, ?, 1)`)
      .run("a".repeat(64)),
  ).toThrow();
  const candidate: IncrementalReleaseCandidate = {
    ...packageCandidate,
    kind: "managed-openapi",
    identity: {
      marketplaceId: packageCandidate.identity.marketplaceId,
      publisherNamespace: packageCandidate.identity.publisherNamespace,
      pluginSlug: packageCandidate.identity.pluginSlug,
      semanticVersion: "2.0.0",
    },
    definitionId: packageCandidate.definitionId,
    releaseOrdinal: 8,
    version: PluginVersion.make({
      marketplaceId: packageCandidate.version.marketplaceId,
      publisherNamespace: packageCandidate.version.publisherNamespace,
      pluginSlug: packageCandidate.version.pluginSlug,
      id: "supernala-public:supernala:offline-fixture@2.0.0" as typeof packageCandidate.version.id,
      version: "2.0.0" as typeof packageCandidate.version.version,
      name: packageCandidate.version.name,
      description: packageCandidate.version.description,
      license: packageCandidate.version.license,
      catalog: packageCandidate.version.catalog,
      config: packageCandidate.version.config,
      allowedHosts: packageCandidate.version.allowedHosts,
      status: packageCandidate.version.status,
      publishedAt: packageCandidate.version.publishedAt,
      runtime: {
        _tag: "ManagedOpenApi",
        kind: "managed-openapi",
        artifactDigest: packageCandidate.artifactDigest,
        manifestDigest: packageCandidate.artifactDigest,
        providerRegistrationId: ProviderRegistrationId.make("fixture-provider"),
      },
    }),
  };
  const claimed = await journal.claim(candidate);
  expect(claimed).toMatchObject({ _tag: "Success" });
  if (Result.isSuccess(claimed)) {
    expect(claimed.success.record.kind).toBe("managed-openapi");
    await journal.markArtifactVerified(
      "supernala-public/supernala/offline-fixture@2.0.0",
      claimed.success.record.generation,
    );
    await journal.markFailed(
      "supernala-public/supernala/offline-fixture@2.0.0",
      1,
      "fixture-failure",
    );
    const retried = await journal.claim({ ...candidate, releaseOrdinal: 9 });
    expect(retried).toMatchObject({
      _tag: "Success",
      success: { record: { attempts: 2, generation: 2, status: "claimed" } },
    });
    await journal.markArtifactVerified("supernala-public/supernala/offline-fixture@2.0.0", 2);
    expect(await journal.list()).toMatchObject([
      { kind: "managed-package", status: "published" },
      { kind: "managed-openapi", status: "artifact-verified" },
    ]);
  }
  database.close();
});

it("rolls back the journal rebuild if copying a legacy row fails a constraint", async () => {
  const database = new DatabaseSync(":memory:");
  database.exec("PRAGMA foreign_keys = ON");
  for (const migration of ["0001_release_journal", "0002_local_release_attempts"]) {
    database.exec(await readFile(`tools/infra/migrations/${migration}.sql`, "utf8"));
  }
  const journal = new D1ReleaseJournal(new SQLiteJournalTransport(database));
  const candidate = await makeCandidate();
  const claimed = await journal.claim(candidate);
  expect(Result.isSuccess(claimed)).toBe(true);
  if (Result.isFailure(claimed)) throw new Error("test-package-claim-failed");
  await journal.markPublished("supernala-public/supernala/offline-fixture@1.0.0", 1);
  database.exec("PRAGMA ignore_check_constraints = ON");
  database.prepare("UPDATE marketplace_release_journal SET attempts = 0").run();
  database.exec("PRAGMA ignore_check_constraints = OFF");
  const before = {
    journal: database.prepare("SELECT * FROM marketplace_release_journal").all(),
    baselines: database.prepare("SELECT * FROM marketplace_release_baselines").all(),
  };
  const migration = await readFile(
    "tools/infra/migrations/0003_managed_openapi_release_journal.sql",
    "utf8",
  );
  database.exec("BEGIN IMMEDIATE");
  expect(() => database.exec(migration)).toThrow();
  database.exec("ROLLBACK");
  expect(database.prepare("SELECT * FROM marketplace_release_journal").all()).toEqual(
    before.journal,
  );
  expect(database.prepare("SELECT * FROM marketplace_release_baselines").all()).toEqual(
    before.baselines,
  );
  expect(database.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
  expect(database.prepare("SELECT name FROM sqlite_master WHERE name LIKE '%_0003'").all()).toEqual(
    [],
  );
  database.close();
});
