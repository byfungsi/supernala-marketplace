import { promises as fs } from "node:fs";
import path from "node:path";
import { Effect, Result, Schema } from "effect";
import { derivePluginAuthoritySnapshot, diffPluginAuthority } from "./authority-diff.js";
import { validatePluginSource } from "./authoring-validation.js";
import { inspectMcpJsonLines, inspectMcpStreamableHttpBody } from "./mcp-conformance.js";
import { parsePackagedPluginArchive } from "./package-archive.js";
import { makePackagedPluginPublicationPlan, PublicationReviewBinding } from "./publication-plan.js";
import { inspectPublicRepositorySafety } from "./public-repo-safety.js";
import { validateManagedRemotePluginRelease } from "./remote-release.js";
import { captureRemoteMcpCatalog } from "./remote-catalog-capture.js";
import { canonicalPluginJson, digestPluginBytes, PluginSha256 } from "./plugin-contract.js";
import { generateMarketplaceJsonSchemas } from "./schema-exports.js";
import {
  type PluginAuthoringAuthProfile,
  preparePluginAuthoringSource,
  scaffoldPluginAuthoringSource,
  type PluginAuthoringRuntime,
  validatePluginAuthoringSource,
} from "./plugin-authoring.js";

const writeJson = (value: unknown): void => {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
};

const fail = (message: string): never => {
  process.stderr.write(`Marketplace command failed: ${message}\n`);
  process.exitCode = 1;
  throw new Error("Marketplace command terminated");
};

const requireArgument = (
  arguments_: ReadonlyArray<string>,
  index: number,
  name: string,
): string => {
  const value = arguments_[index];
  return value === undefined ? fail(`missing-${name}`) : value;
};

const unwrapResult = <A, E>(result: Result.Result<A, E>, renderError: (error: E) => string): A => {
  if (Result.isSuccess(result)) return result.success;
  return fail(renderError(result.failure));
};

const sourceTreeDigest = async (directory: string): Promise<typeof PluginSha256.Type> => {
  const records: Array<{ readonly path: string; readonly digest: string }> = [];
  const visit = async (current: string): Promise<void> => {
    for (const entry of (await fs.readdir(current, { withFileTypes: true })).toSorted((a, b) =>
      a.name.localeCompare(b.name),
    )) {
      const absolute = path.join(current, entry.name);
      if (entry.isSymbolicLink()) fail("source-tree-link-not-allowed");
      if (entry.isDirectory()) await visit(absolute);
      else if (entry.isFile()) {
        records.push({
          path: path.relative(directory, absolute).split(path.sep).join("/"),
          digest: await digestPluginBytes(new Uint8Array(await fs.readFile(absolute))),
        });
      }
    }
  };
  await visit(path.resolve(directory));
  return digestPluginBytes(new TextEncoder().encode(canonicalPluginJson(records)));
};

const validateCommand = async (directory: string): Promise<void> => {
  const source = unwrapResult(await validatePluginAuthoringSource(directory), (error) => error);
  writeJson({
    valid: true,
    runtime: source.runtime,
    plugin: source.plugin,
    version: source.version,
    tools: source.tools,
    publicationEligible: source.publicationEligible,
    publicationBlocker: source.publicationBlocker,
  });
};

const prepareCommand = async (directory: string, output: string): Promise<void> => {
  const prepared = unwrapResult(
    await preparePluginAuthoringSource({ sourcePath: directory, outputFile: output }),
    (error) => error,
  );
  writeJson({
    ...prepared,
    output: path.basename(output),
    publication: "not-performed",
  });
};

const createCommand = async (arguments_: ReadonlyArray<string>): Promise<void> => {
  const slug = requireArgument(arguments_, 0, "plugin-slug");
  if (arguments_[1] !== "--runtime") fail("expected---runtime");
  const runtimeArgument = requireArgument(arguments_, 2, "runtime");
  const runtime: PluginAuthoringRuntime =
    runtimeArgument === "managed-package" || runtimeArgument === "managed-remote-mcp"
      ? runtimeArgument
      : fail("runtime-invalid");
  let auth: PluginAuthoringAuthProfile | undefined;
  if (arguments_.length > 3) {
    if (arguments_[3] !== "--auth") fail("expected---auth");
    const authArgument = requireArgument(arguments_, 4, "auth-profile");
    auth =
      authArgument === "workspace-oauth" ||
      authArgument === "mcp-oauth" ||
      authArgument === "api-key" ||
      authArgument === "device-oauth"
        ? authArgument
        : fail("auth-profile-invalid");
  }
  if (arguments_.length !== (auth === undefined ? 3 : 5)) fail("unexpected-create-arguments");
  const created = unwrapResult(
    await scaffoldPluginAuthoringSource({
      rootDirectory: "plugins",
      slug,
      runtime,
      ...(auth === undefined ? {} : { auth }),
    }),
    (error) => error,
  );
  writeJson({
    created: path.relative(process.cwd(), created.directory),
    runtime,
    auth: auth ?? null,
    files: created.files,
    publicationEligible: false,
  });
};

const inspectCommand = async (archive: string): Promise<void> => {
  const bytes = new Uint8Array(await fs.readFile(archive));
  const parsed = await parsePackagedPluginArchive({
    archiveBytes: bytes,
    marketplaceId: "supernala-public",
    versionId: "offline-inspection",
    publishedAt: 0,
  });
  const packageResult = unwrapResult(parsed, (error) => error);
  writeJson({
    artifactDigest:
      packageResult.version.runtime.kind === "managed-package"
        ? packageResult.version.runtime.artifactDigest
        : null,
    manifestDigest:
      packageResult.version.runtime.kind === "managed-package"
        ? packageResult.version.runtime.manifestDigest
        : null,
    catalogDigest: packageResult.version.catalog.digest,
    configDigest: packageResult.configDigest,
    entries: packageResult.entries.map((entry) => entry.path),
  });
};

const diffCommand = async (beforeDirectory: string, afterDirectory: string): Promise<void> => {
  const before = await validatePluginSource(beforeDirectory);
  const after = await validatePluginSource(afterDirectory);
  const validBefore = unwrapResult(before, (error) => error.message);
  const validAfter = unwrapResult(after, (error) => error.message);
  const diff = await diffPluginAuthority(
    derivePluginAuthoritySnapshot(validBefore),
    derivePluginAuthoritySnapshot(validAfter),
  );
  writeJson(diff);
  if (diff.expandsAuthority) process.exitCode = 2;
};

const conformanceCommand = async (fixture: string): Promise<void> => {
  const bytes = new Uint8Array(await fs.readFile(fixture));
  const result = fixture.endsWith(".jsonl")
    ? inspectMcpJsonLines({ bytes, expectedIds: [1, 2, "call-1"] })
    : inspectMcpStreamableHttpBody({
        contentType: "application/json",
        bytes,
        expectedId: "http-1",
      });
  writeJson(unwrapResult(result, (error) => error));
};

const remoteCommand = async (): Promise<void> => {
  const directory = path.resolve("plugins/remotes");
  const files = (await fs.readdir(directory)).filter((file) => file.endsWith(".json")).toSorted();
  for (const file of files) {
    const parsed = validateManagedRemotePluginRelease(
      JSON.parse(await fs.readFile(path.join(directory, file), "utf8")),
      "authoring",
    );
    const release = unwrapResult(parsed, (error) => `${file}:${error}`);
    const publishable = validateManagedRemotePluginRelease(release, "publication");
    if (Result.isSuccess(publishable)) fail(`${file}:unexpectedly-publishable`);
  }
  writeJson({ valid: true, staged: files });
};

const captureRemoteCatalogCommand = async (
  inputFile: string,
  outputFile: string,
): Promise<void> => {
  const observed: unknown = JSON.parse(await fs.readFile(inputFile, "utf8"));
  const capture = unwrapResult(await captureRemoteMcpCatalog(observed), (error) => error);
  await fs.writeFile(outputFile, `${JSON.stringify(capture, null, 2)}\n`);
  writeJson({
    output: path.basename(outputFile),
    digest: capture.digest,
    tools: capture.tools.length,
    publication: "not-performed",
  });
};

const safetyCommand = async (): Promise<void> => {
  const findings = await inspectPublicRepositorySafety(process.cwd());
  if (findings.length > 0) {
    writeJson({ safe: false, findings });
    process.exitCode = 1;
    return;
  }
  writeJson({ safe: true, scannedRoot: "." });
};

const exportSchemasCommand = async (): Promise<void> => {
  await fs.mkdir("schemas", { recursive: true });
  for (const [file, schema] of Object.entries(generateMarketplaceJsonSchemas())) {
    await fs.writeFile(path.join("schemas", file), `${JSON.stringify(schema, null, 2)}\n`);
  }
  writeJson({ generated: Object.keys(generateMarketplaceJsonSchemas()).toSorted() });
};

const verifyPlanCommand = async (planFile: string, reviewId: string): Promise<void> => {
  const { loadPhase1PublicationInput } = await import("./publication-plan.js");
  const loaded = unwrapResult(
    await loadPhase1PublicationInput({ planFile, expectedReviewId: reviewId }),
    (error) => error,
  );
  writeJson({
    adapterContract: "Phase1.PublishPackagedPluginVersionInput",
    definitionId: loaded.definitionId,
    versionId: loaded.version.id,
    artifactDigest: loaded.expectedArtifactDigest,
    archiveByteLength: loaded.archiveBytes.byteLength,
    reviewedAt: loaded.reviewedAt,
    publication: "not-performed",
  });
};

const planCommand = async (arguments_: ReadonlyArray<string>): Promise<void> => {
  const sourceDirectory = requireArgument(arguments_, 0, "source-directory");
  const archiveFile = requireArgument(arguments_, 1, "archive-file");
  const planFile = requireArgument(arguments_, 2, "plan-file");
  const reviewId = requireArgument(arguments_, 3, "review-id");
  const reviewer = requireArgument(arguments_, 4, "reviewer");
  const authorityDiffDigest = Schema.decodeUnknownSync(PluginSha256)(
    requireArgument(arguments_, 5, "authority-diff-digest"),
  );
  const reviewedAt = Number(requireArgument(arguments_, 6, "reviewed-at"));
  if (!Number.isSafeInteger(reviewedAt) || reviewedAt < 0) fail("reviewed-at-invalid");
  const archiveBytes = new Uint8Array(await fs.readFile(archiveFile));
  const source = await validatePluginSource(sourceDirectory);
  const validSource = unwrapResult(source, (error) => error.message);
  const parsed = await parsePackagedPluginArchive({
    archiveBytes,
    marketplaceId: "supernala-public",
    versionId: `${validSource.manifest.id}-${validSource.manifest.version}`,
    publishedAt: 0,
  });
  const packageResult = unwrapResult(parsed, (error) => error);
  const sourceDigest = await sourceTreeDigest(sourceDirectory);
  const artifactDigest = await digestPluginBytes(archiveBytes);
  const relativeArtifactPath = path.relative(
    path.dirname(path.resolve(planFile)),
    path.resolve(archiveFile),
  );
  if (relativeArtifactPath.split(path.sep).includes("..")) {
    fail("artifact-must-be-beside-or-below-plan");
  }
  const review = PublicationReviewBinding.make({
    reviewId,
    reviewedAt,
    reviewer,
    sourceTreeDigest: sourceDigest,
    artifactDigest,
    authentication: packageResult.authentication,
    catalogDigest: packageResult.version.catalog.digest,
    configDigest: packageResult.configDigest,
    authorityDiffDigest,
    decision: "approved",
  });
  const plan = makePackagedPluginPublicationPlan({
    definitionId: packageResult.version.pluginSlug,
    artifactRelativePath: relativeArtifactPath.split(path.sep).join("/"),
    artifactByteLength: archiveBytes.byteLength,
    version: packageResult.version,
    authentication: packageResult.authentication,
    catalog: validSource.catalog,
    config: validSource.config,
    provenance: validSource.provenance,
    review,
  });
  await fs.writeFile(planFile, `${JSON.stringify(plan, null, 2)}\n`);
  writeJson({ plan: path.basename(planFile), mode: "plan-only", publication: "not-performed" });
};

const main = async (): Promise<void> => {
  const [command, ...arguments_] = process.argv.slice(2);
  switch (command) {
    case "deploy": {
      const { runLocalMarketplaceDeploy } = await import("./local-marketplace-deploy.js");
      await Effect.runPromise(
        runLocalMarketplaceDeploy(arguments_).pipe(
          Effect.catch((error) =>
            Effect.sync(() => {
              process.stderr.write(
                `Marketplace deploy failed: ${error.reason}. Use deploy --environment production --status to inspect retained attempts.\n`,
              );
              process.exitCode = 1;
            }),
          ),
        ),
      );
      return;
    }
    case "validate":
      return validateCommand(requireArgument(arguments_, 0, "source-directory"));
    case "create":
      return createCommand(arguments_);
    case "prepare":
      return prepareCommand(
        requireArgument(arguments_, 0, "source-directory"),
        requireArgument(arguments_, 1, "output-file"),
      );
    case "inspect":
      return inspectCommand(requireArgument(arguments_, 0, "archive-file"));
    case "diff-authority":
      return diffCommand(
        requireArgument(arguments_, 0, "before-directory"),
        requireArgument(arguments_, 1, "after-directory"),
      );
    case "conformance":
      return conformanceCommand(requireArgument(arguments_, 0, "fixture-file"));
    case "validate-remotes":
      return remoteCommand();
    case "capture-remote-catalog":
      return captureRemoteCatalogCommand(
        requireArgument(arguments_, 0, "observed-catalog-file"),
        requireArgument(arguments_, 1, "output-file"),
      );
    case "plan-publication":
      return planCommand(arguments_);
    case "public-safety":
      return safetyCommand();
    case "export-schemas":
      return exportSchemasCommand();
    case "verify-plan":
      return verifyPlanCommand(
        requireArgument(arguments_, 0, "plan-file"),
        requireArgument(arguments_, 1, "review-id"),
      );
    default:
      return fail(
        "expected deploy|create|validate|prepare|inspect|diff-authority|conformance|validate-remotes|capture-remote-catalog|plan-publication|verify-plan|public-safety|export-schemas",
      );
  }
};

main().catch((error: unknown) => {
  if (process.exitCode === undefined) {
    process.stderr.write(
      error instanceof Error
        ? `Marketplace command failed: ${error.message}\n`
        : "Marketplace command failed\n",
    );
    process.exitCode = 1;
  }
});
