import { createHash } from "node:crypto";
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { expect, it } from "@effect/vitest";
import { Result, Schema } from "effect";
import type { D1BatchTransport, D1Statement } from "./cloudflare-adapters.js";
import { D1ReleaseJournal } from "./d1-release-journal.js";
import { Phase1D1PublicationAdapter } from "./phase1-d1-publication-adapter.js";
import { preparePluginPackage, validatePluginSource } from "./authoring-validation.js";
import { canonicalPluginJson, digestPluginBytes, PluginSha256 } from "./plugin-contract.js";
import {
  InMemoryImmutableArtifactStore,
  publishIncrementalRelease,
  type ApplicationPublicationAdapter,
  type IncrementalReleaseCandidate,
} from "./release-machine.js";
import { pluginDefinitionId, pluginVersionId } from "./release-bundle.js";

class RecordingD1Transport implements D1BatchTransport {
  batches: Array<ReadonlyArray<D1Statement>> = [];
  queryRows: ReadonlyArray<Schema.JsonObject> = [];
  failBatch = false;
  async batch(statements: ReadonlyArray<D1Statement>) {
    this.batches.push(statements);
    return this.failBatch ? Result.fail("controlled-batch-failure") : Result.succeed([]);
  }
  async query(_statement: D1Statement) {
    return Result.succeed(this.queryRows);
  }
}

class SQLiteD1Transport implements D1BatchTransport {
  constructor(readonly database: DatabaseSync) {}
  async batch(statements: ReadonlyArray<D1Statement>) {
    this.database.exec("BEGIN IMMEDIATE");
    try {
      const results = statements.map((statement) => {
        const result = this.database.prepare(statement.sql).run(...statement.params);
        return { changes: Number(result.changes) };
      });
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

class ConfigWinnerRaceTransport extends SQLiteD1Transport {
  #injectWinner = true;
  constructor(
    database: DatabaseSync,
    readonly release: IncrementalReleaseCandidate,
  ) {
    super(database);
  }
  override async batch(statements: ReadonlyArray<D1Statement>) {
    if (this.#injectWinner) {
      this.#injectWinner = false;
      this.database
        .prepare(
          `INSERT INTO plugin_config_schemas
            (config_schema_id, schema_digest, revision, fields_json, created_at)
           VALUES ('legacy:concurrent-winner', ?, ?, ?, 0)`,
        )
        .run(
          this.release.configDigest,
          this.release.version.config.revision,
          canonicalPluginJson(this.release.version.config.fields),
        );
      return Result.fail("synthetic-concurrent-unique-winner");
    }
    return super.batch(statements);
  }
}

const candidate = async (
  sourceDirectory = "plugins/offline-fixture",
): Promise<IncrementalReleaseCandidate> => {
  const source = await validatePluginSource(sourceDirectory);
  if (Result.isFailure(source)) throw new Error(source.failure.message);
  const identity = {
    marketplaceId: "supernala-public",
    publisherNamespace: source.success.manifest.publisher,
    pluginSlug: source.success.manifest.id,
    semanticVersion: source.success.manifest.version,
  } as const;
  const prepared = await preparePluginPackage({
    source: source.success,
    marketplaceId: "supernala-public",
    versionId: pluginVersionId(identity),
    publishedAt: 1,
  });
  if (Result.isFailure(prepared)) throw new Error(prepared.failure.message);
  return {
    identity,
    definitionId: pluginDefinitionId(identity),
    version: prepared.success.parsed.version,
    authentication: prepared.success.parsed.authentication,
    kind: "managed-package",
    sourceInputDigest: PluginSha256.make("1".repeat(64)),
    releaseDigest: PluginSha256.make("2".repeat(64)),
    catalogDigest: prepared.success.parsed.version.catalog.digest,
    configDigest: prepared.success.parsed.configDigest,
    provenance: prepared.success.parsed.provenance,
    provenanceDigest: await digestPluginBytes(
      new TextEncoder().encode(JSON.stringify(prepared.success.parsed.provenance)),
    ),
    authorityBaselineDigest: PluginSha256.make("6".repeat(64)),
    authorityDigest: PluginSha256.make("3".repeat(64)),
    authorityDiffDigest: PluginSha256.make("4".repeat(64)),
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

const createSourceVariant = async (input: {
  readonly root: string;
  readonly slug: string;
  readonly version: string;
  readonly catalogSuffix?: string;
  readonly configRevision?: number;
}): Promise<string> => {
  const directory = path.join(input.root, `${input.slug}-${input.version}`);
  await cp("plugins/offline-fixture", directory, { recursive: true });
  // SAFETY: This test owns the copied fixture JSON and immediately passes the rewritten files
  // through the production authoring schemas before using them as a release candidate.
  const catalog = JSON.parse(await readFile(path.join(directory, "catalog.json"), "utf8")) as {
    id: string;
    tools: Array<{ id: string }>;
  };
  if (input.catalogSuffix !== undefined) {
    catalog.id = `offline-fixture-catalog-${input.catalogSuffix}`;
    const tool = catalog.tools[0];
    if (tool === undefined) throw new Error("test-tool-missing");
    tool.id = `${input.slug}.echo`;
  }
  // SAFETY: Same owned fixture boundary as catalog above; production validation follows.
  const config = JSON.parse(await readFile(path.join(directory, "config.json"), "utf8")) as {
    revision: number;
    fields: ReadonlyArray<unknown>;
  };
  if (input.configRevision !== undefined) config.revision = input.configRevision;
  const catalogBytes = new TextEncoder().encode(`${JSON.stringify(catalog, null, 2)}\n`);
  const configBytes = new TextEncoder().encode(`${JSON.stringify(config, null, 2)}\n`);
  await writeFile(path.join(directory, "catalog.json"), catalogBytes);
  await writeFile(path.join(directory, "config.json"), configBytes);
  // SAFETY: Same owned fixture boundary; candidate() validates all changed identities and digests.
  const manifest = JSON.parse(await readFile(path.join(directory, "plugin.json"), "utf8")) as {
    id: string;
    version: string;
    name: string;
    catalog: { sha256: string };
    config: { sha256: string };
  };
  manifest.id = input.slug;
  manifest.version = input.version;
  manifest.name = `Offline fixture ${input.slug}`;
  manifest.catalog.sha256 = await digestPluginBytes(catalogBytes);
  manifest.config.sha256 = await digestPluginBytes(configBytes);
  await writeFile(path.join(directory, "plugin.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  return directory;
};

const createGithubPackageSource = async (root: string): Promise<string> => {
  const directory = path.join(root, "github-package");
  await mkdir(path.join(directory, "dist"), { recursive: true });
  await Promise.all([
    cp("plugins/github/package-manifest.json", path.join(directory, "plugin.json")),
    cp("plugins/github/catalog.json", path.join(directory, "catalog.json")),
    cp("plugins/github/config.json", path.join(directory, "config.json")),
    cp("plugins/github/provenance.json", path.join(directory, "provenance.json")),
    cp("plugins/github/LICENSE", path.join(directory, "LICENSE")),
    cp("plugins/github/NOTICE", path.join(directory, "NOTICE")),
    cp("plugins/github/source/server.mjs", path.join(directory, "dist", "server.mjs")),
  ]);
  return directory;
};

class FailOnceFinalizeApplication implements ApplicationPublicationAdapter {
  failNextFinalize = false;
  constructor(readonly delegate: Phase1D1PublicationAdapter) {}
  stage(candidate: IncrementalReleaseCandidate) {
    return this.delegate.stage(candidate);
  }
  finalize(candidate: IncrementalReleaseCandidate) {
    if (this.failNextFinalize) {
      this.failNextFinalize = false;
      return Promise.resolve(Result.fail("controlled-finalize-interruption"));
    }
    return this.delegate.finalize(candidate);
  }
  readPublished(candidate: IncrementalReleaseCandidate) {
    return this.delegate.readPublished(candidate);
  }
}

const exactMigrationFile = "fixtures/sql/phase1-0042-plugin-control-plane.sql";
const exactMigrationDigest = "5d834a38ff1fe278e0225ffe16c2c4f03d335cf0a1511fe67e17b2c348c05f2e";

const applicationDatabase = async (): Promise<DatabaseSync> => {
  const migration = await readFile(exactMigrationFile);
  expect(createHash("sha256").update(migration).digest("hex")).toBe(exactMigrationDigest);
  const database = new DatabaseSync(":memory:");
  database.exec("PRAGMA foreign_keys = ON");
  database.exec(migration.toString("utf8"));
  return database;
};

it("places rollback guard inside stage and finalization batches", async () => {
  const transport = new RecordingD1Transport();
  const adapter = new Phase1D1PublicationAdapter(transport);
  const release = await candidate();
  expect(await adapter.stage(release)).toEqual(Result.succeed(undefined));
  expect(await adapter.finalize(release)).toEqual(Result.succeed(undefined));
  expect(transport.batches).toHaveLength(2);
  for (const batch of transport.batches) {
    const guard = batch.at(-1);
    expect(guard?.sql).toContain("SELECT NULL, NULL, NULL");
    expect(guard?.sql).toContain("WHERE NOT EXISTS");
  }
});

it("reports failed D1 finalization without claiming publication", async () => {
  const transport = new RecordingD1Transport();
  transport.failBatch = true;
  const adapter = new Phase1D1PublicationAdapter(transport);
  expect(await adapter.finalize(await candidate())).toEqual(
    Result.fail("application-finalize-failed"),
  );
});

it("executes Phase 1 stage/finalize atomically in SQLite and rolls back a failed guard", async () => {
  const database = await applicationDatabase();
  const transport = new SQLiteD1Transport(database);
  const adapter = new Phase1D1PublicationAdapter(transport);
  const release = await candidate();
  expect(await adapter.stage(release)).toEqual(Result.succeed(undefined));
  expect(
    database
      .prepare("SELECT status FROM plugin_versions WHERE plugin_version_id = ?")
      .get(release.version.id),
  ).toMatchObject({ status: "publishing" });
  expect(await adapter.finalize(release)).toEqual(Result.succeed(undefined));
  expect(await adapter.readPublished(release)).toEqual(Result.succeed(true));
  database
    .prepare(
      "UPDATE plugin_catalog_tools SET title = 'Tampered title' WHERE catalog_snapshot_id = ?",
    )
    .run(release.version.catalog.id);
  expect(await adapter.readPublished(release)).toEqual(Result.succeed(false));

  database.close();
  const interruptedDatabase = await applicationDatabase();
  const interruptedAdapter = new Phase1D1PublicationAdapter(
    new SQLiteD1Transport(interruptedDatabase),
  );
  expect(await interruptedAdapter.stage(release)).toEqual(Result.succeed(undefined));
  interruptedDatabase
    .prepare(
      "UPDATE plugin_artifacts SET status = 'blocked', verified_at = 1 WHERE artifact_digest = ?",
    )
    .run(release.artifactDigest);
  expect(await interruptedAdapter.finalize(release)).toEqual(
    Result.fail("application-finalize-failed"),
  );
  expect(
    interruptedDatabase
      .prepare("SELECT status FROM plugin_versions WHERE plugin_version_id = ?")
      .get(release.version.id),
  ).toMatchObject({ status: "publishing" });
  interruptedDatabase.close();
});

it("rolls back staging against conflicting preexisting definition authority", async () => {
  const database = await applicationDatabase();
  const release = await candidate();
  database
    .prepare(
      `INSERT INTO plugin_definitions
       (plugin_definition_id, marketplace_id, publisher_namespace, plugin_slug, name,
        short_description, long_description, categories_json, publisher_trust, status,
        created_at, updated_at)
       VALUES (?, 'supernala-public', 'other-publisher', 'other-plugin', 'Other',
               'Other description', 'Other description', '[]', 'supernala-curated', 'active', 0, 0)`,
    )
    .run(release.definitionId);
  const adapter = new Phase1D1PublicationAdapter(new SQLiteD1Transport(database));
  expect(await adapter.stage(release)).toEqual(Result.fail("application-stage-failed"));
  expect(database.prepare("SELECT COUNT(*) AS count FROM plugin_versions").get()).toMatchObject({
    count: 0,
  });
  expect(database.prepare("SELECT COUNT(*) AS count FROM plugin_artifacts").get()).toMatchObject({
    count: 0,
  });
  database.close();
});

it("rolls back staging against conflicting catalog or Config authority", async () => {
  for (const conflict of ["catalog", "config"] as const) {
    const database = await applicationDatabase();
    const release = await candidate();
    if (conflict === "catalog") {
      database
        .prepare(
          `INSERT INTO plugin_catalog_snapshots
             (catalog_snapshot_id, catalog_digest, schema_version, created_at)
           VALUES (?, ?, 1, 0)`,
        )
        .run(release.version.catalog.id, "f".repeat(64));
    } else {
      const deterministicConfigId = `config:sha256:${release.configDigest}`;
      database
        .prepare(
          `INSERT INTO plugin_config_schemas
             (config_schema_id, schema_digest, revision, fields_json, created_at)
           VALUES (?, ?, 1, '[]', 0)`,
        )
        .run(deterministicConfigId, "e".repeat(64));
    }
    const adapter = new Phase1D1PublicationAdapter(new SQLiteD1Transport(database));
    expect(await adapter.stage(release)).toEqual(
      Result.fail(
        conflict === "config" ? "application-config-conflict" : "application-stage-failed",
      ),
    );
    expect(database.prepare("SELECT COUNT(*) AS count FROM plugin_versions").get()).toMatchObject({
      count: 0,
    });
    expect(database.prepare("SELECT COUNT(*) AS count FROM plugin_artifacts").get()).toMatchObject({
      count: 0,
    });
    database.close();
  }
});

it("refuses an existing version whose publication intent was failed", async () => {
  const database = await applicationDatabase();
  const release = await candidate();
  const adapter = new Phase1D1PublicationAdapter(new SQLiteD1Transport(database));
  expect(await adapter.stage(release)).toEqual(Result.succeed(undefined));
  database
    .prepare("UPDATE plugin_publication_intents SET status = 'failed' WHERE plugin_version_id = ?")
    .run(release.version.id);
  expect(await adapter.stage(release)).toEqual(Result.fail("immutable-version-conflict"));
  database.close();
});

it("fails closed when approval authority changes between staging and finalization", async () => {
  const database = await applicationDatabase();
  const release = await candidate();
  const adapter = new Phase1D1PublicationAdapter(new SQLiteD1Transport(database));
  expect(await adapter.stage(release)).toEqual(Result.succeed(undefined));
  database
    .prepare("UPDATE plugin_versions SET review_status = 'rejected' WHERE plugin_version_id = ?")
    .run(release.version.id);
  expect(await adapter.finalize(release)).toEqual(Result.fail("application-finalize-failed"));
  expect(
    database
      .prepare("SELECT status FROM plugin_artifacts WHERE artifact_digest = ?")
      .get(release.artifactDigest),
  ).toMatchObject({ status: "pending" });
  database.close();
});

it("distinguishes an exact revoked version from missing or mismatched publication state", async () => {
  const database = await applicationDatabase();
  const release = await candidate();
  const adapter = new Phase1D1PublicationAdapter(new SQLiteD1Transport(database));
  expect(await adapter.stage(release)).toEqual(Result.succeed(undefined));
  expect(await adapter.finalize(release)).toEqual(Result.succeed(undefined));
  database
    .prepare(
      "UPDATE plugin_versions SET status = 'revoked', revoked_at = ? WHERE plugin_version_id = ?",
    )
    .run(2, release.version.id);
  expect(await adapter.readPublished(release)).toEqual(Result.succeed(false));
  expect(await adapter.readPublicationState(release)).toEqual(Result.succeed("revoked"));
  database.close();
});

it("runs coherent A/B packages through exact Phase 1 D1 with cross-merge resume and missing-journal recovery", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "marketplace-exact-app-release-"));
  try {
    const secondSource = await createSourceVariant({
      root,
      slug: "offline-fixture-b",
      version: "1.0.0",
      catalogSuffix: "b-v1",
      configRevision: 2,
    });
    const thirdSource = await createSourceVariant({
      root,
      slug: "offline-fixture-c",
      version: "1.0.0",
      catalogSuffix: "c-v1",
      configRevision: 3,
    });
    const first = await candidate();
    const secondBase = await candidate(secondSource);
    const second: IncrementalReleaseCandidate = {
      ...secondBase,
      sourceInputDigest: PluginSha256.make("7".repeat(64)),
      releaseDigest: PluginSha256.make("8".repeat(64)),
      releaseOrdinal: 2,
    };
    const thirdBase = await candidate(thirdSource);
    const third: IncrementalReleaseCandidate = {
      ...thirdBase,
      sourceInputDigest: PluginSha256.make("9".repeat(64)),
      releaseDigest: PluginSha256.make("a".repeat(64)),
      releaseOrdinal: 3,
    };
    const appDatabase = await applicationDatabase();
    const exactApplication = new Phase1D1PublicationAdapter(new SQLiteD1Transport(appDatabase));
    const application = new FailOnceFinalizeApplication(exactApplication);
    const journalDatabase = new DatabaseSync(":memory:");
    journalDatabase.exec(await readFile("tools/infra/migrations/0001_release_journal.sql", "utf8"));
    const journal = new D1ReleaseJournal(new SQLiteD1Transport(journalDatabase));
    const artifacts = new InMemoryImmutableArtifactStore();

    expect(
      Result.isSuccess(
        await publishIncrementalRelease({ candidate: first, journal, artifacts, application }),
      ),
    ).toBe(true);
    application.failNextFinalize = true;
    expect(
      await publishIncrementalRelease({ candidate: second, journal, artifacts, application }),
    ).toEqual(Result.fail("controlled-finalize-interruption"));
    expect(await journal.list()).toMatchObject([
      { identity: { pluginSlug: "offline-fixture" }, status: "published" },
      { identity: { pluginSlug: "offline-fixture-b" }, status: "failed" },
    ]);

    const laterMerge = { ...second, mergeCommit: "b".repeat(40), releaseOrdinal: 3 };
    expect(
      Result.isSuccess(
        await publishIncrementalRelease({
          candidate: laterMerge,
          journal,
          artifacts,
          application,
        }),
      ),
    ).toBe(true);
    expect(await exactApplication.readPublished(first)).toEqual(Result.succeed(true));
    expect(await exactApplication.readPublished(second)).toEqual(Result.succeed(true));
    expect(artifacts.putCount).toBe(2);
    expect(await journal.list()).toMatchObject([
      { identity: { pluginSlug: "offline-fixture" }, status: "published" },
      {
        identity: { pluginSlug: "offline-fixture-b" },
        status: "published",
        mergeCommit: "a".repeat(40),
        releaseOrdinal: 2,
        attempts: 2,
      },
    ]);

    const thirdClaim = await journal.claim(third);
    expect(Result.isSuccess(thirdClaim)).toBe(true);
    expect(await exactApplication.stage(third)).toEqual(Result.succeed(undefined));
    if (third.artifactDigest === null || third.artifactBytes === null) {
      throw new Error("test-artifact-missing");
    }
    expect(await artifacts.ensureVerified(third.artifactDigest, third.artifactBytes)).toMatchObject(
      {
        _tag: "Success",
      },
    );
    expect(await exactApplication.finalize(third)).toEqual(Result.succeed(undefined));
    expect(await journal.list()).toMatchObject([
      { status: "published" },
      { status: "published" },
      { identity: { pluginSlug: "offline-fixture-c" }, status: "claimed", attempts: 1 },
    ]);
    expect(
      Result.isSuccess(
        await publishIncrementalRelease({
          candidate: { ...third, mergeCommit: "d".repeat(40), releaseOrdinal: 4 },
          journal,
          artifacts,
          application,
        }),
      ),
    ).toBe(true);
    expect(await exactApplication.readPublished(third)).toEqual(Result.succeed(true));
    expect(artifacts.putCount).toBe(3);

    const reconstructedJournalDatabase = new DatabaseSync(":memory:");
    reconstructedJournalDatabase.exec(
      await readFile("tools/infra/migrations/0001_release_journal.sql", "utf8"),
    );
    const reconstructedJournal = new D1ReleaseJournal(
      new SQLiteD1Transport(reconstructedJournalDatabase),
    );
    expect(
      Result.isSuccess(
        await publishIncrementalRelease({
          candidate: { ...first, mergeCommit: "c".repeat(40), releaseOrdinal: 5 },
          journal: reconstructedJournal,
          artifacts,
          application,
        }),
      ),
    ).toBe(true);
    expect(artifacts.putCount).toBe(3);
    expect(await reconstructedJournal.list()).toMatchObject([
      { identity: { pluginSlug: "offline-fixture" }, status: "published" },
    ]);
    reconstructedJournalDatabase.close();
    journalDatabase.close();
    appDatabase.close();
  } finally {
    await rm(root, { recursive: true });
  }
});

it("reuses one exact Config identity across coherent Plugin versions", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "marketplace-config-blocker-"));
  try {
    const followUpSource = await createSourceVariant({
      root,
      slug: "offline-fixture-reuse",
      version: "2.0.0",
      catalogSuffix: "reuse",
    });
    const first = await candidate();
    const followUp = await candidate(followUpSource);
    expect(followUp.configDigest).toBe(first.configDigest);
    const database = await applicationDatabase();
    const adapter = new Phase1D1PublicationAdapter(new SQLiteD1Transport(database));
    expect(await adapter.stage(first)).toEqual(Result.succeed(undefined));
    expect(await adapter.finalize(first)).toEqual(Result.succeed(undefined));
    expect(await adapter.stage(followUp)).toEqual(Result.succeed(undefined));
    expect(await adapter.finalize(followUp)).toEqual(Result.succeed(undefined));
    expect(database.prepare("SELECT COUNT(*) AS count FROM plugin_versions").get()).toMatchObject({
      count: 2,
    });
    const configIds = database
      .prepare("SELECT DISTINCT config_schema_id FROM plugin_versions ORDER BY config_schema_id")
      .all();
    expect(configIds).toHaveLength(1);
    expect(configIds[0]).toMatchObject({ config_schema_id: `config:sha256:${first.configDigest}` });
    database.close();
  } finally {
    await rm(root, { recursive: true });
  }
});

it("publishes reviewed GitHub auth metadata only through an active platform provider", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "marketplace-github-auth-"));
  try {
    const source = await createGithubPackageSource(root);
    const release = await candidate(source);
    expect(release.authentication).toMatchObject({
      kind: "github-app",
      providerRegistration: "supernala-github-app-v1",
    });
    const database = await applicationDatabase();
    const adapter = new Phase1D1PublicationAdapter(new SQLiteD1Transport(database));
    expect(await adapter.stage(release)).toEqual(
      Result.fail("application-provider-verification-failed"),
    );
    database
      .prepare(
        `INSERT INTO provider_registrations
          (provider_registration_id, provider, resource_identity, registration_mode,
           callback_url, approved_scopes_json, client_credential_reference, source, status,
           revision, created_at, updated_at)
         VALUES (?, 'github-app', 'synthetic-platform-registration', 'platform-pre-registered',
                 'https://example.invalid/callback', '[]', 'private-reference', 'platform',
                 'active', 1, 0, 0)`,
      )
      .run("supernala-github-app-v1");
    expect(await adapter.stage(release)).toEqual(Result.succeed(undefined));
    database
      .prepare(
        "UPDATE provider_registrations SET status = 'revoked' WHERE provider_registration_id = ?",
      )
      .run("supernala-github-app-v1");
    expect(await adapter.finalize(release)).toEqual(
      Result.fail("application-provider-verification-failed"),
    );
    expect(
      database
        .prepare("SELECT status FROM plugin_versions WHERE plugin_version_id = ?")
        .get(release.version.id),
    ).toMatchObject({ status: "publishing" });
    database
      .prepare(
        "UPDATE provider_registrations SET status = 'active' WHERE provider_registration_id = ?",
      )
      .run("supernala-github-app-v1");
    expect(await adapter.finalize(release)).toEqual(Result.succeed(undefined));
    expect(await adapter.readPublished(release)).toEqual(Result.succeed(true));
    expect(
      database
        .prepare(
          `SELECT authentication_kind, provider_registration_id, requested_scopes_json
           FROM plugin_versions WHERE plugin_version_id = ?`,
        )
        .get(release.version.id),
    ).toMatchObject({
      authentication_kind: "github-app",
      provider_registration_id: "supernala-github-app-v1",
      requested_scopes_json: "[]",
    });
    database
      .prepare(
        "UPDATE provider_registrations SET status = 'revoked' WHERE provider_registration_id = ?",
      )
      .run("supernala-github-app-v1");
    expect(await adapter.readPublished(release)).toEqual(Result.succeed(false));
    database.close();
  } finally {
    await rm(root, { recursive: true });
  }
});

it("retries once against an exact concurrent alternate-ID Config winner", async () => {
  const database = await applicationDatabase();
  const release = await candidate();
  const adapter = new Phase1D1PublicationAdapter(new ConfigWinnerRaceTransport(database, release));
  expect(await adapter.stage(release)).toEqual(Result.succeed(undefined));
  expect(
    database
      .prepare("SELECT config_schema_id FROM plugin_versions WHERE plugin_version_id = ?")
      .get(release.version.id),
  ).toMatchObject({ config_schema_id: "legacy:concurrent-winner" });
  expect(database.prepare("SELECT COUNT(*) AS count FROM plugin_artifacts").get()).toMatchObject({
    count: 1,
  });
  database.close();
});

it("reuses canonical legacy Config JSON but rejects stored excess fields", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "marketplace-config-json-"));
  try {
    const release = await candidate(await createGithubPackageSource(root));
    for (const storedForm of ["canonical-whitespace", "excess-field"] as const) {
      const database = await applicationDatabase();
      database
        .prepare(
          `INSERT INTO provider_registrations
            (provider_registration_id, provider, resource_identity, registration_mode,
             callback_url, approved_scopes_json, client_credential_reference, source, status,
             revision, created_at, updated_at)
           VALUES ('supernala-github-app-v1', 'github-app', 'synthetic',
                   'platform-pre-registered', 'https://example.invalid/callback', '[]',
                   'private-reference', 'platform', 'active', 1, 0, 0)`,
        )
        .run();
      const fields = release.version.config.fields.map((field) =>
        storedForm === "excess-field" ? { ...field, unreviewed: true } : field,
      );
      database
        .prepare(
          `INSERT INTO plugin_config_schemas
            (config_schema_id, schema_digest, revision, fields_json, created_at)
           VALUES ('legacy:verified-config', ?, ?, ?, 0)`,
        )
        .run(
          release.configDigest,
          release.version.config.revision,
          JSON.stringify(fields, null, 2),
        );
      const adapter = new Phase1D1PublicationAdapter(new SQLiteD1Transport(database));
      const staged = await adapter.stage(release);
      if (storedForm === "canonical-whitespace") {
        expect(staged).toEqual(Result.succeed(undefined));
        expect(
          database
            .prepare("SELECT config_schema_id FROM plugin_versions WHERE plugin_version_id = ?")
            .get(release.version.id),
        ).toMatchObject({ config_schema_id: "legacy:verified-config" });
      } else {
        expect(staged).toEqual(Result.fail("application-config-conflict"));
        expect(
          database.prepare("SELECT COUNT(*) AS count FROM plugin_versions").get(),
        ).toMatchObject({ count: 0 });
      }
      database.close();
    }
  } finally {
    await rm(root, { recursive: true });
  }
});
