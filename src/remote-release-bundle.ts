import { promises as fs } from "node:fs";
import path from "node:path";
import { Result, Schema } from "effect";
import {
  deriveBootstrapAuthoritySnapshot,
  deriveManagedRemoteAuthoritySnapshot,
  diffPluginAuthority,
} from "./authority-diff.js";
import { PackagedPluginAuthentication } from "./package-archive.js";
import { PluginAuthStrategyDefinition } from "./plugin-auth-strategy.js";
import { OAuthScopeSet, PluginOAuthProviderDefinition } from "./oauth-provider-definition.js";
import {
  canonicalPluginJson,
  digestPluginBytes,
  PluginSha256,
  PluginVersion,
} from "./plugin-contract.js";
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
import {
  ManagedRemotePluginRelease,
  validateManagedRemotePluginRelease,
} from "./remote-release.js";

const SerializedRemoteCandidate = Schema.Struct({
  schemaVersion: Schema.Literal(1),
  identity: PluginReleaseIdentity,
  definitionId: Schema.NonEmptyString,
  version: PluginVersion,
  authentication: PackagedPluginAuthentication,
  authStrategy: Schema.optionalKey(PluginAuthStrategyDefinition),
  oauthProviderDefinition: Schema.optionalKey(PluginOAuthProviderDefinition),
  kind: Schema.Literal("managed-remote-mcp"),
  sourceInputDigest: PluginSha256,
  releaseDigest: PluginSha256,
  catalogDigest: PluginSha256,
  configDigest: PluginSha256,
  provenance: Schema.Json,
  provenanceDigest: PluginSha256,
  authorityBaselineDigest: PluginSha256,
  authorityDigest: PluginSha256,
  authorityDiffDigest: PluginSha256,
  artifactDigest: Schema.Null,
  artifactByteLength: Schema.Null,
  mergeCommit: Schema.String.pipe(Schema.check(Schema.isPattern(/^[a-f0-9]{40}$/u))),
  releaseOrdinal: Schema.Int.pipe(Schema.check(Schema.isGreaterThanOrEqualTo(0))),
  reviewId: Schema.NonEmptyString,
  reviewer: Schema.NonEmptyString,
  reviewedAt: Schema.Int.pipe(Schema.check(Schema.isGreaterThanOrEqualTo(0))),
  remote: ManagedRemotePluginRelease,
});

const digestJson = (value: Schema.Json) =>
  digestPluginBytes(new TextEncoder().encode(canonicalPluginJson(value)));

interface PreviousPublishedAuthority {
  readonly status: "published";
  readonly durableStateVerified: true;
  readonly identity: typeof PluginReleaseIdentity.Type;
  readonly releaseDigest: typeof PluginSha256.Type;
  readonly authorityDigest: typeof PluginSha256.Type;
}

/** Digests one managed remote declaration plus shared release-system inputs. */
export async function calculateManagedRemoteSourceInputDigest(input: {
  readonly sourceFile: string;
  readonly sharedInputDigest: typeof PluginSha256.Type;
}): Promise<typeof PluginSha256.Type> {
  return digestReleaseInputs({
    pluginFiles: [
      {
        path: path.basename(input.sourceFile),
        digest: await digestPluginBytes(new Uint8Array(await fs.readFile(input.sourceFile))),
      },
    ],
    sharedInputDigest: input.sharedInputDigest,
  });
}

const loadReviewedRemote = async (sourceFile: string) => {
  try {
    return validateManagedRemotePluginRelease(
      JSON.parse(await fs.readFile(sourceFile, "utf8")),
      "publication",
    );
  } catch {
    return Result.fail("remote-release-invalid");
  }
};

/** Builds a reviewed managed remote bundle containing declarations only and no executable bytes. */
export async function buildManagedRemoteReleaseBundle(input: {
  readonly sourceFile: string;
  readonly outputDirectory: string;
  readonly sharedInputDigest: typeof PluginSha256.Type;
  readonly mergeCommit: string;
  readonly releaseOrdinal: number;
  readonly review: ReleaseReview;
  readonly previousPublished: PreviousPublishedAuthority | null;
}): Promise<Result.Result<IncrementalReleaseCandidate, string>> {
  const loaded = await loadReviewedRemote(input.sourceFile);
  if (Result.isFailure(loaded)) return Result.fail(loaded.failure);
  const remote = loaded.success;
  if (
    (remote.authStrategy === undefined && remote.providerDefinitionDigest === undefined) ||
    remote.protocolPolicy === undefined
  ) {
    return Result.fail("remote-release-evidence-incomplete");
  }
  const identity = PluginReleaseIdentity.make({
    marketplaceId: remote.marketplaceId,
    publisherNamespace: remote.publisherNamespace,
    pluginSlug: remote.pluginSlug,
    semanticVersion: remote.version,
  });
  if (remote.id !== `${pluginDefinitionId(identity)}@${identity.semanticVersion}`) {
    return Result.fail("remote-release-identity-incoherent");
  }
  const sourceInputDigest = await calculateManagedRemoteSourceInputDigest(input);
  const configDigest = await digestJson(remote.config);
  const authorityAfter = deriveManagedRemoteAuthoritySnapshot(remote);
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
  const providerDefinitionDigest =
    remote.authStrategy !== undefined && remote.authStrategy.profile !== "api-key"
      ? remote.authStrategy.providerDefinitionDigest
      : remote.providerDefinitionDigest;
  if (remote.authStrategy?.profile !== "api-key" && providerDefinitionDigest === undefined) {
    return Result.fail("remote-release-evidence-incomplete");
  }
  let authentication: typeof PackagedPluginAuthentication.Type;
  if (remote.authStrategy?.profile === "api-key") {
    authentication = PackagedPluginAuthentication.make({ kind: "none" });
  } else {
    if (providerDefinitionDigest === undefined) {
      return Result.fail("remote-release-evidence-incomplete");
    }
    authentication = PackagedPluginAuthentication.make({
      kind: "oauth",
      providerRegistration: remote.runtime.providerRegistrationId,
      providerDefinitionDigest,
      requestedScopes: Schema.decodeUnknownSync(OAuthScopeSet)(remote.scopes),
      credentialDelivery: "short-lived-access-token-only",
    });
  }
  const authStrategyDigest =
    remote.authStrategy === undefined ? undefined : await digestJson(remote.authStrategy);
  const provenanceBase = {
    kind: "managed-remote-mcp",
    endpoint: remote.endpoint,
    oauthRegistrationMode: remote.oauthRegistrationMode,
    protocolPolicy: remote.protocolPolicy,
    evidenceUrls: remote.evidenceUrls ?? [],
    verificationNotes: remote.verificationNotes,
  } as const;
  const provenance =
    remote.authStrategy === undefined || authStrategyDigest === undefined
      ? provenanceBase
      : {
          ...provenanceBase,
          authProfile: remote.authStrategy.profile,
          authStrategyDigest,
        };
  const provenanceDigest = await digestJson(provenance);
  const version = PluginVersion.make({
    id: remote.id,
    marketplaceId: remote.marketplaceId,
    publisherNamespace: remote.publisherNamespace,
    pluginSlug: remote.pluginSlug,
    version: remote.version,
    name: remote.name,
    description: remote.description,
    license: remote.license,
    runtime: remote.runtime,
    catalog: remote.catalog,
    config: remote.config,
    allowedHosts: remote.allowedHosts,
    status: "published",
    publishedAt: input.review.reviewedAt,
  });
  const authorityDiffDigest = PluginSha256.make(authorityDiff.diffDigest);
  const releaseDigest = await calculateReleaseDigest({
    identity,
    version,
    authentication,
    sourceInputDigest,
    catalogDigest: remote.catalog.digest,
    configDigest,
    provenanceDigest,
    authorityBaselineDigest,
    authorityDigest,
    authorityDiffDigest,
    artifactDigest: null,
  });
  const candidate: IncrementalReleaseCandidate = {
    identity,
    definitionId: pluginDefinitionId(identity),
    version,
    authentication,
    ...(remote.authStrategy === undefined ? {} : { authStrategy: remote.authStrategy }),
    ...(remote.oauthProviderDefinition === undefined
      ? {}
      : { oauthProviderDefinition: remote.oauthProviderDefinition }),
    kind: "managed-remote-mcp",
    sourceInputDigest,
    releaseDigest,
    catalogDigest: remote.catalog.digest,
    configDigest,
    provenance,
    provenanceDigest,
    authorityBaselineDigest,
    authorityDigest,
    authorityDiffDigest,
    artifactDigest: null,
    artifactByteLength: null,
    artifactBytes: null,
    mergeCommit: input.mergeCommit,
    releaseOrdinal: input.releaseOrdinal,
    reviewId: input.review.reviewId,
    reviewer: input.review.reviewer,
    reviewedAt: input.review.reviewedAt,
  };
  if (
    input.review.artifactDigest !== null ||
    input.review.sourceInputDigest !== sourceInputDigest ||
    canonicalPluginJson(input.review.authentication) !== canonicalPluginJson(authentication) ||
    input.review.catalogDigest !== remote.catalog.digest ||
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
  const { artifactBytes: _artifactBytes, ...durableCandidate } = candidate;
  await fs.writeFile(
    path.join(input.outputDirectory, "release.json"),
    `${JSON.stringify(SerializedRemoteCandidate.make({ schemaVersion: 1, ...durableCandidate, ...(remote.authStrategy === undefined ? {} : { authStrategy: remote.authStrategy }), ...(remote.oauthProviderDefinition === undefined ? {} : { oauthProviderDefinition: remote.oauthProviderDefinition }), kind: "managed-remote-mcp", artifactDigest: null, artifactByteLength: null, remote }), null, 2)}\n`,
  );
  return Result.succeed(candidate);
}

/** Re-derives a managed remote candidate from its protected declaration and review. */
export async function loadManagedRemoteReleaseBundle(input: {
  readonly bundleDirectory: string;
  readonly sourceFile: string;
  readonly sharedInputDigest: typeof PluginSha256.Type;
  readonly trustedReview: ReleaseReview;
  readonly expectedMergeCommit: string;
  readonly expectedReleaseOrdinal: number;
  readonly previousPublished?: PreviousPublishedAuthority | null;
}): Promise<Result.Result<IncrementalReleaseCandidate, string>> {
  let serialized: typeof SerializedRemoteCandidate.Type;
  try {
    const releaseFile = path.join(input.bundleDirectory, "release.json");
    if ((await fs.lstat(releaseFile)).isSymbolicLink())
      return Result.fail("release-bundle-link-rejected");
    serialized = Schema.decodeUnknownSync(SerializedRemoteCandidate, { onExcessProperty: "error" })(
      JSON.parse(await fs.readFile(releaseFile, "utf8")),
    );
  } catch {
    return Result.fail("release-bundle-invalid");
  }
  if (
    serialized.mergeCommit !== input.expectedMergeCommit ||
    serialized.releaseOrdinal !== input.expectedReleaseOrdinal
  ) {
    return Result.fail("release-attempt-binding-mismatch");
  }
  const rebuiltDirectory = await fs.mkdtemp(path.join(input.bundleDirectory, ".verify-"));
  try {
    const rebuilt = await buildManagedRemoteReleaseBundle({
      sourceFile: input.sourceFile,
      outputDirectory: rebuiltDirectory,
      sharedInputDigest: input.sharedInputDigest,
      mergeCommit: input.expectedMergeCommit,
      releaseOrdinal: input.expectedReleaseOrdinal,
      review: input.trustedReview,
      previousPublished:
        input.previousPublished ??
        (input.trustedReview.authorityBeforeIdentity === null ||
        input.trustedReview.authorityBeforeReleaseDigest === null
          ? null
          : {
              status: "published",
              durableStateVerified: true,
              identity: input.trustedReview.authorityBeforeIdentity,
              releaseDigest: input.trustedReview.authorityBeforeReleaseDigest,
              authorityDigest: input.trustedReview.authorityBeforeDigest,
            }),
    });
    if (Result.isFailure(rebuilt)) return rebuilt;
    const { artifactBytes: _artifactBytes, ...durableCandidate } = rebuilt.success;
    const expected = SerializedRemoteCandidate.make({
      schemaVersion: 1,
      ...durableCandidate,
      ...(rebuilt.success.authStrategy === undefined
        ? {}
        : { authStrategy: rebuilt.success.authStrategy }),
      ...(rebuilt.success.oauthProviderDefinition === undefined
        ? {}
        : { oauthProviderDefinition: rebuilt.success.oauthProviderDefinition }),
      kind: "managed-remote-mcp",
      artifactDigest: null,
      artifactByteLength: null,
      remote: serialized.remote,
    });
    return canonicalPluginJson(serialized) === canonicalPluginJson(expected)
      ? rebuilt
      : Result.fail("release-bundle-contract-mismatch");
  } finally {
    await fs.rm(rebuiltDirectory, { recursive: true, force: true });
  }
}
