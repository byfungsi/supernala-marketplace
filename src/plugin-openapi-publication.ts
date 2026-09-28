import { Result, Schema } from "effect";
import type { D1BatchTransport, D1Statement } from "./cloudflare-adapters.js";
import { pluginOpenApiObjectKey } from "./cloudflare-adapters.js";
import { admitMarketplaceOpenApiCandidate } from "./plugin-openapi-admission.js";
import { canonicalPluginJson, digestPluginBytes } from "./plugin-contract.js";
import type { IncrementalReleaseCandidate } from "./release-machine.js";

type OpenApiReleaseCandidate = Extract<
  IncrementalReleaseCandidate,
  { readonly kind: "managed-openapi" }
>;
const encoder = new TextEncoder();
const guard = (sql: string, params: D1Statement["params"]): D1Statement => ({
  sql: `INSERT INTO plugin_marketplaces (marketplace_id, name, visibility, trust_class, status, created_at, updated_at)
    SELECT NULL, NULL, NULL, NULL, NULL, NULL, NULL WHERE NOT EXISTS (${sql})`,
  params,
});
const rowSchema = Schema.Struct({
  status: Schema.String,
  runtime_kind: Schema.String,
  artifact_digest: Schema.String,
  manifest_digest: Schema.String,
  catalog_snapshot_id: Schema.String,
  catalog_digest: Schema.String,
  config_schema_id: Schema.String,
  schema_digest: Schema.String,
  auth_definition_digest: Schema.String,
  canonical_definition_json: Schema.String,
  provider_registration_id: Schema.String,
  allowed_hosts_json: Schema.String,
  provenance_json: Schema.String,
  intent_status: Schema.String,
  artifact_status: Schema.String,
  object_key: Schema.String,
  byte_size: Schema.Int,
  verified_at: Schema.NullOr(Schema.Int),
  published_at: Schema.NullOr(Schema.Int),
  authentication_kind: Schema.String,
  auth_profile: Schema.String,
  requested_scopes_json: Schema.String,
  release_date: Schema.Int,
  license: Schema.String,
  definition_id: Schema.String,
  semantic_version: Schema.String,
  provider_status: Schema.String,
  definition_status: Schema.String,
  auth_definition_revision: Schema.Int,
  config_revision: Schema.Int,
  config_fields_json: Schema.String,
});
type OpenApiPublicationRow = typeof rowSchema.Type;

/** Every mutable D1 authority projection is rechecked inside the same atomic batch as publication. */
const exactCandidateGuard = (
  candidate: OpenApiReleaseCandidate,
  projection: {
    readonly configId: string;
    readonly authDigest: string;
    readonly intentId: string;
    readonly objectKey: string;
    readonly hostsJson: string;
    readonly provenanceJson: string;
  },
  status: "publishing" | "published",
  artifactStatus: "pending" | "available",
  intentStatus: "pending" | "artifact-verified" | "published",
): D1Statement => {
  const version = candidate.version;
  const tools = version.catalog.tools.map((tool, ordinal) => ({
    id: tool.id,
    ordinal,
    mcpName: tool.mcpName,
    title: tool.title,
    description: tool.description,
    classification: tool.classification,
    defaultPolicy: tool.defaultPolicy,
    inputSchemaJson: JSON.stringify(tool.inputSchema),
    maximumOutputBytes: tool.maximumOutputBytes,
  }));
  return guard(
    `SELECT 1 FROM plugin_versions v
    JOIN plugin_definitions definition ON definition.plugin_definition_id = v.plugin_definition_id
    JOIN plugin_marketplaces marketplace ON marketplace.marketplace_id = definition.marketplace_id
    JOIN provider_registrations provider ON provider.provider_registration_id = v.provider_registration_id
    JOIN plugin_auth_strategy_definitions auth ON auth.auth_definition_digest = v.auth_definition_digest
    JOIN plugin_artifacts artifact ON artifact.artifact_digest = v.artifact_digest
    JOIN plugin_publication_intents intent ON intent.plugin_version_id = v.plugin_version_id
    JOIN plugin_catalog_snapshots catalog ON catalog.catalog_snapshot_id = v.catalog_snapshot_id
    JOIN plugin_config_schemas config ON config.config_schema_id = v.config_schema_id
    WHERE v.plugin_version_id = ? AND v.status = ? AND v.runtime_kind = 'managed-openapi'
      AND v.plugin_definition_id = ? AND v.semantic_version = ? AND v.manifest_digest = ?
      AND v.artifact_digest = ? AND v.catalog_snapshot_id = ? AND catalog.catalog_digest = ?
      AND catalog.schema_version = 1 AND v.config_schema_id = ? AND config.schema_digest = ?
      AND config.revision = ? AND config.fields_json = '[]'
      AND v.provider_registration_id = ? AND provider.status = 'active'
      AND v.auth_definition_digest = ? AND v.auth_definition_revision = 1
      AND auth.revision = 1 AND auth.status = 'active' AND auth.profile = 'api-key'
      AND auth.canonical_definition_json = ?
      AND v.authentication_kind = 'none' AND v.auth_profile = 'api-key'
      AND v.requested_scopes_json = '[]' AND v.allowed_hosts_json = ?
      AND v.provenance_json = ? AND v.license = ? AND v.release_date = ?
      AND v.review_status = 'approved'
      AND definition.marketplace_id = ? AND definition.publisher_namespace = ?
      AND definition.plugin_slug = ? AND definition.name = ?
      AND definition.short_description = ? AND definition.long_description = ?
      AND definition.status = 'active' AND marketplace.status = 'active'
      AND artifact.object_key = ? AND artifact.byte_size = ? AND artifact.status = ?
      AND intent.publication_intent_id = ? AND intent.artifact_digest = ? AND intent.status = ?
      AND (SELECT count(*) FROM plugin_catalog_tools WHERE catalog_snapshot_id = ?) = ?
      AND NOT EXISTS (SELECT 1 FROM json_each(?) expected
        LEFT JOIN plugin_catalog_tools tool ON tool.catalog_snapshot_id = v.catalog_snapshot_id
          AND tool.tool_id = json_extract(expected.value, '$.id')
        WHERE tool.ordinal IS NOT json_extract(expected.value, '$.ordinal')
          OR tool.mcp_name IS NOT json_extract(expected.value, '$.mcpName')
          OR tool.title IS NOT json_extract(expected.value, '$.title')
          OR tool.description IS NOT json_extract(expected.value, '$.description')
          OR tool.classification IS NOT json_extract(expected.value, '$.classification')
          OR tool.default_policy IS NOT json_extract(expected.value, '$.defaultPolicy')
          OR tool.input_schema_json IS NOT json_extract(expected.value, '$.inputSchemaJson')
          OR tool.maximum_output_bytes IS NOT json_extract(expected.value, '$.maximumOutputBytes'))`,
    [
      version.id,
      status,
      candidate.definitionId,
      version.version,
      candidate.artifactDigest,
      candidate.artifactDigest,
      version.catalog.id,
      version.catalog.digest,
      projection.configId,
      candidate.configDigest,
      version.config.revision,
      version.runtime.kind === "managed-openapi" ? version.runtime.providerRegistrationId : "",
      projection.authDigest,
      canonicalPluginJson(candidate.authStrategy ?? null),
      projection.hostsJson,
      projection.provenanceJson,
      version.license,
      version.publishedAt,
      version.marketplaceId,
      version.publisherNamespace,
      version.pluginSlug,
      version.name,
      version.description.slice(0, 500),
      version.description,
      projection.objectKey,
      candidate.artifactByteLength,
      artifactStatus,
      projection.intentId,
      candidate.artifactDigest,
      intentStatus,
      version.catalog.id,
      tools.length,
      JSON.stringify(tools),
    ],
  );
};

/** D1 staging and guarded finalization for application-owned OpenAPI publication authority. */
export class PluginOpenApiPublication {
  constructor(private readonly database: D1BatchTransport) {}

  async #project(candidate: OpenApiReleaseCandidate) {
    if (
      candidate.version.runtime.kind !== "managed-openapi" ||
      candidate.authStrategy?.profile !== "api-key" ||
      candidate.authentication.kind !== "none"
    ) {
      return Result.fail("openapi-candidate-invalid");
    }
    const runtime = candidate.version.runtime;
    const version = candidate.version;
    const authJson = JSON.stringify(candidate.authStrategy);
    const configJson = JSON.stringify(version.config);
    const provenanceJson = JSON.stringify(candidate.provenance);
    const hostsJson = JSON.stringify(version.allowedHosts);
    const authDigest = await digestPluginBytes(
      encoder.encode(canonicalPluginJson(candidate.authStrategy)),
    );
    const existingConfig = await this.database.query({
      sql: `SELECT config_schema_id, schema_digest, revision, fields_json
        FROM plugin_config_schemas WHERE schema_digest = ?`,
      params: [candidate.configDigest],
    });
    if (Result.isFailure(existingConfig) || existingConfig.success.length > 1) {
      return Result.fail("openapi-config-read-failed");
    }
    const matchedConfig = existingConfig.success[0];
    const existingConfigId = matchedConfig?.config_schema_id;
    if (
      matchedConfig !== undefined &&
      (matchedConfig.schema_digest !== candidate.configDigest ||
        matchedConfig.revision !== version.config.revision ||
        matchedConfig.fields_json !== "[]" ||
        typeof existingConfigId !== "string")
    ) {
      return Result.fail("openapi-config-conflict");
    }
    const admitted =
      candidate.artifactBytes === null
        ? null
        : await admitMarketplaceOpenApiCandidate({
            bundleBytes: candidate.artifactBytes,
            artifactDigest: candidate.artifactDigest,
            manifestDigest: runtime.manifestDigest,
            objectKey: pluginOpenApiObjectKey(candidate.artifactDigest),
            pluginVersionId: version.id,
            catalogSnapshotId: version.catalog.id,
            catalogDigest: candidate.catalogDigest,
            catalogToolsJson: JSON.stringify(version.catalog.tools),
            authDefinitionJson: authJson,
            providerRegistrationId: runtime.providerRegistrationId,
            configSchemaJson: configJson,
            configSchemaDigest: candidate.configDigest,
            provenanceJson,
            allowedHostsJson: hostsJson,
          });
    if (
      (admitted !== null && Result.isFailure(admitted)) ||
      version.catalog.digest !== candidate.catalogDigest ||
      (candidate.artifactBytes !== null &&
        candidate.artifactByteLength !== candidate.artifactBytes.byteLength) ||
      runtime.artifactDigest !== candidate.artifactDigest ||
      candidate.provenanceDigest !==
        (await digestPluginBytes(encoder.encode(canonicalPluginJson(candidate.provenance))))
    ) {
      return Result.fail(
        admitted !== null && Result.isFailure(admitted)
          ? admitted.failure
          : "openapi-candidate-invalid",
      );
    }
    return Result.succeed({
      runtime,
      version,
      configJson,
      provenanceJson,
      hostsJson,
      authDigest,
      configId:
        typeof existingConfigId === "string"
          ? existingConfigId
          : `openapi-config:${candidate.configDigest}`,
      intentId: `${version.id}:publication`,
      objectKey: pluginOpenApiObjectKey(candidate.artifactDigest),
    });
  }

  async #readRow(versionId: string): Promise<Result.Result<OpenApiPublicationRow | null, string>> {
    const rows = await this.database.query({
      sql: `SELECT v.status, v.runtime_kind, v.artifact_digest,
      v.manifest_digest, v.catalog_snapshot_id, c.catalog_digest, v.config_schema_id,
      s.schema_digest, s.revision AS config_revision, s.fields_json AS config_fields_json,
      v.auth_definition_digest, v.auth_definition_revision, d.canonical_definition_json,
      d.status AS definition_status, p.status AS provider_status,
      v.provider_registration_id, v.allowed_hosts_json, v.provenance_json,
      i.status AS intent_status, a.status AS artifact_status, a.object_key, a.byte_size,
      a.verified_at, v.published_at, v.authentication_kind, v.auth_profile,
      v.requested_scopes_json, v.release_date, v.license,
      v.plugin_definition_id AS definition_id, v.semantic_version
      FROM plugin_versions v
      JOIN plugin_artifacts a ON a.artifact_digest = v.artifact_digest
      JOIN plugin_catalog_snapshots c ON c.catalog_snapshot_id = v.catalog_snapshot_id
      JOIN plugin_config_schemas s ON s.config_schema_id = v.config_schema_id
      JOIN plugin_auth_strategy_definitions d ON d.auth_definition_digest = v.auth_definition_digest
      JOIN provider_registrations p ON p.provider_registration_id = v.provider_registration_id
      JOIN plugin_publication_intents i ON i.plugin_version_id = v.plugin_version_id
      WHERE v.plugin_version_id = ?`,
      params: [versionId],
    });
    if (Result.isFailure(rows)) return Result.fail(rows.failure);
    if (rows.success.length === 0) return Result.succeed(null);
    if (rows.success.length !== 1) return Result.fail("openapi-readback-duplicate");
    const decoded = Schema.decodeUnknownResult(rowSchema)(rows.success[0]);
    return Result.isFailure(decoded)
      ? Result.fail("openapi-readback-invalid")
      : Result.succeed(decoded.success);
  }

  async #matches(
    candidate: OpenApiReleaseCandidate,
    expectedStatus: "publishing" | "published" | "revoked",
  ): Promise<Result.Result<boolean, string>> {
    const projection = await this.#project(candidate);
    if (Result.isFailure(projection)) return Result.fail(projection.failure);
    const row = await this.#readRow(candidate.version.id);
    if (Result.isFailure(row)) return Result.fail(row.failure);
    if (row.success === null) return Result.succeed(false);
    const { runtime, version, authDigest, configId, objectKey, hostsJson, provenanceJson } =
      projection.success;
    const entry = row.success;
    const toolRows = await this.database.query({
      sql: `SELECT tool_id, ordinal, mcp_name, title,
      description, classification, default_policy, input_schema_json, maximum_output_bytes
      FROM plugin_catalog_tools WHERE catalog_snapshot_id = ? ORDER BY ordinal`,
      params: [version.catalog.id],
    });
    if (Result.isFailure(toolRows)) return Result.fail(toolRows.failure);
    const toolsMatch =
      toolRows.success.length === version.catalog.tools.length &&
      toolRows.success.every((toolRow, index) => {
        const tool = version.catalog.tools[index];
        return (
          tool !== undefined &&
          toolRow.tool_id === tool.id &&
          toolRow.ordinal === index &&
          toolRow.mcp_name === tool.mcpName &&
          toolRow.title === tool.title &&
          toolRow.description === tool.description &&
          toolRow.classification === tool.classification &&
          toolRow.default_policy === tool.defaultPolicy &&
          toolRow.input_schema_json === JSON.stringify(tool.inputSchema) &&
          toolRow.maximum_output_bytes === tool.maximumOutputBytes
        );
      });
    return Result.succeed(
      toolsMatch &&
        entry.status === expectedStatus &&
        entry.runtime_kind === "managed-openapi" &&
        entry.artifact_digest === runtime.artifactDigest &&
        entry.manifest_digest === runtime.manifestDigest &&
        entry.catalog_snapshot_id === version.catalog.id &&
        entry.catalog_digest === version.catalog.digest &&
        entry.config_schema_id === configId &&
        entry.schema_digest === candidate.configDigest &&
        entry.config_revision === version.config.revision &&
        entry.config_fields_json === "[]" &&
        entry.auth_definition_digest === authDigest &&
        entry.provider_registration_id === runtime.providerRegistrationId &&
        entry.canonical_definition_json === canonicalPluginJson(candidate.authStrategy ?? null) &&
        entry.auth_definition_revision === 1 &&
        entry.definition_status === "active" &&
        entry.provider_status === "active" &&
        entry.allowed_hosts_json === hostsJson &&
        entry.provenance_json === provenanceJson &&
        entry.object_key === objectKey &&
        entry.byte_size === candidate.artifactByteLength &&
        entry.authentication_kind === "none" &&
        entry.auth_profile === "api-key" &&
        entry.requested_scopes_json === "[]" &&
        entry.release_date === version.publishedAt &&
        entry.license === version.license &&
        entry.definition_id === candidate.definitionId &&
        entry.semantic_version === version.version &&
        entry.intent_status === (expectedStatus === "publishing" ? "pending" : "published") &&
        entry.artifact_status === (expectedStatus === "publishing" ? "pending" : "available") &&
        (expectedStatus !== "publishing"
          ? entry.verified_at !== null && entry.published_at === version.publishedAt
          : entry.published_at === null),
    );
  }

  /** Atomically stages auth, catalog, artifact metadata, immutable version, and publication intent. */
  async stage(candidate: OpenApiReleaseCandidate): Promise<Result.Result<void, string>> {
    if (candidate.artifactBytes === null) return Result.fail("openapi-artifact-missing");
    const projection = await this.#project(candidate);
    if (Result.isFailure(projection)) return Result.fail(projection.failure);
    const existing = await this.#readRow(candidate.version.id);
    if (Result.isFailure(existing)) return Result.fail(existing.failure);
    if (existing.success !== null) {
      const staged = await this.#matches(candidate, "publishing");
      const published = await this.#matches(candidate, "published");
      return (Result.isSuccess(staged) && staged.success) ||
        (Result.isSuccess(published) && published.success)
        ? Result.succeed(undefined)
        : Result.fail("openapi-immutable-version-conflict");
    }
    const {
      version,
      runtime,
      authDigest,
      configId,
      objectKey,
      intentId,
      hostsJson,
      provenanceJson,
    } = projection.success;
    const now = candidate.reviewedAt;
    const statements: Array<D1Statement> = [
      {
        sql: `INSERT INTO plugin_auth_strategy_definitions
          (auth_definition_digest, schema_version, canonical_definition_json, profile, status,
           revision, source_kind, source_digest, reviewed_at, created_at, updated_at)
          VALUES (?, 1, ?, 'api-key', 'active', 1, 'marketplace-release', ?, ?, ?, ?)
          ON CONFLICT (auth_definition_digest) DO NOTHING`,
        params: [
          authDigest,
          canonicalPluginJson(candidate.authStrategy ?? null),
          candidate.releaseDigest,
          now,
          now,
          now,
        ],
      },
      {
        sql: `INSERT INTO plugin_definitions
          (plugin_definition_id, marketplace_id, publisher_namespace, plugin_slug, name,
           short_description, long_description, categories_json, publisher_trust, status, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, '[]', 'supernala-curated', 'active', ?, ?)
          ON CONFLICT (plugin_definition_id) DO NOTHING`,
        params: [
          candidate.definitionId,
          version.marketplaceId,
          version.publisherNamespace,
          version.pluginSlug,
          version.name,
          version.description.slice(0, 500),
          version.description,
          now,
          now,
        ],
      },
      {
        sql: `INSERT INTO plugin_artifacts (artifact_digest, object_key, byte_size, status, verified_at, created_at)
          VALUES (?, ?, ?, 'pending', NULL, ?) ON CONFLICT (artifact_digest) DO NOTHING`,
        params: [runtime.artifactDigest, objectKey, candidate.artifactByteLength, now],
      },
      {
        sql: `INSERT INTO plugin_catalog_snapshots (catalog_snapshot_id, catalog_digest, schema_version, created_at)
          VALUES (?, ?, 1, ?) ON CONFLICT (catalog_snapshot_id) DO NOTHING`,
        params: [version.catalog.id, version.catalog.digest, now],
      },
      {
        sql: `INSERT INTO plugin_config_schemas (config_schema_id, schema_digest, revision, fields_json, created_at)
          VALUES (?, ?, ?, '[]', ?) ON CONFLICT (schema_digest) DO NOTHING`,
        params: [configId, candidate.configDigest, version.config.revision, now],
      },
    ];
    for (const [ordinal, tool] of version.catalog.tools.entries()) {
      statements.push({
        sql: `INSERT INTO plugin_catalog_tools
        (catalog_snapshot_id, tool_id, ordinal, mcp_name, title, description, classification,
         default_policy, input_schema_json, maximum_output_bytes)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT (catalog_snapshot_id, tool_id) DO NOTHING`,
        params: [
          version.catalog.id,
          tool.id,
          ordinal,
          tool.mcpName,
          tool.title,
          tool.description,
          tool.classification,
          tool.defaultPolicy,
          JSON.stringify(tool.inputSchema),
          tool.maximumOutputBytes,
        ],
      });
    }
    statements.push(
      {
        sql: `INSERT INTO plugin_versions
        (plugin_version_id, plugin_definition_id, semantic_version, manifest_digest,
         catalog_snapshot_id, config_schema_id, runtime_kind, artifact_digest,
         provider_registration_id, authentication_kind, requested_scopes_json,
         allowed_hosts_json, license, provenance_json, release_date, status, review_status,
         published_at, created_at, auth_profile, auth_definition_digest, auth_definition_revision)
        VALUES (?, ?, ?, ?, ?, ?, 'managed-openapi', ?, ?, 'none', '[]', ?, ?, ?, ?,
          'publishing', 'approved', NULL, ?, 'api-key', ?, 1)
        ON CONFLICT (plugin_version_id) DO NOTHING`,
        params: [
          version.id,
          candidate.definitionId,
          version.version,
          runtime.manifestDigest,
          version.catalog.id,
          configId,
          runtime.artifactDigest,
          runtime.providerRegistrationId,
          hostsJson,
          version.license,
          provenanceJson,
          version.publishedAt,
          now,
          authDigest,
        ],
      },
      {
        sql: `INSERT INTO plugin_publication_intents
        (publication_intent_id, plugin_version_id, artifact_digest, status, attempts,
         available_at, last_failure_reason, created_at, updated_at)
        VALUES (?, ?, ?, 'pending', 0, ?, NULL, ?, ?)
        ON CONFLICT (publication_intent_id) DO NOTHING`,
        params: [intentId, version.id, runtime.artifactDigest, now, now, now],
      },
      exactCandidateGuard(candidate, projection.success, "publishing", "pending", "pending"),
    );
    const result = await this.database.batch(statements);
    if (Result.isFailure(result)) return Result.fail("openapi-stage-failed");
    const verified = await this.#matches(candidate, "publishing");
    return Result.isSuccess(verified) && verified.success
      ? Result.succeed(undefined)
      : Result.fail("openapi-stage-readback-mismatch");
  }

  /** Finalizes only after the immutable R2 artifact has been uploaded and byte-verified. */
  async finalize(candidate: OpenApiReleaseCandidate): Promise<Result.Result<void, string>> {
    const published = await this.#matches(candidate, "published");
    if (Result.isSuccess(published) && published.success) return Result.succeed(undefined);
    const staged = await this.#matches(candidate, "publishing");
    if (Result.isFailure(staged) || !staged.success) return Result.fail("openapi-stage-mismatch");
    const projection = await this.#project(candidate);
    if (Result.isFailure(projection)) return Result.fail(projection.failure);
    const result = await this.database.batch([
      exactCandidateGuard(candidate, projection.success, "publishing", "pending", "pending"),
      {
        sql: `UPDATE plugin_artifacts SET status = 'available', verified_at = ?
        WHERE artifact_digest = ? AND object_key = ? AND byte_size = ? AND status = 'pending'`,
        params: [
          candidate.reviewedAt,
          candidate.artifactDigest,
          pluginOpenApiObjectKey(candidate.artifactDigest),
          candidate.artifactByteLength,
        ],
      },
      {
        sql: `UPDATE plugin_publication_intents SET status = 'artifact-verified',
        attempts = attempts + 1, updated_at = ?
        WHERE plugin_version_id = ? AND artifact_digest = ? AND status = 'pending'`,
        params: [candidate.reviewedAt, candidate.version.id, candidate.artifactDigest],
      },
      guard(
        `SELECT 1 FROM plugin_artifacts a JOIN plugin_publication_intents i
        ON i.artifact_digest = a.artifact_digest WHERE i.plugin_version_id = ?
        AND a.status = 'available' AND a.verified_at IS NOT NULL AND i.status = 'artifact-verified'`,
        [candidate.version.id],
      ),
      {
        sql: `UPDATE plugin_versions SET status = 'published', published_at = ?
        WHERE plugin_version_id = ? AND runtime_kind = 'managed-openapi' AND status = 'publishing'
        AND artifact_digest = ? AND manifest_digest = ? AND review_status = 'approved'`,
        params: [
          candidate.version.publishedAt,
          candidate.version.id,
          candidate.artifactDigest,
          candidate.artifactDigest,
        ],
      },
      guard(
        `SELECT 1 FROM plugin_versions WHERE plugin_version_id = ? AND status = 'published'
        AND published_at = ? AND artifact_digest = ?`,
        [candidate.version.id, candidate.version.publishedAt, candidate.artifactDigest],
      ),
      {
        sql: `UPDATE plugin_publication_intents SET status = 'published', updated_at = ?
        WHERE plugin_version_id = ? AND status = 'artifact-verified'`,
        params: [candidate.reviewedAt, candidate.version.id],
      },
    ]);
    if (Result.isFailure(result)) return Result.fail("openapi-finalize-failed");
    const verified = await this.#matches(candidate, "published");
    return Result.isSuccess(verified) && verified.success
      ? Result.succeed(undefined)
      : Result.fail("openapi-finalize-readback-mismatch");
  }

  /** Reads durable D1 publication state for retry and baseline selection. */
  async readPublicationState(
    candidate: OpenApiReleaseCandidate,
  ): Promise<Result.Result<"published" | "revoked" | "mismatch", string>> {
    const verified = await this.#matches(candidate, "published");
    if (Result.isFailure(verified)) return Result.fail(verified.failure);
    if (verified.success) return Result.succeed("published");
    const revoked = await this.#matches(candidate, "revoked");
    return Result.isSuccess(revoked) && revoked.success
      ? Result.succeed("revoked")
      : Result.succeed("mismatch");
  }

  /** Confirms the exact published OpenAPI projection for release journal readback. */
  async readPublished(candidate: OpenApiReleaseCandidate): Promise<Result.Result<boolean, string>> {
    return this.#matches(candidate, "published");
  }
}
