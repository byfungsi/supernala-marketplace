import { promises as fs } from "node:fs";
import path from "node:path";
import { Result, Schema } from "effect";
import { validatePluginSource } from "./authoring-validation.js";
import { CloudflareD1RestTransport, CloudflareR2S3ArtifactStore } from "./cloudflare-adapters.js";
import { D1ReleaseJournal } from "./d1-release-journal.js";
import { Phase1D1PublicationAdapter } from "./phase1-d1-publication-adapter.js";
import { canonicalPluginJson, digestPluginBytes, PluginSha256 } from "./plugin-contract.js";
import { inspectPublicRepositorySafety } from "./public-repo-safety.js";
import { verifyPublishedReleaseBaseline } from "./release-baseline.js";
import {
  buildManagedPackageReleaseBundle,
  calculateManagedPackageSourceInputDigest,
  loadManagedPackageReleaseBundle,
  readReleaseBundleIdentity,
  releaseBundleDirectory,
  releaseIdentityFileStem,
  releaseReviewFile,
  ReleaseReview,
} from "./release-bundle.js";
import {
  publishIncrementalRelease,
  ReleaseJournalRecordSchema,
  selectIncrementalReleaseSources,
  type IncrementalReleaseCandidate,
  type PluginReleaseIdentity,
  type ReleaseSourceState,
} from "./release-machine.js";
import { validatePublicationAuthorityLineage } from "./release-lineage.js";
import { ReleaseSet } from "./release-set.js";
import {
  LocalReleaseCoordinator,
  ReleaseAttemptId,
  ReleaseCommit,
  ReleaseOrdinal,
} from "./local-release-coordinator.js";

const ReleaseIndex = Schema.Struct({
  schemaVersion: Schema.Literal(1),
  sharedInputs: Schema.Array(Schema.NonEmptyString),
  plugins: Schema.Array(
    Schema.Struct({
      sourceDirectory: Schema.NonEmptyString,
      kind: Schema.Literals(["managed-package", "managed-remote-mcp"]),
      publicationEligible: Schema.Boolean,
      reason: Schema.NonEmptyString,
    }),
  ),
});

const VerifiedReleaseBaseline = Schema.Struct({
  schemaVersion: Schema.Literal(1),
  mergeCommit: Schema.String.pipe(Schema.check(Schema.isPattern(/^[a-f0-9]{40}$/u))),
  records: Schema.Array(ReleaseJournalRecordSchema),
});

const fail = (message: string): never => {
  throw new Error(message);
};

const releaseSetDigest = async (input: {
  readonly mergeCommit: string;
  readonly releaseOrdinal: number;
  readonly bundles: ReadonlyArray<{
    readonly identity: PluginReleaseIdentity;
    readonly releaseDigest: typeof PluginSha256.Type;
    readonly reviewId: string;
  }>;
}): Promise<typeof PluginSha256.Type> =>
  digestPluginBytes(
    new TextEncoder().encode(
      canonicalPluginJson({
        schemaVersion: 1,
        mergeCommit: input.mergeCommit,
        releaseOrdinal: input.releaseOrdinal,
        bundles: input.bundles.toSorted((left, right) =>
          canonicalPluginJson(left.identity).localeCompare(canonicalPluginJson(right.identity)),
        ),
      }),
    ),
  );

const unwrap = <A, E>(result: Result.Result<A, E>, render: (error: E) => string): A =>
  Result.isSuccess(result) ? result.success : fail(render(result.failure));

const requiredEnvironment = (name: string): string => {
  const value = process.env[name];
  return value === undefined || value === ""
    ? fail(`required-configuration-missing:${name}`)
    : value;
};

const readJson = async <S extends Schema.ConstraintDecoder<unknown>>(
  file: string,
  schema: S,
): Promise<S["Type"]> =>
  Schema.decodeUnknownSync(schema, { onExcessProperty: "error" })(
    JSON.parse(await fs.readFile(file, "utf8")),
  );

const digestSharedInputs = async (
  files: ReadonlyArray<string>,
): Promise<typeof PluginSha256.Type> => {
  const entries = [];
  for (const file of files.toSorted()) {
    entries.push({
      file,
      digest: await digestPluginBytes(new Uint8Array(await fs.readFile(file))),
    });
  }
  return digestPluginBytes(new TextEncoder().encode(JSON.stringify(entries)));
};

const exportBaseline = async (output: string, mergeCommit: string): Promise<void> => {
  if (!/^[a-f0-9]{40}$/u.test(mergeCommit)) fail("merge-commit-invalid");
  const accountId = requiredEnvironment("CLOUDFLARE_ACCOUNT_ID");
  const journal = new D1ReleaseJournal(
    new CloudflareD1RestTransport({
      accountId,
      databaseId: requiredEnvironment("MARKETPLACE_JOURNAL_DATABASE_ID"),
      apiToken: requiredEnvironment("MARKETPLACE_JOURNAL_READ_TOKEN"),
    }),
  );
  const application = new Phase1D1PublicationAdapter(
    new CloudflareD1RestTransport({
      accountId,
      databaseId: requiredEnvironment("APPLICATION_DATABASE_ID"),
      apiToken: requiredEnvironment("APPLICATION_PLUGIN_READ_TOKEN"),
    }),
  );
  const artifacts = new CloudflareR2S3ArtifactStore({
    accountId,
    bucketName: requiredEnvironment("PLUGIN_PACKAGE_BUCKET_NAME"),
    accessKeyId: requiredEnvironment("PLUGIN_PACKAGE_R2_READ_ACCESS_KEY_ID"),
    secretAccessKey: requiredEnvironment("PLUGIN_PACKAGE_R2_READ_SECRET_ACCESS_KEY"),
  });
  const baseline = unwrap(
    await verifyPublishedReleaseBaseline({
      records: await journal.list(),
      application,
      artifacts,
    }),
    (error) => error,
  );
  await fs.writeFile(
    output,
    `${JSON.stringify({ schemaVersion: 1, mergeCommit, records: baseline }, null, 2)}\n`,
  );
};

const selectAndBuild = async (input: {
  readonly baselineFile: string;
  readonly outputDirectory: string;
  readonly mergeCommit: string;
  readonly releaseOrdinal: number;
}): Promise<void> => {
  if (!/^[a-f0-9]{40}$/u.test(input.mergeCommit)) fail("merge-commit-invalid");
  const index = await readJson("releases/index.json", ReleaseIndex);
  const baselineEnvelope = await readJson(input.baselineFile, VerifiedReleaseBaseline);
  if (baselineEnvelope.mergeCommit !== input.mergeCommit) fail("baseline-merge-commit-mismatch");
  const baseline = baselineEnvelope.records;
  const sharedInputDigest = await digestSharedInputs(index.sharedInputs);
  const states: Array<ReleaseSourceState> = [];
  const sourceByKey = new Map<string, string>();
  for (const plugin of index.plugins) {
    if (!plugin.publicationEligible) continue;
    if (plugin.kind !== "managed-package")
      fail("eligible-remote-release-requires-reviewed-adapter");
    const source = unwrap(
      await validatePluginSource(plugin.sourceDirectory),
      () => "release-source-invalid",
    );
    const identity = {
      marketplaceId: "supernala-public",
      publisherNamespace: source.manifest.publisher,
      pluginSlug: source.manifest.id,
      semanticVersion: source.manifest.version,
    };
    states.push({
      identity,
      kind: "managed-package",
      publicationEligible: true,
      sourceInputDigest: await calculateManagedPackageSourceInputDigest({
        sourceDirectory: plugin.sourceDirectory,
        sharedInputDigest,
      }),
    });
    sourceByKey.set(
      `${identity.publisherNamespace}/${identity.pluginSlug}`,
      plugin.sourceDirectory,
    );
  }
  const selected = unwrap(
    selectIncrementalReleaseSources({ sources: states, journal: baseline }),
    (error) => error,
  );
  await fs.mkdir(input.outputDirectory, { recursive: true });
  const outputs: Array<{
    readonly relativePath: string;
    readonly identity: PluginReleaseIdentity;
    readonly releaseDigest: typeof PluginSha256.Type;
    readonly reviewId: string;
  }> = [];
  for (const state of selected) {
    const sourceDirectory =
      sourceByKey.get(`${state.identity.publisherNamespace}/${state.identity.pluginSlug}`) ??
      fail("selected-source-missing");
    const reviewFile = releaseReviewFile(state.identity);
    const review = await readJson(reviewFile, ReleaseReview);
    const output = releaseBundleDirectory(input.outputDirectory, state.identity);
    const previousAuthorityRecord = baseline
      .filter(
        (record) =>
          record.identity.marketplaceId === state.identity.marketplaceId &&
          record.identity.publisherNamespace === state.identity.publisherNamespace &&
          record.identity.pluginSlug === state.identity.pluginSlug &&
          record.status === "published" &&
          record.identity.semanticVersion !== state.identity.semanticVersion,
      )
      .toSorted((left, right) => right.releaseOrdinal - left.releaseOrdinal)[0];
    if (previousAuthorityRecord?.durableStateRevoked === true) {
      fail("previous-authority-version-revoked");
    }
    const previousPublished = previousAuthorityRecord ?? null;
    const candidate = unwrap(
      await buildManagedPackageReleaseBundle({
        sourceDirectory,
        outputDirectory: output,
        sharedInputDigest,
        mergeCommit: input.mergeCommit,
        releaseOrdinal: input.releaseOrdinal,
        review,
        previousPublished,
      }),
      (error) => error,
    );
    outputs.push({
      relativePath: path.relative(input.outputDirectory, output),
      identity: candidate.identity,
      releaseDigest: candidate.releaseDigest,
      reviewId: candidate.reviewId,
    });
  }
  const setDigest = await releaseSetDigest({
    mergeCommit: input.mergeCommit,
    releaseOrdinal: input.releaseOrdinal,
    bundles: outputs.map(({ identity, releaseDigest, reviewId }) => ({
      identity,
      releaseDigest,
      reviewId,
    })),
  });
  await fs.writeFile(
    path.join(input.outputDirectory, "release-set.json"),
    `${JSON.stringify(
      {
        schemaVersion: 1,
        mergeCommit: input.mergeCommit,
        releaseOrdinal: input.releaseOrdinal,
        setDigest,
        bundles: outputs,
      },
      null,
      2,
    )}\n`,
  );
};

const publishBundles = async (directory: string, dryRun: boolean): Promise<void> => {
  const releaseSetFile = path.join(directory, "release-set.json");
  if ((await fs.lstat(releaseSetFile)).isSymbolicLink()) fail("release-set-link-rejected");
  const releaseSet = await readJson(releaseSetFile, ReleaseSet);
  const mergeCommit = dryRun
    ? releaseSet.mergeCommit
    : requiredEnvironment("MARKETPLACE_RELEASE_COMMIT");
  if (mergeCommit !== releaseSet.mergeCommit) fail("release-merge-commit-mismatch");
  const releaseOrdinal = dryRun
    ? releaseSet.releaseOrdinal
    : Number(requiredEnvironment("MARKETPLACE_RELEASE_ORDINAL"));
  if (!Number.isSafeInteger(releaseOrdinal) || releaseOrdinal < 0) {
    fail("release-ordinal-invalid");
  }
  if (releaseOrdinal !== releaseSet.releaseOrdinal) fail("release-ordinal-mismatch");
  const index = await readJson("releases/index.json", ReleaseIndex);
  const sharedInputDigest = await digestSharedInputs(index.sharedInputs);
  const sourceByKey = new Map<string, string>();
  for (const plugin of index.plugins) {
    if (!plugin.publicationEligible || plugin.kind !== "managed-package") continue;
    const source = unwrap(
      await validatePluginSource(plugin.sourceDirectory),
      () => "release-source-invalid",
    );
    sourceByKey.set(`${source.manifest.publisher}/${source.manifest.id}`, plugin.sourceDirectory);
  }
  const verifiedBundles: Array<{
    readonly candidate: IncrementalReleaseCandidate;
    readonly review: ReleaseReview;
  }> = [];
  const identities = new Set<string>();
  const verifiedSetEntries = [];
  const root = path.resolve(directory);
  for (const bundle of releaseSet.bundles) {
    if (
      path.isAbsolute(bundle.relativePath) ||
      bundle.relativePath.split(/[\\/]/u).includes("..")
    ) {
      fail("release-bundle-path-invalid");
    }
    const bundleDirectory = path.resolve(root, bundle.relativePath);
    if (!bundleDirectory.startsWith(`${root}${path.sep}`)) fail("release-bundle-path-invalid");
    const stat = await fs.lstat(bundleDirectory);
    if (!stat.isDirectory() || stat.isSymbolicLink()) fail("release-bundle-link-rejected");
    const claimedIdentity = unwrap(
      await readReleaseBundleIdentity(bundleDirectory),
      (error) => error,
    );
    if (
      canonicalPluginJson(claimedIdentity) !== canonicalPluginJson(bundle.identity) ||
      bundle.relativePath !== releaseIdentityFileStem(claimedIdentity)
    ) {
      fail("release-set-identity-mismatch");
    }
    const identityKey = canonicalPluginJson(claimedIdentity);
    if (identities.has(identityKey)) fail("release-set-duplicate-identity");
    identities.add(identityKey);
    const sourceDirectory =
      sourceByKey.get(`${claimedIdentity.publisherNamespace}/${claimedIdentity.pluginSlug}`) ??
      fail("release-source-not-eligible");
    const trustedReview = await readJson(releaseReviewFile(claimedIdentity), ReleaseReview);
    const safetyFindings = await inspectPublicRepositorySafety(bundleDirectory);
    if (safetyFindings.length > 0) fail("release-artifact-public-safety-failed");
    const loaded = unwrap(
      await loadManagedPackageReleaseBundle({
        bundleDirectory,
        sourceDirectory,
        sharedInputDigest,
        trustedReview,
        expectedMergeCommit: mergeCommit,
        expectedReleaseOrdinal: releaseOrdinal,
      }),
      (error) => error,
    );
    if (loaded.releaseDigest !== bundle.releaseDigest || loaded.reviewId !== bundle.reviewId) {
      fail("release-set-candidate-mismatch");
    }
    verifiedBundles.push({ candidate: loaded, review: trustedReview });
    verifiedSetEntries.push({
      identity: loaded.identity,
      releaseDigest: loaded.releaseDigest,
      reviewId: loaded.reviewId,
    });
  }
  const verifiedSetDigest = await releaseSetDigest({
    mergeCommit,
    releaseOrdinal,
    bundles: verifiedSetEntries,
  });
  if (verifiedSetDigest !== releaseSet.setDigest) fail("release-set-digest-mismatch");
  if (dryRun) {
    process.stdout.write(
      `${JSON.stringify({ mode: "dry-run", writes: 0, bundles: verifiedBundles.length })}\n`,
    );
    return;
  }
  if (requiredEnvironment("MARKETPLACE_APPROVED_RELEASE_SET_DIGEST") !== verifiedSetDigest) {
    fail("release-set-approval-mismatch");
  }
  const accountId = requiredEnvironment("CLOUDFLARE_ACCOUNT_ID");
  const coordinator = new LocalReleaseCoordinator(
    new CloudflareD1RestTransport({
      accountId,
      databaseId: requiredEnvironment("MARKETPLACE_JOURNAL_DATABASE_ID"),
      apiToken: requiredEnvironment("MARKETPLACE_JOURNAL_WRITE_TOKEN"),
    }),
  );
  const attemptId = Schema.decodeUnknownSync(ReleaseAttemptId)(
    requiredEnvironment("MARKETPLACE_RELEASE_ATTEMPT_ID"),
  );
  const journal = new D1ReleaseJournal(
    new CloudflareD1RestTransport({
      accountId,
      databaseId: requiredEnvironment("MARKETPLACE_JOURNAL_DATABASE_ID"),
      apiToken: requiredEnvironment("MARKETPLACE_JOURNAL_WRITE_TOKEN"),
    }),
  );
  const application = new Phase1D1PublicationAdapter(
    new CloudflareD1RestTransport({
      accountId,
      databaseId: requiredEnvironment("APPLICATION_DATABASE_ID"),
      apiToken: requiredEnvironment("APPLICATION_PLUGIN_PUBLISH_TOKEN"),
    }),
  );
  const artifacts = new CloudflareR2S3ArtifactStore({
    accountId,
    bucketName: requiredEnvironment("PLUGIN_PACKAGE_BUCKET_NAME"),
    accessKeyId: requiredEnvironment("PLUGIN_PACKAGE_R2_ACCESS_KEY_ID"),
    secretAccessKey: requiredEnvironment("PLUGIN_PACKAGE_R2_SECRET_ACCESS_KEY"),
  });
  const currentJournal = await journal.list();
  for (const bundle of verifiedBundles) {
    const lineage = await validatePublicationAuthorityLineage({
      candidate: bundle.candidate,
      review: bundle.review,
      records: currentJournal,
      application,
    });
    if (Result.isFailure(lineage)) fail(lineage.failure);
  }
  unwrap(
    await coordinator.beginPublication({
      attemptId,
      commit: Schema.decodeUnknownSync(ReleaseCommit)(mergeCommit),
      ordinal: Schema.decodeUnknownSync(ReleaseOrdinal)(releaseOrdinal),
      digest: verifiedSetDigest,
    }),
    (error) => error.reason,
  );
  for (const { candidate: loaded } of verifiedBundles) {
    const published = await publishIncrementalRelease({
      candidate: loaded,
      journal,
      artifacts,
      application,
    });
    if (Result.isFailure(published)) fail(published.failure);
  }
  unwrap(await coordinator.finish(attemptId, "completed"), (error) => error.reason);
};

const main = async (): Promise<void> => {
  const [command, ...arguments_] = process.argv.slice(2);
  if (command === "baseline") {
    return exportBaseline(
      arguments_[0] ?? fail("baseline-output-required"),
      arguments_[1] ?? fail("merge-commit-required"),
    );
  }
  if (command === "build") {
    const releaseOrdinal = Number(arguments_[3]);
    if (!Number.isSafeInteger(releaseOrdinal) || releaseOrdinal < 0)
      fail("release-ordinal-invalid");
    return selectAndBuild({
      baselineFile: arguments_[0] ?? fail("baseline-file-required"),
      outputDirectory: arguments_[1] ?? fail("release-output-required"),
      mergeCommit: arguments_[2] ?? fail("merge-commit-required"),
      releaseOrdinal,
    });
  }
  if (command === "publish") {
    return publishBundles(
      arguments_[0] ?? fail("release-directory-required"),
      arguments_[1] === "--dry-run",
    );
  }
  fail("expected baseline|build|publish");
};

main().catch((error: unknown) => {
  const message =
    error instanceof Error && /^[a-z0-9][a-z0-9:-]{0,159}$/u.test(error.message)
      ? error.message
      : "release-command-failed";
  process.stderr.write(`Release failed: ${message}\n`);
  process.exitCode = 1;
});
