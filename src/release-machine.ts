import { Result, Schema } from "effect";
import {
  canonicalPluginJson,
  digestPluginBytes,
  PluginSha256,
  PluginVersion,
} from "./plugin-contract.js";
import {
  PackagedPluginAuthentication,
  type PackagedPluginAuthentication as PackagedPluginAuthenticationType,
} from "./package-archive.js";

/** Stable per-Plugin version identity. Byte deduplication never replaces this trust identity. */
export const PluginReleaseIdentity = Schema.Struct({
  marketplaceId: Schema.NonEmptyString,
  publisherNamespace: Schema.NonEmptyString,
  pluginSlug: Schema.NonEmptyString,
  semanticVersion: Schema.NonEmptyString,
});
export interface PluginReleaseIdentity extends Schema.Schema.Type<typeof PluginReleaseIdentity> {}

export type ReleaseKind = "managed-package" | "managed-remote-mcp";

/** Fully validated immutable candidate produced by the credential-free build job. */
export interface IncrementalReleaseCandidate {
  readonly identity: PluginReleaseIdentity;
  readonly definitionId: string;
  readonly version: PluginVersion;
  readonly authentication: PackagedPluginAuthenticationType;
  readonly kind: ReleaseKind;
  readonly sourceInputDigest: typeof PluginSha256.Type;
  readonly releaseDigest: typeof PluginSha256.Type;
  readonly catalogDigest: typeof PluginSha256.Type;
  readonly configDigest: typeof PluginSha256.Type;
  readonly provenance: Schema.Json;
  readonly provenanceDigest: typeof PluginSha256.Type;
  readonly authorityDigest: typeof PluginSha256.Type;
  readonly authorityBaselineDigest: typeof PluginSha256.Type;
  readonly authorityDiffDigest: typeof PluginSha256.Type;
  readonly artifactDigest: typeof PluginSha256.Type | null;
  readonly artifactByteLength: number | null;
  readonly artifactBytes: Uint8Array | null;
  readonly mergeCommit: string;
  readonly reviewId: string;
  readonly reviewer: string;
  readonly reviewedAt: number;
  readonly releaseOrdinal: number;
}

export type ReleaseJournalStatus = "claimed" | "artifact-verified" | "published" | "failed";

export const ReleaseJournalRecordSchema = Schema.Struct({
  identity: PluginReleaseIdentity,
  definitionId: Schema.NonEmptyString,
  version: PluginVersion,
  authentication: PackagedPluginAuthentication,
  kind: Schema.Literals(["managed-package", "managed-remote-mcp"]),
  sourceInputDigest: PluginSha256,
  releaseDigest: PluginSha256,
  catalogDigest: PluginSha256,
  configDigest: PluginSha256,
  provenance: Schema.Json,
  provenanceDigest: PluginSha256,
  authorityDigest: PluginSha256,
  authorityBaselineDigest: PluginSha256,
  authorityDiffDigest: PluginSha256,
  artifactDigest: Schema.NullOr(PluginSha256),
  artifactByteLength: Schema.NullOr(
    Schema.Int.pipe(Schema.check(Schema.isGreaterThanOrEqualTo(1))),
  ),
  mergeCommit: Schema.String.pipe(Schema.check(Schema.isPattern(/^[a-f0-9]{40}$/u))),
  releaseOrdinal: Schema.Int.pipe(
    Schema.check(Schema.isGreaterThanOrEqualTo(0)),
    Schema.check(Schema.isLessThanOrEqualTo(Number.MAX_SAFE_INTEGER)),
  ),
  reviewId: Schema.NonEmptyString,
  reviewer: Schema.NonEmptyString,
  reviewedAt: Schema.Int.pipe(Schema.check(Schema.isGreaterThanOrEqualTo(0))),
  status: Schema.Literals(["claimed", "artifact-verified", "published", "failed"]),
  attempts: Schema.Int.pipe(Schema.check(Schema.isGreaterThanOrEqualTo(1))),
  failureType: Schema.NullOr(Schema.String),
  generation: Schema.Int.pipe(Schema.check(Schema.isGreaterThanOrEqualTo(1))),
  durableStateVerified: Schema.optionalKey(Schema.Literal(true)),
  durableStateRevoked: Schema.optionalKey(Schema.Literal(true)),
});

/** Durable, authoritative release journal row. A checked-in snapshot is never substituted for this row. */
export interface ReleaseJournalRecord extends Omit<IncrementalReleaseCandidate, "artifactBytes"> {
  readonly status: ReleaseJournalStatus;
  readonly attempts: number;
  readonly failureType: string | null;
  readonly generation: number;
  readonly durableStateVerified?: true;
  readonly durableStateRevoked?: true;
}

export const pluginReleaseIdentityKey = (identity: PluginReleaseIdentity): string =>
  `${identity.marketplaceId}/${identity.publisherNamespace}/${identity.pluginSlug}@${identity.semanticVersion}`;

const pluginKey = (identity: PluginReleaseIdentity): string =>
  `${identity.marketplaceId}/${identity.publisherNamespace}/${identity.pluginSlug}`;

/** Cross-field invariant for durable identity, definition, and immutable version descriptors. */
export const releaseRecordIdentityIsCoherent = (
  record: Pick<IncrementalReleaseCandidate, "identity" | "definitionId" | "version">,
): boolean =>
  record.definitionId ===
    `${record.identity.marketplaceId}:${record.identity.publisherNamespace}:${record.identity.pluginSlug}` &&
  record.version.id === `${record.definitionId}@${record.identity.semanticVersion}` &&
  record.version.marketplaceId === record.identity.marketplaceId &&
  record.version.publisherNamespace === record.identity.publisherNamespace &&
  record.version.pluginSlug === record.identity.pluginSlug &&
  record.version.version === record.identity.semanticVersion;

const compareSemanticVersions = (left: string, right: string): number => {
  const parse = (value: string): readonly [number, number, number, string] => {
    const match = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z.-]+))?$/u.exec(value);
    if (match === null) throw new Error("release-semantic-version-invalid");
    return [Number(match[1]), Number(match[2]), Number(match[3]), match[4] ?? ""];
  };
  const a = parse(left);
  const b = parse(right);
  for (const index of [0, 1, 2] as const) {
    const difference = a[index] - b[index];
    if (difference !== 0) return difference;
  }
  if (a[3] === b[3]) return 0;
  if (a[3] === "") return 1;
  if (b[3] === "") return -1;
  return a[3].localeCompare(b[3]);
};

const immutableReleaseFieldsMatch = (
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
  record.authorityDigest === candidate.authorityDigest &&
  record.authorityBaselineDigest === candidate.authorityBaselineDigest &&
  record.authorityDiffDigest === candidate.authorityDiffDigest &&
  record.artifactDigest === candidate.artifactDigest &&
  record.artifactByteLength === candidate.artifactByteLength &&
  record.kind === candidate.kind &&
  record.reviewId === candidate.reviewId &&
  record.reviewer === candidate.reviewer &&
  record.reviewedAt === candidate.reviewedAt;

export interface ReleaseJournal {
  readonly claim: (
    candidate: IncrementalReleaseCandidate,
  ) => Promise<
    Result.Result<
      { readonly record: ReleaseJournalRecord; readonly alreadyPublished: boolean },
      string
    >
  >;
  readonly markArtifactVerified: (key: string, generation: number) => Promise<void>;
  readonly markPublished: (key: string, generation: number) => Promise<void>;
  readonly markFailed: (key: string, generation: number, failureType: string) => Promise<void>;
  readonly list: () => Promise<ReadonlyArray<ReleaseJournalRecord>>;
}

export interface ImmutableArtifactStore {
  readonly ensureVerified: (
    digest: typeof PluginSha256.Type,
    bytes: Uint8Array,
  ) => Promise<Result.Result<"reused" | "uploaded", string>>;
}

/** Read-only complete-byte verification used before trusting a published baseline row. */
export interface ImmutableArtifactReader {
  readonly verifyExisting: (
    digest: typeof PluginSha256.Type,
    expectedByteLength: number,
  ) => Promise<Result.Result<boolean, string>>;
}

export interface ApplicationPublicationAdapter {
  readonly stage: (candidate: IncrementalReleaseCandidate) => Promise<Result.Result<void, string>>;
  readonly finalize: (
    candidate: IncrementalReleaseCandidate,
  ) => Promise<Result.Result<void, string>>;
  readonly readPublished: (
    candidate: IncrementalReleaseCandidate,
  ) => Promise<Result.Result<boolean, string>>;
}

/** Read-only application-state verification used by authoritative baseline export. */
export interface ApplicationPublicationReader {
  readonly readPublicationState: (
    candidate: IncrementalReleaseCandidate,
  ) => Promise<Result.Result<"published" | "revoked" | "mismatch", string>>;
}

export interface ApplicationAuthorityLineageReader extends ApplicationPublicationReader {
  readonly listAuthorityVersionStates: (identity: PluginReleaseIdentity) => Promise<
    Result.Result<
      ReadonlyArray<{
        readonly versionId: string;
        readonly status: "published" | "revoked";
      }>,
      string
    >
  >;
}

/** Reconcile one release through durable claim, immutable upload, application finalization and readback. */
export async function publishIncrementalRelease(input: {
  readonly candidate: IncrementalReleaseCandidate;
  readonly journal: ReleaseJournal;
  readonly artifacts: ImmutableArtifactStore;
  readonly application: ApplicationPublicationAdapter;
  readonly dryRun?: boolean;
}): Promise<Result.Result<{ readonly status: "published" | "unchanged" | "dry-run" }, string>> {
  if (input.dryRun === true) return Result.succeed({ status: "dry-run" });
  const claim = await input.journal.claim(input.candidate);
  if (Result.isFailure(claim)) return Result.fail(claim.failure);
  const key = pluginReleaseIdentityKey(input.candidate.identity);
  const generation = claim.success.record.generation;
  if (claim.success.alreadyPublished) {
    const published = await input.application.readPublished(input.candidate);
    if (Result.isSuccess(published) && published.success) {
      if (input.candidate.kind === "managed-package") {
        if (input.candidate.artifactBytes === null || input.candidate.artifactDigest === null) {
          return Result.fail("package-artifact-missing");
        }
        const artifact = await input.artifacts.ensureVerified(
          input.candidate.artifactDigest,
          input.candidate.artifactBytes,
        );
        if (Result.isFailure(artifact)) return Result.fail(artifact.failure);
      }
      return Result.succeed({ status: "unchanged" });
    }
  }
  const stage = await input.application.stage(input.candidate);
  if (Result.isFailure(stage)) {
    await input.journal.markFailed(key, generation, stage.failure);
    return Result.fail(stage.failure);
  }
  if (input.candidate.kind === "managed-package") {
    if (input.candidate.artifactBytes === null || input.candidate.artifactDigest === null) {
      await input.journal.markFailed(key, generation, "package-artifact-missing");
      return Result.fail("package-artifact-missing");
    }
    const artifact = await input.artifacts.ensureVerified(
      input.candidate.artifactDigest,
      input.candidate.artifactBytes,
    );
    if (Result.isFailure(artifact)) {
      await input.journal.markFailed(key, generation, artifact.failure);
      return Result.fail(artifact.failure);
    }
    await input.journal.markArtifactVerified(key, generation);
  }
  const finalized = await input.application.finalize(input.candidate);
  if (Result.isFailure(finalized)) {
    await input.journal.markFailed(key, generation, finalized.failure);
    return Result.fail(finalized.failure);
  }
  const readback = await input.application.readPublished(input.candidate);
  if (Result.isFailure(readback) || !readback.success) {
    await input.journal.markFailed(key, generation, "publication-readback-mismatch");
    return Result.fail("publication-readback-mismatch");
  }
  await input.journal.markPublished(key, generation);
  return Result.succeed({ status: "published" });
}

/** Inputs used by the selector before expensive package builds happen. */
export interface ReleaseSourceState {
  readonly identity: PluginReleaseIdentity;
  readonly kind: ReleaseKind;
  readonly sourceInputDigest: typeof PluginSha256.Type;
  readonly publicationEligible: boolean;
}

/** Select from the last successful durable state, never merely from the previous Git commit. */
export function selectIncrementalReleaseSources(input: {
  readonly sources: ReadonlyArray<ReleaseSourceState>;
  readonly journal: ReadonlyArray<ReleaseJournalRecord>;
}): Result.Result<ReadonlyArray<ReleaseSourceState>, string> {
  if (input.journal.some((record) => !releaseRecordIdentityIsCoherent(record))) {
    return Result.fail("release-baseline-identity-incoherent");
  }
  const selected: Array<ReleaseSourceState> = [];
  for (const source of input.sources) {
    if (!source.publicationEligible) continue;
    const exact = input.journal.find(
      (record) =>
        pluginReleaseIdentityKey(record.identity) === pluginReleaseIdentityKey(source.identity),
    );
    if (exact !== undefined) {
      if (exact.sourceInputDigest !== source.sourceInputDigest) {
        return Result.fail(
          `immutable-version-input-conflict:${pluginReleaseIdentityKey(source.identity)}`,
        );
      }
      if (exact.status === "published") {
        if (exact.durableStateVerified === true) continue;
        if (exact.durableStateRevoked === true) {
          return Result.fail(
            `published-version-revoked:${pluginReleaseIdentityKey(source.identity)}`,
          );
        }
        return Result.fail(
          `published-state-reverification-required:${pluginReleaseIdentityKey(source.identity)}`,
        );
      }
      selected.push(source);
      continue;
    }
    const latest = input.journal
      .filter(
        (record) =>
          pluginKey(record.identity) === pluginKey(source.identity) &&
          record.status === "published",
      )
      .toSorted((left, right) =>
        compareSemanticVersions(right.identity.semanticVersion, left.identity.semanticVersion),
      )[0];
    if (
      latest !== undefined &&
      compareSemanticVersions(source.identity.semanticVersion, latest.identity.semanticVersion) <= 0
    ) {
      return Result.fail(`stale-semantic-version:${pluginReleaseIdentityKey(source.identity)}`);
    }
    if (latest === undefined || latest.sourceInputDigest !== source.sourceInputDigest)
      selected.push(source);
  }
  return Result.succeed(selected);
}

/** Digest declared Plugin inputs plus shared contract/toolchain/lock inputs. */
export async function digestReleaseInputs(input: {
  readonly pluginFiles: ReadonlyArray<{ readonly path: string; readonly digest: string }>;
  readonly sharedInputDigest: string;
}): Promise<typeof PluginSha256.Type> {
  return digestPluginBytes(
    new TextEncoder().encode(
      canonicalPluginJson({
        pluginFiles: input.pluginFiles.toSorted((left, right) =>
          left.path.localeCompare(right.path),
        ),
        sharedInputDigest: input.sharedInputDigest,
      }),
    ),
  );
}

/** Controlled atomic journal used only for lifecycle and concurrency tests. */
export class InMemoryReleaseJournal implements ReleaseJournal {
  readonly #records = new Map<string, ReleaseJournalRecord>();
  #queue: Promise<void> = Promise.resolve();

  constructor(initial: ReadonlyArray<ReleaseJournalRecord> = []) {
    for (const record of initial)
      this.#records.set(pluginReleaseIdentityKey(record.identity), record);
  }

  async #exclusive<A>(operation: () => A): Promise<A> {
    const previous = this.#queue;
    let release = (): void => undefined;
    this.#queue = new Promise<void>((resolve) => {
      release = resolve;
    });
    await previous;
    try {
      return operation();
    } finally {
      release();
    }
  }

  claim(candidate: IncrementalReleaseCandidate) {
    return this.#exclusive(() => {
      const key = pluginReleaseIdentityKey(candidate.identity);
      const existing = this.#records.get(key);
      if (existing !== undefined) {
        if (!immutableReleaseFieldsMatch(existing, candidate)) {
          return Result.fail("immutable-version-conflict");
        }
        const resumed = { ...existing, attempts: existing.attempts + 1, failureType: null };
        this.#records.set(key, resumed);
        return Result.succeed({
          record: resumed,
          alreadyPublished: existing.status === "published",
        });
      }
      const latest = [...this.#records.values()]
        .filter(
          (record) =>
            pluginKey(record.identity) === pluginKey(candidate.identity) &&
            record.status === "published",
        )
        .toSorted((left, right) =>
          compareSemanticVersions(right.identity.semanticVersion, left.identity.semanticVersion),
        )[0];
      if (
        latest !== undefined &&
        compareSemanticVersions(
          candidate.identity.semanticVersion,
          latest.identity.semanticVersion,
        ) <= 0
      ) {
        return Result.fail("stale-release-conflict");
      }
      const { artifactBytes: _artifactBytes, ...durableCandidate } = candidate;
      const record: ReleaseJournalRecord = {
        ...durableCandidate,
        status: "claimed",
        attempts: 1,
        failureType: null,
        generation: 1,
      };
      this.#records.set(key, record);
      return Result.succeed({ record, alreadyPublished: false });
    });
  }

  markArtifactVerified(key: string, generation: number): Promise<void> {
    return this.#update(key, generation, "artifact-verified", null);
  }
  markPublished(key: string, generation: number): Promise<void> {
    return this.#update(key, generation, "published", null);
  }
  markFailed(key: string, generation: number, failureType: string): Promise<void> {
    return this.#update(key, generation, "failed", failureType);
  }
  #update(
    key: string,
    generation: number,
    status: ReleaseJournalStatus,
    failureType: string | null,
  ): Promise<void> {
    return this.#exclusive(() => {
      const existing = this.#records.get(key);
      if (existing === undefined || existing.generation !== generation) return;
      if (existing.status === "published" && status !== "published") return;
      this.#records.set(key, { ...existing, status, failureType });
    });
  }
  async list(): Promise<ReadonlyArray<ReleaseJournalRecord>> {
    return [...this.#records.values()];
  }
}

/** Controlled verified content-addressed object store with observable PUT count. */
export class InMemoryImmutableArtifactStore implements ImmutableArtifactStore {
  readonly #objects = new Map<string, Uint8Array>();
  putCount = 0;
  failNextUpload = false;
  failNextReadback = false;

  async ensureVerified(
    digest: typeof PluginSha256.Type,
    bytes: Uint8Array,
  ): Promise<Result.Result<"reused" | "uploaded", string>> {
    const actual = await digestPluginBytes(bytes);
    if (actual !== digest) return Result.fail("artifact-input-digest-mismatch");
    const existing = this.#objects.get(digest);
    if (existing === undefined) {
      if (this.failNextUpload) {
        this.failNextUpload = false;
        return Result.fail("artifact-upload-failed");
      }
      this.#objects.set(digest, Uint8Array.from(bytes));
      this.putCount += 1;
    }
    if (this.failNextReadback) {
      this.failNextReadback = false;
      return Result.fail("artifact-readback-failed");
    }
    const stored = this.#objects.get(digest);
    if (stored === undefined || (await digestPluginBytes(stored)) !== digest) {
      return Result.fail("artifact-readback-mismatch");
    }
    return Result.succeed(existing === undefined ? ("uploaded" as const) : ("reused" as const));
  }
}

/** Controlled application adapter; models idempotent exact-identity publication, not D1/R2 parity. */
export class InMemoryApplicationPublicationAdapter implements ApplicationPublicationAdapter {
  readonly #staged = new Map<string, IncrementalReleaseCandidate>();
  readonly #published = new Map<string, IncrementalReleaseCandidate>();
  finalizeCount = 0;
  failNextStage = false;
  failNextFinalize = false;

  async stage(candidate: IncrementalReleaseCandidate) {
    if (this.failNextStage) {
      this.failNextStage = false;
      return Result.fail("application-stage-failed");
    }
    const key = pluginReleaseIdentityKey(candidate.identity);
    const published = this.#published.get(key);
    const staged = this.#staged.get(key);
    if (
      (published !== undefined && published.releaseDigest !== candidate.releaseDigest) ||
      (staged !== undefined && staged.releaseDigest !== candidate.releaseDigest)
    ) {
      return Result.fail("application-identity-conflict");
    }
    this.#staged.set(key, candidate);
    return Result.succeed(undefined);
  }
  async finalize(candidate: IncrementalReleaseCandidate) {
    if (this.failNextFinalize) {
      this.failNextFinalize = false;
      return Result.fail("application-finalize-failed");
    }
    const key = pluginReleaseIdentityKey(candidate.identity);
    const published = this.#published.get(key);
    if (published !== undefined) {
      return published.releaseDigest === candidate.releaseDigest
        ? Result.succeed(undefined)
        : Result.fail("application-identity-conflict");
    }
    if (this.#staged.get(key)?.releaseDigest !== candidate.releaseDigest) {
      return Result.fail("application-intent-missing");
    }
    this.#published.set(key, candidate);
    this.finalizeCount += 1;
    return Result.succeed(undefined);
  }
  async readPublished(candidate: IncrementalReleaseCandidate) {
    return Result.succeed(
      this.#published.get(pluginReleaseIdentityKey(candidate.identity))?.releaseDigest ===
        candidate.releaseDigest,
    );
  }
}
