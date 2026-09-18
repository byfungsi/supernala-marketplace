import { cp, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { expect, it } from "@effect/vitest";
import { Result } from "effect";
import {
  deriveBootstrapAuthoritySnapshot,
  derivePluginAuthoritySnapshot,
  diffPluginAuthority,
} from "./authority-diff.js";
import { preparePluginPackage, validatePluginSource } from "./authoring-validation.js";
import {
  buildManagedPackageReleaseBundle,
  calculateAuthorityBaselineDigest,
  calculateManagedPackageSourceInputDigest,
  calculateReleaseDigest,
  loadManagedPackageReleaseBundle,
  pluginVersionId,
  releaseBundleDirectory,
  ReleaseReview,
} from "./release-bundle.js";
import {
  canonicalPluginJson,
  digestPluginBytes,
  PluginSha256,
  PluginVersion,
} from "./plugin-contract.js";
import { PluginReleaseIdentity, type ReleaseJournalRecord } from "./release-machine.js";

const digestJson = (value: Parameters<typeof canonicalPluginJson>[0]) =>
  digestPluginBytes(new TextEncoder().encode(canonicalPluginJson(value)));

interface MutableSerializedRelease {
  version: { allowedHosts: Array<string> };
  releaseDigest: string;
  authorityDiffDigest: string;
  provenance: unknown;
  identity: { publisherNamespace: string };
  authentication: {
    kind: string;
    providerRegistration?: string;
    credentialDelivery?: string;
    scopes?: Array<string>;
    provider?: string;
  };
  reviewId: string;
  artifactRelativePath: string;
  readonly [key: string]: unknown;
}

const fixture = async () => {
  const sourceDirectory = "plugins/offline-fixture";
  const sharedInputDigest = PluginSha256.make("a".repeat(64));
  const source = await validatePluginSource(sourceDirectory);
  if (Result.isFailure(source)) throw new Error(source.failure.message);
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
    publishedAt: 1,
  });
  if (Result.isFailure(prepared)) throw new Error(prepared.failure.message);
  const authorityAfter = derivePluginAuthoritySnapshot(source.success);
  const authorityBefore = deriveBootstrapAuthoritySnapshot(authorityAfter);
  const authorityDiff = await diffPluginAuthority(authorityBefore, authorityAfter);
  const sourceInputDigest = await calculateManagedPackageSourceInputDigest({
    sourceDirectory,
    sharedInputDigest,
  });
  const authorityDigest = await digestJson(authorityAfter);
  const authorityBeforeDigest = await digestJson(authorityBefore);
  const provenanceDigest = await digestJson(prepared.success.parsed.provenance);
  const authorityBaselineDigest = await calculateAuthorityBaselineDigest({
    authorityBeforeIdentity: null,
    authorityBeforeReleaseDigest: null,
    authorityBefore,
    authorityBeforeDigest,
  });
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
    authorityDiffDigest: PluginSha256.make(authorityDiff.diffDigest),
    artifactDigest: prepared.success.artifactDigest,
  });
  const review = ReleaseReview.make({
    schemaVersion: 1,
    identity,
    reviewId: "synthetic-protected-review",
    reviewer: "synthetic-independent-reviewer",
    reviewedAt: 1,
    sourceInputDigest,
    artifactDigest: prepared.success.artifactDigest,
    authentication: prepared.success.parsed.authentication,
    catalogDigest: prepared.success.parsed.version.catalog.digest,
    configDigest: prepared.success.parsed.configDigest,
    provenanceDigest,
    authorityBeforeIdentity: null,
    authorityBeforeReleaseDigest: null,
    authorityBefore,
    authorityBeforeDigest,
    authorityAfter,
    authorityDigest,
    authorityDiffDigest: PluginSha256.make(authorityDiff.diffDigest),
    releaseDigest,
    decision: "approved",
  });
  const root = await mkdtemp(path.join(os.tmpdir(), "marketplace-release-bundle-"));
  const bundleDirectory = releaseBundleDirectory(root, identity);
  const built = await buildManagedPackageReleaseBundle({
    sourceDirectory,
    outputDirectory: bundleDirectory,
    sharedInputDigest,
    mergeCommit: "a".repeat(40),
    releaseOrdinal: 1,
    review,
    previousPublished: null,
  });
  if (Result.isFailure(built)) throw new Error(built.failure);
  return {
    root,
    bundleDirectory,
    sourceDirectory,
    sharedInputDigest,
    review,
    candidate: built.success,
  };
};

const load = (
  input: Awaited<ReturnType<typeof fixture>>,
  bundleDirectory = input.bundleDirectory,
) =>
  loadManagedPackageReleaseBundle({
    bundleDirectory,
    sourceDirectory: input.sourceDirectory,
    sharedInputDigest: input.sharedInputDigest,
    trustedReview: input.review,
    expectedMergeCommit: "a".repeat(40),
    expectedReleaseOrdinal: 1,
  });

it("reparses archive and reconstructs every reviewed release field", async () => {
  const input = await fixture();
  expect(Result.isSuccess(await load(input))).toBe(true);
  await rm(input.root, { recursive: true });
});

it("rejects independent descriptor, digest, authority, provenance and identity tampering", async () => {
  const input = await fixture();
  const original = JSON.parse(
    await readFile(path.join(input.bundleDirectory, "release.json"), "utf8"),
  ) as MutableSerializedRelease;
  const mutations: ReadonlyArray<(value: MutableSerializedRelease) => void> = [
    (value) => {
      value.version.allowedHosts = ["api.example.invalid"];
    },
    (value) => {
      value.releaseDigest = "9".repeat(64);
    },
    (value) => {
      value.authorityDiffDigest = "8".repeat(64);
    },
    (value) => {
      value.provenance = { synthetic: "tampered" };
    },
    (value) => {
      value.identity.publisherNamespace = "other-publisher";
    },
    (value) => {
      value.reviewId = "self-attested-review";
    },
    (value) => {
      value.authentication = {
        kind: "github-app",
        providerRegistration: "unreviewed-provider",
        credentialDelivery: "short-lived-installation-token-only",
      };
    },
    (value) => {
      value.authentication = { kind: "none", scopes: ["synthetic-disallowed-scope"] };
    },
    (value) => {
      value.authentication = {
        kind: "github-app",
        providerRegistration: "synthetic-provider",
        credentialDelivery: "short-lived-installation-token-only",
        provider: "synthetic-unreviewed-provider-kind",
      };
    },
  ];
  for (const [index, mutate] of mutations.entries()) {
    const copy = path.join(input.root, `tamper-${index}`);
    await cp(input.bundleDirectory, copy, { recursive: true });
    const value = structuredClone(original);
    mutate(value);
    await writeFile(path.join(copy, "release.json"), JSON.stringify(value));
    expect(Result.isFailure(await load(input, copy))).toBe(true);
  }
  await rm(input.root, { recursive: true });
});

it("rejects artifact traversal and symlink substitution", async () => {
  const input = await fixture();
  const releaseFile = path.join(input.bundleDirectory, "release.json");
  const original = JSON.parse(await readFile(releaseFile, "utf8")) as MutableSerializedRelease;
  await writeFile(
    releaseFile,
    JSON.stringify({ ...original, artifactRelativePath: "../escape.plugin" }),
  );
  expect(await load(input)).toEqual(Result.fail("release-artifact-path-invalid"));
  await writeFile(releaseFile, JSON.stringify(original));
  const artifact = path.join(input.bundleDirectory, String(original.artifactRelativePath));
  const realArtifact = `${artifact}.real`;
  await cp(artifact, realArtifact);
  await rm(artifact);
  await symlink(path.basename(realArtifact), artifact);
  expect(await load(input)).toEqual(Result.fail("release-bundle-link-rejected"));
  await rm(input.root, { recursive: true });
});

it("rejects an arbitrary bootstrap authority snapshot", async () => {
  const input = await fixture();
  const arbitraryBeforeDigest = await digestJson(input.review.authorityAfter);
  const review = ReleaseReview.make({
    schemaVersion: 1,
    identity: input.review.identity,
    reviewId: input.review.reviewId,
    reviewer: input.review.reviewer,
    reviewedAt: input.review.reviewedAt,
    sourceInputDigest: input.review.sourceInputDigest,
    artifactDigest: input.review.artifactDigest,
    authentication: input.review.authentication,
    catalogDigest: input.review.catalogDigest,
    configDigest: input.review.configDigest,
    provenanceDigest: input.review.provenanceDigest,
    authorityBeforeIdentity: null,
    authorityBeforeReleaseDigest: null,
    authorityBefore: input.review.authorityAfter,
    authorityBeforeDigest: arbitraryBeforeDigest,
    authorityAfter: input.review.authorityAfter,
    authorityDigest: input.review.authorityDigest,
    authorityDiffDigest: input.review.authorityDiffDigest,
    releaseDigest: input.review.releaseDigest,
    decision: "approved",
  });
  expect(
    await buildManagedPackageReleaseBundle({
      sourceDirectory: input.sourceDirectory,
      outputDirectory: path.join(input.root, "arbitrary-bootstrap"),
      sharedInputDigest: input.sharedInputDigest,
      mergeCommit: "b".repeat(40),
      releaseOrdinal: 2,
      review,
      previousPublished: null,
    }),
  ).toEqual(Result.fail("release-bootstrap-authority-baseline-mismatch"));
  await rm(input.root, { recursive: true });
});

it("accepts authorityBefore only when bound to the verified previous published version", async () => {
  const input = await fixture();
  const previousIdentity = PluginReleaseIdentity.make({
    marketplaceId: input.candidate.identity.marketplaceId,
    publisherNamespace: input.candidate.identity.publisherNamespace,
    pluginSlug: input.candidate.identity.pluginSlug,
    semanticVersion: "0.9.0",
  });
  const previousVersion = PluginVersion.make({
    id: pluginVersionId(previousIdentity) as typeof input.candidate.version.id,
    marketplaceId: input.candidate.version.marketplaceId,
    publisherNamespace: input.candidate.version.publisherNamespace,
    pluginSlug: input.candidate.version.pluginSlug,
    version: "0.9.0" as typeof input.candidate.version.version,
    name: input.candidate.version.name,
    description: input.candidate.version.description,
    license: input.candidate.version.license,
    catalog: input.candidate.version.catalog,
    config: input.candidate.version.config,
    allowedHosts: input.candidate.version.allowedHosts,
    runtime: input.candidate.version.runtime,
    status: input.candidate.version.status,
    publishedAt: input.candidate.version.publishedAt,
  });
  const previousReleaseDigest = PluginSha256.make("b".repeat(64));
  const previous: ReleaseJournalRecord = {
    identity: previousIdentity,
    definitionId: input.candidate.definitionId,
    version: previousVersion,
    authentication: input.candidate.authentication,
    kind: input.candidate.kind,
    sourceInputDigest: input.candidate.sourceInputDigest,
    releaseDigest: previousReleaseDigest,
    catalogDigest: input.candidate.catalogDigest,
    configDigest: input.candidate.configDigest,
    provenance: input.candidate.provenance,
    provenanceDigest: input.candidate.provenanceDigest,
    authorityBaselineDigest: input.candidate.authorityBaselineDigest,
    authorityDigest: input.candidate.authorityDigest,
    authorityDiffDigest: input.candidate.authorityDiffDigest,
    artifactDigest: input.candidate.artifactDigest,
    artifactByteLength: input.candidate.artifactByteLength,
    mergeCommit: "9".repeat(40),
    releaseOrdinal: 1,
    reviewId: "previous-review",
    reviewer: "previous-reviewer",
    reviewedAt: 0,
    status: "published",
    attempts: 1,
    failureType: null,
    generation: 1,
    durableStateVerified: true,
  };
  const authorityDiff = await diffPluginAuthority(
    input.review.authorityAfter,
    input.review.authorityAfter,
  );
  const authorityBaselineDigest = await calculateAuthorityBaselineDigest({
    authorityBeforeIdentity: previousIdentity,
    authorityBeforeReleaseDigest: previousReleaseDigest,
    authorityBefore: input.review.authorityAfter,
    authorityBeforeDigest: input.review.authorityDigest,
  });
  const releaseDigest = await calculateReleaseDigest({
    identity: input.candidate.identity,
    version: input.candidate.version,
    authentication: input.candidate.authentication,
    sourceInputDigest: input.candidate.sourceInputDigest,
    catalogDigest: input.candidate.catalogDigest,
    configDigest: input.candidate.configDigest,
    provenanceDigest: input.candidate.provenanceDigest,
    authorityBaselineDigest,
    authorityDigest: input.candidate.authorityDigest,
    authorityDiffDigest: PluginSha256.make(authorityDiff.diffDigest),
    artifactDigest: input.review.artifactDigest,
  });
  const review = ReleaseReview.make({
    schemaVersion: 1,
    identity: input.review.identity,
    reviewId: "current-review",
    reviewer: "current-reviewer",
    reviewedAt: input.review.reviewedAt,
    sourceInputDigest: input.review.sourceInputDigest,
    artifactDigest: input.review.artifactDigest,
    authentication: input.review.authentication,
    catalogDigest: input.review.catalogDigest,
    configDigest: input.review.configDigest,
    provenanceDigest: input.review.provenanceDigest,
    authorityBeforeIdentity: previousIdentity,
    authorityBeforeReleaseDigest: previousReleaseDigest,
    authorityBefore: input.review.authorityAfter,
    authorityBeforeDigest: input.review.authorityDigest,
    authorityAfter: input.review.authorityAfter,
    authorityDigest: input.review.authorityDigest,
    authorityDiffDigest: PluginSha256.make(authorityDiff.diffDigest),
    releaseDigest,
    decision: "approved",
  });
  expect(
    Result.isSuccess(
      await buildManagedPackageReleaseBundle({
        sourceDirectory: input.sourceDirectory,
        outputDirectory: path.join(input.root, "previous-bound"),
        sharedInputDigest: input.sharedInputDigest,
        mergeCommit: "c".repeat(40),
        releaseOrdinal: 2,
        review,
        previousPublished: previous,
      }),
    ),
  ).toBe(true);
  expect(
    await buildManagedPackageReleaseBundle({
      sourceDirectory: input.sourceDirectory,
      outputDirectory: path.join(input.root, "wrong-previous"),
      sharedInputDigest: input.sharedInputDigest,
      mergeCommit: "d".repeat(40),
      releaseOrdinal: 2,
      review,
      previousPublished: { ...previous, releaseDigest: PluginSha256.make("c".repeat(64)) },
    }),
  ).toEqual(Result.fail("release-previous-authority-baseline-mismatch"));
  await rm(input.root, { recursive: true });
});
