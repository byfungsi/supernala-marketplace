import { promises as fs } from "node:fs";
import path from "node:path";
import { Result, Schema } from "effect";
import type { D1BatchTransport, D1Statement } from "./cloudflare-adapters.js";
import {
  canonicalPluginJson,
  digestPluginBytes,
  PluginSha256,
  ProviderRegistrationId,
} from "./plugin-contract.js";
import {
  decodePluginOAuthProviderDefinition,
  digestPluginOAuthProviderDefinition,
  encodePluginOAuthProviderDefinitionCanonicalJson,
  type PluginOAuthProviderDefinition,
} from "./oauth-provider-definition.js";
import type { PackagedPluginAuthentication } from "./package-archive.js";

const WorkspaceOAuthProviderBindings = Schema.Struct({
  providerRegistration: ProviderRegistrationId,
  providerDefinition: Schema.Struct({
    path: Schema.Literal("oauth-provider.json"),
    canonicalSha256: PluginSha256,
  }),
  providerMetadata: Schema.Struct({
    provider: Schema.String,
    resourceIdentity: Schema.String,
    registrationMode: Schema.Literal("workspace-oauth-app"),
    source: Schema.Literal("platform"),
    approvedScopes: Schema.Array(Schema.String),
  }),
  workspaceOAuthApp: Schema.Struct({
    ownership: Schema.Literal("workspace-owner"),
    credentialFields: Schema.Tuple([Schema.Literal("clientId"), Schema.Literal("clientSecret")]),
    storage: Schema.Literal("encrypted-plugin-vault"),
  }),
});

export interface ReviewedWorkspaceOAuthProviderAuthority {
  readonly providerRegistrationId: typeof ProviderRegistrationId.Type;
  readonly providerDefinitionDigest: typeof PluginSha256.Type;
  readonly definition: PluginOAuthProviderDefinition;
  readonly canonicalDefinitionJson: string;
  readonly sourcePath: string;
  readonly sourceContentDigest: typeof PluginSha256.Type;
}

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

/** Loads and cross-checks credential-free Workspace OAuth authority from reviewed Plugin source. */
export async function loadReviewedWorkspaceOAuthProviderAuthority(input: {
  readonly sourceDirectory: string;
  readonly authentication: Extract<PackagedPluginAuthentication, { readonly kind: "oauth" }>;
}): Promise<Result.Result<ReviewedWorkspaceOAuthProviderAuthority, string>> {
  try {
    const bindingsPath = path.join(input.sourceDirectory, "platform-bindings.json");
    const bindings = Schema.decodeUnknownSync(WorkspaceOAuthProviderBindings, {
      onExcessProperty: "error",
    })(JSON.parse(await fs.readFile(bindingsPath, "utf8")));
    const definitionPath = path.join(input.sourceDirectory, bindings.providerDefinition.path);
    const definitionBytes = new Uint8Array(await fs.readFile(definitionPath));
    const definitionJson = Schema.decodeUnknownSync(Schema.Json)(
      JSON.parse(new TextDecoder().decode(definitionBytes)),
    );
    const decoded = decodePluginOAuthProviderDefinition(definitionJson);
    if (Result.isFailure(decoded))
      return Result.fail("workspace-oauth-provider-definition-invalid");
    const definition = decoded.success;
    const digest = await digestPluginOAuthProviderDefinition(definition);
    if (
      digest !== input.authentication.providerDefinitionDigest ||
      digest !== bindings.providerDefinition.canonicalSha256 ||
      bindings.providerRegistration !== input.authentication.providerRegistration ||
      bindings.providerMetadata.provider !== definition.provider ||
      bindings.providerMetadata.resourceIdentity !== definition.resourceIdentity ||
      canonicalPluginJson(bindings.providerMetadata.approvedScopes) !==
        canonicalPluginJson(definition.scopes) ||
      canonicalPluginJson(input.authentication.requestedScopes) !==
        canonicalPluginJson(definition.scopes) ||
      definition.account.kind !== "https-json" ||
      definition.account.displayLabelPath === undefined ||
      (definition.tokenEndpointAuthMethod !== "client_secret_post" &&
        definition.tokenEndpointAuthMethod !== "client_secret_basic")
    ) {
      return Result.fail("workspace-oauth-provider-authority-mismatch");
    }
    return Result.succeed({
      providerRegistrationId: bindings.providerRegistration,
      providerDefinitionDigest: digest,
      definition,
      canonicalDefinitionJson: new TextDecoder().decode(
        encodePluginOAuthProviderDefinitionCanonicalJson(definition),
      ),
      sourcePath: `${input.sourceDirectory}/${bindings.providerDefinition.path}`,
      sourceContentDigest: await digestPluginBytes(definitionBytes),
    });
  } catch {
    return Result.fail("workspace-oauth-provider-authority-invalid");
  }
}

/** Trusted D1 admission for one reviewed credential-free Provider Definition and Registration. */
export class WorkspaceOAuthProviderAuthorityAdmission {
  constructor(
    private readonly database: D1BatchTransport,
    private readonly callbackUrl: string,
  ) {}

  async admit(input: {
    readonly authority: ReviewedWorkspaceOAuthProviderAuthority;
    readonly sourceRepository: string;
    readonly sourceRevision: string;
    readonly reviewId: string;
    readonly reviewer: string;
    readonly reviewedAt: number;
  }): Promise<Result.Result<void, string>> {
    let callback: URL;
    try {
      callback = new URL(this.callbackUrl);
    } catch {
      return Result.fail("workspace-oauth-callback-invalid");
    }
    if (
      callback.protocol !== "https:" ||
      callback.username !== "" ||
      callback.password !== "" ||
      callback.hash !== "" ||
      callback.search !== "" ||
      callback.toString() !== this.callbackUrl
    ) {
      return Result.fail("workspace-oauth-callback-invalid");
    }
    const { authority } = input;
    const scopesJson = canonicalPluginJson(authority.definition.scopes);
    const result = await this.database.batch([
      {
        sql: `INSERT INTO plugin_oauth_provider_definitions
          (provider_definition_digest, schema_version, canonical_definition_json, scopes_json,
           provider, resource_identity, display_label_path_present, status, revision,
           admission_operation_id, admitted_by, source_kind, source_repository, source_revision,
           source_path, source_content_digest, reviewed_at, created_at, updated_at)
         VALUES (?, 1, ?, ?, ?, ?, 1, 'active', 1, ?, ?, 'marketplace-release', ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT (provider_definition_digest) DO NOTHING`,
        params: [
          authority.providerDefinitionDigest,
          authority.canonicalDefinitionJson,
          scopesJson,
          authority.definition.provider,
          authority.definition.resourceIdentity,
          input.reviewId,
          input.reviewer,
          input.sourceRepository,
          input.sourceRevision,
          authority.sourcePath,
          authority.sourceContentDigest,
          input.reviewedAt,
          input.reviewedAt,
          input.reviewedAt,
        ],
      },
      {
        sql: `INSERT INTO provider_registrations
          (provider_registration_id, provider, resource_identity, registration_mode,
           authorization_metadata_url, authorization_endpoint, token_endpoint,
           registration_endpoint, userinfo_endpoint, revocation_endpoint, metadata_digest,
           callback_url, approved_scopes_json, client_credential_reference,
           dynamic_registration_claim, dynamic_registration_claimed_at, source, status,
           revision, created_at, updated_at, oauth_provider_definition_digest,
           oauth_provider_definition_revision, oauth_authority_revision)
         VALUES (?, ?, ?, 'workspace-oauth-app', NULL, NULL, NULL, NULL, NULL, NULL, NULL,
                 ?, ?, NULL, NULL, NULL, 'platform', 'active', 1, ?, ?, ?, 1, 1)
         ON CONFLICT (provider_registration_id) DO NOTHING`,
        params: [
          authority.providerRegistrationId,
          authority.definition.provider,
          authority.definition.resourceIdentity,
          this.callbackUrl,
          scopesJson,
          input.reviewedAt,
          input.reviewedAt,
          authority.providerDefinitionDigest,
        ],
      },
      failBatchGuard(
        `SELECT 1 FROM plugin_oauth_provider_definitions d
         JOIN provider_registrations r
           ON r.oauth_provider_definition_digest = d.provider_definition_digest
          AND r.oauth_provider_definition_revision = d.revision
         WHERE d.provider_definition_digest = ? AND d.schema_version = 1
           AND d.canonical_definition_json = ? AND d.scopes_json = ?
           AND d.provider = ? AND d.resource_identity = ? AND d.display_label_path_present = 1
           AND d.status = 'active' AND d.revision = 1
           AND d.admission_operation_id = ? AND d.source_kind = 'marketplace-release'
           AND d.source_repository = ? AND d.source_path = ?
           AND d.source_content_digest = ? AND d.reviewed_at = ?
           AND r.provider_registration_id = ? AND r.provider = d.provider
           AND r.resource_identity = d.resource_identity
           AND r.registration_mode = 'workspace-oauth-app' AND r.callback_url = ?
           AND r.approved_scopes_json = d.scopes_json
           AND r.client_credential_reference IS NULL AND r.source = 'platform'
           AND r.status = 'active' AND r.revision = 1 AND r.oauth_authority_revision = 1`,
        [
          authority.providerDefinitionDigest,
          authority.canonicalDefinitionJson,
          scopesJson,
          authority.definition.provider,
          authority.definition.resourceIdentity,
          input.reviewId,
          input.sourceRepository,
          authority.sourcePath,
          authority.sourceContentDigest,
          input.reviewedAt,
          authority.providerRegistrationId,
          this.callbackUrl,
        ],
      ),
    ]);
    return Result.isSuccess(result)
      ? Result.succeed(undefined)
      : Result.fail("workspace-oauth-provider-admission-failed");
  }
}
