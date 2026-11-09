import type { D1Statement } from "./cloudflare-adapters.js";
import { packagedAuthenticationRequestedScopes } from "./package-archive.js";
import { canonicalPluginJson, digestPluginBytes, type PluginSha256 } from "./plugin-contract.js";
import type { IncrementalReleaseCandidate } from "./release-machine.js";

/**
 * Reviewed Gmail event catalog the application reads to offer `gmail.message.added` to workflow
 * triggers and Gmail monitoring. Mirrors `registerReviewedGmailVersion` in the application's
 * `plugin-event-catalog-registry.ts`: same JSON bytes, same digest, same source predicate. A
 * published curated Gmail version without this row reports no events.
 */

const gmailMonitoringScopes = new Set([
  "https://mail.google.com/",
  "https://www.googleapis.com/auth/gmail.readonly",
  "https://www.googleapis.com/auth/gmail.modify",
  "https://www.googleapis.com/auth/gmail.metadata",
]);

export interface GmailEventCatalog {
  readonly canonicalJson: string;
  readonly digest: PluginSha256;
}

/** Whether a release is the curated Gmail package whose scopes allow mailbox monitoring. */
export function isMonitorableGmailRelease(candidate: IncrementalReleaseCandidate): boolean {
  return (
    candidate.version.marketplaceId === "supernala-public" &&
    candidate.version.publisherNamespace === "supernala" &&
    candidate.version.pluginSlug === "gmail" &&
    candidate.version.runtime.kind === "managed-package" &&
    candidate.authentication.kind === "oauth" &&
    packagedAuthenticationRequestedScopes(candidate.authentication).some((scope) =>
      gmailMonitoringScopes.has(scope),
    )
  );
}

/** The exact catalog bytes and digest the application stores for one Gmail version. */
export async function gmailEventCatalog(pluginVersionId: string): Promise<GmailEventCatalog> {
  const catalog = {
    pluginVersionId,
    events: [
      {
        version: 1,
        event: "gmail.message.added",
        adapter: "gmail-history-v1",
        payload: "gmail-message-metadata-v1",
      },
    ],
  };

  return {
    canonicalJson: JSON.stringify(catalog),
    digest: await digestPluginBytes(new TextEncoder().encode(canonicalPluginJson(catalog))),
  };
}

const reviewedGmailSource = `FROM plugin_versions v
  JOIN plugin_definitions d ON d.plugin_definition_id = v.plugin_definition_id
  JOIN plugin_oauth_provider_definitions pd
    ON pd.provider_definition_digest = v.provider_definition_digest
   AND pd.revision = v.provider_definition_revision AND pd.status = 'active'
  WHERE v.plugin_version_id = ? AND v.manifest_digest = ?
    AND v.status = 'published' AND v.review_status = 'approved'
    AND d.status = 'active' AND d.marketplace_id = 'supernala-public'
    AND d.publisher_namespace = 'supernala' AND d.plugin_slug = 'gmail'
    AND d.publisher_trust = 'supernala-curated'
    AND (v.auth_profile IS NULL OR v.auth_profile IN ('workspace-oauth', 'mcp-oauth'))
    AND json_extract(pd.canonical_definition_json, '$.issuer') = 'https://accounts.google.com'
    AND json_extract(pd.canonical_definition_json, '$.tokenEndpoint') = 'https://oauth2.googleapis.com/token'`;

/** Publishes the catalog in the finalize batch, after the version row becomes published. */
export function registerGmailEventCatalogStatement(input: {
  readonly pluginVersionId: string;
  readonly manifestDigest: string;
  readonly catalog: GmailEventCatalog;
  readonly reviewedAt: number;
}): D1Statement {
  return {
    sql: `INSERT INTO plugin_version_event_catalogs
            (plugin_version_id, reviewed_manifest_digest, catalog_digest, canonical_catalog_json, reviewed_at)
          SELECT v.plugin_version_id, v.manifest_digest, ?, ?, ?
          ${reviewedGmailSource}
          ON CONFLICT (plugin_version_id) DO NOTHING`,
    params: [
      input.catalog.digest,
      input.catalog.canonicalJson,
      input.reviewedAt,
      input.pluginVersionId,
      input.manifestDigest,
    ],
  };
}

/** Guard condition: the version retains exactly this catalog for its reviewed manifest. */
export function gmailEventCatalogRetainedCondition(input: {
  readonly pluginVersionId: string;
  readonly manifestDigest: string;
  readonly catalog: GmailEventCatalog;
}): { readonly condition: string; readonly params: ReadonlyArray<string> } {
  return {
    condition: `SELECT 1 FROM plugin_version_event_catalogs e
      WHERE e.plugin_version_id = ? AND e.reviewed_manifest_digest = ?
        AND e.catalog_digest = ? AND e.canonical_catalog_json = ?`,
    params: [
      input.pluginVersionId,
      input.manifestDigest,
      input.catalog.digest,
      input.catalog.canonicalJson,
    ],
  };
}
