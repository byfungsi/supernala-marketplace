import { promises as fs } from "node:fs";
import path from "node:path";
import { Result, Schema } from "effect";
import {
  canonicalPluginJson,
  digestPluginBytes,
  PluginSha256,
  PluginVersion,
} from "./plugin-contract.js";
import { PackageCatalog, PackagedPluginAuthentication } from "./package-archive.js";
import { parsePackagedPluginArchive } from "./package-archive.js";

/** Human review binding for an exact immutable release candidate. */
export const PublicationReviewBinding = Schema.Struct({
  reviewId: Schema.NonEmptyString,
  reviewedAt: Schema.Int.pipe(Schema.check(Schema.isGreaterThanOrEqualTo(0))),
  reviewer: Schema.NonEmptyString,
  sourceTreeDigest: PluginSha256,
  artifactDigest: PluginSha256,
  authentication: PackagedPluginAuthentication,
  catalogDigest: PluginSha256,
  configDigest: PluginSha256,
  authorityDiffDigest: PluginSha256,
  decision: Schema.Literal("approved"),
});
/** Human review binding for an exact immutable release candidate. */
export interface PublicationReviewBinding extends Schema.Schema.Type<
  typeof PublicationReviewBinding
> {}

/** Serializable plan consumed only by a future trusted application adapter. */
export const PackagedPluginPublicationPlan = Schema.Struct({
  schemaVersion: Schema.Literal(1),
  mode: Schema.Literal("plan-only"),
  adapterContract: Schema.Literal("Phase1.PublishPackagedPluginVersionInput"),
  definitionId: Schema.NonEmptyString,
  artifact: Schema.Struct({
    relativePath: Schema.String.pipe(Schema.check(Schema.isLengthBetween(1, 1_024))),
    sha256: PluginSha256,
    byteLength: Schema.Int.pipe(Schema.check(Schema.isGreaterThanOrEqualTo(1))),
  }),
  version: PluginVersion,
  authentication: PackagedPluginAuthentication,
  catalog: PackageCatalog,
  config: PluginVersion.fields.config,
  provenance: Schema.Json,
  review: PublicationReviewBinding,
});
/** Serializable plan consumed only by a future trusted application adapter. */
export interface PackagedPluginPublicationPlan extends Schema.Schema.Type<
  typeof PackagedPluginPublicationPlan
> {}

/** Exact future mapping to the internal Phase 1 publisher input. */
export interface Phase1PublishPackagedPluginVersionInput {
  readonly definitionId: string;
  readonly version: PluginVersion;
  readonly archiveBytes: Uint8Array;
  readonly expectedArtifactDigest?: typeof PluginSha256.Type;
  readonly expectedAuthentication?: typeof PackagedPluginAuthentication.Type;
  readonly reviewedAt: number;
}

/** Build a plan containing no package bytes or credentials. */
export function makePackagedPluginPublicationPlan(input: {
  readonly definitionId: string;
  readonly artifactRelativePath: string;
  readonly artifactByteLength: number;
  readonly version: PluginVersion;
  readonly authentication: typeof PackagedPluginAuthentication.Type;
  readonly catalog: PackageCatalog;
  readonly config: PluginVersion["config"];
  readonly provenance: Schema.Json;
  readonly review: PublicationReviewBinding;
}): PackagedPluginPublicationPlan {
  if (input.version.runtime.kind !== "managed-package") {
    throw new Error("Publication plan invariant failed: packaged plan requires managed-package");
  }
  return PackagedPluginPublicationPlan.make({
    schemaVersion: 1,
    mode: "plan-only",
    adapterContract: "Phase1.PublishPackagedPluginVersionInput",
    definitionId: input.definitionId,
    artifact: {
      relativePath: input.artifactRelativePath,
      sha256: input.version.runtime.artifactDigest,
      byteLength: input.artifactByteLength,
    },
    version: input.version,
    authentication: input.authentication,
    catalog: input.catalog,
    config: input.config,
    provenance: input.provenance,
    review: input.review,
  });
}

/** Decode and verify a plan plus sidecar bytes before a trusted adapter receives input. */
export async function loadPhase1PublicationInput(input: {
  readonly planFile: string;
  readonly expectedReviewId: string;
}): Promise<Result.Result<Phase1PublishPackagedPluginVersionInput, string>> {
  let plan: PackagedPluginPublicationPlan;
  try {
    plan = Schema.decodeUnknownSync(PackagedPluginPublicationPlan, {
      onExcessProperty: "error",
    })(JSON.parse(await fs.readFile(input.planFile, "utf8")));
  } catch {
    return Result.fail("publication-plan-invalid");
  }
  if (plan.review.reviewId !== input.expectedReviewId) return Result.fail("review-id-mismatch");
  const relativePath = plan.artifact.relativePath;
  if (path.isAbsolute(relativePath) || relativePath.split(/[\\/]/u).includes("..")) {
    return Result.fail("artifact-path-invalid");
  }
  let archiveBytes: Uint8Array;
  try {
    archiveBytes = new Uint8Array(
      await fs.readFile(path.resolve(path.dirname(input.planFile), relativePath)),
    );
  } catch {
    return Result.fail("artifact-unavailable");
  }
  const digest = await digestPluginBytes(archiveBytes);
  if (
    digest !== plan.artifact.sha256 ||
    digest !== plan.review.artifactDigest ||
    archiveBytes.byteLength !== plan.artifact.byteLength
  ) {
    return Result.fail("artifact-review-binding-mismatch");
  }
  const parsed = await parsePackagedPluginArchive({
    archiveBytes,
    marketplaceId: plan.version.marketplaceId,
    versionId: plan.version.id,
    publishedAt: plan.version.publishedAt,
  });
  if (Result.isFailure(parsed)) return Result.fail("artifact-inspection-failed");
  if (
    canonicalPluginJson(parsed.success.version) !== canonicalPluginJson(plan.version) ||
    canonicalPluginJson(parsed.success.authentication) !==
      canonicalPluginJson(plan.authentication) ||
    canonicalPluginJson(plan.review.authentication) !== canonicalPluginJson(plan.authentication) ||
    canonicalPluginJson({
      id: parsed.success.version.catalog.id,
      schemaVersion: parsed.success.version.catalog.schemaVersion,
      tools: parsed.success.version.catalog.tools,
    }) !== canonicalPluginJson(plan.catalog) ||
    parsed.success.version.catalog.digest !== plan.review.catalogDigest ||
    parsed.success.configDigest !== plan.review.configDigest ||
    canonicalPluginJson(parsed.success.provenance) !== canonicalPluginJson(plan.provenance)
  ) {
    return Result.fail("release-contract-mismatch");
  }
  return Result.succeed({
    definitionId: plan.definitionId,
    version: plan.version,
    archiveBytes,
    expectedArtifactDigest: digest,
    expectedAuthentication: plan.authentication,
    reviewedAt: plan.review.reviewedAt,
  });
}
