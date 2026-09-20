import { Result, Schema } from "effect";
import {
  PackagedPluginAuthentication,
  packagedAuthenticationProviderDefinitionDigest,
  packagedAuthenticationProviderRegistration,
  packagedAuthenticationRequestedScopes,
} from "./package-archive.js";
import { pluginConfigFieldsHaveNoExcessProperties } from "./plugin-config-validation.js";
import {
  canonicalPluginJson,
  digestPluginBytes,
  PluginConfigField,
  PluginSha256,
} from "./plugin-contract.js";
import {
  decodePluginOAuthProviderDefinition,
  digestPluginOAuthProviderDefinition,
  encodePluginOAuthProviderDefinitionCanonicalJson,
} from "./oauth-provider-definition.js";
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

interface ResolvedPublicationAuthentication {
  readonly providerRegistrationAuthorityRevision: number | null;
  readonly providerDefinitionDigest: typeof PluginSha256.Type | null;
  readonly providerDefinitionRevision: number | null;
  readonly materialSource: ResolvedOAuthMaterialSource | null;
}

interface ResolvedOAuthMaterialSource {
  readonly sourceRevision: number;
  readonly materialVersion: string;
  readonly declarationId: string;
  readonly deploymentRevision: string;
  readonly tokenEndpointAuthMethod: "client_secret_post" | "client_secret_basic" | "none";
}

const noGenericOAuthAuthority: ResolvedPublicationAuthentication = {
  providerRegistrationAuthorityRevision: null,
  providerDefinitionDigest: null,
  providerDefinitionRevision: null,
  materialSource: null,
};

const ManagedRemoteProvenance = Schema.Struct({
  kind: Schema.Literal("managed-remote-mcp"),
  endpoint: Schema.String,
  oauthRegistrationMode: Schema.Literals([
    "dynamic",
    "cimd",
    "platform-pre-registered",
    "workspace-oauth-app",
  ]),
  protocolPolicy: Schema.Struct({
    catalogCompatibility: Schema.Literals(["exact", "reviewed-subset"]),
    maximumCatalogPages: Schema.Int.pipe(
      Schema.check(Schema.isBetween({ minimum: 1, maximum: 20 })),
    ),
  }),
  evidenceUrls: Schema.Array(Schema.String),
  verificationNotes: Schema.String,
  authProfile: Schema.optionalKey(
    Schema.Literals(["workspace-oauth", "mcp-oauth", "api-key", "device-oauth"]),
  ),
  authStrategyDigest: Schema.optionalKey(PluginSha256),
});

const durableOAuthRegistrationMode = (
  mode: "dynamic" | "cimd" | "platform-pre-registered" | "workspace-oauth-app",
): "dynamic" | "platform-pre-registered" | "workspace-oauth-app" =>
  mode === "cimd" ? "dynamic" : mode;

const packagedOAuthRegistrationMode = (
  candidate: IncrementalReleaseCandidate,
): "workspace-oauth-app" | undefined =>
  candidate.authStrategy?.profile === "workspace-oauth" ? "workspace-oauth-app" : undefined;

const OAuthDefinitionPublicationRow = Schema.Struct({
  provider_definition_digest: PluginSha256,
  schema_version: Schema.Literal(1),
  canonical_definition_json: Schema.String,
  scopes_json: Schema.String,
  provider: Schema.String,
  resource_identity: Schema.String,
  display_label_path_present: Schema.Literal(1),
  status: Schema.Literal("active"),
  revision: Schema.Int.pipe(Schema.check(Schema.isGreaterThanOrEqualTo(1))),
});

const PositiveRevision = Schema.Int.pipe(Schema.check(Schema.isGreaterThanOrEqualTo(1)));

const PackagedOAuthRegistrationModeRow = Schema.Struct({
  registration_mode: Schema.Literals(["platform-pre-registered", "workspace-oauth-app"]),
});

const OAuthRegistrationSemanticRowFields = {
  provider_registration_id: Schema.NonEmptyString,
  provider: Schema.String,
  resource_identity: Schema.String,
  registration_mode: Schema.Literal("platform-pre-registered"),
  approved_scopes_json: Schema.String,
  source: Schema.Literal("platform"),
  status: Schema.Literal("active"),
  oauth_provider_definition_digest: PluginSha256,
  oauth_provider_definition_revision: PositiveRevision,
  oauth_authority_revision: PositiveRevision,
} as const;

const OAuthEnvironmentRegistrationPublicationRow = Schema.Struct({
  ...OAuthRegistrationSemanticRowFields,
  source_revision: PositiveRevision,
  source_kind: Schema.Literal("deployment-environment"),
  material_version: Schema.String.pipe(
    Schema.check(Schema.isPattern(/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u)),
  ),
  declaration_id: Schema.String.pipe(
    Schema.check(Schema.isPattern(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/u)),
  ),
  token_endpoint_auth_method: Schema.Literals([
    "client_secret_post",
    "client_secret_basic",
    "none",
  ]),
  deployment_revision: Schema.String.pipe(
    Schema.check(Schema.isMinLength(1)),
    Schema.check(Schema.isMaxLength(200)),
  ),
});

const OAuthWorkspaceRegistrationPublicationRow = Schema.Struct({
  provider_registration_id: Schema.NonEmptyString,
  provider: Schema.String,
  resource_identity: Schema.String,
  registration_mode: Schema.Literal("workspace-oauth-app"),
  approved_scopes_json: Schema.String,
  source: Schema.Literal("platform"),
  status: Schema.Literal("active"),
  oauth_provider_definition_digest: PluginSha256,
  oauth_provider_definition_revision: PositiveRevision,
  oauth_authority_revision: PositiveRevision,
  client_authority_present: Schema.Literal(0),
});

const OAuthPublishedEnvironmentRegistrationRow = Schema.Struct({
  ...OAuthRegistrationSemanticRowFields,
  source_revision: PositiveRevision,
  source_kind: Schema.Literal("deployment-environment"),
  material_version: OAuthEnvironmentRegistrationPublicationRow.fields.material_version,
  declaration_id: OAuthEnvironmentRegistrationPublicationRow.fields.declaration_id,
  token_endpoint_auth_method:
    OAuthEnvironmentRegistrationPublicationRow.fields.token_endpoint_auth_method,
  deployment_revision: OAuthEnvironmentRegistrationPublicationRow.fields.deployment_revision,
  historical_source_status: Schema.Literals(["active", "retired"]),
  current_source_available: Schema.Literal(1),
});

const OAuthLegacyRegistrationPublicationRow = Schema.Struct({
  ...OAuthRegistrationSemanticRowFields,
  client_authority_present: Schema.Literal(1),
});

const OAuthDynamicRegistrationStateRow = Schema.Struct({
  provider_registration_id: Schema.NonEmptyString,
  provider: Schema.String,
  resource_identity: Schema.String,
  registration_mode: Schema.Literal("dynamic"),
  approved_scopes_json: Schema.String,
  source: Schema.Literal("platform"),
  status: Schema.Literal("active"),
  authorization_metadata_url: Schema.NonEmptyString,
  client_authority_present: Schema.Literals([0, 1]),
  oauth_provider_definition_digest: Schema.NullOr(PluginSha256),
  oauth_provider_definition_revision: Schema.NullOr(PositiveRevision),
  oauth_authority_revision: Schema.NullOr(PositiveRevision),
  source_revision: Schema.NullOr(PositiveRevision),
  material_origin: Schema.NullOr(
    Schema.Literals(["dynamic-registration", "client-id-metadata-document"]),
  ),
  material_source_status: Schema.NullOr(Schema.Literal("active")),
});

const authenticationRequestedScopesJson = (
  authentication: typeof PackagedPluginAuthentication.Type,
): string => JSON.stringify(packagedAuthenticationRequestedScopes(authentication));

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
    return this.#stage(candidate, false, null);
  }

  async #stage(
    candidate: IncrementalReleaseCandidate,
    retriedConfigWinner: boolean,
    resolvedAuthentication: ResolvedPublicationAuthentication | null,
  ): Promise<Result.Result<void, string>> {
    if (
      candidate.kind === "managed-remote-mcp" &&
      candidate.version.runtime.kind === "managed-remote-mcp"
    ) {
      return this.#stageManagedRemote(candidate);
    }
    if (
      candidate.kind !== "managed-package" ||
      candidate.version.runtime.kind !== "managed-package"
    ) {
      return Result.fail("remote-publication-adapter-not-implemented");
    }
    const existing = await this.#loadVersion(candidate.version.id);
    if (Result.isFailure(existing)) return Result.fail(existing.failure);
    if (existing.success !== null) {
      if (
        resolvedAuthentication !== null &&
        !this.#rowMatchesResolvedPublicationAuthentication(existing.success, resolvedAuthentication)
      ) {
        return Result.fail("immutable-version-conflict");
      }
      return (await this.#rowMatchesCandidate(existing.success, candidate, "staged"))
        ? Result.succeed(undefined)
        : Result.fail("immutable-version-conflict");
    }
    const authentication =
      resolvedAuthentication === null
        ? await this.#resolvePublicationAuthentication(
            candidate.authentication,
            packagedOAuthRegistrationMode(candidate),
          )
        : Result.succeed(resolvedAuthentication);
    if (Result.isFailure(authentication)) return Result.fail(authentication.failure);
    const configIdentity = await this.#resolveConfigIdentity(candidate);
    if (Result.isFailure(configIdentity)) return Result.fail(configIdentity.failure);
    const version = candidate.version;
    const runtime = candidate.version.runtime;
    if (runtime.kind !== "managed-package") return Result.fail("packaged-runtime-required");
    if (
      candidate.authStrategy !== undefined &&
      (candidate.authStrategy.profile !== "workspace-oauth" ||
        candidate.authentication.kind !== "oauth" ||
        candidate.authentication.providerRegistration !==
          candidate.authStrategy.providerRegistrationId ||
        candidate.authentication.providerDefinitionDigest !==
          candidate.authStrategy.providerDefinitionDigest ||
        canonicalPluginJson(candidate.authentication.requestedScopes) !==
          canonicalPluginJson(candidate.authStrategy.requestedScopes))
    ) {
      return Result.fail("packaged-auth-strategy-mismatch");
    }
    const authDefinitionJson =
      candidate.authStrategy === undefined ? null : canonicalPluginJson(candidate.authStrategy);
    const authDefinitionDigest =
      authDefinitionJson === null
        ? null
        : await digestPluginBytes(new TextEncoder().encode(authDefinitionJson));
    const configId = configIdentity.success.configSchemaId;
    const intentId = `${version.id}:publication`;
    const objectKey = `plugin-packages/sha256/${runtime.artifactDigest.slice(0, 2)}/${runtime.artifactDigest}.plugin`;
    const statements: Array<D1Statement> = [
      ...(candidate.authStrategy === undefined ||
      authDefinitionJson === null ||
      authDefinitionDigest === null
        ? []
        : [
            {
              sql: `INSERT INTO plugin_auth_strategy_definitions
                (auth_definition_digest, schema_version, canonical_definition_json, profile,
                 status, revision, source_kind, source_digest, reviewed_at, created_at, updated_at)
                VALUES (?, 1, ?, ?, 'active', 1, 'marketplace-release', ?, ?, ?, ?)
                ON CONFLICT (auth_definition_digest) DO NOTHING`,
              params: [
                authDefinitionDigest,
                authDefinitionJson,
                candidate.authStrategy.profile,
                candidate.releaseDigest,
                candidate.reviewedAt,
                candidate.reviewedAt,
                candidate.reviewedAt,
              ],
            },
          ]),
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
    statements.push(
      {
        sql: `INSERT INTO plugin_versions
          (plugin_version_id, plugin_definition_id, semantic_version, manifest_digest,
           catalog_snapshot_id, config_schema_id, runtime_kind, artifact_digest,
            package_entrypoint, package_node_version, authentication_kind, provider_registration_id,
            requested_scopes_json, provider_registration_authority_revision,
            provider_definition_digest, provider_definition_revision,
             allowed_hosts_json, license, provenance_json,
             release_date, status, review_status, published_at, created_at,
             auth_profile, auth_definition_digest, auth_definition_revision)
          VALUES (?, ?, ?, ?, ?, ?, 'managed-package', ?, ?, '22.x', ?, ?, ?, ?, ?, ?, ?, ?, ?,
                   ?, 'publishing', 'approved', NULL, ?, ?, ?, ?)
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
          packagedAuthenticationProviderRegistration(candidate.authentication),
          authenticationRequestedScopesJson(candidate.authentication),
          authentication.success.providerRegistrationAuthorityRevision,
          authentication.success.providerDefinitionDigest,
          authentication.success.providerDefinitionRevision,
          JSON.stringify(version.allowedHosts),
          version.license,
          canonicalPluginJson(candidate.provenance),
          version.publishedAt,
          candidate.reviewedAt,
          candidate.authStrategy?.profile ?? null,
          authDefinitionDigest,
          candidate.authStrategy === undefined ? null : 1,
        ],
      },
      {
        sql: `INSERT INTO plugin_publication_intents
          (publication_intent_id, plugin_version_id, artifact_digest, status, attempts,
            available_at, last_failure_reason, created_at, updated_at,
            provider_registration_material_source_revision)
           VALUES (?, ?, ?, 'pending', 0, ?, NULL, ?, ?, ?)
           ON CONFLICT (publication_intent_id) DO NOTHING`,
        params: [
          intentId,
          version.id,
          runtime.artifactDigest,
          candidate.reviewedAt,
          candidate.reviewedAt,
          candidate.reviewedAt,
          authentication.success.materialSource?.sourceRevision ?? null,
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
           AND v.package_node_version = '22.x' AND v.allowed_hosts_json = ?
            AND v.license = ? AND v.provenance_json = ? AND v.release_date = ?
            AND v.auth_profile IS ? AND v.auth_definition_digest IS ?
            AND v.auth_definition_revision IS ?
           AND v.review_status = 'approved' AND v.status IN ('publishing', 'published')
           AND a.object_key = ? AND a.byte_size = ? AND a.status IN ('pending', 'available')
           AND i.status IN ('pending', 'artifact-verified', 'published')`,
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
          JSON.stringify(version.allowedHosts),
          version.license,
          canonicalPluginJson(candidate.provenance),
          version.publishedAt,
          candidate.authStrategy?.profile ?? null,
          authDefinitionDigest,
          candidate.authStrategy === undefined ? null : 1,
          objectKey,
          candidate.artifactByteLength ?? 0,
        ],
      ),
      failBatchGuard(
        `SELECT 1 FROM plugin_versions v
         WHERE v.plugin_version_id = ?
           AND EXISTS (SELECT 1 FROM plugin_definitions d
             WHERE d.plugin_definition_id = v.plugin_definition_id
               AND d.marketplace_id = ? AND d.publisher_namespace = ? AND d.plugin_slug = ?
               AND d.name = ? AND d.short_description = ? AND d.long_description = ?
               AND d.status = 'active'
               AND EXISTS (SELECT 1 FROM plugin_marketplaces m
                 WHERE m.marketplace_id = d.marketplace_id AND m.status = 'active'))`,
        [
          version.id,
          version.marketplaceId,
          version.publisherNamespace,
          version.pluginSlug,
          version.name,
          version.description.slice(0, 500),
          version.description,
        ],
      ),
      failBatchGuard(
        `SELECT 1 FROM plugin_versions v
         WHERE v.plugin_version_id = ?
           AND EXISTS (SELECT 1 FROM plugin_catalog_snapshots c
             WHERE c.catalog_snapshot_id = v.catalog_snapshot_id
               AND c.catalog_digest = ? AND c.schema_version = 1)
           AND EXISTS (SELECT 1 FROM plugin_config_schemas s
             WHERE s.config_schema_id = v.config_schema_id
               AND s.schema_digest = ? AND s.revision = ? AND s.fields_json = ?)`,
        [
          version.id,
          version.catalog.digest,
          candidate.configDigest,
          version.config.revision,
          configIdentity.success.fieldsJson,
        ],
      ),
      failBatchGuard(
        `SELECT 1 FROM plugin_versions v
         JOIN plugin_publication_intents i ON i.plugin_version_id = v.plugin_version_id
         WHERE v.plugin_version_id = ? AND v.authentication_kind = ?
           AND v.provider_registration_id IS ? AND v.requested_scopes_json = ?
           AND v.provider_registration_authority_revision IS ?
           AND v.provider_definition_digest IS ? AND v.provider_definition_revision IS ?
           AND i.provider_registration_material_source_revision IS ?
           AND (? = 'none'
             OR (? = 'github-app' AND EXISTS (SELECT 1 FROM provider_registrations p
               WHERE p.provider_registration_id = v.provider_registration_id
                 AND p.registration_mode = 'platform-pre-registered'
                  AND p.approved_scopes_json = ? AND p.source = 'platform'
                  AND p.status = 'active' AND length(p.client_credential_reference) > 0
                  AND p.oauth_provider_definition_digest IS NULL))
              OR (? = 'oauth' AND EXISTS (
                SELECT 1 FROM provider_registrations p
                JOIN plugin_oauth_provider_definitions od
                  ON od.provider_definition_digest = p.oauth_provider_definition_digest
                 AND od.revision = p.oauth_provider_definition_revision
                WHERE p.provider_registration_id = v.provider_registration_id
                  AND p.registration_mode = 'workspace-oauth-app'
                  AND p.approved_scopes_json = ? AND p.source = 'platform'
                  AND p.status = 'active' AND p.client_credential_reference IS NULL
                  AND p.oauth_authority_revision = v.provider_registration_authority_revision
                  AND p.oauth_provider_definition_digest = v.provider_definition_digest
                  AND p.oauth_provider_definition_revision = v.provider_definition_revision
                  AND od.status = 'active' AND od.provider = p.provider
                  AND od.resource_identity = p.resource_identity
                  AND od.scopes_json = v.requested_scopes_json
                  AND od.display_label_path_present = 1))
              OR (? = 'oauth' AND EXISTS (
               SELECT 1 FROM provider_registrations p
               JOIN plugin_oauth_registration_material_sources ms
                 ON ms.provider_registration_id = p.provider_registration_id
                AND ms.oauth_authority_revision = p.oauth_authority_revision
                AND ms.provider_definition_digest = p.oauth_provider_definition_digest
                AND ms.provider_definition_revision = p.oauth_provider_definition_revision
               JOIN plugin_oauth_provider_definitions od
                 ON od.provider_definition_digest = p.oauth_provider_definition_digest
                AND od.revision = p.oauth_provider_definition_revision
               WHERE p.provider_registration_id = v.provider_registration_id
                 AND p.registration_mode = 'platform-pre-registered'
                 AND p.approved_scopes_json = ? AND p.source = 'platform'
                 AND p.status = 'active' AND p.client_credential_reference IS NULL
                 AND p.oauth_authority_revision = v.provider_registration_authority_revision
                 AND p.oauth_provider_definition_digest = v.provider_definition_digest
                 AND p.oauth_provider_definition_revision = v.provider_definition_revision
                 AND ms.source_revision = i.provider_registration_material_source_revision
                 AND ms.source_revision IS ? AND ms.source_kind = 'deployment-environment'
                 AND ms.status = 'active' AND ms.material_version IS ?
                 AND ms.declaration_id IS ? AND ms.deployment_revision IS ?
                 AND ms.token_endpoint_auth_method IS ?
                 AND od.status = 'active' AND od.provider = p.provider
                 AND od.resource_identity = p.resource_identity
                 AND od.scopes_json = v.requested_scopes_json
                 AND od.display_label_path_present = 1
                 AND json_extract(od.canonical_definition_json, '$.tokenEndpointAuthMethod')
                       = ms.token_endpoint_auth_method)))`,
        [
          version.id,
          candidate.authentication.kind,
          packagedAuthenticationProviderRegistration(candidate.authentication),
          authenticationRequestedScopesJson(candidate.authentication),
          authentication.success.providerRegistrationAuthorityRevision,
          authentication.success.providerDefinitionDigest,
          authentication.success.providerDefinitionRevision,
          authentication.success.materialSource?.sourceRevision ?? null,
          candidate.authentication.kind,
          candidate.authentication.kind,
          authenticationRequestedScopesJson(candidate.authentication),
          candidate.authentication.kind,
          authenticationRequestedScopesJson(candidate.authentication),
          candidate.authentication.kind,
          authenticationRequestedScopesJson(candidate.authentication),
          authentication.success.materialSource?.sourceRevision ?? null,
          authentication.success.materialSource?.materialVersion ?? null,
          authentication.success.materialSource?.declarationId ?? null,
          authentication.success.materialSource?.deploymentRevision ?? null,
          authentication.success.materialSource?.tokenEndpointAuthMethod ?? null,
        ],
      ),
      failBatchGuard(
        `SELECT 1 FROM plugin_versions v
         WHERE v.plugin_version_id = ?
           AND (SELECT COUNT(*) FROM plugin_catalog_tools t
                WHERE t.catalog_snapshot_id = v.catalog_snapshot_id) = ?`,
        [version.id, version.catalog.tools.length],
      ),
    );
    for (const [ordinal, tool] of version.catalog.tools.entries()) {
      statements.push(
        failBatchGuard(
          `SELECT 1 FROM plugin_catalog_tools t
           WHERE t.catalog_snapshot_id = ? AND t.tool_id = ? AND t.ordinal = ?
             AND t.mcp_name = ? AND t.title = ? AND t.description = ?
             AND t.classification = ? AND t.default_policy = ?
             AND t.input_schema_json = ? AND t.maximum_output_bytes = ?`,
          [
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
        ),
      );
    }
    const result = await this.database.batch(statements);
    if (Result.isSuccess(result)) return Result.succeed(undefined);
    if (!retriedConfigWinner) {
      const winner = await this.#resolveConfigIdentity(candidate);
      if (
        Result.isSuccess(winner) &&
        winner.success.configSchemaId !== configIdentity.success.configSchemaId
      ) {
        return this.#stage(candidate, true, authentication.success);
      }
    }
    return Result.fail("application-stage-failed");
  }

  async #stageManagedRemote(
    candidate: IncrementalReleaseCandidate,
  ): Promise<Result.Result<void, string>> {
    const version = candidate.version;
    const runtime = version.runtime;
    if (
      runtime.kind !== "managed-remote-mcp" ||
      (candidate.authentication.kind !== "oauth" &&
        !(
          candidate.authentication.kind === "none" && candidate.authStrategy?.profile === "api-key"
        ))
    ) {
      return Result.fail("remote-release-contract-invalid");
    }
    const authDefinitionJson =
      candidate.authStrategy === undefined ? null : canonicalPluginJson(candidate.authStrategy);
    const authDefinitionDigest =
      authDefinitionJson === null
        ? null
        : await digestPluginBytes(new TextEncoder().encode(authDefinitionJson));
    const provenance = Schema.decodeUnknownResult(ManagedRemoteProvenance, {
      onExcessProperty: "error",
    })(candidate.provenance);
    if (Result.isFailure(provenance)) return Result.fail("remote-release-contract-invalid");
    let endpoint: URL;
    try {
      endpoint = new URL(provenance.success.endpoint);
    } catch {
      return Result.fail("remote-release-contract-invalid");
    }
    if (
      endpoint.protocol !== "https:" ||
      endpoint.origin !== `https://${version.allowedHosts[0] ?? ""}` ||
      version.allowedHosts.length !== 1
    ) {
      return Result.fail("remote-release-contract-invalid");
    }
    let providerDefinitionAdmission:
      | {
          readonly digest: typeof PluginSha256.Type;
          readonly canonicalJson: string;
          readonly provider: string;
          readonly resourceIdentity: string;
          readonly scopesJson: string;
          readonly metadataUrl: string;
        }
      | undefined;
    let authentication: Result.Result<ResolvedPublicationAuthentication, string>;
    if (candidate.oauthProviderDefinition === undefined) {
      authentication = await this.#resolvePublicationAuthentication(
        candidate.authentication,
        durableOAuthRegistrationMode(provenance.success.oauthRegistrationMode),
      );
    } else {
      if (
        candidate.authentication.kind !== "oauth" ||
        provenance.success.oauthRegistrationMode === "platform-pre-registered" ||
        candidate.authStrategy?.profile !== "mcp-oauth" ||
        (candidate.authStrategy.clientRegistration.kind !== "dynamic" &&
          candidate.authStrategy.clientRegistration.kind !== "cimd") ||
        (candidate.authStrategy.clientRegistration.kind === "cimd" &&
          candidate.authStrategy.resourceMetadataUrl === undefined) ||
        (candidate.oauthProviderDefinition.account.kind !== "declaration-managed" &&
          (!("displayLabelPath" in candidate.oauthProviderDefinition.account) ||
            candidate.oauthProviderDefinition.account.displayLabelPath === undefined))
      ) {
        return Result.fail("remote-provider-definition-admission-invalid");
      }
      const digest = await digestPluginOAuthProviderDefinition(candidate.oauthProviderDefinition);
      const scopesJson = canonicalPluginJson(candidate.oauthProviderDefinition.scopes);
      const metadataUrl =
        candidate.authStrategy.clientRegistration.kind === "dynamic"
          ? candidate.authStrategy.clientRegistration.authorizationServerMetadataUrl
          : candidate.authStrategy.resourceMetadataUrl;
      if (metadataUrl === undefined) {
        return Result.fail("remote-provider-definition-admission-invalid");
      }
      if (
        digest !== candidate.authentication.providerDefinitionDigest ||
        digest !== candidate.authStrategy.providerDefinitionDigest ||
        scopesJson !== authenticationRequestedScopesJson(candidate.authentication)
      ) {
        return Result.fail("remote-provider-definition-admission-invalid");
      }
      providerDefinitionAdmission = {
        digest,
        canonicalJson: new TextDecoder().decode(
          encodePluginOAuthProviderDefinitionCanonicalJson(candidate.oauthProviderDefinition),
        ),
        provider: candidate.oauthProviderDefinition.provider,
        resourceIdentity: candidate.oauthProviderDefinition.resourceIdentity,
        scopesJson,
        metadataUrl,
      };
      authentication = Result.succeed({
        providerRegistrationAuthorityRevision: null,
        providerDefinitionDigest: digest,
        providerDefinitionRevision: 1,
        materialSource: null,
      });
    }
    if (Result.isFailure(authentication)) return Result.fail(authentication.failure);
    const configIdentity = await this.#resolveConfigIdentity(candidate);
    if (Result.isFailure(configIdentity)) return Result.fail(configIdentity.failure);
    const existing = await this.#loadVersion(version.id);
    if (Result.isFailure(existing)) return Result.fail(existing.failure);
    if (existing.success !== null) {
      return (await this.#rowMatchesCandidate(existing.success, candidate, "staged"))
        ? Result.succeed(undefined)
        : Result.fail("immutable-version-conflict");
    }
    const statements: Array<D1Statement> = [
      ...(providerDefinitionAdmission === undefined
        ? []
        : [
            {
              sql: `INSERT INTO plugin_oauth_provider_definitions
                (provider_definition_digest, schema_version, canonical_definition_json,
                 scopes_json, provider, resource_identity, display_label_path_present, status,
                 revision, admission_operation_id, admitted_by, source_kind, source_repository,
                 source_revision, source_path, source_content_digest, reviewed_at, created_at,
                 updated_at)
                VALUES (?, 1, ?, ?, ?, ?, 1, 'active', 1, ?, ?, 'marketplace-release',
                        ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT (provider_definition_digest) DO NOTHING`,
              params: [
                providerDefinitionAdmission.digest,
                providerDefinitionAdmission.canonicalJson,
                providerDefinitionAdmission.scopesJson,
                providerDefinitionAdmission.provider,
                providerDefinitionAdmission.resourceIdentity,
                `publish:${candidate.releaseDigest}`,
                candidate.reviewer,
                `${candidate.identity.publisherNamespace}/${candidate.identity.pluginSlug}`,
                candidate.mergeCommit,
                `${candidate.identity.pluginSlug}/oauth-provider.json`,
                providerDefinitionAdmission.digest,
                candidate.reviewedAt,
                candidate.reviewedAt,
                candidate.reviewedAt,
              ],
            },
            {
              sql: `INSERT INTO provider_registrations
                (provider_registration_id, provider, resource_identity, registration_mode,
                 authorization_metadata_url, callback_url, approved_scopes_json,
                 client_credential_reference, source, status, revision, created_at, updated_at)
                VALUES (?, ?, ?, 'dynamic', ?,
                        'https://supernala.com/v1/plugins/oauth/callback', ?, NULL, 'platform',
                        'active', 1, ?, ?)
                ON CONFLICT (provider_registration_id) DO NOTHING`,
              params: [
                candidate.authentication.kind === "oauth"
                  ? candidate.authentication.providerRegistration
                  : "",
                providerDefinitionAdmission.provider,
                providerDefinitionAdmission.resourceIdentity,
                providerDefinitionAdmission.metadataUrl,
                providerDefinitionAdmission.scopesJson,
                candidate.reviewedAt,
                candidate.reviewedAt,
              ],
            },
          ]),
      ...(candidate.authStrategy === undefined ||
      authDefinitionDigest === null ||
      authDefinitionJson === null
        ? []
        : [
            {
              sql: `INSERT INTO plugin_auth_strategy_definitions
          (auth_definition_digest, schema_version, canonical_definition_json, profile,
           status, revision, source_kind, source_digest, reviewed_at, created_at, updated_at)
          VALUES (?, 1, ?, ?, 'active', 1, 'marketplace-release', ?, ?, ?, ?)
          ON CONFLICT (auth_definition_digest) DO NOTHING`,
              params: [
                authDefinitionDigest,
                authDefinitionJson,
                candidate.authStrategy.profile,
                candidate.releaseDigest,
                candidate.reviewedAt,
                candidate.reviewedAt,
                candidate.reviewedAt,
              ],
            },
          ]),
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
        sql:
          candidate.authStrategy?.profile === "api-key"
            ? `INSERT INTO provider_registrations
                 (provider_registration_id, provider, resource_identity, registration_mode,
                  authorization_metadata_url, authorization_endpoint, token_endpoint,
                  registration_endpoint, userinfo_endpoint, revocation_endpoint, metadata_digest,
                  callback_url, approved_scopes_json, client_credential_reference,
                  dynamic_registration_claim, dynamic_registration_claimed_at, source, status,
                  revision, created_at, updated_at, oauth_provider_definition_digest,
                  oauth_provider_definition_revision, oauth_authority_revision)
               VALUES (?, ?, ?, 'dynamic', ?, NULL, NULL, NULL, NULL, NULL, NULL, ?, '[]',
                       NULL, NULL, NULL, 'platform', 'active', 1, ?, ?, NULL, NULL, NULL)
               ON CONFLICT (provider_registration_id) DO NOTHING`
            : `SELECT 1`,
        params:
          candidate.authStrategy?.profile === "api-key"
            ? [
                runtime.providerRegistrationId,
                `${version.publisherNamespace}/${version.pluginSlug}`,
                endpoint.origin,
                provenance.success.endpoint,
                provenance.success.endpoint,
                candidate.reviewedAt,
                candidate.reviewedAt,
              ]
            : [],
      },
      {
        sql: `INSERT INTO remote_mcp_endpoint_registrations
          (endpoint_registration_id, endpoint_url, expected_origin, transport,
           provider_registration_id, resource_audience, protocol_policy_json, status,
           revision, created_at, updated_at)
          VALUES (?, ?, ?, 'streamable-http', ?, ?, ?, 'active', 1, ?, ?)
          ON CONFLICT (endpoint_registration_id) DO NOTHING`,
        params: [
          runtime.endpointRegistrationId,
          provenance.success.endpoint,
          endpoint.origin,
          runtime.providerRegistrationId,
          provenance.success.endpoint,
          canonicalPluginJson(provenance.success.protocolPolicy),
          candidate.reviewedAt,
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
          configIdentity.success.configSchemaId,
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
    statements.push(
      candidate.authStrategy === undefined || authDefinitionDigest === null
        ? {
            sql: `INSERT INTO plugin_versions
          (plugin_version_id, plugin_definition_id, semantic_version, manifest_digest,
           catalog_snapshot_id, config_schema_id, runtime_kind, endpoint_registration_id,
           provider_registration_id, authentication_kind, requested_scopes_json,
           provider_registration_authority_revision, provider_definition_digest,
           provider_definition_revision, allowed_hosts_json, license, provenance_json,
           release_date, status, review_status, published_at, created_at)
          VALUES (?, ?, ?, ?, ?, ?, 'managed-remote-mcp', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
                  'publishing', 'approved', NULL, ?)
          ON CONFLICT (plugin_version_id) DO NOTHING`,
            params: [
              version.id,
              candidate.definitionId,
              version.version,
              candidate.sourceInputDigest,
              version.catalog.id,
              configIdentity.success.configSchemaId,
              runtime.endpointRegistrationId,
              runtime.providerRegistrationId,
              candidate.authentication.kind,
              authenticationRequestedScopesJson(candidate.authentication),
              authentication.success.providerRegistrationAuthorityRevision,
              authentication.success.providerDefinitionDigest,
              authentication.success.providerDefinitionRevision,
              JSON.stringify(version.allowedHosts),
              version.license,
              canonicalPluginJson(candidate.provenance),
              version.publishedAt,
              candidate.reviewedAt,
            ],
          }
        : {
            sql: `INSERT INTO plugin_versions
          (plugin_version_id, plugin_definition_id, semantic_version, manifest_digest,
           catalog_snapshot_id, config_schema_id, runtime_kind, endpoint_registration_id,
           provider_registration_id, authentication_kind, requested_scopes_json,
           provider_registration_authority_revision, provider_definition_digest,
           provider_definition_revision, allowed_hosts_json, license, provenance_json,
            release_date, status, review_status, published_at, created_at,
            auth_profile, auth_definition_digest, auth_definition_revision)
          VALUES (?, ?, ?, ?, ?, ?, 'managed-remote-mcp', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
                  'publishing', 'approved', NULL, ?, ?, ?, 1)
          ON CONFLICT (plugin_version_id) DO NOTHING`,
            params: [
              version.id,
              candidate.definitionId,
              version.version,
              candidate.sourceInputDigest,
              version.catalog.id,
              configIdentity.success.configSchemaId,
              runtime.endpointRegistrationId,
              runtime.providerRegistrationId,
              candidate.authentication.kind,
              authenticationRequestedScopesJson(candidate.authentication),
              authentication.success.providerRegistrationAuthorityRevision,
              authentication.success.providerDefinitionDigest,
              authentication.success.providerDefinitionRevision,
              JSON.stringify(version.allowedHosts),
              version.license,
              canonicalPluginJson(candidate.provenance),
              version.publishedAt,
              candidate.reviewedAt,
              candidate.authStrategy.profile,
              authDefinitionDigest,
            ],
          },
      {
        sql: `INSERT INTO plugin_publication_intents
          (publication_intent_id, plugin_version_id, artifact_digest, status, attempts,
           available_at, last_failure_reason, created_at, updated_at,
           provider_registration_material_source_revision)
          VALUES (?, ?, NULL, 'pending', 0, ?, NULL, ?, ?, ?)
          ON CONFLICT (publication_intent_id) DO NOTHING`,
        params: [
          `${version.id}:publication`,
          version.id,
          candidate.reviewedAt,
          candidate.reviewedAt,
          candidate.reviewedAt,
          authentication.success.materialSource?.sourceRevision ?? null,
        ],
      },
      candidate.authStrategy === undefined ||
        authDefinitionDigest === null ||
        authDefinitionJson === null
        ? failBatchGuard(
            `SELECT 1 FROM plugin_versions v
             JOIN remote_mcp_endpoint_registrations e
               ON e.endpoint_registration_id = v.endpoint_registration_id
             JOIN plugin_publication_intents i ON i.plugin_version_id = v.plugin_version_id
             WHERE v.plugin_version_id = ? AND v.runtime_kind = 'managed-remote-mcp'
               AND v.plugin_definition_id = ? AND v.manifest_digest = ?
               AND v.catalog_snapshot_id = ? AND v.config_schema_id = ?
               AND v.provider_registration_id = ? AND v.authentication_kind = ?
               AND v.requested_scopes_json = ? AND v.provider_definition_digest IS ?
               AND v.status IN ('publishing', 'published') AND v.review_status = 'approved'
               AND e.endpoint_url = ? AND e.expected_origin = ? AND e.protocol_policy_json = ?
               AND e.provider_registration_id = v.provider_registration_id AND e.status = 'active'
               AND i.artifact_digest IS NULL AND i.status IN ('pending', 'published')`,
            [
              version.id,
              candidate.definitionId,
              candidate.sourceInputDigest,
              version.catalog.id,
              configIdentity.success.configSchemaId,
              runtime.providerRegistrationId,
              candidate.authentication.kind,
              authenticationRequestedScopesJson(candidate.authentication),
              authentication.success.providerDefinitionDigest,
              provenance.success.endpoint,
              endpoint.origin,
              canonicalPluginJson(provenance.success.protocolPolicy),
            ],
          )
        : failBatchGuard(
            `SELECT 1 FROM plugin_versions v
         JOIN remote_mcp_endpoint_registrations e
           ON e.endpoint_registration_id = v.endpoint_registration_id
         JOIN plugin_publication_intents i ON i.plugin_version_id = v.plugin_version_id
         WHERE v.plugin_version_id = ? AND v.runtime_kind = 'managed-remote-mcp'
           AND v.plugin_definition_id = ? AND v.manifest_digest = ?
           AND v.catalog_snapshot_id = ? AND v.config_schema_id = ?
           AND v.provider_registration_id = ? AND v.authentication_kind = ?
             AND v.requested_scopes_json = ? AND v.provider_definition_digest IS ?
            AND v.auth_profile = ? AND v.auth_definition_digest = ?
            AND v.auth_definition_revision = 1
            AND EXISTS (
              SELECT 1 FROM plugin_auth_strategy_definitions auth
              WHERE auth.auth_definition_digest = v.auth_definition_digest
                AND auth.profile = v.auth_profile AND auth.revision = 1
                AND auth.canonical_definition_json = ? AND auth.status = 'active'
            )
           AND v.status IN ('publishing', 'published') AND v.review_status = 'approved'
           AND e.endpoint_url = ? AND e.expected_origin = ? AND e.protocol_policy_json = ?
           AND e.provider_registration_id = v.provider_registration_id AND e.status = 'active'
           AND i.artifact_digest IS NULL AND i.status IN ('pending', 'published')`,
            [
              version.id,
              candidate.definitionId,
              candidate.sourceInputDigest,
              version.catalog.id,
              configIdentity.success.configSchemaId,
              runtime.providerRegistrationId,
              candidate.authentication.kind,
              authenticationRequestedScopesJson(candidate.authentication),
              authentication.success.providerDefinitionDigest,
              candidate.authStrategy.profile,
              authDefinitionDigest,
              authDefinitionJson,
              provenance.success.endpoint,
              endpoint.origin,
              canonicalPluginJson(provenance.success.protocolPolicy),
            ],
          ),
      this.#managedRemoteAuthenticationGuard(
        candidate,
        authentication.success,
        durableOAuthRegistrationMode(provenance.success.oauthRegistrationMode),
      ),
    );
    statements.push(
      failBatchGuard(
        `SELECT 1 FROM plugin_catalog_snapshots c
         WHERE c.catalog_snapshot_id = ? AND c.catalog_digest = ? AND c.schema_version = 1
           AND (SELECT COUNT(*) FROM plugin_catalog_tools t
                WHERE t.catalog_snapshot_id = c.catalog_snapshot_id) = ?`,
        [version.catalog.id, candidate.catalogDigest, version.catalog.tools.length],
      ),
    );
    for (const [ordinal, tool] of version.catalog.tools.entries()) {
      statements.push(
        failBatchGuard(
          `SELECT 1 FROM plugin_catalog_tools t
           WHERE t.catalog_snapshot_id = ? AND t.tool_id = ? AND t.ordinal = ?
             AND t.mcp_name = ? AND t.title = ? AND t.description = ?
             AND t.classification = ? AND t.default_policy = ?
             AND t.input_schema_json = ? AND t.maximum_output_bytes = ?`,
          [
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
        ),
      );
    }
    const result = await this.database.batch(statements);
    return Result.isFailure(result)
      ? Result.fail("application-stage-failed")
      : Result.succeed(undefined);
  }

  async finalize(candidate: IncrementalReleaseCandidate) {
    if (candidate.version.runtime.kind === "managed-remote-mcp") {
      return this.#finalizeManagedRemote(candidate);
    }
    const version = candidate.version;
    const runtime = candidate.version.runtime;
    if (runtime.kind !== "managed-package") return Result.fail("packaged-runtime-required");
    const existing = await this.#loadVersion(version.id);
    if (Result.isFailure(existing) || existing.success === null) {
      return Result.fail("application-finalize-failed");
    }
    const authentication = await this.#verifyPersistedPublicationAuthentication(
      existing.success,
      candidate.authentication,
      false,
      packagedOAuthRegistrationMode(candidate),
    );
    if (Result.isFailure(authentication)) return Result.fail(authentication.failure);
    const configIdentity = await this.#resolveConfigIdentity(candidate);
    if (Result.isFailure(configIdentity)) return Result.fail(configIdentity.failure);
    const digest = runtime.artifactDigest;
    const intentId = `${version.id}:publication`;
    const configId = configIdentity.success.configSchemaId;
    const objectKey = `plugin-packages/sha256/${digest.slice(0, 2)}/${digest}.plugin`;
    const statements: Array<D1Statement> = [
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
                  AND requested_scopes_json = ?
                  AND provider_registration_authority_revision IS ?
                  AND provider_definition_digest IS ? AND provider_definition_revision IS ?
                AND EXISTS (SELECT 1 FROM plugin_config_schemas c
                  WHERE c.config_schema_id = plugin_versions.config_schema_id
                    AND c.schema_digest = ? AND c.revision = ? AND c.fields_json = ?)
                  AND EXISTS (SELECT 1 FROM plugin_definitions d
                    JOIN plugin_marketplaces m ON m.marketplace_id = d.marketplace_id
                    WHERE d.plugin_definition_id = plugin_versions.plugin_definition_id
                      AND d.status = 'active' AND m.status = 'active')
                AND EXISTS (SELECT 1 FROM plugin_artifacts a
                  WHERE a.artifact_digest = plugin_versions.artifact_digest AND a.status = 'available')
                 AND EXISTS (SELECT 1 FROM plugin_publication_intents i
                   WHERE i.publication_intent_id = ? AND i.plugin_version_id = plugin_versions.plugin_version_id
                     AND i.artifact_digest = plugin_versions.artifact_digest
                     AND i.provider_registration_material_source_revision IS ?
                     AND i.status = 'artifact-verified')`,
        params: [
          version.publishedAt,
          version.id,
          digest,
          configId,
          candidate.authentication.kind,
          packagedAuthenticationProviderRegistration(candidate.authentication),
          authenticationRequestedScopesJson(candidate.authentication),
          authentication.success.providerRegistrationAuthorityRevision,
          authentication.success.providerDefinitionDigest,
          authentication.success.providerDefinitionRevision,
          candidate.configDigest,
          version.config.revision,
          configIdentity.success.fieldsJson,
          intentId,
          authentication.success.materialSource?.sourceRevision ?? null,
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
                       AND v.provider_registration_id IS ? AND v.requested_scopes_json = ?
                        AND v.provider_registration_authority_revision IS ?
                        AND v.provider_definition_digest IS ? AND v.provider_definition_revision IS ?
                        AND plugin_publication_intents.provider_registration_material_source_revision IS ?
                     AND a.status = 'available')`,
        params: [
          candidate.reviewedAt,
          intentId,
          version.id,
          digest,
          configId,
          candidate.authentication.kind,
          packagedAuthenticationProviderRegistration(candidate.authentication),
          authenticationRequestedScopesJson(candidate.authentication),
          authentication.success.providerRegistrationAuthorityRevision,
          authentication.success.providerDefinitionDigest,
          authentication.success.providerDefinitionRevision,
          authentication.success.materialSource?.sourceRevision ?? null,
        ],
      },
      failBatchGuard(
        `SELECT 1 FROM plugin_publication_intents i
         JOIN plugin_versions v ON v.plugin_version_id = i.plugin_version_id
         JOIN plugin_artifacts a ON a.artifact_digest = i.artifact_digest
         WHERE i.publication_intent_id = ? AND i.plugin_version_id = ?
           AND i.artifact_digest = ? AND i.status = 'published'
           AND i.provider_registration_material_source_revision IS ?
           AND v.status = 'published' AND v.review_status = 'approved'
           AND v.plugin_definition_id = ? AND v.semantic_version = ?
           AND v.manifest_digest = ? AND v.catalog_snapshot_id = ? AND v.config_schema_id = ?
           AND v.runtime_kind = 'managed-package' AND v.artifact_digest = i.artifact_digest
           AND v.package_entrypoint = ? AND v.package_node_version = '22.x'
           AND v.allowed_hosts_json = ? AND v.license = ? AND v.provenance_json = ?
           AND v.release_date = ? AND a.status = 'available'
           AND a.object_key = ? AND a.byte_size = ?`,
        [
          intentId,
          version.id,
          digest,
          authentication.success.materialSource?.sourceRevision ?? null,
          candidate.definitionId,
          version.version,
          runtime.manifestDigest,
          version.catalog.id,
          configId,
          runtime.entrypoint,
          JSON.stringify(version.allowedHosts),
          version.license,
          canonicalPluginJson(candidate.provenance),
          version.publishedAt,
          objectKey,
          candidate.artifactBytes?.byteLength ?? 0,
        ],
      ),
      failBatchGuard(
        `SELECT 1 FROM plugin_versions v
         WHERE v.plugin_version_id = ?
           AND EXISTS (SELECT 1 FROM plugin_definitions d
             WHERE d.plugin_definition_id = v.plugin_definition_id
               AND d.marketplace_id = ? AND d.publisher_namespace = ? AND d.plugin_slug = ?
               AND d.name = ? AND d.short_description = ? AND d.long_description = ?
               AND d.status = 'active'
               AND EXISTS (SELECT 1 FROM plugin_marketplaces m
                 WHERE m.marketplace_id = d.marketplace_id AND m.status = 'active'))`,
        [
          version.id,
          version.marketplaceId,
          version.publisherNamespace,
          version.pluginSlug,
          version.name,
          version.description.slice(0, 500),
          version.description,
        ],
      ),
      failBatchGuard(
        `SELECT 1 FROM plugin_versions v
         WHERE v.plugin_version_id = ?
           AND EXISTS (SELECT 1 FROM plugin_catalog_snapshots c
             WHERE c.catalog_snapshot_id = v.catalog_snapshot_id
               AND c.catalog_digest = ? AND c.schema_version = 1)
           AND EXISTS (SELECT 1 FROM plugin_config_schemas s
             WHERE s.config_schema_id = v.config_schema_id
               AND s.schema_digest = ? AND s.revision = ? AND s.fields_json = ?)`,
        [
          version.id,
          version.catalog.digest,
          candidate.configDigest,
          version.config.revision,
          configIdentity.success.fieldsJson,
        ],
      ),
      failBatchGuard(
        `SELECT 1 FROM plugin_versions v
         JOIN plugin_publication_intents i ON i.plugin_version_id = v.plugin_version_id
         WHERE v.plugin_version_id = ? AND v.authentication_kind = ?
           AND v.provider_registration_id IS ? AND v.requested_scopes_json = ?
           AND v.provider_registration_authority_revision IS ?
           AND v.provider_definition_digest IS ? AND v.provider_definition_revision IS ?
           AND i.provider_registration_material_source_revision IS ?
           AND (? = 'none'
             OR (? = 'github-app' AND EXISTS (SELECT 1 FROM provider_registrations p
               WHERE p.provider_registration_id = v.provider_registration_id
                 AND p.registration_mode = 'platform-pre-registered'
                  AND p.approved_scopes_json = ? AND p.source = 'platform'
                  AND p.status = 'active' AND length(p.client_credential_reference) > 0
                  AND p.oauth_provider_definition_digest IS NULL))
              OR (? = 'oauth' AND EXISTS (
                SELECT 1 FROM provider_registrations p
                JOIN plugin_oauth_provider_definitions od
                  ON od.provider_definition_digest = p.oauth_provider_definition_digest
                 AND od.revision = p.oauth_provider_definition_revision
                WHERE p.provider_registration_id = v.provider_registration_id
                  AND p.registration_mode = 'workspace-oauth-app'
                  AND p.approved_scopes_json = ? AND p.source = 'platform'
                  AND p.status = 'active' AND p.client_credential_reference IS NULL
                  AND p.oauth_authority_revision = v.provider_registration_authority_revision
                  AND p.oauth_provider_definition_digest = v.provider_definition_digest
                  AND p.oauth_provider_definition_revision = v.provider_definition_revision
                  AND od.status = 'active' AND od.provider = p.provider
                  AND od.resource_identity = p.resource_identity
                  AND od.scopes_json = v.requested_scopes_json
                  AND od.display_label_path_present = 1))
              OR (? = 'oauth' AND EXISTS (
               SELECT 1 FROM provider_registrations p
               JOIN plugin_oauth_registration_material_sources ms
                 ON ms.provider_registration_id = p.provider_registration_id
                AND ms.oauth_authority_revision = p.oauth_authority_revision
                AND ms.provider_definition_digest = p.oauth_provider_definition_digest
                AND ms.provider_definition_revision = p.oauth_provider_definition_revision
               JOIN plugin_oauth_provider_definitions od
                 ON od.provider_definition_digest = p.oauth_provider_definition_digest
                AND od.revision = p.oauth_provider_definition_revision
               WHERE p.provider_registration_id = v.provider_registration_id
                 AND p.registration_mode = 'platform-pre-registered'
                 AND p.approved_scopes_json = ? AND p.source = 'platform'
                 AND p.status = 'active' AND p.client_credential_reference IS NULL
                 AND p.oauth_authority_revision = v.provider_registration_authority_revision
                 AND p.oauth_provider_definition_digest = v.provider_definition_digest
                 AND p.oauth_provider_definition_revision = v.provider_definition_revision
                 AND ms.source_revision = i.provider_registration_material_source_revision
                 AND ms.source_revision IS ? AND ms.source_kind = 'deployment-environment'
                 AND ms.status = 'active' AND ms.material_version IS ?
                 AND ms.declaration_id IS ? AND ms.deployment_revision IS ?
                 AND ms.token_endpoint_auth_method IS ?
                 AND od.status = 'active' AND od.provider = p.provider
                 AND od.resource_identity = p.resource_identity
                 AND od.scopes_json = v.requested_scopes_json
                 AND od.display_label_path_present = 1
                 AND json_extract(od.canonical_definition_json, '$.tokenEndpointAuthMethod')
                       = ms.token_endpoint_auth_method)))`,
        [
          version.id,
          candidate.authentication.kind,
          packagedAuthenticationProviderRegistration(candidate.authentication),
          authenticationRequestedScopesJson(candidate.authentication),
          authentication.success.providerRegistrationAuthorityRevision,
          authentication.success.providerDefinitionDigest,
          authentication.success.providerDefinitionRevision,
          authentication.success.materialSource?.sourceRevision ?? null,
          candidate.authentication.kind,
          candidate.authentication.kind,
          authenticationRequestedScopesJson(candidate.authentication),
          candidate.authentication.kind,
          authenticationRequestedScopesJson(candidate.authentication),
          candidate.authentication.kind,
          authenticationRequestedScopesJson(candidate.authentication),
          authentication.success.materialSource?.sourceRevision ?? null,
          authentication.success.materialSource?.materialVersion ?? null,
          authentication.success.materialSource?.declarationId ?? null,
          authentication.success.materialSource?.deploymentRevision ?? null,
          authentication.success.materialSource?.tokenEndpointAuthMethod ?? null,
        ],
      ),
      failBatchGuard(
        `SELECT 1 FROM plugin_versions v
         WHERE v.plugin_version_id = ?
           AND (SELECT COUNT(*) FROM plugin_catalog_tools t
                WHERE t.catalog_snapshot_id = v.catalog_snapshot_id) = ?`,
        [version.id, version.catalog.tools.length],
      ),
    ];
    for (const [ordinal, tool] of version.catalog.tools.entries()) {
      statements.push(
        failBatchGuard(
          `SELECT 1 FROM plugin_catalog_tools t
           WHERE t.catalog_snapshot_id = ? AND t.tool_id = ? AND t.ordinal = ?
             AND t.mcp_name = ? AND t.title = ? AND t.description = ?
             AND t.classification = ? AND t.default_policy = ?
             AND t.input_schema_json = ? AND t.maximum_output_bytes = ?`,
          [
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
        ),
      );
    }
    const result = await this.database.batch(statements);
    return Result.isFailure(result)
      ? Result.fail("application-finalize-failed")
      : Result.succeed(undefined);
  }

  async #finalizeManagedRemote(
    candidate: IncrementalReleaseCandidate,
  ): Promise<Result.Result<void, string>> {
    const runtime = candidate.version.runtime;
    if (
      runtime.kind !== "managed-remote-mcp" ||
      (candidate.authentication.kind !== "oauth" &&
        !(
          candidate.authentication.kind === "none" && candidate.authStrategy?.profile === "api-key"
        ))
    )
      return Result.fail("remote-release-contract-invalid");
    const provenance = Schema.decodeUnknownResult(ManagedRemoteProvenance, {
      onExcessProperty: "error",
    })(candidate.provenance);
    if (Result.isFailure(provenance)) return Result.fail("remote-release-contract-invalid");
    const existing = await this.#loadVersion(candidate.version.id);
    if (Result.isFailure(existing) || existing.success === null) {
      return Result.fail("application-finalize-failed");
    }
    if (!(await this.#rowMatchesCandidate(existing.success, candidate, "staged"))) {
      return Result.fail("immutable-version-conflict");
    }
    const authentication = await this.#verifyPersistedPublicationAuthentication(
      existing.success,
      candidate.authentication,
      false,
      durableOAuthRegistrationMode(provenance.success.oauthRegistrationMode),
    );
    if (Result.isFailure(authentication)) return Result.fail(authentication.failure);
    const configIdentity = await this.#resolveConfigIdentity(candidate);
    if (Result.isFailure(configIdentity)) return Result.fail(configIdentity.failure);
    const intentId = `${candidate.version.id}:publication`;
    const result = await this.database.batch([
      {
        sql: `UPDATE plugin_versions SET status = 'published', published_at = ?
              WHERE plugin_version_id = ? AND runtime_kind = 'managed-remote-mcp'
                AND status = 'publishing' AND review_status = 'approved'`,
        params: [candidate.version.publishedAt, candidate.version.id],
      },
      {
        sql: `UPDATE plugin_publication_intents
              SET status = 'published', attempts = attempts + 1, last_failure_reason = NULL,
                  updated_at = ?
              WHERE publication_intent_id = ? AND artifact_digest IS NULL
                AND status IN ('pending', 'failed')`,
        params: [candidate.reviewedAt, intentId],
      },
      failBatchGuard(
        `SELECT 1 FROM plugin_versions v
         JOIN plugin_publication_intents i ON i.plugin_version_id = v.plugin_version_id
         JOIN remote_mcp_endpoint_registrations e
           ON e.endpoint_registration_id = v.endpoint_registration_id
          WHERE v.plugin_version_id = ? AND v.status = 'published'
            AND v.review_status = 'approved' AND v.runtime_kind = 'managed-remote-mcp'
            AND v.plugin_definition_id = ? AND v.semantic_version = ?
            AND v.manifest_digest = ? AND v.catalog_snapshot_id = ?
            AND v.config_schema_id = ? AND v.provider_registration_id = ?
            AND v.authentication_kind = ? AND v.requested_scopes_json = ?
            AND v.allowed_hosts_json = ? AND v.license = ? AND v.provenance_json = ?
            AND v.release_date = ?
            AND i.publication_intent_id = ? AND i.status = 'published'
            AND i.artifact_digest IS NULL AND e.status = 'active'`,
        [
          candidate.version.id,
          candidate.definitionId,
          candidate.version.version,
          candidate.sourceInputDigest,
          candidate.version.catalog.id,
          configIdentity.success.configSchemaId,
          runtime.providerRegistrationId,
          candidate.authentication.kind,
          authenticationRequestedScopesJson(candidate.authentication),
          JSON.stringify(candidate.version.allowedHosts),
          candidate.version.license,
          canonicalPluginJson(candidate.provenance),
          candidate.version.publishedAt,
          intentId,
        ],
      ),
      this.#managedRemoteAuthenticationGuard(
        candidate,
        authentication.success,
        durableOAuthRegistrationMode(provenance.success.oauthRegistrationMode),
      ),
    ]);
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

  #managedRemoteAuthenticationGuard(
    candidate: IncrementalReleaseCandidate,
    authentication: ResolvedPublicationAuthentication,
    registrationMode: "dynamic" | "platform-pre-registered" | "workspace-oauth-app",
  ): D1Statement {
    const providerRegistration = candidate.authentication;
    if (providerRegistration.kind !== "oauth") {
      return candidate.authStrategy?.profile === "api-key"
        ? failBatchGuard("SELECT 1", [])
        : failBatchGuard("SELECT 1 WHERE 0", []);
    }
    const scopesJson = authenticationRequestedScopesJson(providerRegistration);
    if (registrationMode === "dynamic") {
      return failBatchGuard(
        `SELECT 1 FROM provider_registrations p
         JOIN plugin_oauth_provider_definitions od
           ON od.provider_definition_digest = ? AND od.revision = ?
         WHERE p.provider_registration_id = ? AND p.registration_mode = 'dynamic'
           AND p.source = 'platform' AND p.status = 'active'
           AND p.authorization_metadata_url IS NOT NULL
           AND p.client_credential_reference IS NULL
           AND p.oauth_provider_definition_digest IS NULL
           AND p.oauth_provider_definition_revision IS NULL
           AND p.oauth_authority_revision IS NULL
           AND p.provider = od.provider AND p.resource_identity = od.resource_identity
           AND p.approved_scopes_json = ? AND od.scopes_json = ?
           AND od.status = 'active' AND od.display_label_path_present = 1`,
        [
          providerRegistration.providerDefinitionDigest,
          authentication.providerDefinitionRevision,
          providerRegistration.providerRegistration,
          scopesJson,
          scopesJson,
        ],
      );
    }
    if (registrationMode === "workspace-oauth-app") {
      return failBatchGuard(
        `SELECT 1 FROM provider_registrations p
         JOIN plugin_oauth_provider_definitions od
           ON od.provider_definition_digest = p.oauth_provider_definition_digest
          AND od.revision = p.oauth_provider_definition_revision
         WHERE p.provider_registration_id = ?
           AND p.registration_mode = 'workspace-oauth-app'
           AND p.source = 'platform' AND p.status = 'active'
           AND p.approved_scopes_json = ? AND p.client_credential_reference IS NULL
           AND p.oauth_authority_revision IS ?
           AND p.oauth_provider_definition_digest = ?
           AND p.oauth_provider_definition_revision IS ?
           AND od.status = 'active' AND od.scopes_json = ?
           AND od.display_label_path_present = 1`,
        [
          providerRegistration.providerRegistration,
          scopesJson,
          authentication.providerRegistrationAuthorityRevision,
          providerRegistration.providerDefinitionDigest,
          authentication.providerDefinitionRevision,
          scopesJson,
        ],
      );
    }
    return failBatchGuard(
      `SELECT 1 FROM provider_registrations p
       JOIN plugin_oauth_registration_material_sources ms
         ON ms.provider_registration_id = p.provider_registration_id
        AND ms.oauth_authority_revision = p.oauth_authority_revision
        AND ms.provider_definition_digest = p.oauth_provider_definition_digest
        AND ms.provider_definition_revision = p.oauth_provider_definition_revision
       JOIN plugin_oauth_provider_definitions od
         ON od.provider_definition_digest = p.oauth_provider_definition_digest
        AND od.revision = p.oauth_provider_definition_revision
       WHERE p.provider_registration_id = ?
         AND p.registration_mode = 'platform-pre-registered'
         AND p.source = 'platform' AND p.status = 'active'
         AND p.approved_scopes_json = ? AND p.client_credential_reference IS NULL
         AND p.oauth_authority_revision IS ?
         AND p.oauth_provider_definition_digest = ?
         AND p.oauth_provider_definition_revision IS ?
         AND ms.source_revision IS ? AND ms.source_kind = 'deployment-environment'
         AND ms.status = 'active' AND od.status = 'active'
         AND od.scopes_json = ? AND od.display_label_path_present = 1`,
      [
        providerRegistration.providerRegistration,
        scopesJson,
        authentication.providerRegistrationAuthorityRevision,
        providerRegistration.providerDefinitionDigest,
        authentication.providerDefinitionRevision,
        authentication.materialSource?.sourceRevision ?? null,
        scopesJson,
      ],
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
      (candidate.kind === "managed-remote-mcp" || row.success.artifact_status === "available") &&
      row.success.intent_status === "published"
    ) {
      return Result.succeed("published");
    }
    return Result.succeed(
      row.success.status === "revoked" &&
        (candidate.kind === "managed-remote-mcp" || row.success.artifact_status === "available") &&
        row.success.intent_status === "published"
        ? "revoked"
        : "mismatch",
    );
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

  async #resolvePublicationAuthentication(
    authentication: typeof PackagedPluginAuthentication.Type,
    registrationMode?: "dynamic" | "platform-pre-registered" | "workspace-oauth-app",
  ): Promise<Result.Result<ResolvedPublicationAuthentication, string>> {
    if (authentication.kind === "none") return Result.succeed(noGenericOAuthAuthority);
    if (authentication.kind === "github-app") {
      const rows = await this.database.query({
        sql: `SELECT provider_registration_id, registration_mode, approved_scopes_json,
                     source, status,
                     CASE WHEN client_credential_reference IS NOT NULL
                                AND length(client_credential_reference) > 0 THEN 1 ELSE 0 END
                       AS client_authority_present,
                     oauth_provider_definition_digest
              FROM provider_registrations WHERE provider_registration_id = ?`,
        params: [authentication.providerRegistration],
      });
      if (Result.isFailure(rows)) return Result.fail("application-provider-verification-failed");
      const row = rows.success[0];
      return row?.provider_registration_id === authentication.providerRegistration &&
        row.registration_mode === "platform-pre-registered" &&
        row.approved_scopes_json === "[]" &&
        row.source === "platform" &&
        row.status === "active" &&
        row.client_authority_present === 1 &&
        row.oauth_provider_definition_digest === null
        ? Result.succeed(noGenericOAuthAuthority)
        : Result.fail("application-provider-verification-failed");
    }

    const definition = await this.#resolveOAuthDefinition(
      authentication.providerDefinitionDigest,
      authenticationRequestedScopesJson(authentication),
    );
    if (Result.isFailure(definition)) return Result.fail(definition.failure);
    let resolvedRegistrationMode = registrationMode;
    if (resolvedRegistrationMode === undefined) {
      const rows = await this.database.query({
        sql: `SELECT registration_mode FROM provider_registrations
              WHERE provider_registration_id = ? AND status = 'active'`,
        params: [authentication.providerRegistration],
      });
      if (Result.isFailure(rows)) return Result.fail("application-provider-verification-failed");
      const row = Schema.decodeUnknownResult(PackagedOAuthRegistrationModeRow, {
        onExcessProperty: "error",
      })(rows.success[0]);
      if (Result.isFailure(row)) return Result.fail("application-provider-verification-failed");
      resolvedRegistrationMode = row.success.registration_mode;
    }
    if (resolvedRegistrationMode === "dynamic") {
      return this.#resolveDynamicOAuthAuthentication(authentication, definition.success);
    }
    if (resolvedRegistrationMode === "workspace-oauth-app") {
      const workspace = await this.#resolveWorkspaceOAuthAuthentication(
        authentication,
        definition.success,
      );
      return workspace;
    }
    const registrationRows = await this.database.query({
      sql: `SELECT r.provider_registration_id, r.provider, r.resource_identity,
                   r.registration_mode, r.approved_scopes_json, r.source, r.status,
                   r.oauth_provider_definition_digest, r.oauth_provider_definition_revision,
                   r.oauth_authority_revision, s.source_revision, s.source_kind,
                   s.material_version, s.declaration_id, s.token_endpoint_auth_method,
                   s.deployment_revision
            FROM provider_registrations r
            JOIN plugin_oauth_registration_material_sources s
              ON s.provider_registration_id = r.provider_registration_id
             AND s.oauth_authority_revision = r.oauth_authority_revision
             AND s.provider_definition_digest = r.oauth_provider_definition_digest
             AND s.provider_definition_revision = r.oauth_provider_definition_revision
            WHERE r.provider_registration_id = ? AND r.status = 'active'
              AND r.registration_mode = 'platform-pre-registered' AND r.source = 'platform'
              AND r.client_credential_reference IS NULL
              AND s.source_kind = 'deployment-environment' AND s.status = 'active'
            ORDER BY s.source_revision DESC LIMIT 1`,
      params: [authentication.providerRegistration],
    });
    if (Result.isFailure(registrationRows)) {
      return Result.fail("application-provider-verification-failed");
    }
    const registrationRow = Schema.decodeUnknownResult(OAuthEnvironmentRegistrationPublicationRow, {
      onExcessProperty: "error",
    })(registrationRows.success[0]);
    if (
      Result.isFailure(registrationRow) ||
      !this.#oauthRegistrationMatchesDefinition(
        registrationRow.success,
        authentication.providerRegistration,
        authentication.providerDefinitionDigest,
        authenticationRequestedScopesJson(authentication),
        definition.success,
      )
    ) {
      return Result.fail("application-provider-verification-failed");
    }
    return Result.succeed({
      providerRegistrationAuthorityRevision: registrationRow.success.oauth_authority_revision,
      providerDefinitionDigest: definition.success.providerDefinitionDigest,
      providerDefinitionRevision: definition.success.providerDefinitionRevision,
      materialSource: {
        sourceRevision: registrationRow.success.source_revision,
        materialVersion: registrationRow.success.material_version,
        declarationId: registrationRow.success.declaration_id,
        deploymentRevision: registrationRow.success.deployment_revision,
        tokenEndpointAuthMethod: registrationRow.success.token_endpoint_auth_method,
      },
    });
  }

  async #resolveWorkspaceOAuthAuthentication(
    authentication: Extract<typeof PackagedPluginAuthentication.Type, { readonly kind: "oauth" }>,
    definition: {
      readonly providerDefinitionDigest: typeof PluginSha256.Type;
      readonly providerDefinitionRevision: number;
      readonly provider: string;
      readonly resourceIdentity: string;
    },
  ): Promise<Result.Result<ResolvedPublicationAuthentication, string>> {
    const rows = await this.database.query({
      sql: `SELECT provider_registration_id, provider, resource_identity, registration_mode,
                   approved_scopes_json, source, status, oauth_provider_definition_digest,
                   oauth_provider_definition_revision, oauth_authority_revision,
                   CASE WHEN client_credential_reference IS NOT NULL
                              AND length(client_credential_reference) > 0 THEN 1 ELSE 0 END
                     AS client_authority_present
            FROM provider_registrations
            WHERE provider_registration_id = ? AND registration_mode = 'workspace-oauth-app'
              AND status = 'active' AND source = 'platform'`,
      params: [authentication.providerRegistration],
    });
    if (Result.isFailure(rows)) return Result.fail("application-provider-verification-failed");
    const row = Schema.decodeUnknownResult(OAuthWorkspaceRegistrationPublicationRow, {
      onExcessProperty: "error",
    })(rows.success[0]);
    if (
      Result.isFailure(row) ||
      row.success.provider_registration_id !== authentication.providerRegistration ||
      row.success.provider !== definition.provider ||
      row.success.resource_identity !== definition.resourceIdentity ||
      row.success.approved_scopes_json !== authenticationRequestedScopesJson(authentication) ||
      row.success.oauth_provider_definition_digest !== definition.providerDefinitionDigest ||
      row.success.oauth_provider_definition_revision !== definition.providerDefinitionRevision
    ) {
      return Result.fail("application-provider-verification-failed");
    }
    return Result.succeed({
      providerRegistrationAuthorityRevision: row.success.oauth_authority_revision,
      providerDefinitionDigest: definition.providerDefinitionDigest,
      providerDefinitionRevision: definition.providerDefinitionRevision,
      materialSource: null,
    });
  }

  async #resolveDynamicOAuthAuthentication(
    authentication: Extract<typeof PackagedPluginAuthentication.Type, { readonly kind: "oauth" }>,
    definition: {
      readonly providerDefinitionDigest: typeof PluginSha256.Type;
      readonly providerDefinitionRevision: number;
      readonly provider: string;
      readonly resourceIdentity: string;
    },
  ): Promise<Result.Result<ResolvedPublicationAuthentication, string>> {
    const rows = await this.database.query({
      sql: `SELECT r.provider_registration_id, r.provider, r.resource_identity, r.registration_mode,
                    r.approved_scopes_json, r.source, r.status, r.authorization_metadata_url,
                    CASE WHEN client_credential_reference IS NOT NULL
                               AND length(client_credential_reference) > 0 THEN 1 ELSE 0 END
                      AS client_authority_present,
                    r.oauth_provider_definition_digest, r.oauth_provider_definition_revision,
                    r.oauth_authority_revision, ms.source_revision, ms.material_origin,
                    ms.status AS material_source_status
              FROM provider_registrations r
              LEFT JOIN plugin_oauth_registration_material_sources ms
                ON ms.provider_registration_id = r.provider_registration_id
               AND ms.oauth_authority_revision = r.oauth_authority_revision
               AND ms.provider_definition_digest = r.oauth_provider_definition_digest
               AND ms.provider_definition_revision = r.oauth_provider_definition_revision
               AND ms.material_origin = 'dynamic-registration' AND ms.status = 'active'
              WHERE r.provider_registration_id = ?
              ORDER BY ms.source_revision DESC LIMIT 1`,
      params: [authentication.providerRegistration],
    });
    if (Result.isFailure(rows)) return Result.fail("application-provider-verification-failed");
    const row = Schema.decodeUnknownResult(OAuthDynamicRegistrationStateRow, {
      onExcessProperty: "error",
    })(rows.success[0]);
    if (
      Result.isFailure(row) ||
      row.success.provider_registration_id !== authentication.providerRegistration ||
      row.success.provider !== definition.provider ||
      row.success.resource_identity !== definition.resourceIdentity ||
      row.success.approved_scopes_json !== authenticationRequestedScopesJson(authentication) ||
      (row.success.oauth_provider_definition_digest === null
        ? row.success.client_authority_present !== 0 ||
          row.success.oauth_provider_definition_revision !== null ||
          row.success.oauth_authority_revision !== null ||
          row.success.source_revision !== null ||
          row.success.material_origin !== null ||
          row.success.material_source_status !== null
        : row.success.client_authority_present !== 1)
    ) {
      return Result.fail("application-provider-verification-failed");
    }
    if (
      row.success.oauth_provider_definition_digest !== null &&
      (row.success.oauth_provider_definition_digest !== definition.providerDefinitionDigest ||
        row.success.oauth_provider_definition_revision !== definition.providerDefinitionRevision ||
        row.success.oauth_authority_revision === null ||
        row.success.oauth_authority_revision < 1 ||
        (row.success.material_origin !== "dynamic-registration" &&
          row.success.material_origin !== "client-id-metadata-document") ||
        row.success.material_source_status !== "active")
    ) {
      return Result.fail("application-provider-verification-failed");
    }
    try {
      const metadataUrl = new URL(row.success.authorization_metadata_url);
      if (metadataUrl.protocol !== "https:") {
        return Result.fail("application-provider-verification-failed");
      }
    } catch {
      return Result.fail("application-provider-verification-failed");
    }
    return Result.succeed({
      providerRegistrationAuthorityRevision: null,
      providerDefinitionDigest: definition.providerDefinitionDigest,
      providerDefinitionRevision: definition.providerDefinitionRevision,
      materialSource: null,
    });
  }

  async #resolveOAuthDefinition(
    providerDefinitionDigest: typeof PluginSha256.Type,
    scopesJson: string,
  ): Promise<
    Result.Result<
      {
        readonly providerDefinitionDigest: typeof PluginSha256.Type;
        readonly providerDefinitionRevision: number;
        readonly provider: string;
        readonly resourceIdentity: string;
        readonly tokenEndpointAuthMethod: "client_secret_post" | "client_secret_basic" | "none";
      },
      string
    >
  > {
    const definitionRows = await this.database.query({
      sql: `SELECT provider_definition_digest, schema_version, canonical_definition_json,
                   scopes_json, provider, resource_identity, display_label_path_present,
                   status, revision
            FROM plugin_oauth_provider_definitions WHERE provider_definition_digest = ?`,
      params: [providerDefinitionDigest],
    });
    if (Result.isFailure(definitionRows)) {
      return Result.fail("application-provider-verification-failed");
    }
    const definitionRow = Schema.decodeUnknownResult(OAuthDefinitionPublicationRow, {
      onExcessProperty: "error",
    })(definitionRows.success[0]);
    if (Result.isFailure(definitionRow)) {
      return Result.fail("application-provider-verification-failed");
    }
    let definitionJson: Schema.Json;
    try {
      definitionJson = Schema.decodeUnknownSync(Schema.Json)(
        JSON.parse(definitionRow.success.canonical_definition_json),
      );
    } catch {
      return Result.fail("application-provider-verification-failed");
    }
    const definition = decodePluginOAuthProviderDefinition(definitionJson);
    if (Result.isFailure(definition)) {
      return Result.fail("application-provider-verification-failed");
    }
    const canonicalDefinitionJson = new TextDecoder().decode(
      encodePluginOAuthProviderDefinitionCanonicalJson(definition.success),
    );
    const definitionDigest = await digestPluginOAuthProviderDefinition(definition.success);
    const admittedProviderIsDeployable = definition.success.provider.length <= 100;
    const exactDefinition =
      canonicalDefinitionJson === definitionRow.success.canonical_definition_json &&
      definitionDigest === providerDefinitionDigest &&
      definitionRow.success.provider_definition_digest === providerDefinitionDigest &&
      definitionRow.success.scopes_json === scopesJson &&
      canonicalPluginJson(definition.success.scopes) === scopesJson &&
      definitionRow.success.provider === definition.success.provider &&
      definitionRow.success.resource_identity === definition.success.resourceIdentity &&
      (definition.success.account.kind === "declaration-managed" ||
        definition.success.account.kind === "atlassian-jira-site" ||
        definition.success.account.displayLabelPath !== undefined) &&
      admittedProviderIsDeployable;
    if (!exactDefinition) {
      return Result.fail("application-provider-verification-failed");
    }
    return Result.succeed({
      providerDefinitionDigest: definitionRow.success.provider_definition_digest,
      providerDefinitionRevision: definitionRow.success.revision,
      provider: definition.success.provider,
      resourceIdentity: definition.success.resourceIdentity,
      tokenEndpointAuthMethod: definition.success.tokenEndpointAuthMethod,
    });
  }

  #oauthRegistrationMatchesDefinition(
    registration: typeof OAuthEnvironmentRegistrationPublicationRow.Type,
    providerRegistrationId: string,
    providerDefinitionDigest: typeof PluginSha256.Type,
    requestedScopesJson: string,
    definition: {
      readonly providerDefinitionRevision: number;
      readonly provider: string;
      readonly resourceIdentity: string;
      readonly tokenEndpointAuthMethod: "client_secret_post" | "client_secret_basic" | "none";
    },
  ): boolean {
    return (
      registration.provider_registration_id === providerRegistrationId &&
      registration.provider === definition.provider &&
      registration.resource_identity === definition.resourceIdentity &&
      registration.approved_scopes_json === requestedScopesJson &&
      registration.oauth_provider_definition_digest === providerDefinitionDigest &&
      registration.oauth_provider_definition_revision === definition.providerDefinitionRevision &&
      registration.token_endpoint_auth_method === definition.tokenEndpointAuthMethod
    );
  }

  async #verifyPersistedPublicationAuthentication(
    row: Readonly<Record<string, unknown>>,
    authentication: typeof PackagedPluginAuthentication.Type,
    allowPublishedHistory: boolean,
    registrationMode?: "dynamic" | "platform-pre-registered" | "workspace-oauth-app",
  ): Promise<Result.Result<ResolvedPublicationAuthentication, string>> {
    if (authentication.kind !== "oauth") {
      const current = await this.#resolvePublicationAuthentication(authentication);
      if (Result.isFailure(current)) return current;
      return this.#rowMatchesResolvedPublicationAuthentication(row, current.success) &&
        row.provider_definition_digest ===
          packagedAuthenticationProviderDefinitionDigest(authentication)
        ? current
        : Result.fail("application-provider-verification-failed");
    }

    const sourceRevision = row.provider_registration_material_source_revision;
    if (sourceRevision === null) {
      const definition = await this.#resolveOAuthDefinition(
        authentication.providerDefinitionDigest,
        authenticationRequestedScopesJson(authentication),
      );
      if (Result.isFailure(definition)) return Result.fail(definition.failure);
      if (registrationMode === "workspace-oauth-app") {
        const workspace = await this.#resolveWorkspaceOAuthAuthentication(
          authentication,
          definition.success,
        );
        if (
          Result.isSuccess(workspace) &&
          this.#rowMatchesResolvedPublicationAuthentication(row, workspace.success)
        ) {
          return workspace;
        }
        return workspace;
      }
      if (registrationMode === "dynamic") {
        const dynamic = await this.#resolveDynamicOAuthAuthentication(
          authentication,
          definition.success,
        );
        return Result.isSuccess(dynamic) &&
          this.#rowMatchesResolvedPublicationAuthentication(row, dynamic.success)
          ? dynamic
          : Result.fail("application-provider-verification-failed");
      }
      if (registrationMode === undefined) {
        const current = await this.#resolvePublicationAuthentication(authentication);
        if (
          Result.isSuccess(current) &&
          current.success.materialSource === null &&
          this.#rowMatchesResolvedPublicationAuthentication(row, current.success)
        ) {
          return current;
        }
        if (!allowPublishedHistory) return Result.fail("application-provider-verification-failed");
      }
      return allowPublishedHistory
        ? this.#resolveLegacyPublishedOAuthAuthentication(row, authentication)
        : Result.fail("application-provider-verification-failed");
    }
    const parsedSourceRevision = Schema.decodeUnknownResult(PositiveRevision)(sourceRevision);
    if (Result.isFailure(parsedSourceRevision)) {
      return Result.fail("application-provider-verification-failed");
    }
    const definition = await this.#resolveOAuthDefinition(
      authentication.providerDefinitionDigest,
      authenticationRequestedScopesJson(authentication),
    );
    if (Result.isFailure(definition)) return Result.fail(definition.failure);
    const publishedHistory =
      allowPublishedHistory &&
      (row.status === "published" || row.status === "revoked") &&
      row.artifact_status === "available" &&
      row.intent_status === "published";
    const registrationRows = await this.database.query({
      sql: publishedHistory
        ? `SELECT r.provider_registration_id, r.provider, r.resource_identity,
                  r.registration_mode, r.approved_scopes_json, r.source, r.status,
                  r.oauth_provider_definition_digest, r.oauth_provider_definition_revision,
                  r.oauth_authority_revision, s.source_revision, s.source_kind,
                  s.material_version, s.declaration_id, s.token_endpoint_auth_method,
                  s.deployment_revision, s.status AS historical_source_status,
                  CASE WHEN EXISTS (
                    SELECT 1 FROM plugin_oauth_registration_material_sources current_source
                    WHERE current_source.provider_registration_id = r.provider_registration_id
                      AND current_source.oauth_authority_revision = r.oauth_authority_revision
                      AND current_source.provider_definition_digest = r.oauth_provider_definition_digest
                      AND current_source.provider_definition_revision = r.oauth_provider_definition_revision
                      AND current_source.source_kind = 'deployment-environment'
                      AND current_source.status = 'active'
                      AND current_source.token_endpoint_auth_method = s.token_endpoint_auth_method
                  ) THEN 1 ELSE 0 END AS current_source_available
           FROM provider_registrations r
           JOIN plugin_oauth_registration_material_sources s
             ON s.provider_registration_id = r.provider_registration_id
            AND s.oauth_authority_revision = r.oauth_authority_revision
            AND s.provider_definition_digest = r.oauth_provider_definition_digest
            AND s.provider_definition_revision = r.oauth_provider_definition_revision
           WHERE r.provider_registration_id = ? AND r.status = 'active'
             AND r.registration_mode = 'platform-pre-registered' AND r.source = 'platform'
             AND r.client_credential_reference IS NULL AND s.source_revision = ?
             AND s.source_kind = 'deployment-environment'`
        : `SELECT r.provider_registration_id, r.provider, r.resource_identity,
                  r.registration_mode, r.approved_scopes_json, r.source, r.status,
                  r.oauth_provider_definition_digest, r.oauth_provider_definition_revision,
                  r.oauth_authority_revision, s.source_revision, s.source_kind,
                  s.material_version, s.declaration_id, s.token_endpoint_auth_method,
                  s.deployment_revision
           FROM provider_registrations r
           JOIN plugin_oauth_registration_material_sources s
             ON s.provider_registration_id = r.provider_registration_id
            AND s.oauth_authority_revision = r.oauth_authority_revision
            AND s.provider_definition_digest = r.oauth_provider_definition_digest
            AND s.provider_definition_revision = r.oauth_provider_definition_revision
           WHERE r.provider_registration_id = ? AND r.status = 'active'
             AND r.registration_mode = 'platform-pre-registered' AND r.source = 'platform'
             AND r.client_credential_reference IS NULL AND s.source_revision = ?
             AND s.source_kind = 'deployment-environment' AND s.status = 'active'`,
      params: [authentication.providerRegistration, parsedSourceRevision.success],
    });
    if (Result.isFailure(registrationRows)) {
      return Result.fail("application-provider-verification-failed");
    }
    const registrationRow = Schema.decodeUnknownResult(
      publishedHistory
        ? OAuthPublishedEnvironmentRegistrationRow
        : OAuthEnvironmentRegistrationPublicationRow,
      { onExcessProperty: "error" },
    )(registrationRows.success[0]);
    if (
      Result.isFailure(registrationRow) ||
      !this.#oauthRegistrationMatchesDefinition(
        registrationRow.success,
        authentication.providerRegistration,
        authentication.providerDefinitionDigest,
        authenticationRequestedScopesJson(authentication),
        definition.success,
      )
    ) {
      return Result.fail("application-provider-verification-failed");
    }
    const resolved: ResolvedPublicationAuthentication = {
      providerRegistrationAuthorityRevision: registrationRow.success.oauth_authority_revision,
      providerDefinitionDigest: definition.success.providerDefinitionDigest,
      providerDefinitionRevision: definition.success.providerDefinitionRevision,
      materialSource: {
        sourceRevision: registrationRow.success.source_revision,
        materialVersion: registrationRow.success.material_version,
        declarationId: registrationRow.success.declaration_id,
        deploymentRevision: registrationRow.success.deployment_revision,
        tokenEndpointAuthMethod: registrationRow.success.token_endpoint_auth_method,
      },
    };
    return this.#rowMatchesResolvedPublicationAuthentication(row, resolved)
      ? Result.succeed(resolved)
      : Result.fail("application-provider-verification-failed");
  }

  async #resolveLegacyPublishedOAuthAuthentication(
    row: Readonly<Record<string, unknown>>,
    authentication: Extract<typeof PackagedPluginAuthentication.Type, { readonly kind: "oauth" }>,
  ): Promise<Result.Result<ResolvedPublicationAuthentication, string>> {
    if (
      (row.status !== "published" && row.status !== "revoked") ||
      row.artifact_status !== "available" ||
      row.intent_status !== "published"
    ) {
      return Result.fail("application-provider-verification-failed");
    }
    const definition = await this.#resolveOAuthDefinition(
      authentication.providerDefinitionDigest,
      authenticationRequestedScopesJson(authentication),
    );
    if (Result.isFailure(definition)) return Result.fail(definition.failure);
    const registrationRows = await this.database.query({
      sql: `SELECT provider_registration_id, provider, resource_identity, registration_mode,
                   approved_scopes_json, source, status, oauth_provider_definition_digest,
                   oauth_provider_definition_revision, oauth_authority_revision,
                   CASE WHEN client_credential_reference IS NOT NULL
                              AND length(client_credential_reference) > 0 THEN 1 ELSE 0 END
                     AS client_authority_present
            FROM provider_registrations WHERE provider_registration_id = ?`,
      params: [authentication.providerRegistration],
    });
    if (Result.isFailure(registrationRows)) {
      return Result.fail("application-provider-verification-failed");
    }
    const registrationRow = Schema.decodeUnknownResult(OAuthLegacyRegistrationPublicationRow, {
      onExcessProperty: "error",
    })(registrationRows.success[0]);
    if (
      Result.isFailure(registrationRow) ||
      registrationRow.success.provider_registration_id !== authentication.providerRegistration ||
      registrationRow.success.provider !== definition.success.provider ||
      registrationRow.success.resource_identity !== definition.success.resourceIdentity ||
      registrationRow.success.approved_scopes_json !==
        authenticationRequestedScopesJson(authentication) ||
      registrationRow.success.oauth_provider_definition_digest !==
        authentication.providerDefinitionDigest ||
      registrationRow.success.oauth_provider_definition_revision !==
        definition.success.providerDefinitionRevision
    ) {
      return Result.fail("application-provider-verification-failed");
    }
    const resolved: ResolvedPublicationAuthentication = {
      providerRegistrationAuthorityRevision: registrationRow.success.oauth_authority_revision,
      providerDefinitionDigest: definition.success.providerDefinitionDigest,
      providerDefinitionRevision: definition.success.providerDefinitionRevision,
      materialSource: null,
    };
    return this.#rowMatchesResolvedPublicationAuthentication(row, resolved)
      ? Result.succeed(resolved)
      : Result.fail("application-provider-verification-failed");
  }

  #rowMatchesResolvedPublicationAuthentication(
    row: Readonly<Record<string, unknown>>,
    authentication: ResolvedPublicationAuthentication,
  ): boolean {
    return (
      row.provider_registration_authority_revision ===
        authentication.providerRegistrationAuthorityRevision &&
      row.provider_definition_digest === authentication.providerDefinitionDigest &&
      row.provider_definition_revision === authentication.providerDefinitionRevision &&
      row.provider_registration_material_source_revision ===
        (authentication.materialSource?.sourceRevision ?? null)
    );
  }

  async #loadVersion(
    id: string,
  ): Promise<Result.Result<Readonly<Record<string, unknown>> | null, string>> {
    const rows = await this.database.query({
      sql: `SELECT v.plugin_version_id, v.plugin_definition_id, v.semantic_version,
                   v.manifest_digest, v.catalog_snapshot_id, v.config_schema_id,
                     v.runtime_kind, v.artifact_digest, v.package_entrypoint,
                     v.package_node_version,
                      v.authentication_kind, v.provider_registration_id, v.requested_scopes_json,
                     v.provider_registration_authority_revision, v.provider_definition_digest,
                      v.provider_definition_revision,
                    v.allowed_hosts_json, v.license, v.provenance_json, v.release_date,
                     v.status, v.review_status, v.published_at,
                     c.catalog_digest, c.schema_version,
                    s.schema_digest, s.revision AS config_revision, s.fields_json,
                    d.marketplace_id AS definition_marketplace_id,
                    d.publisher_namespace AS definition_publisher_namespace,
                    d.plugin_slug AS definition_plugin_slug, d.name AS definition_name,
                     d.short_description, d.long_description, d.status AS definition_status,
                     m.status AS marketplace_status,
                      a.status AS artifact_status, a.object_key, a.byte_size,
                        v.endpoint_registration_id, e.endpoint_url, e.expected_origin,
                        e.transport AS endpoint_transport,
                        e.provider_registration_id AS endpoint_provider_registration_id,
                        e.resource_audience AS endpoint_resource_audience,
                        e.status AS endpoint_status, e.protocol_policy_json,
                      i.publication_intent_id, i.artifact_digest AS intent_artifact_digest,
                      i.status AS intent_status,
                      i.provider_registration_material_source_revision
             FROM plugin_versions v
             JOIN plugin_definitions d ON d.plugin_definition_id = v.plugin_definition_id
             JOIN plugin_marketplaces m ON m.marketplace_id = d.marketplace_id
             JOIN plugin_catalog_snapshots c ON c.catalog_snapshot_id = v.catalog_snapshot_id
             JOIN plugin_config_schemas s ON s.config_schema_id = v.config_schema_id
              LEFT JOIN plugin_artifacts a ON a.artifact_digest = v.artifact_digest
               LEFT JOIN remote_mcp_endpoint_registrations e
                 ON e.endpoint_registration_id = v.endpoint_registration_id
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
    const version = candidate.version;
    const runtime = candidate.version.runtime;
    const remoteProvenance =
      runtime.kind === "managed-remote-mcp"
        ? Schema.decodeUnknownResult(ManagedRemoteProvenance, {
            onExcessProperty: "error",
          })(candidate.provenance)
        : null;
    if (remoteProvenance !== null && Result.isFailure(remoteProvenance)) return false;
    const configIdentity = await this.#resolveConfigIdentity(candidate);
    if (Result.isFailure(configIdentity)) return false;
    const authentication = await this.#verifyPersistedPublicationAuthentication(
      row,
      candidate.authentication,
      mode !== "staged",
      remoteProvenance === null || Result.isFailure(remoteProvenance)
        ? packagedOAuthRegistrationMode(candidate)
        : durableOAuthRegistrationMode(remoteProvenance.success.oauthRegistrationMode),
    );
    if (Result.isFailure(authentication)) return false;
    const tools = await this.database.query({
      sql: `SELECT tool_id, ordinal, mcp_name, title, description, classification,
                   default_policy, input_schema_json, maximum_output_bytes
            FROM plugin_catalog_tools WHERE catalog_snapshot_id = ? ORDER BY ordinal`,
      params: [version.catalog.id],
    });
    if (Result.isFailure(tools)) return false;
    const exactToolOrdinals = tools.success.every((tool, ordinal) => tool.ordinal === ordinal);
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
    const packagedRuntimeMatches =
      runtime.kind === "managed-package" &&
      row.manifest_digest === runtime.manifestDigest &&
      row.runtime_kind === "managed-package" &&
      row.artifact_digest === runtime.artifactDigest &&
      row.package_entrypoint === runtime.entrypoint &&
      row.package_node_version === "22.x" &&
      row.object_key ===
        `plugin-packages/sha256/${runtime.artifactDigest.slice(0, 2)}/${runtime.artifactDigest}.plugin` &&
      row.byte_size === candidate.artifactByteLength &&
      row.intent_artifact_digest === runtime.artifactDigest;
    let remoteRuntimeMatches = false;
    if (runtime.kind === "managed-remote-mcp") {
      if (remoteProvenance !== null && Result.isSuccess(remoteProvenance)) {
        try {
          const endpoint = new URL(remoteProvenance.success.endpoint);
          remoteRuntimeMatches =
            row.manifest_digest === candidate.sourceInputDigest &&
            row.runtime_kind === "managed-remote-mcp" &&
            row.artifact_digest === null &&
            row.package_entrypoint === null &&
            row.package_node_version === null &&
            row.endpoint_registration_id === runtime.endpointRegistrationId &&
            row.endpoint_url === remoteProvenance.success.endpoint &&
            row.expected_origin === endpoint.origin &&
            row.endpoint_transport === "streamable-http" &&
            row.endpoint_provider_registration_id === runtime.providerRegistrationId &&
            row.endpoint_resource_audience === remoteProvenance.success.endpoint &&
            row.endpoint_status === "active" &&
            row.protocol_policy_json ===
              canonicalPluginJson(remoteProvenance.success.protocolPolicy) &&
            row.intent_artifact_digest === null;
        } catch {
          remoteRuntimeMatches = false;
        }
      }
    }
    const runtimeMatches = packagedRuntimeMatches || remoteRuntimeMatches;
    let authStrategyMatches = true;
    if (candidate.authStrategy !== undefined) {
      const authDefinitionDigest = await digestPluginBytes(
        new TextEncoder().encode(canonicalPluginJson(candidate.authStrategy)),
      );
      const authRows = await this.database.query({
        sql: `SELECT v.auth_profile, v.auth_definition_digest, v.auth_definition_revision,
                     auth.canonical_definition_json, auth.status
              FROM plugin_versions v
              JOIN plugin_auth_strategy_definitions auth
                ON auth.auth_definition_digest = v.auth_definition_digest
               AND auth.revision = v.auth_definition_revision
             WHERE v.plugin_version_id = ?`,
        params: [candidate.version.id],
      });
      if (Result.isFailure(authRows)) return false;
      const authRow = authRows.success[0];
      authStrategyMatches =
        authRow?.auth_profile === candidate.authStrategy.profile &&
        authRow.auth_definition_digest === authDefinitionDigest &&
        authRow.auth_definition_revision === 1 &&
        authRow.canonical_definition_json === canonicalPluginJson(candidate.authStrategy) &&
        authRow.status === "active";
    }
    const artifactLifecycleMatches =
      runtime.kind === "managed-remote-mcp" ||
      (mode === "published"
        ? row.artifact_status === "available"
        : row.artifact_status === "pending" || row.artifact_status === "available");
    return (
      row.plugin_version_id === version.id &&
      row.plugin_definition_id === candidate.definitionId &&
      row.definition_marketplace_id === version.marketplaceId &&
      row.definition_publisher_namespace === version.publisherNamespace &&
      row.definition_plugin_slug === version.pluginSlug &&
      row.definition_name === version.name &&
      row.short_description === version.description.slice(0, 500) &&
      row.long_description === version.description &&
      row.definition_status === "active" &&
      row.marketplace_status === "active" &&
      row.review_status === "approved" &&
      row.semantic_version === version.version &&
      row.catalog_snapshot_id === version.catalog.id &&
      row.config_schema_id === configIdentity.success.configSchemaId &&
      runtimeMatches &&
      authStrategyMatches &&
      row.authentication_kind === candidate.authentication.kind &&
      row.provider_registration_id ===
        (runtime.kind === "managed-remote-mcp" && candidate.authStrategy?.profile === "api-key"
          ? runtime.providerRegistrationId
          : packagedAuthenticationProviderRegistration(candidate.authentication)) &&
      row.requested_scopes_json === authenticationRequestedScopesJson(candidate.authentication) &&
      row.provider_registration_authority_revision ===
        authentication.success.providerRegistrationAuthorityRevision &&
      row.provider_definition_digest === authentication.success.providerDefinitionDigest &&
      row.provider_definition_revision === authentication.success.providerDefinitionRevision &&
      row.allowed_hosts_json === JSON.stringify(version.allowedHosts) &&
      row.license === version.license &&
      row.release_date === version.publishedAt &&
      row.catalog_digest === candidate.catalogDigest &&
      row.schema_version === 1 &&
      exactToolOrdinals &&
      canonicalPluginJson(normalizedTools as never) ===
        canonicalPluginJson(version.catalog.tools) &&
      row.schema_digest === candidate.configDigest &&
      row.config_revision === version.config.revision &&
      canonicalPluginJson(normalizedConfigFields.success) ===
        canonicalPluginJson(version.config.fields) &&
      row.provenance_json === canonicalPluginJson(candidate.provenance) &&
      row.publication_intent_id === `${version.id}:publication` &&
      (row.status === "publishing"
        ? row.published_at === null
        : row.published_at === version.publishedAt) &&
      (mode === "immutable" ||
        (mode === "published"
          ? row.status === "published" &&
            artifactLifecycleMatches &&
            row.intent_status === "published"
          : (row.status === "publishing" || row.status === "published") &&
            artifactLifecycleMatches &&
            (row.intent_status === "pending" ||
              row.intent_status === "artifact-verified" ||
              row.intent_status === "published")))
    );
  }
}
