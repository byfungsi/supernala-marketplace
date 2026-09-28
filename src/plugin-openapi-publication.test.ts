import { copyFile, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { createHash } from "node:crypto";
import { backup, DatabaseSync } from "node:sqlite";
import { Result, Schema } from "effect";
import { describe, expect, it } from "vitest";
import { Phase1D1PublicationAdapter } from "./phase1-d1-publication-adapter.js";
import type { D1BatchTransport, D1Statement } from "./cloudflare-adapters.js";
import { loadPluginOpenApiSource } from "./plugin-openapi-source.js";
import {
  buildPluginOpenApiReleaseBundle,
  calculatePluginOpenApiSourceInputDigest,
} from "./plugin-openapi-release-bundle.js";
import {
  deriveBootstrapAuthoritySnapshot,
  derivePluginOpenApiAuthoritySnapshot,
  diffPluginAuthority,
} from "./authority-diff.js";
import {
  calculateAuthorityBaselineDigest,
  calculateReleaseDigest,
  ReleaseReview,
} from "./release-bundle.js";
import { PackagedPluginAuthentication } from "./package-archive.js";
import {
  canonicalPluginJson,
  digestPluginBytes,
  PluginMarketplaceId,
  PluginPublisherNamespace,
  PluginSemanticVersion,
  PluginSlug,
  PluginVersion,
  PluginSha256,
  ProviderRegistrationId,
} from "./plugin-contract.js";
import {
  InMemoryImmutableArtifactStore,
  PluginReleaseIdentity,
  publishIncrementalRelease,
  InMemoryReleaseJournal,
  type IncrementalReleaseCandidate,
} from "./release-machine.js";

class SQLiteOpenApiTransport implements D1BatchTransport {
  constructor(readonly database: DatabaseSync) {}
  beforeNextBatch: (() => void) | undefined;
  async batch(statements: ReadonlyArray<D1Statement>) {
    const before = this.beforeNextBatch;
    this.beforeNextBatch = undefined;
    before?.();
    this.database.exec("BEGIN IMMEDIATE");
    try {
      const changes = statements.map(({ sql, params }) => ({
        changes: Number(this.database.prepare(sql).run(...params).changes),
      }));
      this.database.exec("COMMIT");
      return Result.succeed(changes);
    } catch {
      this.database.exec("ROLLBACK");
      return Result.fail("sqlite-batch-failed");
    }
  }
  async query(statement: D1Statement) {
    try {
      return Result.succeed(
        this.database
          .prepare(statement.sql)
          .all(...statement.params)
          .map((row) => Schema.decodeUnknownSync(Schema.JsonObject)(row)),
      );
    } catch {
      return Result.fail("sqlite-query-failed");
    }
  }
}

const createOpenApiDatabase = async () => {
  const database = new DatabaseSync(":memory:");
  database.exec("PRAGMA foreign_keys = ON");
  const applicationMigrations = process.env.MARKETPLACE_APPLICATION_MIGRATIONS_DIR;
  if (applicationMigrations !== undefined) {
    for (const filename of (await readdir(applicationMigrations))
      .filter((name) => name.endsWith(".sql") && name <= "0081_managed_openapi_plugins.sql")
      .toSorted()) {
      const bytes = await readFile(path.join(applicationMigrations, filename));
      if (filename === "0081_managed_openapi_plugins.sql")
        expect(bytes).toEqual(
          await readFile("fixtures/sql/phase1-0081-managed-openapi-plugins.sql"),
        );
      database.exec(bytes.toString("utf8"));
    }
    return database;
  }
  for (const migration of [
    "0042-plugin-control-plane",
    "0044-plugin-oauth-publication-authority",
  ]) {
    database.exec(await readFile(`fixtures/sql/phase1-${migration}.sql`, "utf8"));
  }
  database.exec(`CREATE TABLE workspace_memberships
    (workspace_id TEXT NOT NULL, user_id TEXT NOT NULL, role TEXT NOT NULL, status TEXT NOT NULL)`);
  for (const migration of [
    "0047-plugin-oauth-environment-registration-authority",
    "0048-plugin-oauth-runtime-lifecycle",
    "0050-workspace-oauth-apps",
    "0051-workspace-owned-oauth-authority",
    "0053-managed-remote-oauth-publication-authority",
    "0054-managed-remote-dynamic-oauth-runtime",
    "0055-plugin-auth-strategies",
  ]) {
    database.exec(await readFile(`fixtures/sql/phase1-${migration}.sql`, "utf8"));
  }
  // The portable pre-0081 migration set omits unrelated application installation triggers.
  for (const trigger of [
    "plugin_installation_requires_published_version",
    "plugin_default_grants_after_ready_connection_insert",
    "plugin_default_grants_after_connection_ready",
    "plugin_default_grants_after_agent_insert",
    "plugin_publication_intent_oauth_source_insert",
    "plugin_oauth_connection_ready_insert",
    "plugin_oauth_connection_ready_update",
  ]) {
    database.exec(
      `CREATE TRIGGER IF NOT EXISTS ${trigger} BEFORE INSERT ON plugin_versions BEGIN SELECT 1; END`,
    );
  }
  database.exec(`CREATE TABLE agent_profiles (agent_id TEXT PRIMARY KEY, owner_id TEXT, status TEXT, created_at INTEGER);
    CREATE TABLE "user" (id TEXT PRIMARY KEY)`);
  const migration = await readFile("fixtures/sql/phase1-0081-managed-openapi-plugins.sql");
  expect(createHash("sha256").update(migration).digest("hex")).toBe(
    "c28bd7113983f548360d2276179ee9002494abbcbdd55e764142fc9392daa96d",
  );
  database.exec(migration.toString("utf8"));
  return database;
};

describe("OpenAPI existing release machine and D1 adapter", () => {
  it("stages, verifies immutable artifact, finalizes, reads back, and retries without new writes", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "marketplace-openapi-joint-"));
    const sourceDirectory = path.join(root, "source");
    await mkdir(sourceDirectory);
    for (const file of ["openapi.json", "openapi-source.json"]) {
      await copyFile(
        path.join("plugins/openapi-inventory", file),
        path.join(sourceDirectory, file),
      );
    }
    const metadata = JSON.parse(
      await readFile(path.join(sourceDirectory, "openapi-source.json"), "utf8"),
    );
    metadata.status = "reviewed-publishable";
    await writeFile(path.join(sourceDirectory, "openapi-source.json"), JSON.stringify(metadata));
    const loaded = await loadPluginOpenApiSource(sourceDirectory);
    expect(Result.isSuccess(loaded)).toBe(true);
    if (Result.isFailure(loaded)) return;
    const identity = PluginReleaseIdentity.make({
      marketplaceId: "supernala-public",
      publisherNamespace: "supernala",
      pluginSlug: "inventory",
      semanticVersion: "1.0.0",
    });
    const { source: authoring, compiled } = loaded.success;
    const config = { revision: 1, fields: [] } as const;
    const provenance = { sourceDigest: compiled.contract.sourceDigest };
    const sharedInputDigest = await digestPluginBytes(
      new TextEncoder().encode("joint-offline-input"),
    );
    const sourceInputDigest = await calculatePluginOpenApiSourceInputDigest({
      sourceDirectory,
      sharedInputDigest,
    });
    const authorityAfter = derivePluginOpenApiAuthoritySnapshot(compiled.contract);
    const authorityBefore = deriveBootstrapAuthoritySnapshot(authorityAfter);
    const digestJson = (value: Schema.Json) =>
      digestPluginBytes(new TextEncoder().encode(canonicalPluginJson(value)));
    const authorityBeforeDigest = await digestJson(authorityBefore);
    const authorityDigest = await digestJson(authorityAfter);
    const authorityDiffDigest = PluginSha256.make(
      (await diffPluginAuthority(authorityBefore, authorityAfter)).diffDigest,
    );
    const authentication = PackagedPluginAuthentication.make({ kind: "none" });
    const version = PluginVersion.make({
      id: authoring.pluginVersionId,
      marketplaceId: PluginMarketplaceId.make(identity.marketplaceId),
      publisherNamespace: PluginPublisherNamespace.make(identity.publisherNamespace),
      pluginSlug: PluginSlug.make(identity.pluginSlug),
      version: PluginSemanticVersion.make(identity.semanticVersion),
      name: authoring.name,
      description: authoring.description,
      license: authoring.license,
      runtime: {
        _tag: "ManagedOpenApi",
        kind: "managed-openapi",
        artifactDigest: compiled.artifactDigest,
        manifestDigest: compiled.artifactDigest,
        providerRegistrationId: ProviderRegistrationId.make("inventory-provider"),
      },
      catalog: compiled.contract.catalog,
      config,
      allowedHosts: ["inventory.example.com"],
      status: "published",
      publishedAt: 100,
    });
    const configDigest = await digestPluginBytes(new TextEncoder().encode(JSON.stringify(config)));
    const provenanceDigest = await digestJson(provenance);
    const authorityBaselineDigest = await calculateAuthorityBaselineDigest({
      authorityBeforeIdentity: null,
      authorityBeforeReleaseDigest: null,
      authorityBefore,
      authorityBeforeDigest,
    });
    const releaseDigest = await calculateReleaseDigest({
      identity,
      version,
      authentication,
      sourceInputDigest,
      catalogDigest: compiled.contract.catalog.digest,
      configDigest,
      provenanceDigest,
      authorityBaselineDigest,
      authorityDigest,
      authorityDiffDigest,
      artifactDigest: compiled.artifactDigest,
    });
    const review = ReleaseReview.make({
      schemaVersion: 1,
      identity,
      reviewId: "review-openapi",
      reviewer: "offline-reviewer",
      reviewedAt: 100,
      sourceInputDigest,
      artifactDigest: compiled.artifactDigest,
      authentication,
      authStrategy: compiled.contract.authStrategy,
      catalogDigest: compiled.contract.catalog.digest,
      configDigest,
      provenanceDigest,
      authorityBeforeIdentity: null,
      authorityBeforeReleaseDigest: null,
      authorityBefore,
      authorityBeforeDigest,
      authorityAfter,
      authorityDigest,
      authorityDiffDigest,
      releaseDigest,
      decision: "approved",
    });
    const built = await buildPluginOpenApiReleaseBundle({
      sourceDirectory,
      outputDirectory: path.join(root, "reviewed-bundle"),
      sharedInputDigest,
      mergeCommit: "a".repeat(40),
      releaseOrdinal: 1,
      review,
      previousPublished: null,
    });
    expect(Result.isSuccess(built)).toBe(true);
    if (Result.isFailure(built)) throw new Error(built.failure);
    const candidate: IncrementalReleaseCandidate = built.success;
    const database = await createOpenApiDatabase();
    try {
      database
        .prepare(`INSERT INTO plugin_config_schemas
        (config_schema_id, schema_digest, revision, fields_json, created_at)
        VALUES ('preexisting-empty-config', ?, 1, '[]', 1)`)
        .run(candidate.configDigest);
      const missingProvider = new Phase1D1PublicationAdapter(new SQLiteOpenApiTransport(database));
      expect(await missingProvider.stage(candidate)).toMatchObject({
        _tag: "Failure",
        failure: "openapi-stage-failed",
      });
      expect(database.prepare("SELECT count(*) AS count FROM plugin_versions").get()).toMatchObject(
        { count: 0 },
      );
      database
        .prepare(`INSERT INTO provider_registrations
        (provider_registration_id, provider, resource_identity, registration_mode,
         authorization_metadata_url, callback_url, approved_scopes_json, source, status,
         revision, created_at, updated_at)
        VALUES ('inventory-provider', 'inventory', 'inventory.example.com', 'dynamic',
          'https://inventory.example.com/oauth', 'https://supernala.example.com/callback', '[]',
          'platform', 'active', 1, 100, 100)`)
        .run();
      const transport = new SQLiteOpenApiTransport(database);
      const application = new Phase1D1PublicationAdapter(transport);
      const journal = new InMemoryReleaseJournal();
      const artifacts = new InMemoryImmutableArtifactStore();
      artifacts.failNextUpload = true;
      expect(
        await publishIncrementalRelease({ candidate, journal, artifacts, application }),
      ).toMatchObject({ _tag: "Failure", failure: "artifact-upload-failed" });
      expect(artifacts.putCount).toBe(0);
      expect(
        database
          .prepare("SELECT status FROM plugin_versions WHERE plugin_version_id = ?")
          .get(candidate.version.id),
      ).toMatchObject({ status: "publishing" });
      let interrupted = true;
      const interruptedApplication = {
        stage: (value: IncrementalReleaseCandidate) => application.stage(value),
        finalize: (value: IncrementalReleaseCandidate) => {
          if (interrupted) {
            interrupted = false;
            return Promise.resolve(Result.fail("controlled-finalize-interruption"));
          }
          return application.finalize(value);
        },
        readPublished: (value: IncrementalReleaseCandidate) => application.readPublished(value),
      };
      expect(
        await publishIncrementalRelease({
          candidate,
          journal,
          artifacts,
          application: interruptedApplication,
        }),
      ).toMatchObject({ _tag: "Failure", failure: "controlled-finalize-interruption" });
      expect(artifacts.putCount).toBe(1);
      expect(
        database
          .prepare("SELECT status FROM plugin_versions WHERE plugin_version_id = ?")
          .get(candidate.version.id),
      ).toMatchObject({ status: "publishing" });
      expect(
        database
          .prepare("SELECT config_schema_id FROM plugin_versions WHERE plugin_version_id = ?")
          .get(candidate.version.id),
      ).toMatchObject({ config_schema_id: "preexisting-empty-config" });
      expect(await application.stage(candidate)).toMatchObject({ _tag: "Success" });
      const interleavings = [
        {
          table: "plugin_catalog_tools",
          where: "catalog_snapshot_id = ? AND tool_id = 'items.list'",
          key: candidate.version.catalog.id,
          field: "default_policy",
          drift: "block",
          original: "allow",
        },
        {
          table: "plugin_config_schemas",
          where: "schema_digest = ?",
          key: candidate.configDigest,
          field: "fields_json",
          drift: '[{"key":"unexpected"}]',
          original: "[]",
        },
        {
          table: "plugin_versions",
          where: "plugin_version_id = ?",
          key: candidate.version.id,
          field: "allowed_hosts_json",
          drift: "[]",
          original: JSON.stringify(candidate.version.allowedHosts),
        },
        {
          table: "plugin_versions",
          where: "plugin_version_id = ?",
          key: candidate.version.id,
          field: "provenance_json",
          drift: "{}",
          original: JSON.stringify(candidate.provenance),
        },
        {
          table: "provider_registrations",
          where: "provider_registration_id = ?",
          key: "inventory-provider",
          field: "status",
          drift: "revoked",
          original: "active",
        },
      ];
      for (const change of interleavings) {
        const update = database.prepare(
          `UPDATE ${change.table} SET ${change.field} = ? WHERE ${change.where}`,
        );
        transport.beforeNextBatch = () => {
          update.run(change.drift, change.key);
        };
        expect(await application.finalize(candidate)).toMatchObject({
          _tag: "Failure",
          failure: "openapi-finalize-failed",
        });
        expect(
          database
            .prepare("SELECT status FROM plugin_versions WHERE plugin_version_id = ?")
            .get(candidate.version.id),
        ).toMatchObject({ status: "publishing" });
        expect(
          database
            .prepare("SELECT status FROM plugin_artifacts WHERE artifact_digest = ?")
            .get(candidate.artifactDigest),
        ).toMatchObject({ status: "pending" });
        update.run(change.original, change.key);
      }
      const first = await publishIncrementalRelease({ candidate, journal, artifacts, application });
      expect(first).toMatchObject({ _tag: "Success", success: { status: "published" } });
      expect(artifacts.putCount).toBe(1);
      expect(await application.finalize(candidate)).toMatchObject({ _tag: "Success" });
      expect(await application.readPublished(candidate)).toMatchObject({
        _tag: "Success",
        success: true,
      });
      const retry = await publishIncrementalRelease({ candidate, journal, artifacts, application });
      expect(retry).toMatchObject({ _tag: "Success", success: { status: "unchanged" } });
      expect(
        database
          .prepare("SELECT status FROM plugin_versions WHERE plugin_version_id = ?")
          .get(candidate.version.id),
      ).toMatchObject({ status: "published" });
      expect(database.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
      const exportDirectory = process.env.MARKETPLACE_OPENAPI_JOINT_EXPORT_DIR;
      if (exportDirectory !== undefined) {
        await mkdir(exportDirectory, { recursive: true });
        const bytes = candidate.artifactBytes;
        if (bytes === null) throw new Error("reviewed-openapi-artifact-missing");
        expect(await digestPluginBytes(bytes)).toBe(candidate.artifactDigest);
        await backup(database, path.join(exportDirectory, "published.sqlite"));
        await writeFile(path.join(exportDirectory, "openapi-bundle.json"), bytes);
        await writeFile(
          path.join(exportDirectory, "publication.json"),
          JSON.stringify({
            versionId: candidate.version.id,
            definitionId: candidate.definitionId,
            catalogSnapshotId: candidate.version.catalog.id,
            catalogDigest: candidate.catalogDigest,
            artifactDigest: candidate.artifactDigest,
            objectKey: `openapi/${candidate.artifactDigest}`,
            releaseDigest: candidate.releaseDigest,
            reviewId: candidate.reviewId,
          }),
        );
      }
      database
        .prepare(`UPDATE plugin_catalog_tools SET default_policy = 'block'
        WHERE catalog_snapshot_id = ? AND tool_id = ?`)
        .run(candidate.version.catalog.id, "items.list");
      expect(await application.readPublished(candidate)).toMatchObject({
        _tag: "Success",
        success: false,
      });
    } finally {
      database.close();
      await rm(root, { recursive: true, force: true });
    }
  });
});
