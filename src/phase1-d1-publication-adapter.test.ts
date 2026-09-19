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
import {
  canonicalPluginJson,
  digestPluginBytes,
  PluginSha256,
  PluginVersion,
} from "./plugin-contract.js";
import { PackagedPluginAuthentication } from "./package-archive.js";
import {
  decodePluginOAuthProviderDefinition,
  digestPluginOAuthProviderDefinition,
  encodePluginOAuthProviderDefinitionCanonicalJson,
} from "./oauth-provider-definition.js";
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

class SequencedQueryTransport implements D1BatchTransport {
  readonly queries: Array<D1Statement> = [];
  batchCalls = 0;
  constructor(readonly responses: Array<ReadonlyArray<Schema.JsonObject>>) {}
  async batch(_statements: ReadonlyArray<D1Statement>) {
    this.batchCalls += 1;
    return Result.fail("unexpected-batch");
  }
  async query(statement: D1Statement) {
    this.queries.push(statement);
    return Result.succeed(this.responses.shift() ?? []);
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

class RecordingSQLiteD1Transport extends SQLiteD1Transport {
  readonly batches: Array<ReadonlyArray<D1Statement>> = [];

  override async batch(statements: ReadonlyArray<D1Statement>) {
    this.batches.push(statements);
    return super.batch(statements);
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
  readonly toolCount?: number;
}): Promise<string> => {
  const directory = path.join(input.root, `${input.slug}-${input.version}`);
  await cp("plugins/offline-fixture", directory, { recursive: true });
  // SAFETY: This test owns the copied fixture JSON and immediately passes the rewritten files
  // through the production authoring schemas before using them as a release candidate.
  const catalog = JSON.parse(await readFile(path.join(directory, "catalog.json"), "utf8")) as {
    id: string;
    tools: Array<{ id: string; mcpName: string; readonly [key: string]: unknown }>;
  };
  if (input.catalogSuffix !== undefined) {
    catalog.id = `offline-fixture-catalog-${input.catalogSuffix}`;
    const tool = catalog.tools[0];
    if (tool === undefined) throw new Error("test-tool-missing");
    tool.id = `${input.slug}.echo`;
  }
  if (input.toolCount !== undefined) {
    const template = catalog.tools[0];
    if (template === undefined) throw new Error("test-tool-missing");
    catalog.tools = Array.from({ length: input.toolCount }, (_, index) => ({
      ...template,
      id: `${input.slug}.tool-${index}`,
      mcpName: `tool_${index}`,
    }));
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

const syntheticOAuthDefinitionJson = {
  schemaVersion: 1,
  protocol: "oauth2-authorization-code",
  issuer: "https://identity.synthetic.example",
  provider: "synthetic-mail",
  resourceIdentity: "mail-api.synthetic.example",
  authorizationEndpoint: "https://identity.synthetic.example/oauth/authorize",
  tokenEndpoint: "https://identity.synthetic.example/oauth/token",
  tokenEndpointAuthMethod: "client_secret_post",
  authorizationResponseIssuer: "required",
  pkce: { method: "S256" },
  authorizationParameters: [{ name: "audience", value: "synthetic-mail" }],
  scopes: ["synthetic.mail.read"],
  account: {
    kind: "https-json",
    endpoint: "https://mail-api.synthetic.example/v1/account",
    authorization: "bearer",
    subjectPath: ["account", "mailboxId"],
    displayLabelPath: ["account", "displayName"],
    subjectStability: "stable",
    maximumResponseBytes: 65_536,
    maximumJsonDepth: 8,
    maximumObjectKeys: 256,
    maximumSubjectLength: 200,
    maximumDisplayLabelLength: 120,
  },
  tokens: {
    accessTokenType: "bearer",
    expiresIn: { required: true, minimumSeconds: 60, maximumSeconds: 7_200 },
    grantedScopes: { whenPresent: "exact-match", whenOmitted: "requested-scopes" },
    initialRefreshToken: "required",
    refreshResponseToken: "retain-current-if-omitted",
  },
  refresh: {
    kind: "standard-form-post",
    invalidGrant: "reauthorization-required",
    ambiguousOutcome: "fail-closed-no-replay",
  },
  revocation: { kind: "none" },
} as const;

const syntheticOAuthDefinition = () => {
  const decoded = decodePluginOAuthProviderDefinition(syntheticOAuthDefinitionJson);
  if (Result.isFailure(decoded)) throw new Error("test-oauth-definition-invalid");
  return decoded.success;
};

const syntheticOAuthAuthentication = (definitionDigest: string) =>
  Schema.decodeUnknownSync(PackagedPluginAuthentication, { onExcessProperty: "error" })({
    kind: "oauth",
    providerRegistration: "synthetic-mail-rest-v1",
    providerDefinitionDigest: definitionDigest,
    requestedScopes: ["synthetic.mail.read"],
    credentialDelivery: "short-lived-access-token-only",
  });

const syntheticOAuthDefinitionRow = async (
  definition: ReturnType<typeof syntheticOAuthDefinition>,
): Promise<Schema.JsonObject> => ({
  provider_definition_digest: await digestPluginOAuthProviderDefinition(definition),
  schema_version: 1,
  canonical_definition_json: new TextDecoder().decode(
    encodePluginOAuthProviderDefinitionCanonicalJson(definition),
  ),
  scopes_json: canonicalPluginJson(definition.scopes),
  provider: definition.provider,
  resource_identity: definition.resourceIdentity,
  display_label_path_present: 1,
  status: "active",
  revision: 1,
});

const createSyntheticOAuthPackageSource = async (
  root: string,
  definitionDigest: string,
): Promise<string> => {
  const directory = await createGithubPackageSource(root);
  const manifest = Schema.decodeUnknownSync(Schema.JsonObject)(
    JSON.parse(await readFile(path.join(directory, "plugin.json"), "utf8")),
  );
  await writeFile(
    path.join(directory, "plugin.json"),
    `${JSON.stringify(
      {
        ...manifest,
        authentication: {
          kind: "oauth",
          providerRegistration: "synthetic-mail-rest-v1",
          providerDefinitionDigest: definitionDigest,
          requestedScopes: ["synthetic.mail.read"],
          credentialDelivery: "short-lived-access-token-only",
        },
      },
      null,
      2,
    )}\n`,
  );
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
const exactOAuthMigrationFile = "fixtures/sql/phase1-0044-plugin-oauth-publication-authority.sql";
const exactOAuthMigrationDigest =
  "41b1a35768cba4aa334b69889051e8d6b6f6b2ff4b10c01b7cb632ad43fe3448";

const applicationDatabase = async (): Promise<DatabaseSync> => {
  const migration = await readFile(exactMigrationFile);
  const oauthMigration = await readFile(exactOAuthMigrationFile);
  expect(createHash("sha256").update(migration).digest("hex")).toBe(exactMigrationDigest);
  expect(createHash("sha256").update(oauthMigration).digest("hex")).toBe(exactOAuthMigrationDigest);
  const database = new DatabaseSync(":memory:");
  database.exec("PRAGMA foreign_keys = ON");
  database.exec(migration.toString("utf8"));
  database.exec(oauthMigration.toString("utf8"));
  return database;
};

it("places rollback guard inside stage and finalization batches", async () => {
  const database = await applicationDatabase();
  const transport = new RecordingSQLiteD1Transport(database);
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
  database.close();
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
    .prepare("UPDATE plugin_versions SET published_at = 9 WHERE plugin_version_id = ?")
    .run(release.version.id);
  expect(await adapter.readPublished(release)).toEqual(Result.succeed(false));
  database
    .prepare("UPDATE plugin_versions SET published_at = ? WHERE plugin_version_id = ?")
    .run(release.version.publishedAt, release.version.id);
  database
    .prepare(
      "UPDATE plugin_publication_intents SET publication_intent_id = 'corrupt:intent' WHERE plugin_version_id = ?",
    )
    .run(release.version.id);
  expect(await adapter.readPublished(release)).toEqual(Result.succeed(false));
  database
    .prepare(
      "UPDATE plugin_publication_intents SET publication_intent_id = ? WHERE plugin_version_id = ?",
    )
    .run(`${release.version.id}:publication`, release.version.id);
  database
    .prepare("UPDATE plugin_catalog_tools SET ordinal = ordinal + 7 WHERE catalog_snapshot_id = ?")
    .run(release.version.catalog.id);
  expect(await adapter.readPublished(release)).toEqual(Result.succeed(false));
  expect(await adapter.readPublicationState(release)).toEqual(Result.succeed("mismatch"));
  database
    .prepare("UPDATE plugin_catalog_tools SET ordinal = ordinal - 7 WHERE catalog_snapshot_id = ?")
    .run(release.version.catalog.id);
  database
    .prepare(
      "UPDATE plugin_catalog_tools SET title = 'Tampered title' WHERE catalog_snapshot_id = ?",
    )
    .run(release.version.catalog.id);
  expect(await adapter.readPublished(release)).toEqual(Result.succeed(false));
  const firstTool = release.version.catalog.tools[0];
  if (firstTool === undefined) throw new Error("test-tool-missing");
  database
    .prepare("UPDATE plugin_catalog_tools SET title = ? WHERE catalog_snapshot_id = ?")
    .run(firstTool.title, release.version.catalog.id);
  database
    .prepare("DELETE FROM plugin_catalog_tools WHERE catalog_snapshot_id = ?")
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

it("keeps every D1 statement within 100 binds for larger exact catalogs", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "marketplace-bind-budget-"));
  try {
    const source = await createSourceVariant({
      root,
      slug: "bind-budget",
      version: "1.0.0",
      catalogSuffix: "bind-budget",
      toolCount: 25,
    });
    const release = await candidate(source);
    const database = await applicationDatabase();
    const transport = new RecordingSQLiteD1Transport(database);
    const adapter = new Phase1D1PublicationAdapter(transport);
    expect(await adapter.stage(release)).toEqual(Result.succeed(undefined));
    expect(await adapter.finalize(release)).toEqual(Result.succeed(undefined));
    expect(
      Math.max(...transport.batches.flatMap((batch) => batch.map((entry) => entry.params.length))),
    ).toBeLessThanOrEqual(100);
    expect(await adapter.readPublished(release)).toEqual(Result.succeed(true));
    database
      .prepare(
        `UPDATE plugin_catalog_tools SET ordinal = ordinal + 7
         WHERE catalog_snapshot_id = ? AND ordinal = 24`,
      )
      .run(release.version.catalog.id);
    expect(await adapter.readPublished(release)).toEqual(Result.succeed(false));
    expect(await adapter.readPublicationState(release)).toEqual(Result.succeed("mismatch"));
    database.close();
  } finally {
    await rm(root, { recursive: true });
  }
});

it("fences Marketplace and Plugin-definition lifecycle during stage and finalize", async () => {
  const release = await candidate();
  const disabledMarketplace = await applicationDatabase();
  disabledMarketplace
    .prepare("UPDATE plugin_marketplaces SET status = 'disabled' WHERE marketplace_id = ?")
    .run(release.version.marketplaceId);
  const marketplaceAdapter = new Phase1D1PublicationAdapter(
    new SQLiteD1Transport(disabledMarketplace),
  );
  expect(await marketplaceAdapter.stage(release)).toEqual(Result.fail("application-stage-failed"));
  expect(
    disabledMarketplace.prepare("SELECT COUNT(*) AS count FROM plugin_versions").get(),
  ).toMatchObject({ count: 0 });
  disabledMarketplace.close();

  const disabledDefinition = await applicationDatabase();
  const definitionAdapter = new Phase1D1PublicationAdapter(
    new SQLiteD1Transport(disabledDefinition),
  );
  expect(await definitionAdapter.stage(release)).toEqual(Result.succeed(undefined));
  disabledDefinition
    .prepare("UPDATE plugin_definitions SET status = 'disabled' WHERE plugin_definition_id = ?")
    .run(release.definitionId);
  expect(await definitionAdapter.finalize(release)).toEqual(
    Result.fail("application-finalize-failed"),
  );
  expect(
    disabledDefinition
      .prepare("SELECT status FROM plugin_artifacts WHERE artifact_digest = ?")
      .get(release.artifactDigest),
  ).toMatchObject({ status: "pending" });
  expect(await definitionAdapter.readPublished(release)).toEqual(Result.succeed(false));
  disabledDefinition.close();
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

it("treats exact lost stage acknowledgement as idempotent and rejects a different winner", async () => {
  const database = await applicationDatabase();
  const release = await candidate();
  const adapter = new Phase1D1PublicationAdapter(new SQLiteD1Transport(database));
  expect(await adapter.stage(release)).toEqual(Result.succeed(undefined));
  expect(await adapter.stage(release)).toEqual(Result.succeed(undefined));
  expect(
    await adapter.stage({
      ...release,
      version: PluginVersion.make({
        id: release.version.id,
        marketplaceId: release.version.marketplaceId,
        publisherNamespace: release.version.publisherNamespace,
        pluginSlug: release.version.pluginSlug,
        version: release.version.version,
        name: release.version.name,
        description: release.version.description,
        license: release.version.license,
        catalog: release.version.catalog,
        config: release.version.config,
        allowedHosts: ["different-winner.example.invalid"],
        runtime: release.version.runtime,
        status: release.version.status,
        publishedAt: release.version.publishedAt,
      }),
    }),
  ).toEqual(Result.fail("immutable-version-conflict"));
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

it("persists exact generic OAuth definition and semantic registration authority", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "marketplace-oauth-auth-"));
  try {
    const definition = syntheticOAuthDefinition();
    const definitionDigest = await digestPluginOAuthProviderDefinition(definition);
    const source = await createSyntheticOAuthPackageSource(root, definitionDigest);
    const release = await candidate(source);
    expect(release.authentication).toEqual({
      kind: "oauth",
      providerRegistration: "synthetic-mail-rest-v1",
      providerDefinitionDigest: definitionDigest,
      requestedScopes: ["synthetic.mail.read"],
      credentialDelivery: "short-lived-access-token-only",
    });
    const database = await applicationDatabase();
    const adapter = new Phase1D1PublicationAdapter(new SQLiteD1Transport(database));
    expect(await adapter.stage(release)).toEqual(
      Result.fail("application-provider-verification-failed"),
    );
    database
      .prepare(
        `INSERT INTO plugin_oauth_provider_definitions
          (provider_definition_digest, schema_version, canonical_definition_json, scopes_json,
           provider, resource_identity, display_label_path_present, status, revision,
           admission_operation_id, admitted_by, source_kind, source_repository, source_revision,
           source_path, source_content_digest, reviewed_at, created_at, updated_at)
         VALUES (?, 1, ?, ?, 'synthetic-mail', 'mail-api.synthetic.example', 1, 'active', 1,
                 'synthetic-admission', 'synthetic-reviewer', 'marketplace-release',
                 'synthetic/repository', 'synthetic-revision', 'providers/synthetic.json', ?,
                 1, 1, 1)`,
      )
      .run(
        definitionDigest,
        new TextDecoder().decode(encodePluginOAuthProviderDefinitionCanonicalJson(definition)),
        '["synthetic.mail.read"]',
        definitionDigest,
      );
    database
      .prepare(
        `INSERT INTO provider_registrations
          (provider_registration_id, provider, resource_identity, registration_mode,
           callback_url, approved_scopes_json, client_credential_reference, source, status,
            revision, created_at, updated_at, oauth_provider_definition_digest,
            oauth_provider_definition_revision, oauth_authority_revision)
          VALUES ('synthetic-mail-rest-v1', 'synthetic-mail', 'mail-api.synthetic.example',
                  'platform-pre-registered', 'https://example.invalid/v1/plugins/oauth/callback',
                  '["synthetic.mail.read"]', 'private-reference', 'platform', 'active', 1, 0, 0,
                  ?, 1, 1)`,
      )
      .run(definitionDigest);
    expect(await adapter.stage(release)).toEqual(Result.succeed(undefined));
    expect(
      database
        .prepare(
          `SELECT authentication_kind, provider_registration_id, requested_scopes_json,
                  provider_registration_authority_revision, provider_definition_digest,
                  provider_definition_revision
           FROM plugin_versions WHERE plugin_version_id = ?`,
        )
        .get(release.version.id),
    ).toMatchObject({
      authentication_kind: "oauth",
      provider_registration_id: "synthetic-mail-rest-v1",
      requested_scopes_json: '["synthetic.mail.read"]',
      provider_registration_authority_revision: 1,
      provider_definition_digest: definitionDigest,
      provider_definition_revision: 1,
    });
    expect(await adapter.finalize(release)).toEqual(Result.succeed(undefined));
    expect(await adapter.readPublished(release)).toEqual(Result.succeed(true));
    database
      .prepare(
        `UPDATE plugin_oauth_provider_definitions
         SET status = 'revoked', revision = 2, updated_at = 2, revoked_at = 2,
             revocation_operation_id = 'synthetic-revocation', revoked_by = 'synthetic-reviewer',
             revocation_reason = 'synthetic-test'
         WHERE provider_definition_digest = ?`,
      )
      .run(definitionDigest);
    expect(await adapter.readPublished(release)).toEqual(Result.succeed(false));
    database.close();
  } finally {
    await rm(root, { recursive: true });
  }
});

it("validates canonical OAuth definitions before registration lookup", async () => {
  const baseRelease = await candidate();
  const decodeDefinition = (value: Schema.Json) => {
    const decoded = decodePluginOAuthProviderDefinition(value);
    if (Result.isFailure(decoded)) throw new Error("test-oauth-definition-invalid");
    return decoded.success;
  };
  const attempt = async (
    definition: ReturnType<typeof syntheticOAuthDefinition>,
    rowChanges: Readonly<Record<string, Schema.Json>> = {},
    registrationRows: ReadonlyArray<Schema.JsonObject> = [],
  ) => {
    const digest = await digestPluginOAuthProviderDefinition(definition);
    const row = Object.assign({}, await syntheticOAuthDefinitionRow(definition), rowChanges);
    const transport = new SequencedQueryTransport([[], [row], registrationRows]);
    const adapter = new Phase1D1PublicationAdapter(transport);
    const result = await adapter.stage({
      ...baseRelease,
      authentication: syntheticOAuthAuthentication(digest),
    });
    return { result, transport };
  };

  const provider101 = decodeDefinition({
    ...syntheticOAuthDefinitionJson,
    provider: "p".repeat(101),
  });
  const rejected101 = await attempt(provider101);
  expect(rejected101.result).toEqual(Result.fail("application-provider-verification-failed"));
  expect(rejected101.transport.queries).toHaveLength(2);

  const provider100 = decodeDefinition({
    ...syntheticOAuthDefinitionJson,
    provider: "p".repeat(100),
  });
  const acceptedDefinitionBeforeMissingRegistration = await attempt(provider100);
  expect(acceptedDefinitionBeforeMissingRegistration.result).toEqual(
    Result.fail("application-provider-verification-failed"),
  );
  expect(acceptedDefinitionBeforeMissingRegistration.transport.queries).toHaveLength(3);

  const astralProviderAtJsLength100 = decodeDefinition({
    ...syntheticOAuthDefinitionJson,
    provider: "😀".repeat(50),
  });
  const acceptedAstralBoundary = await attempt(astralProviderAtJsLength100);
  expect(acceptedAstralBoundary.result).toEqual(
    Result.fail("application-provider-verification-failed"),
  );
  expect(acceptedAstralBoundary.transport.queries).toHaveLength(3);

  const astralProviderOverJsLength100 = decodeDefinition({
    ...syntheticOAuthDefinitionJson,
    provider: "😀".repeat(51),
  });
  const rejectedAstralBoundary = await attempt(astralProviderOverJsLength100);
  expect(rejectedAstralBoundary.result).toEqual(
    Result.fail("application-provider-verification-failed"),
  );
  expect(rejectedAstralBoundary.transport.queries).toHaveLength(2);

  const { displayLabelPath: _displayLabelPath, ...accountWithoutLabel } =
    syntheticOAuthDefinitionJson.account;
  const missingLabel = decodeDefinition({
    ...syntheticOAuthDefinitionJson,
    account: accountWithoutLabel,
  });
  const rejectedMissingLabel = await attempt(missingLabel);
  expect(rejectedMissingLabel.result).toEqual(
    Result.fail("application-provider-verification-failed"),
  );
  expect(rejectedMissingLabel.transport.queries).toHaveLength(2);

  const definition = syntheticOAuthDefinition();
  const noncanonical = await attempt(definition, {
    canonical_definition_json: JSON.stringify(definition, null, 2),
  });
  expect(noncanonical.result).toEqual(Result.fail("application-provider-verification-failed"));
  expect(noncanonical.transport.queries).toHaveLength(2);

  const extractedMismatch = await attempt(definition, { provider: "synthetic-other" });
  expect(extractedMismatch.result).toEqual(Result.fail("application-provider-verification-failed"));
  expect(extractedMismatch.transport.queries).toHaveLength(2);
});

it("requires client material existence without projecting its opaque reference", async () => {
  const definition = syntheticOAuthDefinition();
  const digest = await digestPluginOAuthProviderDefinition(definition);
  const definitionRow = await syntheticOAuthDefinitionRow(definition);
  const registrationRow = {
    provider_registration_id: "synthetic-mail-rest-v1",
    provider: definition.provider,
    resource_identity: definition.resourceIdentity,
    registration_mode: "platform-pre-registered",
    approved_scopes_json: '["synthetic.mail.read"]',
    source: "platform",
    status: "active",
    oauth_provider_definition_digest: digest,
    oauth_provider_definition_revision: 1,
    oauth_authority_revision: 1,
    client_authority_present: 0,
  };
  const transport = new SequencedQueryTransport([[], [definitionRow], [registrationRow]]);
  const adapter = new Phase1D1PublicationAdapter(transport);
  expect(
    await adapter.stage({
      ...(await candidate()),
      authentication: syntheticOAuthAuthentication(digest),
    }),
  ).toEqual(Result.fail("application-provider-verification-failed"));
  expect(transport.queries).toHaveLength(3);
  expect(transport.queries.map((query) => query.sql).join("\n")).not.toContain(
    "client_credential_reference,",
  );
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

it("rejects a Config-retry version winner whose persisted authority differs from invocation R", async () => {
  const release = await candidate();
  const configWinner = {
    config_schema_id: "legacy:concurrent-winner",
    schema_digest: release.configDigest,
    revision: release.version.config.revision,
    fields_json: canonicalPluginJson(release.version.config.fields),
  };
  // This boundary row is deliberately corrupt and cannot be created through the accepted 0044 DDL.
  // It isolates the adapter's required comparison between a post-resolution winner and invocation R.
  const corruptedVersionWinner = {
    provider_registration_authority_revision: 9,
    provider_definition_digest: null,
    provider_definition_revision: null,
  };
  const transport = new SequencedQueryTransport([
    [],
    [],
    [],
    [configWinner],
    [],
    [corruptedVersionWinner],
  ]);
  const adapter = new Phase1D1PublicationAdapter(transport);
  expect(await adapter.stage(release)).toEqual(Result.fail("immutable-version-conflict"));
  expect(transport.batchCalls).toBe(1);
  expect(transport.queries).toHaveLength(6);
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
