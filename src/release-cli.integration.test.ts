import { spawn } from "node:child_process";
import { cp, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { expect, it } from "@effect/vitest";
import { Result, Schema } from "effect";
import {
  deriveBootstrapAuthoritySnapshot,
  derivePluginAuthoritySnapshot,
  diffPluginAuthority,
} from "./authority-diff.js";
import { preparePluginPackage, validatePluginSource } from "./authoring-validation.js";
import {
  calculateManagedPackageSourceInputDigest,
  calculateAuthorityBaselineDigest,
  calculateReleaseDigest,
  pluginVersionId,
  releaseIdentityFileStem,
  releaseReviewFile,
  ReleaseReview,
} from "./release-bundle.js";
import { canonicalPluginJson, digestPluginBytes, PluginSha256 } from "./plugin-contract.js";
import { PluginReleaseIdentity } from "./release-machine.js";

interface CommandResult {
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
}

const repositoryRoot = path.resolve(".");
const tsxCli = path.join(repositoryRoot, "node_modules", "tsx", "dist", "cli.mjs");
const releaseCli = path.join(repositoryRoot, "src", "release-cli.ts");

const runReleaseCli = (
  cwd: string,
  arguments_: ReadonlyArray<string>,
  environment: Readonly<Record<string, string>> = {},
): Promise<CommandResult> =>
  new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [tsxCli, releaseCli, ...arguments_], {
      cwd,
      env: { PATH: process.env.PATH ?? "", ...environment },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8").on("data", (chunk: string) => {
      stdout += chunk;
    });
    child.stderr.setEncoding("utf8").on("data", (chunk: string) => {
      stderr += chunk;
    });
    child.once("error", reject);
    child.once("close", (code) => {
      resolve({ exitCode: code ?? -1, stdout, stderr });
    });
  });

const digestJson = (value: Parameters<typeof canonicalPluginJson>[0]) =>
  digestPluginBytes(new TextEncoder().encode(canonicalPluginJson(value)));

const createCliFixture = async (): Promise<{
  readonly root: string;
  readonly bundleDirectory: string;
  readonly reviewFile: string;
}> => {
  const root = await mkdtemp(path.join(os.tmpdir(), "marketplace-cli-integration-"));
  const sourceDirectory = path.join(root, "plugins", "offline-fixture");
  await mkdir(path.dirname(sourceDirectory), { recursive: true });
  await cp(path.join(repositoryRoot, "plugins", "offline-fixture"), sourceDirectory, {
    recursive: true,
  });
  await writeFile(path.join(root, "shared.txt"), "reviewed shared input\n");
  await mkdir(path.join(root, "releases", "reviews"), { recursive: true });
  await writeFile(
    path.join(root, "releases", "index.json"),
    `${JSON.stringify(
      {
        schemaVersion: 1,
        sharedInputs: ["shared.txt"],
        plugins: [
          {
            sourceDirectory: "plugins/offline-fixture",
            kind: "managed-package",
            publicationEligible: true,
            reason: "synthetic CLI integration fixture",
          },
        ],
      },
      null,
      2,
    )}\n`,
  );
  const source = await validatePluginSource(sourceDirectory);
  if (Result.isFailure(source)) throw new Error("test-source-invalid");
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
  if (Result.isFailure(prepared)) throw new Error("test-package-invalid");
  const sharedBytes = new Uint8Array(await readFile(path.join(root, "shared.txt")));
  const sharedInputDigest = await digestPluginBytes(
    new TextEncoder().encode(
      JSON.stringify([{ file: "shared.txt", digest: await digestPluginBytes(sharedBytes) }]),
    ),
  );
  const sourceInputDigest = await calculateManagedPackageSourceInputDigest({
    sourceDirectory,
    sharedInputDigest,
  });
  const authorityAfter = derivePluginAuthoritySnapshot(source.success);
  const authorityBefore = deriveBootstrapAuthoritySnapshot(authorityAfter);
  const authorityDigest = await digestJson(authorityAfter);
  const authorityBeforeDigest = await digestJson(authorityBefore);
  const authorityDiff = await diffPluginAuthority(authorityBefore, authorityAfter);
  const authorityDiffDigest = PluginSha256.make(authorityDiff.diffDigest);
  const authorityBaselineDigest = await calculateAuthorityBaselineDigest({
    authorityBeforeIdentity: null,
    authorityBeforeReleaseDigest: null,
    authorityBefore,
    authorityBeforeDigest,
  });
  const provenanceDigest = await digestJson(prepared.success.parsed.provenance);
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
    authorityDiffDigest,
    artifactDigest: prepared.success.artifactDigest,
  });
  const review = ReleaseReview.make({
    schemaVersion: 1,
    identity,
    reviewId: "synthetic-cli-review",
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
    authorityDiffDigest,
    releaseDigest,
    decision: "approved",
  });
  const reviewFile = path.join(root, releaseReviewFile(identity));
  await writeFile(reviewFile, `${JSON.stringify(review, null, 2)}\n`);
  await writeFile(
    path.join(root, "baseline.json"),
    `${JSON.stringify({ schemaVersion: 1, mergeCommit: "a".repeat(40), records: [] })}\n`,
  );
  return {
    root,
    bundleDirectory: path.join(root, "release-output", releaseIdentityFileStem(identity)),
    reviewFile,
  };
};

it("runs actual CLI build and zero-write dry-run, then rejects descriptor tampering safely", async () => {
  const fixture = await createCliFixture();
  try {
    const serializedReview = Schema.decodeUnknownSync(Schema.JsonObject)(
      JSON.parse(await readFile(fixture.reviewFile, "utf8")),
    );
    await writeFile(
      fixture.reviewFile,
      JSON.stringify({
        ...serializedReview,
        authentication: { kind: "none", tokenName: "SYNTHETIC_TOKEN_OVERRIDE" },
      }),
    );
    const excessReviewRejected = await runReleaseCli(fixture.root, [
      "build",
      "baseline.json",
      "release-output-excess-review",
      "a".repeat(40),
      "1",
    ]);
    expect(excessReviewRejected.exitCode).toBe(1);
    expect(excessReviewRejected.stderr).toBe("Release failed: release-command-failed\n");
    expect(excessReviewRejected.stderr).not.toContain(fixture.root);
    await writeFile(fixture.reviewFile, `${JSON.stringify(serializedReview, null, 2)}\n`);

    const build = await runReleaseCli(fixture.root, [
      "build",
      "baseline.json",
      "release-output",
      "a".repeat(40),
      "1",
    ]);
    expect(build).toMatchObject({ exitCode: 0, stderr: "" });
    const dryRun = await runReleaseCli(fixture.root, ["publish", "release-output", "--dry-run"]);
    expect(dryRun).toMatchObject({ exitCode: 0, stderr: "" });
    expect(JSON.parse(dryRun.stdout)).toEqual({ mode: "dry-run", writes: 0, bundles: 1 });
    const wrongTrustedOrdinal = await runReleaseCli(fixture.root, ["publish", "release-output"], {
      MARKETPLACE_RELEASE_COMMIT: "a".repeat(40),
      MARKETPLACE_RELEASE_ORDINAL: "2",
    });
    expect(wrongTrustedOrdinal.exitCode).toBe(1);
    expect(wrongTrustedOrdinal.stderr).toBe("Release failed: release-ordinal-mismatch\n");
    expect(wrongTrustedOrdinal.stderr).not.toContain("required-configuration-missing");

    const releaseFile = path.join(fixture.bundleDirectory, "release.json");
    const serialized = JSON.parse(await readFile(releaseFile, "utf8")) as {
      schemaVersion: number;
      artifactRelativePath: string;
      version: { allowedHosts: Array<string> };
      releaseOrdinal: number;
      readonly [key: string]: unknown;
    };
    const {
      schemaVersion: _schemaVersion,
      artifactRelativePath: _artifactRelativePath,
      ...journalCandidate
    } = serialized;
    await writeFile(
      path.join(fixture.root, "failed-baseline.json"),
      `${JSON.stringify({
        schemaVersion: 1,
        mergeCommit: "b".repeat(40),
        records: [
          {
            ...journalCandidate,
            status: "failed",
            attempts: 1,
            failureType: "controlled-interruption",
            generation: 1,
          },
        ],
      })}\n`,
    );
    const retryBuild = await runReleaseCli(fixture.root, [
      "build",
      "failed-baseline.json",
      "release-output-retry",
      "b".repeat(40),
      "2",
    ]);
    expect(retryBuild).toMatchObject({ exitCode: 0, stderr: "" });
    const retriedRelease = JSON.parse(
      await readFile(
        path.join(
          fixture.root,
          "release-output-retry",
          path.basename(fixture.bundleDirectory),
          "release.json",
        ),
        "utf8",
      ),
    ) as { mergeCommit: string; releaseOrdinal: number };
    expect(retriedRelease).toMatchObject({ mergeCommit: "b".repeat(40), releaseOrdinal: 2 });
    const retryDryRun = await runReleaseCli(fixture.root, [
      "publish",
      "release-output-retry",
      "--dry-run",
    ]);
    expect(JSON.parse(retryDryRun.stdout)).toEqual({ mode: "dry-run", writes: 0, bundles: 1 });

    await writeFile(
      path.join(fixture.root, "verified-baseline.json"),
      `${JSON.stringify({
        schemaVersion: 1,
        mergeCommit: "c".repeat(40),
        records: [
          {
            ...journalCandidate,
            status: "published",
            attempts: 1,
            failureType: null,
            generation: 1,
            durableStateVerified: true,
          },
        ],
      })}\n`,
    );
    const noOpBuild = await runReleaseCli(fixture.root, [
      "build",
      "verified-baseline.json",
      "release-output-noop",
      "c".repeat(40),
      "3",
    ]);
    expect(noOpBuild).toMatchObject({ exitCode: 0, stderr: "" });
    expect(await readdir(path.join(fixture.root, "release-output-noop"))).toEqual([
      "release-set.json",
    ]);
    const noOpDryRun = await runReleaseCli(fixture.root, [
      "publish",
      "release-output-noop",
      "--dry-run",
    ]);
    expect(JSON.parse(noOpDryRun.stdout)).toEqual({ mode: "dry-run", writes: 0, bundles: 0 });

    serialized.releaseOrdinal = 999_999_999;
    await writeFile(releaseFile, JSON.stringify(serialized));
    const ordinalRejected = await runReleaseCli(fixture.root, [
      "publish",
      "release-output",
      "--dry-run",
    ]);
    expect(ordinalRejected.exitCode).toBe(1);
    expect(ordinalRejected.stderr).toBe("Release failed: release-attempt-binding-mismatch\n");
    expect(ordinalRejected.stderr).not.toContain(fixture.root);

    serialized.releaseOrdinal = 1;
    serialized.version.allowedHosts = ["tampered.example.invalid"];
    await writeFile(releaseFile, JSON.stringify(serialized));
    const rejected = await runReleaseCli(fixture.root, ["publish", "release-output", "--dry-run"]);
    expect(rejected.exitCode).toBe(1);
    expect(rejected.stderr).toBe("Release failed: release-bundle-contract-mismatch\n");
    expect(rejected.stderr).not.toContain(fixture.root);
  } finally {
    await rm(fixture.root, { recursive: true });
  }
});
