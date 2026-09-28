import { promises as fs } from "node:fs";
import path from "node:path";
import { Result, Schema } from "effect";
import {
  deriveBootstrapAuthoritySnapshot,
  derivePluginOpenApiAuthoritySnapshot,
  diffPluginAuthority,
} from "./authority-diff.js";
import { PackagedPluginAuthentication } from "./package-archive.js";
import {
  canonicalPluginJson,
  digestPluginBytes,
  PluginSha256,
  PluginVersion,
} from "./plugin-contract.js";
import { loadPluginOpenApiSource } from "./plugin-openapi-source.js";
import {
  calculateAuthorityBaselineDigest,
  calculateReleaseDigest,
  pluginDefinitionId,
  type ReleaseReview,
} from "./release-bundle.js";
import {
  digestReleaseInputs,
  PluginReleaseIdentity,
  type IncrementalReleaseCandidate,
} from "./release-machine.js";

const SerializedOpenApiCandidate = Schema.Struct({
  schemaVersion: Schema.Literal(1),
  identity: PluginReleaseIdentity,
  definitionId: Schema.NonEmptyString,
  version: PluginVersion,
  authentication: PackagedPluginAuthentication,
  authStrategy: Schema.JsonObject,
  kind: Schema.Literal("managed-openapi"),
  sourceInputDigest: PluginSha256,
  releaseDigest: PluginSha256,
  catalogDigest: PluginSha256,
  configDigest: PluginSha256,
  provenance: Schema.JsonObject,
  provenanceDigest: PluginSha256,
  authorityBaselineDigest: PluginSha256,
  authorityDigest: PluginSha256,
  authorityDiffDigest: PluginSha256,
  artifactDigest: PluginSha256,
  artifactByteLength: Schema.Int,
  artifactRelativePath: Schema.Literal("openapi-bundle.json"),
  mergeCommit: Schema.String,
  releaseOrdinal: Schema.Int,
  reviewId: Schema.NonEmptyString,
  reviewer: Schema.NonEmptyString,
  reviewedAt: Schema.Int,
});
const digestJson = (value: Schema.Json) =>
  digestPluginBytes(new TextEncoder().encode(canonicalPluginJson(value)));

/** Digests the exact local OpenAPI spec, selection, and shared release inputs. */
export async function calculatePluginOpenApiSourceInputDigest(input: {
  readonly sourceDirectory: string;
  readonly sharedInputDigest: typeof PluginSha256.Type;
}) {
  const loaded = await loadPluginOpenApiSource(input.sourceDirectory);
  if (Result.isFailure(loaded)) throw new Error(loaded.failure);
  const pin = loaded.success.source.hostedSource;
  return digestReleaseInputs({
    sharedInputDigest: input.sharedInputDigest,
    pluginFiles: await Promise.all(
      [
        "openapi-source.json",
        pin === undefined ? "openapi.json" : `openapi-${pin.sha256}.json`,
      ].map(async (file) => ({
        path: file,
        digest: await digestPluginBytes(
          new Uint8Array(await fs.readFile(path.join(input.sourceDirectory, file))),
        ),
      })),
    ),
  });
}

/** Builds a review-bound immutable OpenAPI release through the existing release vocabulary. */
export async function buildPluginOpenApiReleaseBundle(input: {
  readonly sourceDirectory: string;
  readonly outputDirectory: string;
  readonly sharedInputDigest: typeof PluginSha256.Type;
  readonly mergeCommit: string;
  readonly releaseOrdinal: number;
  readonly review: ReleaseReview;
  readonly previousPublished: {
    readonly status: "published";
    readonly durableStateVerified: true;
    readonly identity: PluginReleaseIdentity;
    readonly releaseDigest: typeof PluginSha256.Type;
    readonly authorityDigest: typeof PluginSha256.Type;
  } | null;
}): Promise<Result.Result<IncrementalReleaseCandidate, string>> {
  const loaded = await loadPluginOpenApiSource(input.sourceDirectory);
  if (Result.isFailure(loaded)) return Result.fail(loaded.failure);
  const { source, compiled } = loaded.success;
  if (source.status !== "reviewed-publishable") return Result.fail("openapi-source-not-reviewed");
  const identity = PluginReleaseIdentity.make({
    marketplaceId: source.marketplaceId,
    publisherNamespace: source.publisherNamespace,
    pluginSlug: source.pluginSlug,
    semanticVersion: source.version,
  });
  const sourceInputDigest = await calculatePluginOpenApiSourceInputDigest(input);
  const authorityAfter = derivePluginOpenApiAuthoritySnapshot(compiled.contract);
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
    canonicalPluginJson(input.review.authorityBeforeIdentity) !==
      canonicalPluginJson(input.previousPublished.identity) ||
    input.review.authorityBeforeReleaseDigest !== input.previousPublished.releaseDigest ||
    input.review.authorityBeforeDigest !== input.previousPublished.authorityDigest
  ) {
    return Result.fail("release-previous-authority-baseline-mismatch");
  }
  const authorityBaselineDigest = await calculateAuthorityBaselineDigest(input.review);
  const authorityDiff = await diffPluginAuthority(input.review.authorityBefore, authorityAfter);
  const config = { revision: 1, fields: [] } as const;
  const configDigest = await digestPluginBytes(new TextEncoder().encode(JSON.stringify(config)));
  const provenance = {
    sourceDigest: compiled.contract.sourceDigest,
    ...(source.hostedSource === undefined ? {} : { hostedSource: source.hostedSource }),
  };
  const provenanceDigest = await digestJson(provenance);
  const authentication = PackagedPluginAuthentication.make({ kind: "none" });
  const version = PluginVersion.make({
    id: source.pluginVersionId,
    marketplaceId: source.marketplaceId,
    publisherNamespace: source.publisherNamespace,
    pluginSlug: source.pluginSlug,
    version: source.version,
    name: source.name,
    description: source.description,
    license: source.license,
    runtime: {
      _tag: "ManagedOpenApi",
      kind: "managed-openapi",
      artifactDigest: compiled.artifactDigest,
      manifestDigest: compiled.artifactDigest,
      providerRegistrationId: compiled.contract.authStrategy.providerRegistrationId,
    },
    catalog: compiled.contract.catalog,
    config,
    allowedHosts: authorityAfter.allowedHosts,
    status: "published",
    publishedAt: input.review.reviewedAt,
  });
  const authorityDiffDigest = PluginSha256.make(authorityDiff.diffDigest);
  const releaseDigest = await calculateReleaseDigest({
    identity,
    version,
    authentication,
    sourceInputDigest,
    catalogDigest: compiled.contract.catalog.digest,
    configDigest,
    provenanceDigest,
    authorityBaselineDigest,
    authorityDigest,
    authorityDiffDigest,
    artifactDigest: compiled.artifactDigest,
  });
  const candidate: IncrementalReleaseCandidate = {
    identity,
    definitionId: pluginDefinitionId(identity),
    version,
    authentication,
    authStrategy: compiled.contract.authStrategy,
    kind: "managed-openapi",
    sourceInputDigest,
    releaseDigest,
    catalogDigest: compiled.contract.catalog.digest,
    configDigest,
    provenance,
    provenanceDigest,
    authorityBaselineDigest,
    authorityDigest,
    authorityDiffDigest,
    artifactDigest: compiled.artifactDigest,
    artifactByteLength: compiled.bundleBytes.byteLength,
    artifactBytes: compiled.bundleBytes,
    mergeCommit: input.mergeCommit,
    releaseOrdinal: input.releaseOrdinal,
    reviewId: input.review.reviewId,
    reviewer: input.review.reviewer,
    reviewedAt: input.review.reviewedAt,
  };
  if (
    canonicalPluginJson(input.review.identity) !== canonicalPluginJson(identity) ||
    input.review.sourceInputDigest !== sourceInputDigest ||
    input.review.artifactDigest !== compiled.artifactDigest ||
    canonicalPluginJson(input.review.authentication) !== canonicalPluginJson(authentication) ||
    canonicalPluginJson(input.review.authStrategy ?? null) !==
      canonicalPluginJson(candidate.authStrategy ?? null) ||
    input.review.catalogDigest !== candidate.catalogDigest ||
    input.review.configDigest !== configDigest ||
    input.review.provenanceDigest !== provenanceDigest ||
    input.review.authorityDigest !== authorityDigest ||
    input.review.authorityDiffDigest !== authorityDiffDigest ||
    input.review.releaseDigest !== releaseDigest ||
    canonicalPluginJson(input.review.authorityAfter) !== canonicalPluginJson(authorityAfter)
  ) {
    return Result.fail("release-review-binding-mismatch");
  }
  await fs.mkdir(input.outputDirectory, { recursive: true });
  const { artifactBytes: _artifactBytes, ...record } = candidate;
  await fs.writeFile(
    path.join(input.outputDirectory, "release.json"),
    `${JSON.stringify({ schemaVersion: 1, ...record, artifactRelativePath: "openapi-bundle.json" }, null, 2)}\n`,
  );
  await fs.writeFile(path.join(input.outputDirectory, "openapi-bundle.json"), compiled.bundleBytes);
  return Result.succeed(candidate);
}

/** Rebuilds and byte-compares a reviewed OpenAPI release before trusted publication. */
export async function loadPluginOpenApiReleaseBundle(input: {
  readonly bundleDirectory: string;
  readonly sourceDirectory: string;
  readonly sharedInputDigest: typeof PluginSha256.Type;
  readonly trustedReview: ReleaseReview;
  readonly expectedMergeCommit: string;
  readonly expectedReleaseOrdinal: number;
}): Promise<Result.Result<IncrementalReleaseCandidate, string>> {
  let serialized: typeof SerializedOpenApiCandidate.Type;
  try {
    const metadata = path.join(input.bundleDirectory, "release.json");
    const artifact = path.join(input.bundleDirectory, "openapi-bundle.json");
    if (
      (await fs.lstat(metadata)).isSymbolicLink() ||
      (await fs.lstat(artifact)).isSymbolicLink()
    ) {
      return Result.fail("release-bundle-link-rejected");
    }
    serialized = Schema.decodeUnknownSync(SerializedOpenApiCandidate, {
      onExcessProperty: "error",
    })(JSON.parse(await fs.readFile(metadata, "utf8")));
  } catch {
    return Result.fail("release-bundle-invalid");
  }
  if (
    serialized.mergeCommit !== input.expectedMergeCommit ||
    serialized.releaseOrdinal !== input.expectedReleaseOrdinal
  )
    return Result.fail("release-attempt-binding-mismatch");
  const rebuiltDirectory = await fs.mkdtemp(path.join(input.bundleDirectory, ".verify-"));
  try {
    const rebuilt = await buildPluginOpenApiReleaseBundle({
      sourceDirectory: input.sourceDirectory,
      outputDirectory: rebuiltDirectory,
      sharedInputDigest: input.sharedInputDigest,
      mergeCommit: input.expectedMergeCommit,
      releaseOrdinal: input.expectedReleaseOrdinal,
      review: input.trustedReview,
      previousPublished:
        input.trustedReview.authorityBeforeIdentity === null ||
        input.trustedReview.authorityBeforeReleaseDigest === null
          ? null
          : {
              status: "published",
              durableStateVerified: true,
              identity: input.trustedReview.authorityBeforeIdentity,
              releaseDigest: input.trustedReview.authorityBeforeReleaseDigest,
              authorityDigest: input.trustedReview.authorityBeforeDigest,
            },
    });
    if (Result.isFailure(rebuilt)) return rebuilt;
    const { artifactBytes: _artifactBytes, ...record } = rebuilt.success;
    if (
      canonicalPluginJson(serialized) !==
      canonicalPluginJson({
        schemaVersion: 1,
        ...record,
        artifactRelativePath: "openapi-bundle.json",
      })
    )
      return Result.fail("release-bundle-contract-mismatch");
    const original = new Uint8Array(
      await fs.readFile(path.join(input.bundleDirectory, "openapi-bundle.json")),
    );
    if (
      original.byteLength !== rebuilt.success.artifactByteLength ||
      (await digestPluginBytes(original)) !== rebuilt.success.artifactDigest ||
      !original.every((byte, index) => byte === rebuilt.success.artifactBytes?.[index])
    ) {
      return Result.fail("release-artifact-byte-mismatch");
    }
    return rebuilt;
  } finally {
    await fs.rm(rebuiltDirectory, { recursive: true, force: true });
  }
}
