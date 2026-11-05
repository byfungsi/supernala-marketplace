import { createHash } from "node:crypto";
import {
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
  type S3ClientConfig,
} from "@aws-sdk/client-s3";
import { Result, Schema } from "effect";
import type { D1BatchTransport, D1Statement } from "./cloudflare-adapters.js";
import {
  canonicalSkillJson,
  compareSemanticVersions,
  type MarketplaceSkillRelease,
} from "./marketplace-skill.js";

/*
 * Publishes curated Skills into the application: file bytes into the platform AgentSkillBundles
 * bucket under `marketplace/sha256/<digest>`, then catalog rows into application D1. Bytes land
 * before rows, so a visible version never points at a missing file. Versions are immutable and
 * keyed by `<publisher>/<skill>@<semver>`; publishing the same release again changes nothing.
 */

/** Key of one Marketplace Skill file in the platform bundle bucket. */
export const marketplaceSkillObjectKey = (sha256: string) => `marketplace/sha256/${sha256}`;

/** Write-once, checksum-verified object storage for Skill file bytes. */
export interface SkillBundleStore {
  /**
   * Stores bytes under their content key unless an identical object is already there.
   * The stored object must carry its SHA-256 checksum: the application refuses to serve one
   * whose recorded checksum does not match the digest in the catalog row.
   */
  readonly putVerified: (
    sha256: string,
    bytes: Uint8Array,
  ) => Promise<Result.Result<"uploaded" | "already-present", string>>;
}

const base64Sha256 = (hex: string) => Buffer.from(hex, "hex").toString("base64");

/** R2 through its S3 API; `ChecksumSHA256` is recorded and later checked by the application. */
export class CloudflareR2SkillBundleStore implements SkillBundleStore {
  readonly #client: S3Client;
  readonly #bucket: string;

  constructor(
    configuration: {
      readonly accountId: string;
      readonly bucketName: string;
      readonly accessKeyId: string;
      readonly secretAccessKey: string;
    },
    client?: S3Client,
  ) {
    const clientConfiguration: S3ClientConfig = {
      region: "auto",
      endpoint: `https://${configuration.accountId}.r2.cloudflarestorage.com`,
      credentials: {
        accessKeyId: configuration.accessKeyId,
        secretAccessKey: configuration.secretAccessKey,
      },
      requestChecksumCalculation: "WHEN_REQUIRED",
      responseChecksumValidation: "WHEN_REQUIRED",
    };
    this.#client = client ?? new S3Client(clientConfiguration);
    this.#bucket = configuration.bucketName;
  }

  async #retained(sha256: string, byteSize: number) {
    try {
      const head = await this.#client.send(
        new HeadObjectCommand({
          Bucket: this.#bucket,
          Key: marketplaceSkillObjectKey(sha256),
          ChecksumMode: "ENABLED",
        }),
      );

      return head.ContentLength === byteSize && head.ChecksumSHA256 === base64Sha256(sha256)
        ? ("matching" as const)
        : ("mismatched" as const);
    } catch (cause) {
      const status = (cause as { $metadata?: { httpStatusCode?: number } }).$metadata
        ?.httpStatusCode;

      return status === 404 ? ("absent" as const) : ("unavailable" as const);
    }
  }

  async #matchesBytes(sha256: string): Promise<boolean> {
    try {
      const object = await this.#client.send(
        new GetObjectCommand({ Bucket: this.#bucket, Key: marketplaceSkillObjectKey(sha256) }),
      );
      const bytes = await object.Body?.transformToByteArray();

      return bytes !== undefined && createHash("sha256").update(bytes).digest("hex") === sha256;
    } catch {
      return false;
    }
  }

  async putVerified(sha256: string, bytes: Uint8Array) {
    if (createHash("sha256").update(bytes).digest("hex") !== sha256) {
      return Result.fail("skill-file-digest-mismatch");
    }
    const before = await this.#retained(sha256, bytes.byteLength);
    if (before === "unavailable") return Result.fail("skill-bundle-unavailable");
    if (before === "mismatched") return Result.fail("skill-bundle-object-mismatch");
    if (before === "matching") {
      return (await this.#matchesBytes(sha256))
        ? Result.succeed("already-present" as const)
        : Result.fail("skill-bundle-object-mismatch");
    }
    try {
      await this.#client.send(
        new PutObjectCommand({
          Bucket: this.#bucket,
          Key: marketplaceSkillObjectKey(sha256),
          Body: bytes,
          ChecksumSHA256: base64Sha256(sha256),
          IfNoneMatch: "*",
          ContentType: "application/octet-stream",
          CacheControl: "private, max-age=31536000, immutable",
        }),
      );
    } catch (cause) {
      // A concurrent publisher may have created the same content key first; verify it below.
      const status = (cause as { $metadata?: { httpStatusCode?: number } }).$metadata
        ?.httpStatusCode;
      if (status !== 412) return Result.fail("skill-bundle-upload-failed");
    }
    const after = await this.#retained(sha256, bytes.byteLength);
    if (after !== "matching" || !(await this.#matchesBytes(sha256))) {
      return Result.fail("skill-bundle-readback-mismatch");
    }

    return Result.succeed("uploaded" as const);
  }
}

const PublishedVersionRow = Schema.Struct({
  skill_definition_id: Schema.String,
  skill_version_id: Schema.String,
  semantic_version: Schema.String,
  release_digest: Schema.String,
  status: Schema.Literals(["published", "withdrawn"]),
});

const DefinitionRow = Schema.Struct({
  skill_definition_id: Schema.String,
  marketplace_id: Schema.String,
  publisher_name: Schema.String,
  name: Schema.String,
  short_description: Schema.String,
  long_description: Schema.String,
  categories_json: Schema.String,
  featured_rank: Schema.NullOr(Schema.Number),
  status: Schema.Literals(["active", "disabled"]),
});

/** What publishing one curated Skill would do. */
export type SkillPublicationStep =
  | { readonly kind: "publish-version"; readonly definition: "create" | "update" | "unchanged" }
  | { readonly kind: "update-definition" }
  | { readonly kind: "unchanged" }
  | { readonly kind: "blocked"; readonly reason: string };

export interface SkillPublicationPlanEntry {
  readonly release: MarketplaceSkillRelease;
  readonly step: SkillPublicationStep;
}

const presentation = (release: MarketplaceSkillRelease) => ({
  publisherName: release.manifest.publisher.name,
  name: release.manifest.name,
  shortDescription: release.manifest.shortDescription,
  longDescription: release.manifest.longDescription,
  categoriesJson: JSON.stringify(release.manifest.categories),
  featuredRank: release.manifest.featuredRank,
});

const definitionChanged = (
  row: typeof DefinitionRow.Type,
  release: MarketplaceSkillRelease,
): boolean => {
  const next = presentation(release);

  return (
    row.publisher_name !== next.publisherName ||
    row.name !== next.name ||
    row.short_description !== next.shortDescription ||
    row.long_description !== next.longDescription ||
    row.categories_json !== next.categoriesJson ||
    row.featured_rank !== next.featuredRank
  );
};

const placeholders = (count: number) => Array.from({ length: count }, () => "?").join(", ");

/** Reads current application state and decides, per Skill, what publishing would change. */
export const planSkillPublication = async (
  database: D1BatchTransport,
  releases: ReadonlyArray<MarketplaceSkillRelease>,
): Promise<Result.Result<ReadonlyArray<SkillPublicationPlanEntry>, string>> => {
  if (releases.length === 0) return Result.succeed([]);
  const ids = releases.map((release) => release.id);
  const definitions = await database.query({
    sql: `SELECT skill_definition_id, marketplace_id, publisher_name, name, short_description,
                 long_description, categories_json, featured_rank, status
          FROM marketplace_skill_definitions
          WHERE skill_definition_id IN (${placeholders(ids.length)})`,
    params: ids,
  });
  if (Result.isFailure(definitions)) return Result.fail(definitions.failure);
  const versions = await database.query({
    sql: `SELECT skill_definition_id, skill_version_id, semantic_version, release_digest, status
          FROM marketplace_skill_versions
          WHERE skill_definition_id IN (${placeholders(ids.length)})`,
    params: ids,
  });
  if (Result.isFailure(versions)) return Result.fail(versions.failure);
  const definitionRows = Schema.decodeUnknownResult(Schema.Array(DefinitionRow))(
    definitions.success,
  );
  const versionRows = Schema.decodeUnknownResult(Schema.Array(PublishedVersionRow))(
    versions.success,
  );
  if (Result.isFailure(definitionRows) || Result.isFailure(versionRows)) {
    return Result.fail("skill-catalog-rows-invalid");
  }

  return Result.succeed(
    releases.map((release): SkillPublicationPlanEntry => {
      const definition = definitionRows.success.find(
        (row) => row.skill_definition_id === release.id,
      );
      const existing = versionRows.success.filter((row) => row.skill_definition_id === release.id);
      const same = existing.find((row) => row.skill_version_id === release.versionId);
      if (
        definition !== undefined &&
        definition.marketplace_id !== release.manifest.marketplaceId
      ) {
        return { release, step: { kind: "blocked", reason: "skill-marketplace-mismatch" } };
      }
      const definitionStep =
        definition === undefined
          ? ("create" as const)
          : definitionChanged(definition, release)
            ? ("update" as const)
            : ("unchanged" as const);
      if (same !== undefined) {
        if (same.release_digest !== release.releaseDigest) {
          // Published content is immutable; changed content needs a new version.
          return { release, step: { kind: "blocked", reason: "skill-version-content-changed" } };
        }
        if (same.status === "withdrawn") {
          return { release, step: { kind: "blocked", reason: "skill-version-withdrawn" } };
        }

        return {
          release,
          step: definitionStep === "update" ? { kind: "update-definition" } : { kind: "unchanged" },
        };
      }
      if (
        existing.some(
          (row) => compareSemanticVersions(row.semantic_version, release.manifest.version) >= 0,
        )
      ) {
        return { release, step: { kind: "blocked", reason: "skill-version-not-newer" } };
      }

      return { release, step: { kind: "publish-version", definition: definitionStep } };
    }),
  );
};

/** Inserting NULLs into NOT NULL columns aborts the whole D1 batch when the condition fails. */
const failBatchUnless = (
  condition: string,
  params: ReadonlyArray<string | number | null>,
): D1Statement => ({
  sql: `INSERT INTO plugin_marketplaces
          (marketplace_id, name, visibility, trust_class, status, created_at, updated_at)
        SELECT NULL, NULL, NULL, NULL, NULL, NULL, NULL
        WHERE NOT EXISTS (${condition})`,
  params,
});

const definitionStatements = (
  release: MarketplaceSkillRelease,
  now: number,
): Array<D1Statement> => {
  const next = presentation(release);
  const { manifest } = release;

  return [
    failBatchUnless(
      "SELECT 1 FROM plugin_marketplaces WHERE marketplace_id = ? AND status = 'active'",
      [manifest.marketplaceId],
    ),
    {
      // Presentation is curated and may change; status stays as an operator left it.
      sql: `INSERT INTO marketplace_skill_definitions
              (skill_definition_id, marketplace_id, publisher_namespace, publisher_name, skill_slug,
               name, short_description, long_description, categories_json, featured_rank, status,
               created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?)
            ON CONFLICT (skill_definition_id) DO UPDATE SET
              publisher_name = excluded.publisher_name,
              name = excluded.name,
              short_description = excluded.short_description,
              long_description = excluded.long_description,
              categories_json = excluded.categories_json,
              featured_rank = excluded.featured_rank,
              updated_at = excluded.updated_at
            WHERE marketplace_skill_definitions.marketplace_id = excluded.marketplace_id
              AND (marketplace_skill_definitions.publisher_name IS NOT excluded.publisher_name
                OR marketplace_skill_definitions.name IS NOT excluded.name
                OR marketplace_skill_definitions.short_description IS NOT excluded.short_description
                OR marketplace_skill_definitions.long_description IS NOT excluded.long_description
                OR marketplace_skill_definitions.categories_json IS NOT excluded.categories_json
                OR marketplace_skill_definitions.featured_rank IS NOT excluded.featured_rank)`,
      params: [
        release.id,
        manifest.marketplaceId,
        manifest.publisher.namespace,
        next.publisherName,
        manifest.slug,
        next.name,
        next.shortDescription,
        next.longDescription,
        next.categoriesJson,
        next.featuredRank,
        now,
        now,
      ],
    },
    failBatchUnless(
      `SELECT 1 FROM marketplace_skill_definitions
       WHERE skill_definition_id = ? AND marketplace_id = ? AND name = ?
         AND categories_json = ? AND featured_rank IS ?`,
      [release.id, manifest.marketplaceId, next.name, next.categoriesJson, next.featuredRank],
    ),
  ];
};

const versionStatements = (release: MarketplaceSkillRelease, now: number): Array<D1Statement> => [
  {
    // The ordinal follows every earlier version of this Skill, so the newest one is current.
    sql: `INSERT INTO marketplace_skill_versions
            (skill_version_id, skill_definition_id, semantic_version, version_ordinal, skill_name,
             skill_description, instructions_markdown, files_json, file_count, byte_size,
             license_spdx, attribution, source_json, release_digest, status, published_at)
          SELECT ?, ?, ?,
                 COALESCE((SELECT MAX(version_ordinal) FROM marketplace_skill_versions
                           WHERE skill_definition_id = ?), 0) + 1,
                 ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'published', ?
          WHERE NOT EXISTS (
            SELECT 1 FROM marketplace_skill_versions WHERE skill_version_id = ?)`,
    params: [
      release.versionId,
      release.id,
      release.manifest.version,
      release.id,
      release.skillName,
      release.skillDescription,
      release.instructionsMarkdown,
      JSON.stringify(release.files),
      release.files.length,
      release.byteSize,
      release.manifest.license,
      release.manifest.attribution,
      canonicalSkillJson(release.manifest.source),
      release.releaseDigest,
      now,
      release.versionId,
    ],
  },
  failBatchUnless(
    `SELECT 1 FROM marketplace_skill_versions
     WHERE skill_version_id = ? AND release_digest = ? AND status = 'published'`,
    [release.versionId, release.releaseDigest],
  ),
];

export interface SkillPublicationOutcome {
  readonly id: string;
  readonly versionId: string;
  readonly step: SkillPublicationStep["kind"];
  readonly uploaded: number;
  readonly reused: number;
}

/**
 * Applies a plan: uploads and verifies every file of each new version, then writes that Skill's
 * rows in one guarded D1 transaction and reads them back. Blocked entries are never published.
 */
export const publishSkillPlan = async (input: {
  readonly database: D1BatchTransport;
  readonly store: SkillBundleStore;
  readonly plan: ReadonlyArray<SkillPublicationPlanEntry>;
  readonly now: () => number;
}): Promise<Result.Result<ReadonlyArray<SkillPublicationOutcome>, string>> => {
  if (input.plan.some((entry) => entry.step.kind === "blocked")) {
    return Result.fail("skill-publication-plan-blocked");
  }
  const outcomes: Array<SkillPublicationOutcome> = [];
  for (const { release, step } of input.plan) {
    let uploaded = 0;
    let reused = 0;
    if (step.kind === "publish-version") {
      for (const file of release.files) {
        const bytes = release.contents.get(file.sha256);
        if (bytes === undefined) return Result.fail("skill-file-bytes-missing");
        // oxlint-disable-next-line no-await-in-loop -- Sequential uploads keep failures attributable.
        const stored = await input.store.putVerified(file.sha256, bytes);
        if (Result.isFailure(stored)) return Result.fail(stored.failure);
        if (stored.success === "uploaded") uploaded += 1;
        else reused += 1;
      }
    }
    if (step.kind === "publish-version" || step.kind === "update-definition") {
      const now = input.now();
      const statements = [
        ...definitionStatements(release, now),
        ...(step.kind === "publish-version" ? versionStatements(release, now) : []),
      ];
      // oxlint-disable-next-line no-await-in-loop -- One transaction per Skill, applied in order.
      const written = await input.database.batch(statements);
      if (Result.isFailure(written)) return Result.fail(written.failure);
      // oxlint-disable-next-line no-await-in-loop -- Readback confirms this Skill before the next.
      const readback = await input.database.query({
        sql: `SELECT release_digest FROM marketplace_skill_versions
              WHERE skill_version_id = ? AND status = 'published'`,
        params: [release.versionId],
      });
      if (
        Result.isFailure(readback) ||
        readback.success[0]?.["release_digest"] !== release.releaseDigest
      ) {
        return Result.fail("skill-publication-readback-mismatch");
      }
    }
    outcomes.push({
      id: release.id,
      versionId: release.versionId,
      step: step.kind,
      uploaded,
      reused,
    });
  }

  return Result.succeed(outcomes);
};
