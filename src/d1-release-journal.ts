import { Result, Schema } from "effect";
import { canonicalPluginJson, PluginSha256, PluginVersion } from "./plugin-contract.js";
import { PackagedPluginAuthentication } from "./package-archive.js";
import type { D1BatchTransport, D1Statement } from "./cloudflare-adapters.js";
import {
  pluginReleaseIdentityKey,
  ReleaseJournalRecordSchema,
  releaseRecordIdentityIsCoherent,
  type IncrementalReleaseCandidate,
  type ReleaseJournal,
  type ReleaseJournalRecord,
  type ReleaseJournalStatus,
} from "./release-machine.js";

const JournalRow = Schema.Struct({
  release_identity: Schema.String,
  marketplace_id: Schema.String,
  publisher_namespace: Schema.String,
  plugin_slug: Schema.String,
  semantic_version: Schema.String,
  definition_id: Schema.String,
  runtime_kind: Schema.Literals(["managed-package", "managed-remote-mcp"]),
  version_json: Schema.String,
  source_input_digest: PluginSha256,
  release_digest: PluginSha256,
  catalog_digest: PluginSha256,
  config_digest: PluginSha256,
  provenance_json: Schema.String,
  provenance_digest: PluginSha256,
  authority_baseline_digest: PluginSha256,
  authority_digest: PluginSha256,
  authority_diff_digest: PluginSha256,
  artifact_digest: Schema.NullOr(PluginSha256),
  artifact_byte_length: Schema.NullOr(Schema.Int),
  merge_commit: Schema.String,
  release_ordinal: Schema.Int,
  review_id: Schema.String,
  reviewer: Schema.String,
  reviewed_at: Schema.Int,
  status: Schema.Literals(["claimed", "artifact-verified", "published", "failed"]),
  attempts: Schema.Int,
  failure_type: Schema.NullOr(Schema.String),
  generation: Schema.Int,
});

const JournalVersionEnvelope = Schema.Struct({
  schemaVersion: Schema.Literal(1),
  version: PluginVersion,
  authentication: PackagedPluginAuthentication,
});

const decodeVersionEnvelope = (value: Schema.Json): typeof JournalVersionEnvelope.Type => {
  if (
    Schema.is(Schema.JsonObject)(value) &&
    ("schemaVersion" in value ||
      "authentication" in value ||
      Schema.is(Schema.JsonObject)(value.version))
  ) {
    return Schema.decodeUnknownSync(JournalVersionEnvelope, { onExcessProperty: "error" })(value);
  }
  return JournalVersionEnvelope.make({
    schemaVersion: 1,
    version: Schema.decodeUnknownSync(PluginVersion, { onExcessProperty: "error" })(value),
    authentication: PackagedPluginAuthentication.make({ kind: "none" }),
  });
};

const decodeRow = (input: Schema.JsonObject): Result.Result<ReleaseJournalRecord, string> => {
  try {
    const row = Schema.decodeUnknownSync(JournalRow)(input);
    const versionEnvelope = decodeVersionEnvelope(JSON.parse(row.version_json));
    const record: ReleaseJournalRecord = {
      identity: {
        marketplaceId: row.marketplace_id,
        publisherNamespace: row.publisher_namespace,
        pluginSlug: row.plugin_slug,
        semanticVersion: row.semantic_version,
      },
      definitionId: row.definition_id,
      version: versionEnvelope.version,
      authentication: versionEnvelope.authentication,
      kind: row.runtime_kind,
      sourceInputDigest: row.source_input_digest,
      releaseDigest: row.release_digest,
      catalogDigest: row.catalog_digest,
      configDigest: row.config_digest,
      provenance: Schema.decodeUnknownSync(Schema.Json)(JSON.parse(row.provenance_json)),
      provenanceDigest: row.provenance_digest,
      authorityBaselineDigest: row.authority_baseline_digest,
      authorityDigest: row.authority_digest,
      authorityDiffDigest: row.authority_diff_digest,
      artifactDigest: row.artifact_digest,
      artifactByteLength: row.artifact_byte_length,
      mergeCommit: row.merge_commit,
      releaseOrdinal: row.release_ordinal,
      reviewId: row.review_id,
      reviewer: row.reviewer,
      reviewedAt: row.reviewed_at,
      status: row.status,
      attempts: row.attempts,
      failureType: row.failure_type,
      generation: row.generation,
    };
    const decoded = Schema.decodeUnknownResult(ReleaseJournalRecordSchema)(record);
    return Result.isSuccess(decoded) && releaseRecordIdentityIsCoherent(decoded.success)
      ? Result.succeed(decoded.success)
      : Result.fail("release-journal-row-invalid");
  } catch {
    return Result.fail("release-journal-row-invalid");
  }
};

const immutableMatch = (
  record: ReleaseJournalRecord,
  candidate: IncrementalReleaseCandidate,
): boolean =>
  record.definitionId === candidate.definitionId &&
  canonicalPluginJson(record.version) === canonicalPluginJson(candidate.version) &&
  canonicalPluginJson(record.authentication) === canonicalPluginJson(candidate.authentication) &&
  record.sourceInputDigest === candidate.sourceInputDigest &&
  record.releaseDigest === candidate.releaseDigest &&
  record.catalogDigest === candidate.catalogDigest &&
  record.configDigest === candidate.configDigest &&
  canonicalPluginJson(record.provenance) === canonicalPluginJson(candidate.provenance) &&
  record.provenanceDigest === candidate.provenanceDigest &&
  record.authorityBaselineDigest === candidate.authorityBaselineDigest &&
  record.authorityDigest === candidate.authorityDigest &&
  record.authorityDiffDigest === candidate.authorityDiffDigest &&
  record.artifactDigest === candidate.artifactDigest &&
  record.artifactByteLength === candidate.artifactByteLength &&
  record.kind === candidate.kind &&
  record.reviewId === candidate.reviewId &&
  record.reviewer === candidate.reviewer &&
  record.reviewedAt === candidate.reviewedAt;

/** Marketplace-owned durable D1 journal. It never claims ownership of application catalog D1/R2. */
export class D1ReleaseJournal implements ReleaseJournal {
  constructor(private readonly database: D1BatchTransport) {}

  async claim(candidate: IncrementalReleaseCandidate) {
    const key = pluginReleaseIdentityKey(candidate.identity);
    const insert: D1Statement = {
      sql: `INSERT INTO marketplace_release_journal
        (release_identity, marketplace_id, publisher_namespace, plugin_slug, semantic_version,
         definition_id, runtime_kind, version_json, source_input_digest, release_digest,
         catalog_digest, config_digest, provenance_json, provenance_digest,
          authority_baseline_digest, authority_digest, authority_diff_digest,
          artifact_digest, artifact_byte_length,
         merge_commit, release_ordinal, review_id, reviewer, reviewed_at, status, attempts, failure_type,
         generation, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'claimed', 1, NULL, 1, ?, ?)
        ON CONFLICT (release_identity) DO UPDATE SET
          attempts = marketplace_release_journal.attempts + 1,
          failure_type = NULL,
          updated_at = excluded.updated_at
        WHERE marketplace_release_journal.release_digest = excluded.release_digest
          AND marketplace_release_journal.source_input_digest = excluded.source_input_digest
          AND marketplace_release_journal.authority_digest = excluded.authority_digest`,
      params: [
        key,
        candidate.identity.marketplaceId,
        candidate.identity.publisherNamespace,
        candidate.identity.pluginSlug,
        candidate.identity.semanticVersion,
        candidate.definitionId,
        candidate.kind,
        canonicalPluginJson(
          JournalVersionEnvelope.make({
            schemaVersion: 1,
            version: candidate.version,
            authentication: candidate.authentication,
          }),
        ),
        candidate.sourceInputDigest,
        candidate.releaseDigest,
        candidate.catalogDigest,
        candidate.configDigest,
        canonicalPluginJson(candidate.provenance),
        candidate.provenanceDigest,
        candidate.authorityBaselineDigest,
        candidate.authorityDigest,
        candidate.authorityDiffDigest,
        candidate.artifactDigest,
        candidate.artifactByteLength,
        candidate.mergeCommit,
        candidate.releaseOrdinal,
        candidate.reviewId,
        candidate.reviewer,
        candidate.reviewedAt,
        candidate.reviewedAt,
        candidate.reviewedAt,
      ],
    };
    const rejectStaleOrdinal: D1Statement = {
      sql: `INSERT INTO marketplace_release_baselines
              (plugin_identity, release_identity, release_ordinal, release_digest, updated_at)
            SELECT NULL, NULL, NULL, NULL, NULL
            WHERE EXISTS (
              SELECT 1 FROM marketplace_release_baselines
              WHERE plugin_identity = ? AND release_ordinal >= ? AND release_identity <> ?
            )`,
      params: [
        `${candidate.identity.marketplaceId}/${candidate.identity.publisherNamespace}/${candidate.identity.pluginSlug}`,
        candidate.releaseOrdinal,
        key,
      ],
    };
    const inserted = await this.database.batch([insert, rejectStaleOrdinal]);
    if (Result.isFailure(inserted)) return Result.fail("release-journal-claim-failed");
    const rows = await this.database.query({
      sql: "SELECT * FROM marketplace_release_journal WHERE release_identity = ?",
      params: [key],
    });
    if (Result.isFailure(rows) || rows.success[0] === undefined) {
      return Result.fail("release-journal-readback-failed");
    }
    const record = decodeRow(rows.success[0]);
    if (Result.isFailure(record)) return Result.fail(record.failure);
    if (!immutableMatch(record.success, candidate))
      return Result.fail("immutable-version-conflict");
    return Result.succeed({
      record: record.success,
      alreadyPublished: record.success.status === "published",
    });
  }

  markArtifactVerified(key: string, generation: number): Promise<void> {
    return this.#mark(key, generation, "artifact-verified", null);
  }
  markPublished(key: string, generation: number): Promise<void> {
    return this.#mark(key, generation, "published", null);
  }
  markFailed(key: string, generation: number, failureType: string): Promise<void> {
    return this.#mark(key, generation, "failed", failureType);
  }

  async #mark(
    key: string,
    generation: number,
    status: ReleaseJournalStatus,
    failureType: string | null,
  ): Promise<void> {
    const statements: Array<D1Statement> = [
      {
        sql: `UPDATE marketplace_release_journal SET status = ?, failure_type = ?, updated_at = reviewed_at
              WHERE release_identity = ? AND generation = ? AND status <> 'published'`,
        params: [status, failureType, key, generation],
      },
    ];
    if (status === "published") {
      statements.push({
        sql: `INSERT INTO marketplace_release_baselines
          (plugin_identity, release_identity, release_ordinal, release_digest, updated_at)
          SELECT marketplace_id || '/' || publisher_namespace || '/' || plugin_slug,
                 release_identity, release_ordinal, release_digest, reviewed_at
          FROM marketplace_release_journal WHERE release_identity = ? AND generation = ?
          ON CONFLICT (plugin_identity) DO UPDATE SET
            release_identity = excluded.release_identity,
            release_ordinal = excluded.release_ordinal,
            release_digest = excluded.release_digest,
            updated_at = excluded.updated_at
          WHERE excluded.release_ordinal > marketplace_release_baselines.release_ordinal`,
        params: [key, generation],
      });
    }
    const result = await this.database.batch(statements);
    if (Result.isFailure(result)) throw new Error("release-journal-update-failed");
  }

  async list(): Promise<ReadonlyArray<ReleaseJournalRecord>> {
    const rows = await this.database.query({
      sql: "SELECT * FROM marketplace_release_journal ORDER BY release_ordinal, release_identity",
      params: [],
    });
    if (Result.isFailure(rows)) throw new Error("release-journal-list-failed");
    const records: Array<ReleaseJournalRecord> = [];
    for (const row of rows.success) {
      const decoded = decodeRow(row);
      if (Result.isFailure(decoded)) throw new Error(decoded.failure);
      records.push(decoded.success);
    }
    return records;
  }
}
