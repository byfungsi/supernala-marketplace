import { Result, Schema } from "effect";
import { PackagedPluginAuthentication } from "./package-archive.js";
import { pluginConfigFieldsHaveNoExcessProperties } from "./plugin-config-validation.js";
import { canonicalPluginJson, PluginConfigField, PluginSha256 } from "./plugin-contract.js";
import type { D1BatchTransport, D1Statement } from "./cloudflare-adapters.js";
import type {
  ApplicationPublicationAdapter,
  IncrementalReleaseCandidate,
} from "./release-machine.js";

const failBatchGuard = (
  condition: string,
  params: ReadonlyArray<string | number | null>,
): D1Statement => ({
  sql: `INSERT INTO plugin_marketplaces
          (marketplace_id, name, visibility, trust_class, status, created_at, updated_at)
        SELECT NULL, NULL, NULL, NULL, NULL, NULL, NULL
        WHERE NOT EXISTS (${condition})`,
  params,
});

const ExistingConfigRow = Schema.Struct({
  config_schema_id: Schema.NonEmptyString,
  schema_digest: PluginSha256,
  revision: Schema.Int,
  fields_json: Schema.String,
});

interface ResolvedPluginConfigSchemaIdentity {
  readonly configSchemaId: string;
  readonly schemaDigest: typeof PluginSha256.Type;
  readonly revision: number;
  readonly fieldsJson: string;
}

const authenticationProviderRegistration = (
  authentication: typeof PackagedPluginAuthentication.Type,
): string | null =>
  authentication.kind === "github-app" ? authentication.providerRegistration : null;

const decodeCanonicalConfigFields = (fieldsJson: string): Result.Result<Schema.Json, string> => {
  try {
    const parsed = Schema.decodeUnknownSync(Schema.Json)(JSON.parse(fieldsJson));
    if (!pluginConfigFieldsHaveNoExcessProperties(parsed)) {
      return Result.fail("application-config-conflict");
    }
    const fields = Schema.decodeUnknownSync(Schema.Array(PluginConfigField), {
      onExcessProperty: "error",
    })(parsed);
    return canonicalPluginJson(parsed) === canonicalPluginJson(fields)
      ? Result.succeed(fields)
      : Result.fail("application-config-conflict");
  } catch {
    return Result.fail("application-config-conflict");
  }
};

/**
 * Trusted adapter for the app-owned Phase 1 D1 schema.
 *
 * It provisions no app resources. Array batches include an in-transaction failing SQL guard, rather
 * than attempting to infer rollback from a post-commit `meta.changes` check.
 */
export class Phase1D1PublicationAdapter implements ApplicationPublicationAdapter {
  constructor(private readonly database: D1BatchTransport) {}

  stage(candidate: IncrementalReleaseCandidate) {
    return this.#stage(candidate, false);
  }

  async #stage(
    candidate: IncrementalReleaseCandidate,
    retriedConfigWinner: boolean,
  ): Promise<Result.Result<void, string>> {
    if (
      candidate.kind !== "managed-package" ||
      candidate.version.runtime.kind !== "managed-package"
    ) {
      return Result.fail("remote-publication-adapter-not-implemented");
    }
    const configIdentity = await this.#resolveConfigIdentity(candidate);
    if (Result.isFailure(configIdentity)) return Result.fail(configIdentity.failure);
    const provider = await this.#verifyProviderRegistration(candidate.authentication);
    if (Result.isFailure(provider)) return Result.fail(provider.failure);
    const existing = await this.#loadVersion(candidate.version.id);
    if (Result.isFailure(existing)) return Result.fail(existing.failure);
    if (existing.success !== null) {
      return (await this.#rowMatchesCandidate(existing.success, candidate, "staged"))
        ? Result.succeed(undefined)
        : Result.fail("immutable-version-conflict");
    }
    const version = candidate.version;
    const runtime = candidate.version.runtime;
    if (runtime.kind !== "managed-package") return Result.fail("packaged-runtime-required");
    const configId = configIdentity.success.configSchemaId;
    const intentId = `${version.id}:publication`;
    const objectKey = `plugin-packages/sha256/${runtime.artifactDigest.slice(0, 2)}/${runtime.artifactDigest}.plugin`;
    const statements: Array<D1Statement> = [
      {
        sql: `INSERT INTO plugin_definitions
          (plugin_definition_id, marketplace_id, publisher_namespace, plugin_slug, name,
           short_description, long_description, categories_json, publisher_trust, status,
           created_at, updated_at)
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
          candidate.reviewedAt,
          candidate.reviewedAt,
        ],
      },
      {
        sql: `INSERT INTO plugin_artifacts
          (artifact_digest, object_key, byte_size, status, verified_at, created_at)
          VALUES (?, ?, ?, 'pending', NULL, ?) ON CONFLICT (artifact_digest) DO NOTHING`,
        params: [
          runtime.artifactDigest,
          objectKey,
          candidate.artifactByteLength ?? 0,
          candidate.reviewedAt,
        ],
      },
      {
        sql: `INSERT INTO plugin_catalog_snapshots
          (catalog_snapshot_id, catalog_digest, schema_version, created_at)
          VALUES (?, ?, 1, ?) ON CONFLICT (catalog_snapshot_id) DO NOTHING`,
        params: [version.catalog.id, version.catalog.digest, candidate.reviewedAt],
      },
      {
        sql: `INSERT INTO plugin_config_schemas
          (config_schema_id, schema_digest, revision, fields_json, created_at)
          VALUES (?, ?, ?, ?, ?) ON CONFLICT (schema_digest) DO NOTHING`,
        params: [
          configId,
          candidate.configDigest,
          version.config.revision,
          configIdentity.success.fieldsJson,
          candidate.reviewedAt,
        ],
      },
    ];
    for (const [ordinal, tool] of version.catalog.tools.entries()) {
      statements.push({
        sql: `INSERT INTO plugin_catalog_tools
          (catalog_snapshot_id, tool_id, ordinal, mcp_name, title, description,
           classification, default_policy, input_schema_json, maximum_output_bytes)
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
    const toolGuardSql = version.catalog.tools
      .map(
        () => `AND EXISTS (
          SELECT 1 FROM plugin_catalog_tools t
          WHERE t.catalog_snapshot_id = v.catalog_snapshot_id AND t.tool_id = ? AND t.ordinal = ?
            AND t.mcp_name = ? AND t.title = ? AND t.description = ?
            AND t.classification = ? AND t.default_policy = ?
            AND t.input_schema_json = ? AND t.maximum_output_bytes = ?
        )`,
      )
      .join("\n");
    const toolGuardParams = version.catalog.tools.flatMap((tool, ordinal) => [
      tool.id,
      ordinal,
      tool.mcpName,
      tool.title,
      tool.description,
      tool.classification,
      tool.defaultPolicy,
      JSON.stringify(tool.inputSchema),
      tool.maximumOutputBytes,
    ]);
    statements.push(
      {
        sql: `INSERT INTO plugin_versions
          (plugin_version_id, plugin_definition_id, semantic_version, manifest_digest,
           catalog_snapshot_id, config_schema_id, runtime_kind, artifact_digest,
            package_entrypoint, package_node_version, authentication_kind, provider_registration_id,
           requested_scopes_json, allowed_hosts_json, license, provenance_json,
           release_date, status, review_status, published_at, created_at)
          VALUES (?, ?, ?, ?, ?, ?, 'managed-package', ?, ?, '22.x', ?, ?, '[]', ?, ?, ?,
                  ?, 'publishing', 'approved', NULL, ?)
          ON CONFLICT (plugin_version_id) DO NOTHING`,
        params: [
          version.id,
          candidate.definitionId,
          version.version,
          runtime.manifestDigest,
          version.catalog.id,
          configId,
          runtime.artifactDigest,
          runtime.entrypoint,
          candidate.authentication.kind,
          authenticationProviderRegistration(candidate.authentication),
          JSON.stringify(version.allowedHosts),
          version.license,
          canonicalPluginJson(candidate.provenance),
          version.publishedAt,
          candidate.reviewedAt,
        ],
      },
      {
        sql: `INSERT INTO plugin_publication_intents
          (publication_intent_id, plugin_version_id, artifact_digest, status, attempts,
           available_at, last_failure_reason, created_at, updated_at)
          VALUES (?, ?, ?, 'pending', 0, ?, NULL, ?, ?)
          ON CONFLICT (publication_intent_id) DO NOTHING`,
        params: [
          intentId,
          version.id,
          runtime.artifactDigest,
          candidate.reviewedAt,
          candidate.reviewedAt,
          candidate.reviewedAt,
        ],
      },
      failBatchGuard(
        `SELECT 1 FROM plugin_versions v
         JOIN plugin_publication_intents i ON i.plugin_version_id = v.plugin_version_id
         JOIN plugin_artifacts a ON a.artifact_digest = v.artifact_digest
         WHERE v.plugin_version_id = ? AND v.plugin_definition_id = ?
            AND v.semantic_version = ? AND v.artifact_digest = ?
            AND v.manifest_digest = ? AND v.catalog_snapshot_id = ?
            AND v.config_schema_id = ? AND i.publication_intent_id = ?
            AND i.artifact_digest = v.artifact_digest
            AND v.runtime_kind = 'managed-package' AND v.package_entrypoint = ?
             AND v.package_node_version = '22.x' AND v.authentication_kind = ?
             AND v.provider_registration_id IS ?
            AND v.requested_scopes_json = '[]' AND v.allowed_hosts_json = ?
            AND v.license = ? AND v.provenance_json = ? AND v.release_date = ?
            AND v.review_status = 'approved' AND v.status IN ('publishing', 'published')
            AND a.object_key = ? AND a.byte_size = ? AND a.status IN ('pending', 'available')
            AND i.status IN ('pending', 'artifact-verified', 'published')
            AND EXISTS (SELECT 1 FROM plugin_definitions d
             WHERE d.plugin_definition_id = v.plugin_definition_id
               AND d.marketplace_id = ? AND d.publisher_namespace = ? AND d.plugin_slug = ?
               AND d.name = ? AND d.short_description = ? AND d.long_description = ?)
           AND EXISTS (SELECT 1 FROM plugin_catalog_snapshots c
             WHERE c.catalog_snapshot_id = v.catalog_snapshot_id
               AND c.catalog_digest = ? AND c.schema_version = 1)
           AND EXISTS (SELECT 1 FROM plugin_config_schemas s
              WHERE s.config_schema_id = v.config_schema_id
                AND s.schema_digest = ? AND s.revision = ? AND s.fields_json = ?)
           AND (? = 'none' OR EXISTS (SELECT 1 FROM provider_registrations p
             WHERE p.provider_registration_id = v.provider_registration_id
               AND p.provider = 'github-app' AND p.registration_mode = 'platform-pre-registered'
               AND p.source = 'platform' AND p.status = 'active'))
           AND (SELECT COUNT(*) FROM plugin_catalog_tools t
                WHERE t.catalog_snapshot_id = v.catalog_snapshot_id) = ?
           ${toolGuardSql}`,
        [
          version.id,
          candidate.definitionId,
          version.version,
          runtime.artifactDigest,
          runtime.manifestDigest,
          version.catalog.id,
          configId,
          intentId,
          runtime.entrypoint,
          candidate.authentication.kind,
          authenticationProviderRegistration(candidate.authentication),
          JSON.stringify(version.allowedHosts),
          version.license,
          canonicalPluginJson(candidate.provenance),
          version.publishedAt,
          objectKey,
          candidate.artifactByteLength ?? 0,
          version.marketplaceId,
          version.publisherNamespace,
          version.pluginSlug,
          version.name,
          version.description.slice(0, 500),
          version.description,
          version.catalog.digest,
          candidate.configDigest,
          version.config.revision,
          configIdentity.success.fieldsJson,
          candidate.authentication.kind,
          version.catalog.tools.length,
          ...toolGuardParams,
        ],
      ),
    );
    const result = await this.database.batch(statements);
    if (Result.isSuccess(result)) return Result.succeed(undefined);
    if (!retriedConfigWinner) {
      const winner = await this.#resolveConfigIdentity(candidate);
      if (
        Result.isSuccess(winner) &&
        winner.success.configSchemaId !== configIdentity.success.configSchemaId
      ) {
        return this.#stage(candidate, true);
      }
    }
    return Result.fail("application-stage-failed");
  }

  async finalize(candidate: IncrementalReleaseCandidate) {
    if (candidate.version.runtime.kind !== "managed-package") {
      return Result.fail("remote-publication-adapter-not-implemented");
    }
    const version = candidate.version;
    const runtime = candidate.version.runtime;
    if (runtime.kind !== "managed-package") return Result.fail("packaged-runtime-required");
    const configIdentity = await this.#resolveConfigIdentity(candidate);
    if (Result.isFailure(configIdentity)) return Result.fail(configIdentity.failure);
    const provider = await this.#verifyProviderRegistration(candidate.authentication);
    if (Result.isFailure(provider)) return Result.fail(provider.failure);
    const digest = runtime.artifactDigest;
    const intentId = `${version.id}:publication`;
    const configId = configIdentity.success.configSchemaId;
    const objectKey = `plugin-packages/sha256/${digest.slice(0, 2)}/${digest}.plugin`;
    const toolGuardSql = version.catalog.tools
      .map(
        () => `AND EXISTS (
          SELECT 1 FROM plugin_catalog_tools t
          WHERE t.catalog_snapshot_id = v.catalog_snapshot_id AND t.tool_id = ? AND t.ordinal = ?
            AND t.mcp_name = ? AND t.title = ? AND t.description = ?
            AND t.classification = ? AND t.default_policy = ?
            AND t.input_schema_json = ? AND t.maximum_output_bytes = ?
        )`,
      )
      .join("\n");
    const toolGuardParams = version.catalog.tools.flatMap((tool, ordinal) => [
      tool.id,
      ordinal,
      tool.mcpName,
      tool.title,
      tool.description,
      tool.classification,
      tool.defaultPolicy,
      JSON.stringify(tool.inputSchema),
      tool.maximumOutputBytes,
    ]);
    const statements: ReadonlyArray<D1Statement> = [
      {
        sql: `UPDATE plugin_artifacts SET status = 'available', verified_at = ?
              WHERE artifact_digest = ? AND status = 'pending'`,
        params: [candidate.reviewedAt, digest],
      },
      {
        sql: `UPDATE plugin_publication_intents
              SET status = 'artifact-verified', attempts = attempts + 1,
                  last_failure_reason = NULL, updated_at = ?
              WHERE publication_intent_id = ? AND status IN ('pending', 'failed')`,
        params: [candidate.reviewedAt, intentId],
      },
      {
        sql: `UPDATE plugin_versions SET status = 'published', published_at = ?
              WHERE plugin_version_id = ? AND status = 'publishing' AND review_status = 'approved'
                AND artifact_digest = ? AND config_schema_id = ?
                AND authentication_kind = ? AND provider_registration_id IS ?
                AND requested_scopes_json = '[]'
                AND EXISTS (SELECT 1 FROM plugin_config_schemas c
                  WHERE c.config_schema_id = plugin_versions.config_schema_id
                    AND c.schema_digest = ? AND c.revision = ? AND c.fields_json = ?)
                AND (? = 'none' OR EXISTS (SELECT 1 FROM provider_registrations p
                  WHERE p.provider_registration_id = plugin_versions.provider_registration_id
                    AND p.provider = 'github-app' AND p.registration_mode = 'platform-pre-registered'
                    AND p.source = 'platform' AND p.status = 'active'))
                AND EXISTS (SELECT 1 FROM plugin_artifacts a
                  WHERE a.artifact_digest = plugin_versions.artifact_digest AND a.status = 'available')
                AND EXISTS (SELECT 1 FROM plugin_publication_intents i
                  WHERE i.publication_intent_id = ? AND i.plugin_version_id = plugin_versions.plugin_version_id
                    AND i.artifact_digest = plugin_versions.artifact_digest
                    AND i.status = 'artifact-verified')`,
        params: [
          version.publishedAt,
          version.id,
          digest,
          configId,
          candidate.authentication.kind,
          authenticationProviderRegistration(candidate.authentication),
          candidate.configDigest,
          version.config.revision,
          configIdentity.success.fieldsJson,
          candidate.authentication.kind,
          intentId,
        ],
      },
      {
        sql: `UPDATE plugin_publication_intents SET status = 'published', updated_at = ?
              WHERE publication_intent_id = ? AND status = 'artifact-verified'
                AND plugin_version_id = ? AND artifact_digest = ?
                AND EXISTS (SELECT 1 FROM plugin_versions v
                  JOIN plugin_artifacts a ON a.artifact_digest = v.artifact_digest
                  WHERE v.plugin_version_id = plugin_publication_intents.plugin_version_id
                    AND v.status = 'published' AND v.review_status = 'approved'
                     AND v.artifact_digest = plugin_publication_intents.artifact_digest
                     AND v.config_schema_id = ? AND v.authentication_kind = ?
                     AND v.provider_registration_id IS ? AND v.requested_scopes_json = '[]'
                    AND a.status = 'available')`,
        params: [
          candidate.reviewedAt,
          intentId,
          version.id,
          digest,
          configId,
          candidate.authentication.kind,
          authenticationProviderRegistration(candidate.authentication),
        ],
      },
      failBatchGuard(
        `SELECT 1 FROM plugin_publication_intents i
         JOIN plugin_versions v ON v.plugin_version_id = i.plugin_version_id
         JOIN plugin_artifacts a ON a.artifact_digest = i.artifact_digest
          WHERE i.publication_intent_id = ? AND i.plugin_version_id = ?
            AND i.artifact_digest = ? AND i.status = 'published'
            AND v.status = 'published' AND v.review_status = 'approved'
            AND v.plugin_definition_id = ? AND v.semantic_version = ?
            AND v.manifest_digest = ? AND v.catalog_snapshot_id = ? AND v.config_schema_id = ?
            AND v.runtime_kind = 'managed-package' AND v.artifact_digest = i.artifact_digest
            AND v.package_entrypoint = ? AND v.package_node_version = '22.x'
             AND v.authentication_kind = ? AND v.provider_registration_id IS ?
             AND v.requested_scopes_json = '[]'
            AND v.allowed_hosts_json = ? AND v.license = ? AND v.provenance_json = ?
            AND v.release_date = ? AND a.status = 'available'
            AND a.object_key = ? AND a.byte_size = ?
            AND EXISTS (SELECT 1 FROM plugin_definitions d
              WHERE d.plugin_definition_id = v.plugin_definition_id
                AND d.marketplace_id = ? AND d.publisher_namespace = ? AND d.plugin_slug = ?
                AND d.name = ? AND d.short_description = ? AND d.long_description = ?)
            AND EXISTS (SELECT 1 FROM plugin_catalog_snapshots c
              WHERE c.catalog_snapshot_id = v.catalog_snapshot_id
                AND c.catalog_digest = ? AND c.schema_version = 1)
            AND EXISTS (SELECT 1 FROM plugin_config_schemas s
              WHERE s.config_schema_id = v.config_schema_id
                AND s.schema_digest = ? AND s.revision = ? AND s.fields_json = ?)
            AND (? = 'none' OR EXISTS (SELECT 1 FROM provider_registrations p
              WHERE p.provider_registration_id = v.provider_registration_id
                AND p.provider = 'github-app' AND p.registration_mode = 'platform-pre-registered'
                AND p.source = 'platform' AND p.status = 'active'))
            AND (SELECT COUNT(*) FROM plugin_catalog_tools t
                 WHERE t.catalog_snapshot_id = v.catalog_snapshot_id) = ?
            ${toolGuardSql}`,
        [
          intentId,
          version.id,
          digest,
          candidate.definitionId,
          version.version,
          runtime.manifestDigest,
          version.catalog.id,
          configId,
          runtime.entrypoint,
          candidate.authentication.kind,
          authenticationProviderRegistration(candidate.authentication),
          JSON.stringify(version.allowedHosts),
          version.license,
          canonicalPluginJson(candidate.provenance),
          version.publishedAt,
          objectKey,
          candidate.artifactBytes?.byteLength ?? 0,
          version.marketplaceId,
          version.publisherNamespace,
          version.pluginSlug,
          version.name,
          version.description.slice(0, 500),
          version.description,
          version.catalog.digest,
          candidate.configDigest,
          version.config.revision,
          configIdentity.success.fieldsJson,
          candidate.authentication.kind,
          version.catalog.tools.length,
          ...toolGuardParams,
        ],
      ),
    ];
    const result = await this.database.batch(statements);
    return Result.isFailure(result)
      ? Result.fail("application-finalize-failed")
      : Result.succeed(undefined);
  }

  async readPublished(candidate: IncrementalReleaseCandidate) {
    const row = await this.#loadVersion(candidate.version.id);
    if (Result.isFailure(row)) return Result.fail(row.failure);
    return Result.succeed(
      row.success !== null &&
        (await this.#rowMatchesCandidate(row.success, candidate, "published")),
    );
  }

  async readPublicationState(
    candidate: IncrementalReleaseCandidate,
  ): Promise<Result.Result<"published" | "revoked" | "mismatch", string>> {
    const row = await this.#loadVersion(candidate.version.id);
    if (Result.isFailure(row)) return Result.fail(row.failure);
    if (
      row.success === null ||
      !(await this.#rowMatchesCandidate(row.success, candidate, "immutable"))
    ) {
      return Result.succeed("mismatch");
    }
    if (
      row.success.status === "published" &&
      row.success.review_status === "approved" &&
      row.success.artifact_status === "available" &&
      row.success.intent_status === "published"
    ) {
      return Result.succeed("published");
    }
    return Result.succeed(row.success.status === "revoked" ? "revoked" : "mismatch");
  }

  async listAuthorityVersionStates(
    identity: IncrementalReleaseCandidate["identity"],
  ): Promise<
    Result.Result<
      ReadonlyArray<{ readonly versionId: string; readonly status: "published" | "revoked" }>,
      string
    >
  > {
    const rows = await this.database.query({
      sql: `SELECT v.plugin_version_id, v.status
            FROM plugin_versions v
            JOIN plugin_definitions d ON d.plugin_definition_id = v.plugin_definition_id
            WHERE d.marketplace_id = ? AND d.publisher_namespace = ? AND d.plugin_slug = ?
              AND v.status IN ('published', 'revoked')
            ORDER BY v.release_date, v.plugin_version_id`,
      params: [identity.marketplaceId, identity.publisherNamespace, identity.pluginSlug],
    });
    if (Result.isFailure(rows)) return Result.fail(rows.failure);
    const states: Array<{
      readonly versionId: string;
      readonly status: "published" | "revoked";
    }> = [];
    for (const row of rows.success) {
      if (
        typeof row.plugin_version_id !== "string" ||
        (row.status !== "published" && row.status !== "revoked")
      ) {
        return Result.fail("application-authority-version-row-invalid");
      }
      states.push({ versionId: row.plugin_version_id, status: row.status });
    }
    return Result.succeed(states);
  }

  async #resolveConfigIdentity(
    candidate: IncrementalReleaseCandidate,
  ): Promise<Result.Result<ResolvedPluginConfigSchemaIdentity, string>> {
    const deterministicId = `config:sha256:${candidate.configDigest}`;
    const [digestRows, deterministicRows] = await Promise.all([
      this.database.query({
        sql: `SELECT config_schema_id, schema_digest, revision, fields_json
              FROM plugin_config_schemas WHERE schema_digest = ?`,
        params: [candidate.configDigest],
      }),
      this.database.query({
        sql: `SELECT config_schema_id, schema_digest, revision, fields_json
              FROM plugin_config_schemas WHERE config_schema_id = ?`,
        params: [deterministicId],
      }),
    ]);
    if (Result.isFailure(digestRows) || Result.isFailure(deterministicRows)) {
      return Result.fail("application-config-resolution-failed");
    }
    const canonicalFields = canonicalPluginJson(candidate.version.config.fields);
    const decodeExactRow = (
      value: Schema.JsonObject | undefined,
    ): Result.Result<typeof ExistingConfigRow.Type | null, string> => {
      if (value === undefined) return Result.succeed(null);
      const decoded = Schema.decodeUnknownResult(ExistingConfigRow)(value);
      if (Result.isFailure(decoded)) return Result.fail("application-config-conflict");
      const fields = decodeCanonicalConfigFields(decoded.success.fields_json);
      if (
        Result.isFailure(fields) ||
        decoded.success.schema_digest !== candidate.configDigest ||
        decoded.success.revision !== candidate.version.config.revision ||
        canonicalPluginJson(fields.success) !== canonicalFields
      ) {
        return Result.fail("application-config-conflict");
      }
      return Result.succeed(decoded.success);
    };
    const digestRow = decodeExactRow(digestRows.success[0]);
    const deterministicRow = decodeExactRow(deterministicRows.success[0]);
    if (Result.isFailure(digestRow) || Result.isFailure(deterministicRow)) {
      return Result.fail("application-config-conflict");
    }
    if (
      digestRow.success !== null &&
      deterministicRow.success !== null &&
      digestRow.success.config_schema_id !== deterministicRow.success.config_schema_id
    ) {
      return Result.fail("application-config-conflict");
    }
    const existing = digestRow.success ?? deterministicRow.success;
    return Result.succeed({
      configSchemaId: existing?.config_schema_id ?? deterministicId,
      schemaDigest: candidate.configDigest,
      revision: candidate.version.config.revision,
      fieldsJson: existing?.fields_json ?? canonicalFields,
    });
  }

  async #verifyProviderRegistration(
    authentication: typeof PackagedPluginAuthentication.Type,
  ): Promise<Result.Result<void, string>> {
    if (authentication.kind === "none") return Result.succeed(undefined);
    const rows = await this.database.query({
      sql: `SELECT provider_registration_id, provider, registration_mode, source, status
            FROM provider_registrations WHERE provider_registration_id = ?`,
      params: [authentication.providerRegistration],
    });
    if (Result.isFailure(rows)) return Result.fail("application-provider-verification-failed");
    const row = rows.success[0];
    return row?.provider_registration_id === authentication.providerRegistration &&
      row.provider === "github-app" &&
      row.registration_mode === "platform-pre-registered" &&
      row.source === "platform" &&
      row.status === "active"
      ? Result.succeed(undefined)
      : Result.fail("application-provider-verification-failed");
  }

  async #loadVersion(
    id: string,
  ): Promise<Result.Result<Readonly<Record<string, unknown>> | null, string>> {
    const rows = await this.database.query({
      sql: `SELECT v.plugin_version_id, v.plugin_definition_id, v.semantic_version,
                   v.manifest_digest, v.catalog_snapshot_id, v.config_schema_id,
                    v.runtime_kind, v.artifact_digest, v.package_entrypoint,
                     v.authentication_kind, v.provider_registration_id, v.requested_scopes_json,
                    v.allowed_hosts_json, v.license, v.provenance_json, v.release_date,
                    v.status, v.review_status, c.catalog_digest, c.schema_version,
                    s.schema_digest, s.revision AS config_revision, s.fields_json,
                    d.marketplace_id AS definition_marketplace_id,
                    d.publisher_namespace AS definition_publisher_namespace,
                    d.plugin_slug AS definition_plugin_slug, d.name AS definition_name,
                    d.short_description, d.long_description,
                    a.status AS artifact_status, a.object_key, a.byte_size,
                    i.status AS intent_status
             FROM plugin_versions v
             JOIN plugin_definitions d ON d.plugin_definition_id = v.plugin_definition_id
             JOIN plugin_catalog_snapshots c ON c.catalog_snapshot_id = v.catalog_snapshot_id
             JOIN plugin_config_schemas s ON s.config_schema_id = v.config_schema_id
             JOIN plugin_artifacts a ON a.artifact_digest = v.artifact_digest
             JOIN plugin_publication_intents i ON i.plugin_version_id = v.plugin_version_id
            WHERE v.plugin_version_id = ?`,
      params: [id],
    });
    if (Result.isFailure(rows)) return Result.fail(rows.failure);
    return Result.succeed(rows.success[0] ?? null);
  }

  async #rowMatchesCandidate(
    row: Readonly<Record<string, unknown>>,
    candidate: IncrementalReleaseCandidate,
    mode: "staged" | "published" | "immutable",
  ): Promise<boolean> {
    if (candidate.version.runtime.kind !== "managed-package") return false;
    const version = candidate.version;
    const runtime = candidate.version.runtime;
    if (runtime.kind !== "managed-package") return false;
    const configIdentity = await this.#resolveConfigIdentity(candidate);
    if (Result.isFailure(configIdentity)) return false;
    const provider = await this.#verifyProviderRegistration(candidate.authentication);
    if (Result.isFailure(provider)) return false;
    const tools = await this.database.query({
      sql: `SELECT tool_id, ordinal, mcp_name, title, description, classification,
                   default_policy, input_schema_json, maximum_output_bytes
            FROM plugin_catalog_tools WHERE catalog_snapshot_id = ? ORDER BY ordinal`,
      params: [version.catalog.id],
    });
    if (Result.isFailure(tools)) return false;
    const normalizedTools = tools.success.map((tool) => {
      try {
        if (typeof tool.input_schema_json !== "string") return null;
        return {
          id: tool.tool_id,
          mcpName: tool.mcp_name,
          title: tool.title,
          description: tool.description,
          classification: tool.classification,
          defaultPolicy: tool.default_policy,
          inputSchema: JSON.parse(tool.input_schema_json),
          maximumOutputBytes: tool.maximum_output_bytes,
        };
      } catch {
        return null;
      }
    });
    const normalizedConfigFields = decodeCanonicalConfigFields(
      typeof row.fields_json === "string" ? row.fields_json : "",
    );
    if (Result.isFailure(normalizedConfigFields)) return false;
    return (
      row.plugin_version_id === version.id &&
      row.plugin_definition_id === candidate.definitionId &&
      row.definition_marketplace_id === version.marketplaceId &&
      row.definition_publisher_namespace === version.publisherNamespace &&
      row.definition_plugin_slug === version.pluginSlug &&
      row.definition_name === version.name &&
      row.short_description === version.description.slice(0, 500) &&
      row.long_description === version.description &&
      row.semantic_version === version.version &&
      row.manifest_digest === runtime.manifestDigest &&
      row.catalog_snapshot_id === version.catalog.id &&
      row.config_schema_id === configIdentity.success.configSchemaId &&
      row.runtime_kind === "managed-package" &&
      row.artifact_digest === runtime.artifactDigest &&
      row.package_entrypoint === runtime.entrypoint &&
      row.authentication_kind === candidate.authentication.kind &&
      row.provider_registration_id ===
        authenticationProviderRegistration(candidate.authentication) &&
      row.requested_scopes_json === "[]" &&
      row.allowed_hosts_json === JSON.stringify(version.allowedHosts) &&
      row.license === version.license &&
      row.release_date === version.publishedAt &&
      row.catalog_digest === candidate.catalogDigest &&
      row.schema_version === 1 &&
      canonicalPluginJson(normalizedTools as never) ===
        canonicalPluginJson(version.catalog.tools) &&
      row.schema_digest === candidate.configDigest &&
      row.config_revision === version.config.revision &&
      canonicalPluginJson(normalizedConfigFields.success) ===
        canonicalPluginJson(version.config.fields) &&
      row.provenance_json === canonicalPluginJson(candidate.provenance) &&
      row.object_key ===
        `plugin-packages/sha256/${runtime.artifactDigest.slice(0, 2)}/${runtime.artifactDigest}.plugin` &&
      row.byte_size === candidate.artifactByteLength &&
      (mode === "immutable" ||
        (mode === "published"
          ? row.status === "published" &&
            row.review_status === "approved" &&
            row.artifact_status === "available" &&
            row.intent_status === "published"
          : (row.status === "publishing" || row.status === "published") &&
            row.review_status === "approved" &&
            row.intent_status !== "failed"))
    );
  }
}
