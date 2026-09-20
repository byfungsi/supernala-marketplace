import { promises as fs } from "node:fs";
import path from "node:path";
import { Result, Schema } from "effect";
import {
  deriveBootstrapAuthoritySnapshot,
  derivePluginAuthoritySnapshot,
  diffPluginAuthority,
  PluginAuthoritySnapshot,
} from "./authority-diff.js";
import { preparePluginPackage, validatePluginSource } from "./authoring-validation.js";
import { PackagedPluginAuthentication, parsePackagedPluginArchive } from "./package-archive.js";
import { PluginAuthStrategyDefinition } from "./plugin-auth-strategy.js";
import {
  canonicalPluginJson,
  digestPluginBytes,
  PluginSha256,
  PluginVersion,
} from "./plugin-contract.js";
import {
  digestReleaseInputs,
  PluginReleaseIdentity,
  type IncrementalReleaseCandidate,
  type ReleaseJournalRecord,
} from "./release-machine.js";

/** Protected-source approval for exact content plus its authoritative prior authority snapshot. */
export const ReleaseReview = Schema.Struct({
  schemaVersion: Schema.Literal(1),
  identity: PluginReleaseIdentity,
  reviewId: Schema.NonEmptyString,
  reviewer: Schema.NonEmptyString,
  reviewedAt: Schema.Int.pipe(Schema.check(Schema.isGreaterThanOrEqualTo(0))),
  sourceInputDigest: PluginSha256,
  artifactDigest: Schema.NullOr(PluginSha256),
  authentication: PackagedPluginAuthentication,
  authStrategy: Schema.optionalKey(PluginAuthStrategyDefinition),
  catalogDigest: PluginSha256,
  configDigest: PluginSha256,
  provenanceDigest: PluginSha256,
  authorityBeforeIdentity: Schema.NullOr(PluginReleaseIdentity),
  authorityBeforeReleaseDigest: Schema.NullOr(PluginSha256),
  authorityBefore: PluginAuthoritySnapshot,
  authorityBeforeDigest: PluginSha256,
  authorityAfter: PluginAuthoritySnapshot,
  authorityDigest: PluginSha256,
  authorityDiffDigest: PluginSha256,
  releaseDigest: PluginSha256,
  decision: Schema.Literal("approved"),
});
export interface ReleaseReview extends Schema.Schema.Type<typeof ReleaseReview> {}

const ReleaseOrdinal = Schema.Int.pipe(
  Schema.check(Schema.isGreaterThanOrEqualTo(0)),
  Schema.check(Schema.isLessThanOrEqualTo(Number.MAX_SAFE_INTEGER)),
);

const SerializedCandidate = Schema.Struct({
  schemaVersion: Schema.Literal(1),
  identity: PluginReleaseIdentity,
  definitionId: Schema.NonEmptyString,
  version: PluginVersion,
  authentication: PackagedPluginAuthentication,
  kind: Schema.Literal("managed-package"),
  sourceInputDigest: PluginSha256,
  releaseDigest: PluginSha256,
  catalogDigest: PluginSha256,
  configDigest: PluginSha256,
  provenance: Schema.Json,
  provenanceDigest: PluginSha256,
  authorityBaselineDigest: PluginSha256,
  authorityDigest: PluginSha256,
  authorityDiffDigest: PluginSha256,
  artifactDigest: PluginSha256,
  artifactRelativePath: Schema.NonEmptyString,
  artifactByteLength: Schema.Int.pipe(Schema.check(Schema.isGreaterThan(0))),
  mergeCommit: Schema.String.pipe(Schema.check(Schema.isPattern(/^[a-f0-9]{40}$/u))),
  releaseOrdinal: ReleaseOrdinal,
  reviewId: Schema.NonEmptyString,
  reviewer: Schema.NonEmptyString,
  reviewedAt: Schema.Int.pipe(Schema.check(Schema.isGreaterThanOrEqualTo(0))),
});

const encodePathSegment = (value: string): string => encodeURIComponent(value).replaceAll("%", "~");

export const pluginDefinitionId = (identity: PluginReleaseIdentity): string =>
  `${identity.marketplaceId}:${identity.publisherNamespace}:${identity.pluginSlug}`;

export const pluginVersionId = (identity: PluginReleaseIdentity): string =>
  `${pluginDefinitionId(identity)}@${identity.semanticVersion}`;

export const releaseIdentityFileStem = (identity: PluginReleaseIdentity): string =>
  [
    identity.marketplaceId,
    identity.publisherNamespace,
    identity.pluginSlug,
    identity.semanticVersion,
  ]
    .map(encodePathSegment)
    .join("__");

export const releaseReviewFile = (identity: PluginReleaseIdentity): string =>
  path.join("releases", "reviews", `${releaseIdentityFileStem(identity)}.json`);

export const releaseBundleDirectory = (root: string, identity: PluginReleaseIdentity): string =>
  path.join(root, releaseIdentityFileStem(identity));

/** Read only the claimed identity so callers can locate its protected review before full verification. */
export async function readReleaseBundleIdentity(
  bundleDirectory: string,
): Promise<Result.Result<PluginReleaseIdentity, string>> {
  try {
    const releaseFile = path.join(bundleDirectory, "release.json");
    if ((await fs.lstat(releaseFile)).isSymbolicLink())
      return Result.fail("release-bundle-link-rejected");
    const value = Schema.decodeUnknownSync(Schema.Struct({ identity: PluginReleaseIdentity }))(
      JSON.parse(await fs.readFile(releaseFile, "utf8")),
    );
    return Result.succeed(value.identity);
  } catch {
    return Result.fail("release-bundle-invalid");
  }
}

const collectFileDigests = async (
  root: string,
): Promise<ReadonlyArray<{ readonly path: string; readonly digest: string }>> => {
  const records: Array<{ readonly path: string; readonly digest: string }> = [];
  const visit = async (directory: string): Promise<void> => {
    for (const entry of (await fs.readdir(directory, { withFileTypes: true })).toSorted((a, b) =>
      a.name.localeCompare(b.name),
    )) {
      const absolute = path.join(directory, entry.name);
      if (entry.isSymbolicLink()) throw new Error("release-source-link-not-allowed");
      if (entry.isDirectory()) await visit(absolute);
      else if (entry.isFile()) {
        records.push({
          path: path.relative(root, absolute).split(path.sep).join("/"),
          digest: await digestPluginBytes(new Uint8Array(await fs.readFile(absolute))),
        });
      }
    }
  };
  await visit(root);
  return records;
};

export async function calculateManagedPackageSourceInputDigest(input: {
  readonly sourceDirectory: string;
  readonly sharedInputDigest: typeof PluginSha256.Type;
}): Promise<typeof PluginSha256.Type> {
  return digestReleaseInputs({
    pluginFiles: await collectFileDigests(path.resolve(input.sourceDirectory)),
    sharedInputDigest: input.sharedInputDigest,
  });
}

const digestJson = (value: Schema.Json): Promise<typeof PluginSha256.Type> =>
  digestPluginBytes(new TextEncoder().encode(canonicalPluginJson(value)));

export const calculateReleaseDigest = (input: {
  readonly identity: PluginReleaseIdentity;
  readonly version: PluginVersion;
  readonly authentication: typeof PackagedPluginAuthentication.Type;
  readonly sourceInputDigest: typeof PluginSha256.Type;
  readonly catalogDigest: typeof PluginSha256.Type;
  readonly configDigest: typeof PluginSha256.Type;
  readonly provenanceDigest: typeof PluginSha256.Type;
  readonly authorityBaselineDigest: typeof PluginSha256.Type;
  readonly authorityDigest: typeof PluginSha256.Type;
  readonly authorityDiffDigest: typeof PluginSha256.Type;
  readonly artifactDigest: typeof PluginSha256.Type | null;
}): Promise<typeof PluginSha256.Type> => digestJson(input);

export const calculateAuthorityBaselineDigest = (
  review: Pick<
    ReleaseReview,
    | "authorityBeforeIdentity"
    | "authorityBeforeReleaseDigest"
    | "authorityBefore"
    | "authorityBeforeDigest"
  >,
): Promise<typeof PluginSha256.Type> =>
  digestJson({
    identity: review.authorityBeforeIdentity,
    releaseDigest: review.authorityBeforeReleaseDigest,
    authority: review.authorityBefore,
    authorityDigest: review.authorityBeforeDigest,
  });

const reviewMatches = async (
  review: ReleaseReview,
  candidate: IncrementalReleaseCandidate,
): Promise<boolean> =>
  canonicalPluginJson(review.identity) === canonicalPluginJson(candidate.identity) &&
  review.reviewId === candidate.reviewId &&
  review.reviewer === candidate.reviewer &&
  review.reviewedAt === candidate.reviewedAt &&
  review.sourceInputDigest === candidate.sourceInputDigest &&
  review.artifactDigest === candidate.artifactDigest &&
  canonicalPluginJson(review.authentication) === canonicalPluginJson(candidate.authentication) &&
  review.catalogDigest === candidate.catalogDigest &&
  review.configDigest === candidate.configDigest &&
  review.provenanceDigest === candidate.provenanceDigest &&
  candidate.authorityBaselineDigest === (await calculateAuthorityBaselineDigest(review)) &&
  review.authorityDigest === candidate.authorityDigest &&
  review.authorityDiffDigest === candidate.authorityDiffDigest &&
  review.releaseDigest === candidate.releaseDigest;

export async function buildManagedPackageReleaseBundle(input: {
  readonly sourceDirectory: string;
  readonly outputDirectory: string;
  readonly sharedInputDigest: typeof PluginSha256.Type;
  readonly mergeCommit: string;
  readonly releaseOrdinal: number;
  readonly review: ReleaseReview;
  readonly previousPublished: ReleaseJournalRecord | null;
}): Promise<Result.Result<IncrementalReleaseCandidate, string>> {
  const source = await validatePluginSource(input.sourceDirectory);
  if (Result.isFailure(source)) return Result.fail(source.failure.message);
  const identity = PluginReleaseIdentity.make({
    marketplaceId: "supernala-public",
    publisherNamespace: source.success.manifest.publisher,
    pluginSlug: source.success.manifest.id,
    semanticVersion: source.success.manifest.version,
  });
  const prepared = await preparePluginPackage({
    source: source.success,
    marketplaceId: identity.marketplaceId,
    versionId: pluginVersionId(identity),
    publishedAt: input.review.reviewedAt,
  });
  if (Result.isFailure(prepared)) return Result.fail(prepared.failure.message);
  const sourceInputDigest = await calculateManagedPackageSourceInputDigest(input);
  const authorityAfter = derivePluginAuthoritySnapshot(source.success);
  const authorityDigest = await digestJson(authorityAfter);
  const authorityBeforeDigest = await digestJson(input.review.authorityBefore);
  if (authorityBeforeDigest !== input.review.authorityBeforeDigest) {
    return Result.fail("release-authority-before-digest-mismatch");
  }
  if (input.previousPublished === null) {
    if (
      input.review.authorityBeforeIdentity !== null ||
      input.review.authorityBeforeReleaseDigest !== null ||
      canonicalPluginJson(input.review.authorityBefore) !==
        canonicalPluginJson(deriveBootstrapAuthoritySnapshot(authorityAfter))
    ) {
      return Result.fail("release-bootstrap-authority-baseline-mismatch");
    }
  } else if (
    input.previousPublished.status !== "published" ||
    input.previousPublished.durableStateVerified !== true ||
    input.review.authorityBeforeIdentity === null ||
    canonicalPluginJson(input.review.authorityBeforeIdentity) !==
      canonicalPluginJson(input.previousPublished.identity) ||
    input.review.authorityBeforeReleaseDigest !== input.previousPublished.releaseDigest ||
    input.review.authorityBeforeDigest !== input.previousPublished.authorityDigest
  ) {
    return Result.fail("release-previous-authority-baseline-mismatch");
  }
  const authorityBaselineDigest = await calculateAuthorityBaselineDigest(input.review);
  const authorityDiff = await diffPluginAuthority(input.review.authorityBefore, authorityAfter);
  const provenance = prepared.success.parsed.provenance;
  const provenanceDigest = await digestJson(provenance);
  const artifactBytes = prepared.success.archiveBytes;
  const releaseDigest = await calculateReleaseDigest({
    identity,
    version: prepared.success.parsed.version,
    authentication: prepared.success.parsed.authentication,
    sourceInputDigest,
    catalogDigest: prepared.success.parsed.version.catalog.digest,
    configDigest: prepared.success.parsed.configDigest,
    provenanceDigest,
    authorityBaselineDigest,
    authorityDigest,
    authorityDiffDigest: authorityDiff.diffDigest as typeof PluginSha256.Type,
    artifactDigest: prepared.success.artifactDigest,
  });
  const candidate: IncrementalReleaseCandidate = {
    identity,
    definitionId: pluginDefinitionId(identity),
    version: prepared.success.parsed.version,
    authentication: prepared.success.parsed.authentication,
    ...(prepared.success.parsed.authStrategy === undefined
      ? {}
      : { authStrategy: prepared.success.parsed.authStrategy }),
    kind: "managed-package",
    sourceInputDigest,
    releaseDigest,
    catalogDigest: prepared.success.parsed.version.catalog.digest,
    configDigest: prepared.success.parsed.configDigest,
    provenance,
    provenanceDigest,
    authorityBaselineDigest,
    authorityDigest,
    authorityDiffDigest: authorityDiff.diffDigest as typeof PluginSha256.Type,
    artifactDigest: prepared.success.artifactDigest,
    artifactByteLength: artifactBytes.byteLength,
    artifactBytes,
    mergeCommit: input.mergeCommit,
    releaseOrdinal: input.releaseOrdinal,
    reviewId: input.review.reviewId,
    reviewer: input.review.reviewer,
    reviewedAt: input.review.reviewedAt,
  };
  if (
    canonicalPluginJson(input.review.authorityAfter) !== canonicalPluginJson(authorityAfter) ||
    !(await reviewMatches(input.review, candidate))
  ) {
    return Result.fail("release-review-binding-mismatch");
  }
  await fs.mkdir(input.outputDirectory, { recursive: true });
  const artifactName = `${releaseIdentityFileStem(identity)}.plugin`;
  await fs.writeFile(path.join(input.outputDirectory, artifactName), artifactBytes);
  await fs.writeFile(
    path.join(input.outputDirectory, "release.json"),
    `${JSON.stringify(
      SerializedCandidate.make({
        schemaVersion: 1,
        identity,
        definitionId: candidate.definitionId,
        version: candidate.version,
        authentication: candidate.authentication,
        ...(candidate.authStrategy === undefined ? {} : { authStrategy: candidate.authStrategy }),
        kind: "managed-package",
        sourceInputDigest,
        releaseDigest,
        catalogDigest: candidate.catalogDigest,
        configDigest: candidate.configDigest,
        provenance,
        provenanceDigest,
        authorityBaselineDigest,
        authorityDigest,
        authorityDiffDigest: candidate.authorityDiffDigest,
        artifactDigest: prepared.success.artifactDigest,
        artifactRelativePath: artifactName,
        artifactByteLength: artifactBytes.byteLength,
        mergeCommit: candidate.mergeCommit,
        releaseOrdinal: candidate.releaseOrdinal,
        reviewId: candidate.reviewId,
        reviewer: candidate.reviewer,
        reviewedAt: candidate.reviewedAt,
      }),
      null,
      2,
    )}\n`,
  );
  return Result.succeed(candidate);
}

/** Re-derive every trusted field from archive bytes, protected source and protected review. */
export async function loadManagedPackageReleaseBundle(input: {
  readonly bundleDirectory: string;
  readonly sourceDirectory: string;
  readonly sharedInputDigest: typeof PluginSha256.Type;
  readonly trustedReview: ReleaseReview;
  readonly expectedMergeCommit: string;
  readonly expectedReleaseOrdinal: number;
}): Promise<Result.Result<IncrementalReleaseCandidate, string>> {
  let serialized: typeof SerializedCandidate.Type;
  try {
    const releaseFile = path.join(input.bundleDirectory, "release.json");
    if ((await fs.lstat(releaseFile)).isSymbolicLink())
      return Result.fail("release-bundle-link-rejected");
    serialized = Schema.decodeUnknownSync(SerializedCandidate, {
      onExcessProperty: "error",
    })(JSON.parse(await fs.readFile(releaseFile, "utf8")));
  } catch {
    return Result.fail("release-bundle-invalid");
  }
  if (
    serialized.mergeCommit !== input.expectedMergeCommit ||
    serialized.releaseOrdinal !== input.expectedReleaseOrdinal ||
    canonicalPluginJson(serialized.identity) !==
      canonicalPluginJson(input.trustedReview.identity) ||
    serialized.definitionId !== pluginDefinitionId(input.trustedReview.identity) ||
    serialized.version.id !== pluginVersionId(input.trustedReview.identity) ||
    serialized.version.marketplaceId !== input.trustedReview.identity.marketplaceId ||
    serialized.version.publisherNamespace !== input.trustedReview.identity.publisherNamespace ||
    serialized.version.pluginSlug !== input.trustedReview.identity.pluginSlug ||
    serialized.version.version !== input.trustedReview.identity.semanticVersion
  ) {
    return Result.fail("release-attempt-binding-mismatch");
  }
  if (
    path.isAbsolute(serialized.artifactRelativePath) ||
    serialized.artifactRelativePath.split(/[\\/]/u).includes("..")
  ) {
    return Result.fail("release-artifact-path-invalid");
  }
  if (
    serialized.artifactRelativePath !== `${releaseIdentityFileStem(serialized.identity)}.plugin`
  ) {
    return Result.fail("release-artifact-name-mismatch");
  }
  const artifactPath = path.resolve(input.bundleDirectory, serialized.artifactRelativePath);
  if (!artifactPath.startsWith(`${path.resolve(input.bundleDirectory)}${path.sep}`)) {
    return Result.fail("release-artifact-path-invalid");
  }
  let artifactBytes: Uint8Array;
  try {
    if ((await fs.lstat(artifactPath)).isSymbolicLink())
      return Result.fail("release-bundle-link-rejected");
    artifactBytes = new Uint8Array(await fs.readFile(artifactPath));
  } catch {
    return Result.fail("release-artifact-unavailable");
  }
  const artifactDigest = await digestPluginBytes(artifactBytes);
  if (
    artifactBytes.byteLength !== serialized.artifactByteLength ||
    artifactDigest !== serialized.artifactDigest ||
    artifactDigest !== input.trustedReview.artifactDigest
  ) {
    return Result.fail("release-artifact-readback-mismatch");
  }
  const parsed = await parsePackagedPluginArchive({
    archiveBytes: artifactBytes,
    marketplaceId: input.trustedReview.identity.marketplaceId,
    versionId: pluginVersionId(input.trustedReview.identity),
    publishedAt: input.trustedReview.reviewedAt,
  });
  if (Result.isFailure(parsed)) return Result.fail("release-archive-invalid");
  const source = await validatePluginSource(input.sourceDirectory);
  if (Result.isFailure(source)) return Result.fail("release-source-invalid");
  const sourceInputDigest = await calculateManagedPackageSourceInputDigest(input);
  const authorityAfter = derivePluginAuthoritySnapshot({
    manifest: parsed.success.manifest,
    catalog: {
      id: parsed.success.version.catalog.id,
      schemaVersion: parsed.success.version.catalog.schemaVersion,
      tools: parsed.success.version.catalog.tools,
    },
    config: parsed.success.version.config,
  });
  const authorityDigest = await digestJson(authorityAfter);
  const authorityBeforeDigest = await digestJson(input.trustedReview.authorityBefore);
  if (authorityBeforeDigest !== input.trustedReview.authorityBeforeDigest) {
    return Result.fail("release-authority-before-digest-mismatch");
  }
  if (input.trustedReview.authorityBeforeIdentity === null) {
    if (
      input.trustedReview.authorityBeforeReleaseDigest !== null ||
      canonicalPluginJson(input.trustedReview.authorityBefore) !==
        canonicalPluginJson(deriveBootstrapAuthoritySnapshot(authorityAfter))
    ) {
      return Result.fail("release-bootstrap-authority-baseline-mismatch");
    }
  } else if (input.trustedReview.authorityBeforeReleaseDigest === null) {
    return Result.fail("release-previous-authority-baseline-mismatch");
  }
  const authorityBaselineDigest = await calculateAuthorityBaselineDigest(input.trustedReview);
  const authorityDiff = await diffPluginAuthority(
    input.trustedReview.authorityBefore,
    authorityAfter,
  );
  const provenanceDigest = await digestJson(parsed.success.provenance);
  const releaseDigest = await calculateReleaseDigest({
    identity: input.trustedReview.identity,
    version: parsed.success.version,
    authentication: parsed.success.authentication,
    sourceInputDigest,
    catalogDigest: parsed.success.version.catalog.digest,
    configDigest: parsed.success.configDigest,
    provenanceDigest,
    authorityBaselineDigest,
    authorityDigest,
    authorityDiffDigest: authorityDiff.diffDigest as typeof PluginSha256.Type,
    artifactDigest,
  });
  const candidate: IncrementalReleaseCandidate = {
    identity: input.trustedReview.identity,
    definitionId: pluginDefinitionId(input.trustedReview.identity),
    version: parsed.success.version,
    authentication: parsed.success.authentication,
    ...(parsed.success.authStrategy === undefined
      ? {}
      : { authStrategy: parsed.success.authStrategy }),
    kind: "managed-package",
    sourceInputDigest,
    releaseDigest,
    catalogDigest: parsed.success.version.catalog.digest,
    configDigest: parsed.success.configDigest,
    provenance: parsed.success.provenance,
    provenanceDigest,
    authorityBaselineDigest,
    authorityDigest,
    authorityDiffDigest: authorityDiff.diffDigest as typeof PluginSha256.Type,
    artifactDigest,
    artifactByteLength: artifactBytes.byteLength,
    artifactBytes,
    mergeCommit: serialized.mergeCommit,
    releaseOrdinal: serialized.releaseOrdinal,
    reviewId: input.trustedReview.reviewId,
    reviewer: input.trustedReview.reviewer,
    reviewedAt: input.trustedReview.reviewedAt,
  };
  if (
    canonicalPluginJson(serialized.version) !== canonicalPluginJson(parsed.success.version) ||
    canonicalPluginJson(serialized.provenance) !== canonicalPluginJson(parsed.success.provenance) ||
    canonicalPluginJson(serialized) !==
      canonicalPluginJson({
        schemaVersion: 1,
        identity: candidate.identity,
        definitionId: candidate.definitionId,
        version: candidate.version,
        authentication: candidate.authentication,
        ...(candidate.authStrategy === undefined ? {} : { authStrategy: candidate.authStrategy }),
        kind: candidate.kind,
        sourceInputDigest: candidate.sourceInputDigest,
        releaseDigest: candidate.releaseDigest,
        catalogDigest: candidate.catalogDigest,
        configDigest: candidate.configDigest,
        provenance: candidate.provenance,
        provenanceDigest: candidate.provenanceDigest,
        authorityBaselineDigest: candidate.authorityBaselineDigest,
        authorityDigest: candidate.authorityDigest,
        authorityDiffDigest: candidate.authorityDiffDigest,
        artifactDigest: candidate.artifactDigest,
        artifactRelativePath: serialized.artifactRelativePath,
        artifactByteLength: artifactBytes.byteLength,
        mergeCommit: candidate.mergeCommit,
        releaseOrdinal: candidate.releaseOrdinal,
        reviewId: candidate.reviewId,
        reviewer: candidate.reviewer,
        reviewedAt: candidate.reviewedAt,
      }) ||
    canonicalPluginJson(input.trustedReview.authorityAfter) !==
      canonicalPluginJson(authorityAfter) ||
    !(await reviewMatches(input.trustedReview, candidate))
  ) {
    return Result.fail("release-bundle-contract-mismatch");
  }
  return Result.succeed(candidate);
}
