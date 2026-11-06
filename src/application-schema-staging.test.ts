import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { Result, Schema } from "effect";
import { expect, it } from "vitest";
import type { D1BatchTransport, D1Statement } from "./cloudflare-adapters.js";
import {
  digestPluginOAuthProviderDefinition,
  encodePluginOAuthProviderDefinitionCanonicalJson,
} from "./oauth-provider-definition.js";
import { Phase1D1PublicationAdapter } from "./phase1-d1-publication-adapter.js";
import type { IncrementalReleaseCandidate } from "./release-machine.js";
import { digestReleaseSharedInputs } from "./release-bundle.js";
import {
  buildManagedRemoteReleaseBundle,
  draftManagedRemoteBootstrapReview,
} from "./remote-release-bundle.js";

const ReleaseIndex = Schema.Struct({
  sharedInputs: Schema.Array(Schema.String),
  plugins: Schema.Array(
    Schema.Struct({
      sourceDirectory: Schema.String,
      kind: Schema.String,
      publicationEligible: Schema.Boolean,
    }),
  ),
});

/** Executes D1 batches transactionally and keeps the failing statement's SQLite message. */
class ApplicationSchemaTransport implements D1BatchTransport {
  failure: string | null = null;
  constructor(readonly database: DatabaseSync) {}
  async batch(statements: ReadonlyArray<D1Statement>) {
    this.database.exec("BEGIN IMMEDIATE");
    try {
      const results = statements.map((statement, index) => {
        try {
          const result = this.database.prepare(statement.sql).run(...statement.params);
          return { changes: Number(result.changes) };
        } catch (cause) {
          this.failure = `statement ${index}: ${cause instanceof Error ? cause.message : "failed"}`;
          throw cause;
        }
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
      return Result.succeed(
        this.database
          .prepare(statement.sql)
          .all(...statement.params)
          .map((row) => Schema.decodeUnknownSync(Schema.JsonObject)(row)),
      );
    } catch (cause) {
      this.failure = cause instanceof Error ? cause.message : "query failed";
      return Result.fail("sqlite-query-failed");
    }
  }
}

/**
 * Pre-registered clients are provisioned by an operator before publication: an admitted provider
 * definition, a platform registration, and an attested deployment-environment material source.
 */
const provisionPreRegisteredClient = async (
  database: DatabaseSync,
  candidate: IncrementalReleaseCandidate,
): Promise<void> => {
  const definition = candidate.oauthProviderDefinition;
  if (
    candidate.authStrategy?.profile !== "mcp-oauth" ||
    candidate.authStrategy.clientRegistration.kind !== "pre-registered" ||
    definition === undefined
  ) {
    return;
  }
  const registrationId = candidate.authStrategy.providerRegistrationId;
  const digest = await digestPluginOAuthProviderDefinition(definition);
  database
    .prepare(
      `INSERT INTO plugin_oauth_provider_definitions
        (provider_definition_digest, schema_version, canonical_definition_json, scopes_json,
         provider, resource_identity, display_label_path_present, status, revision,
         admission_operation_id, admitted_by, source_kind, source_repository, source_revision,
         source_path, source_content_digest, reviewed_at, created_at, updated_at)
       VALUES (?, 1, ?, ?, ?, ?, 1, 'active', 1, ?, 'offline-operator', 'marketplace-release',
         'offline/repository', 'offline-release', ?, ?, 1, 1, 1)`,
    )
    .run(
      digest,
      new TextDecoder().decode(encodePluginOAuthProviderDefinitionCanonicalJson(definition)),
      JSON.stringify(definition.scopes),
      definition.provider,
      definition.resourceIdentity,
      `${definition.provider}:admission`,
      `providers/${definition.provider}.json`,
      digest,
    );
  database
    .prepare(
      `INSERT INTO provider_registrations
        (provider_registration_id, provider, resource_identity, registration_mode,
         callback_url, approved_scopes_json, client_credential_reference, source, status,
         revision, created_at, updated_at, oauth_provider_definition_digest,
         oauth_provider_definition_revision, oauth_authority_revision)
       VALUES (?, ?, ?, 'platform-pre-registered', 'https://app.example/oauth/callback', ?,
         NULL, 'platform', 'active', 1, 1, 1, ?, 1, 1)`,
    )
    .run(
      registrationId,
      definition.provider,
      definition.resourceIdentity,
      JSON.stringify(definition.scopes),
      digest,
    );
  database
    .prepare(
      `INSERT INTO plugin_oauth_registration_material_sources
        (provider_registration_id, source_revision, oauth_authority_revision,
         provider_definition_digest, provider_definition_revision, source_kind,
         material_version, declaration_id, token_endpoint_auth_method, deployment_revision,
         status, attestation_operation_id, attested_by, attested_at, created_at, updated_at)
       VALUES (?, 1, 1, ?, 1, 'deployment-environment', ?, ?, ?, 'offline-deployment',
         'active', ?, 'offline-operator', 1, 1, 1)`,
    )
    .run(
      registrationId,
      digest,
      `${registrationId}-material-v1`,
      `${registrationId}-client`,
      definition.tokenEndpointAuthMethod,
      `${registrationId}:material:1`,
    );
};

const index = Schema.decodeUnknownSync(ReleaseIndex)(
  JSON.parse(await readFile("releases/index.json", "utf8")),
);
const applicationSchema = await readFile("vendor/supernala-application-schema/schema.sql", "utf8");
const applicationSchemaManifest = Schema.decodeUnknownSync(
  Schema.Struct({
    owner: Schema.Literal("@supernala/api"),
    sourceCommit: Schema.String,
    latestMigration: Schema.String,
    schemaSha256: Schema.String,
  }),
)(JSON.parse(await readFile("vendor/supernala-application-schema/manifest.json", "utf8")));
const publishableRemotes = index.plugins
  .filter((plugin) => plugin.kind === "managed-remote-mcp" && plugin.publicationEligible)
  .map((plugin) => plugin.sourceDirectory);

it("uses the exact vendored application schema", () => {
  expect(createHash("sha256").update(applicationSchema).digest("hex")).toBe(
    applicationSchemaManifest.schemaSha256,
  );
});

it("covers at least one publishable managed remote", () => {
  expect(publishableRemotes.length).toBeGreaterThan(0);
});

// Production triggers own publication authority; offline release checks must not drift from them.
it.each(publishableRemotes)(
  "stages and finalizes %s against the vendored Supernala application schema",
  async (sourceFile) => {
    const outputDirectory = await mkdtemp(path.join(os.tmpdir(), "app-schema-staging-"));
    const database = new DatabaseSync(":memory:");
    try {
      database.exec("PRAGMA foreign_keys = ON");
      database.exec(applicationSchema);
      database.exec(`INSERT INTO plugin_marketplaces
        (marketplace_id, name, visibility, trust_class, status, created_at, updated_at)
        VALUES ('supernala-public', 'Supernala Marketplace', 'public', 'supernala-curated',
          'active', 0, 0)`);
      const sharedInputDigest = await digestReleaseSharedInputs(index.sharedInputs);
      const review = await draftManagedRemoteBootstrapReview({
        sourceFile,
        sharedInputDigest,
        reviewId: "offline-application-schema-staging",
        reviewer: "offline-check",
        reviewedAt: 1,
      });
      if (Result.isFailure(review)) throw new Error(review.failure);
      const candidate = await buildManagedRemoteReleaseBundle({
        sourceFile,
        outputDirectory,
        sharedInputDigest,
        mergeCommit: "a".repeat(40),
        releaseOrdinal: 1,
        review: review.success,
        previousPublished: null,
      });
      if (Result.isFailure(candidate)) throw new Error(candidate.failure);

      await provisionPreRegisteredClient(database, candidate.success);
      const transport = new ApplicationSchemaTransport(database);
      const adapter = new Phase1D1PublicationAdapter(transport);
      const staged = await adapter.stage(candidate.success);
      expect({ staged, failure: transport.failure }).toEqual({
        staged: Result.succeed(undefined),
        failure: null,
      });
      const finalized = await adapter.finalize(candidate.success);
      expect({ finalized: Result.isSuccess(finalized), failure: transport.failure }).toEqual({
        finalized: true,
        failure: null,
      });
    } finally {
      database.close();
      await rm(outputDirectory, { recursive: true, force: true });
    }
  },
);
