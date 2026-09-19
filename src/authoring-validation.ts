import { promises as fs } from "node:fs";
import path from "node:path";
import { Result, Schema } from "effect";
import {
  digestPluginBytes,
  PluginConfigSchema,
  PluginSha256,
  type PluginSha256 as PluginSha256Type,
} from "./plugin-contract.js";
import {
  buildDeterministicPluginArchive,
  encodePluginJsonFile,
  PackageCatalog,
  PackageManifest,
  parsePackagedPluginArchive,
  validatePackagedPluginLicenseEvidence,
  type ParsedPackagedPluginArchive,
} from "./package-archive.js";
import { pluginConfigHasNoExcessProperties } from "./plugin-config-validation.js";

const supportedJsonSchemaKeywords = new Set([
  "$schema",
  "type",
  "properties",
  "required",
  "additionalProperties",
  "items",
  "enum",
  "const",
  "minimum",
  "maximum",
  "minLength",
  "maxLength",
  "minItems",
  "maxItems",
  "pattern",
]);

/** Typed authoring failure safe to print without package contents. */
export class PluginAuthoringFailure extends Schema.TaggedError<PluginAuthoringFailure>()(
  "PluginAuthoringFailure",
  {
    operation: Schema.String,
    reason: Schema.String,
  },
) {
  /** Stable secret-safe authoring diagnostic. */
  override get message(): string {
    return `Plugin authoring failed during ${this.operation}: ${this.reason}`;
  }
}

/** Validated package source files and their exact manifest contracts. */
export interface ValidatedPluginSource {
  readonly directory: string;
  readonly manifest: PackageManifest;
  readonly catalog: PackageCatalog;
  readonly config: PluginConfigSchema;
  readonly provenance: Schema.Json;
  readonly files: Readonly<Record<string, Uint8Array>>;
}

const ManagedPackageBuildRecipe = Schema.Struct({
  schemaVersion: Schema.Literal(1),
  source: Schema.String.pipe(Schema.check(Schema.isLengthBetween(1, 1_024))),
  output: Schema.String.pipe(Schema.check(Schema.isLengthBetween(1, 1_024))),
  manifest: Schema.String.pipe(Schema.check(Schema.isLengthBetween(1, 1_024))),
  runtime: Schema.Literal("node-22.x"),
  runtimeDependencies: Schema.Array(Schema.NonEmptyString).pipe(
    Schema.check(Schema.isMaxLength(0)),
  ),
  networkDuringBuild: Schema.Literal(false),
  lifecycleScripts: Schema.Literal(false),
  deterministicCopy: Schema.Literal(true),
  license: Schema.String.pipe(Schema.check(Schema.isLengthBetween(1, 80))),
  licenseFile: Schema.String.pipe(Schema.check(Schema.isLengthBetween(1, 1_024))),
  noticeFile: Schema.String.pipe(Schema.check(Schema.isLengthBetween(1, 1_024))),
  preservedThirdPartyNotices: Schema.Array(
    Schema.String.pipe(Schema.check(Schema.isLengthBetween(1, 1_024))),
  ).pipe(Schema.check(Schema.isMaxLength(1_000))),
  packageFiles: Schema.Array(
    Schema.Struct({
      source: Schema.String.pipe(Schema.check(Schema.isLengthBetween(1, 1_024))),
      destination: Schema.String.pipe(Schema.check(Schema.isLengthBetween(1, 1_024))),
      sha256: PluginSha256,
    }),
  ).pipe(Schema.check(Schema.isLengthBetween(1, 1_000))),
});
interface ManagedPackageBuildRecipe extends Schema.Schema.Type<typeof ManagedPackageBuildRecipe> {}

interface PreparedSourceFiles {
  readonly files: Readonly<Record<string, Uint8Array>>;
  readonly declaredLicense: string | null;
}

/** Public source/build provenance accepted by Marketplace authoring validation. */
export const PluginProvenance = Schema.Struct({
  source: Schema.Struct({
    type: Schema.String.pipe(Schema.check(Schema.isLengthBetween(1, 80))),
    path: Schema.String.pipe(Schema.check(Schema.isLengthBetween(1, 1_024))),
    purpose: Schema.optionalKey(Schema.String.pipe(Schema.check(Schema.isLengthBetween(1, 200)))),
    upstream: Schema.optionalKey(
      Schema.NullOr(Schema.String.pipe(Schema.check(Schema.isLengthBetween(1, 2_048)))),
    ),
  }),
  build: Schema.Struct({
    recipeVersion: Schema.optionalKey(
      Schema.Int.pipe(Schema.check(Schema.isGreaterThanOrEqualTo(1))),
    ),
    recipe: Schema.optionalKey(Schema.String.pipe(Schema.check(Schema.isLengthBetween(1, 1_024)))),
    runtimeDependencies: Schema.Array(Schema.String).pipe(Schema.check(Schema.isMaxLength(1_000))),
    networkDuringBuild: Schema.optionalKey(Schema.Boolean),
    reproducible: Schema.optionalKey(Schema.Boolean),
    builtAt: Schema.optionalKey(Schema.String.pipe(Schema.check(Schema.isLengthBetween(1, 100)))),
  }),
  license: Schema.optionalKey(
    Schema.Struct({
      spdx: Schema.NullOr(Schema.String.pipe(Schema.check(Schema.isLengthBetween(1, 80)))),
      status: Schema.String.pipe(Schema.check(Schema.isLengthBetween(1, 200))),
      file: Schema.optionalKey(Schema.String.pipe(Schema.check(Schema.isLengthBetween(1, 1_024)))),
      notice: Schema.optionalKey(
        Schema.String.pipe(Schema.check(Schema.isLengthBetween(1, 1_024))),
      ),
      copyright: Schema.optionalKey(
        Schema.String.pipe(Schema.check(Schema.isLengthBetween(1, 200))),
      ),
    }),
  ),
  publication: Schema.optionalKey(
    Schema.Struct({
      eligible: Schema.Boolean,
      reason: Schema.String.pipe(Schema.check(Schema.isLengthBetween(1, 200))),
    }),
  ),
});
/** Public source/build provenance accepted by Marketplace authoring validation. */
export interface PluginProvenance extends Schema.Schema.Type<typeof PluginProvenance> {}

const parseJsonBytes = <S extends Schema.ConstraintDecoder<unknown>>(
  owner: string,
  bytes: Uint8Array,
  schema: S,
  rejectExcessProperties = false,
): Result.Result<S["Type"], PluginAuthoringFailure> => {
  try {
    return Schema.decodeUnknownResult(
      schema,
      rejectExcessProperties ? { onExcessProperty: "error" } : undefined,
    )(JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes))).pipe(
      Result.mapError(
        () => new PluginAuthoringFailure({ operation: "parse", reason: `invalid-${owner}` }),
      ),
    );
  } catch {
    return Result.fail(
      new PluginAuthoringFailure({ operation: "parse", reason: `invalid-${owner}` }),
    );
  }
};

const validateToolSchemaNode = (
  node: Schema.JsonObject,
  state: { nodes: number },
  depth: number,
): Result.Result<void, PluginAuthoringFailure> => {
  state.nodes += 1;
  if (state.nodes > 1_000 || depth > 20 || Object.keys(node).length > 100) {
    return Result.fail(
      new PluginAuthoringFailure({ operation: "schema", reason: "schema-bounds-exceeded" }),
    );
  }
  for (const keyword of Object.keys(node)) {
    if (!supportedJsonSchemaKeywords.has(keyword)) {
      return Result.fail(
        new PluginAuthoringFailure({ operation: "schema", reason: "unsupported-keyword" }),
      );
    }
  }
  if (node.type === "object" && node.additionalProperties !== false) {
    return Result.fail(
      new PluginAuthoringFailure({ operation: "schema", reason: "object-must-fail-closed" }),
    );
  }
  if (typeof node.maxLength === "number" && node.maxLength > 100_000) {
    return Result.fail(
      new PluginAuthoringFailure({ operation: "schema", reason: "string-bound-too-large" }),
    );
  }
  if (typeof node.maxItems === "number" && node.maxItems > 1_000) {
    return Result.fail(
      new PluginAuthoringFailure({ operation: "schema", reason: "array-bound-too-large" }),
    );
  }
  const properties = node.properties;
  if (properties !== undefined) {
    if (!Schema.is(Schema.JsonObject)(properties)) {
      return Result.fail(
        new PluginAuthoringFailure({ operation: "schema", reason: "invalid-properties" }),
      );
    }
    for (const child of Object.values(properties)) {
      if (!Schema.is(Schema.JsonObject)(child)) {
        return Result.fail(
          new PluginAuthoringFailure({ operation: "schema", reason: "invalid-property" }),
        );
      }
      const result = validateToolSchemaNode(child, state, depth + 1);
      if (Result.isFailure(result)) return result;
    }
  }
  if (node.items !== undefined) {
    if (!Schema.is(Schema.JsonObject)(node.items)) {
      return Result.fail(
        new PluginAuthoringFailure({ operation: "schema", reason: "invalid-items" }),
      );
    }
    return validateToolSchemaNode(node.items, state, depth + 1);
  }
  return Result.succeed(undefined);
};

const readSourceFiles = async (
  root: string,
  relative = "",
): Promise<Result.Result<Readonly<Record<string, Uint8Array>>, PluginAuthoringFailure>> => {
  const current = path.join(root, relative);
  const entries = await fs.readdir(current, { withFileTypes: true });
  const files: Record<string, Uint8Array> = {};
  for (const entry of entries.toSorted((left, right) => left.name.localeCompare(right.name))) {
    const child = path.posix.join(relative, entry.name);
    if (entry.isSymbolicLink()) {
      return Result.fail(
        new PluginAuthoringFailure({ operation: "read", reason: "links-not-allowed" }),
      );
    }
    if (entry.isDirectory()) {
      if (entry.name === "source") continue;
      const nested = await readSourceFiles(root, child);
      if (Result.isFailure(nested)) return nested;
      Object.assign(files, nested.success);
    } else if (entry.isFile()) {
      files[child] = new Uint8Array(await fs.readFile(path.join(root, child)));
    } else {
      return Result.fail(
        new PluginAuthoringFailure({ operation: "read", reason: "special-file-not-allowed" }),
      );
    }
  }
  return Result.succeed(files);
};

const isSafeBuildRecipePath = (value: string): boolean =>
  !path.isAbsolute(value) &&
  !value.includes("\\") &&
  path.posix.normalize(value) === value &&
  value.split("/").every((segment) => segment !== "" && segment !== "." && segment !== "..");

const pathIsInside = (root: string, candidate: string): boolean =>
  candidate.startsWith(`${root}${path.sep}`);

const resolveBuildRecipePath = (root: string, value: string): string | null => {
  if (!isSafeBuildRecipePath(value)) return null;
  const workingDirectoryCandidate = path.resolve(value);
  if (pathIsInside(root, workingDirectoryCandidate)) return workingDirectoryCandidate;
  const authoringDirectoryCandidate = path.resolve(root, value);
  return pathIsInside(root, authoringDirectoryCandidate) ? authoringDirectoryCandidate : null;
};

const readOrdinaryBuildRecipeFile = async (
  root: string,
  absolute: string,
): Promise<Result.Result<Uint8Array, PluginAuthoringFailure>> => {
  const relative = path.relative(root, absolute);
  let current = root;
  try {
    for (const [index, segment] of relative.split(path.sep).entries()) {
      current = path.join(current, segment);
      const metadata = await fs.lstat(current);
      if (
        metadata.isSymbolicLink() ||
        (index === relative.split(path.sep).length - 1
          ? !metadata.isFile()
          : !metadata.isDirectory())
      ) {
        return Result.fail(
          new PluginAuthoringFailure({
            operation: "build-recipe",
            reason: "source-not-ordinary-file",
          }),
        );
      }
    }
    return Result.succeed(new Uint8Array(await fs.readFile(absolute)));
  } catch {
    return Result.fail(
      new PluginAuthoringFailure({ operation: "build-recipe", reason: "source-unavailable" }),
    );
  }
};

const materializeBuildRecipe = async (
  root: string,
  recipeBytes: Uint8Array,
): Promise<Result.Result<PreparedSourceFiles, PluginAuthoringFailure>> => {
  const decoded = parseJsonBytes("build-recipe.json", recipeBytes, ManagedPackageBuildRecipe, true);
  if (Result.isFailure(decoded)) return Result.fail(decoded.failure);
  const recipe = decoded.success;
  const files: Record<string, Uint8Array> = {};
  const sourceByDestination = new Map<string, string>();
  for (const packageFile of recipe.packageFiles) {
    if (!isSafeBuildRecipePath(packageFile.destination)) {
      return Result.fail(
        new PluginAuthoringFailure({
          operation: "build-recipe",
          reason: "destination-path-invalid",
        }),
      );
    }
    if (sourceByDestination.has(packageFile.destination)) {
      return Result.fail(
        new PluginAuthoringFailure({
          operation: "build-recipe",
          reason: "destination-duplicate",
        }),
      );
    }
    const source = resolveBuildRecipePath(root, packageFile.source);
    if (source === null) {
      return Result.fail(
        new PluginAuthoringFailure({ operation: "build-recipe", reason: "source-path-invalid" }),
      );
    }
    const bytes = await readOrdinaryBuildRecipeFile(root, source);
    if (Result.isFailure(bytes)) return Result.fail(bytes.failure);
    if ((await digestPluginBytes(bytes.success)) !== packageFile.sha256) {
      return Result.fail(
        new PluginAuthoringFailure({ operation: "build-recipe", reason: "source-digest-mismatch" }),
      );
    }
    files[packageFile.destination] = bytes.success;
    sourceByDestination.set(packageFile.destination, source);
  }

  const manifest = resolveBuildRecipePath(root, recipe.manifest);
  const source = resolveBuildRecipePath(root, recipe.source);
  const output = resolveBuildRecipePath(root, recipe.output);
  const license = resolveBuildRecipePath(root, recipe.licenseFile);
  const notice = resolveBuildRecipePath(root, recipe.noticeFile);
  if (
    manifest === null ||
    source === null ||
    output === null ||
    license === null ||
    notice === null ||
    sourceByDestination.get("plugin.json") !== manifest ||
    sourceByDestination.get(path.relative(root, output).split(path.sep).join("/")) !== source ||
    sourceByDestination.get("LICENSE") !== license ||
    sourceByDestination.get("NOTICE") !== notice
  ) {
    return Result.fail(
      new PluginAuthoringFailure({ operation: "build-recipe", reason: "declaration-mismatch" }),
    );
  }
  return Result.succeed({ files, declaredLicense: recipe.license });
};

/** Validate an authoring directory before package preparation. */
export async function validatePluginSource(
  directory: string,
): Promise<Result.Result<ValidatedPluginSource, PluginAuthoringFailure>> {
  const root = path.resolve(directory);
  let sourceFiles: Result.Result<Readonly<Record<string, Uint8Array>>, PluginAuthoringFailure>;
  try {
    sourceFiles = await readSourceFiles(root);
  } catch {
    return Result.fail(
      new PluginAuthoringFailure({ operation: "read", reason: "source-unavailable" }),
    );
  }
  if (Result.isFailure(sourceFiles)) return Result.fail(sourceFiles.failure);
  let preparedSource: PreparedSourceFiles = { files: sourceFiles.success, declaredLicense: null };
  const recipeBytes = sourceFiles.success["build-recipe.json"];
  if (recipeBytes !== undefined) {
    const materialized = await materializeBuildRecipe(root, recipeBytes);
    if (Result.isFailure(materialized)) return Result.fail(materialized.failure);
    preparedSource = materialized.success;
  }
  const packageFiles = preparedSource.files;
  const required = ["plugin.json", "catalog.json", "config.json", "LICENSE", "provenance.json"];
  if (required.some((file) => packageFiles[file] === undefined)) {
    return Result.fail(
      new PluginAuthoringFailure({ operation: "validate", reason: "required-file-missing" }),
    );
  }
  const manifestBytes = packageFiles["plugin.json"];
  const catalogBytes = packageFiles["catalog.json"];
  const configBytes = packageFiles["config.json"];
  const provenanceBytes = packageFiles["provenance.json"];
  if (
    manifestBytes === undefined ||
    catalogBytes === undefined ||
    configBytes === undefined ||
    provenanceBytes === undefined
  ) {
    return Result.fail(
      new PluginAuthoringFailure({ operation: "validate", reason: "required-file-missing" }),
    );
  }
  const manifest = parseJsonBytes("plugin.json", manifestBytes, PackageManifest, true);
  const catalog = parseJsonBytes("catalog.json", catalogBytes, PackageCatalog);
  const configJson = parseJsonBytes("config.json", configBytes, Schema.Json);
  const config = parseJsonBytes("config.json", configBytes, PluginConfigSchema, true);
  const provenance = parseJsonBytes("provenance.json", provenanceBytes, PluginProvenance);
  if (Result.isFailure(manifest)) return Result.fail(manifest.failure);
  if (
    preparedSource.declaredLicense !== null &&
    manifest.success.license !== preparedSource.declaredLicense
  ) {
    return Result.fail(
      new PluginAuthoringFailure({ operation: "build-recipe", reason: "license-mismatch" }),
    );
  }
  if (Result.isFailure(catalog)) return Result.fail(catalog.failure);
  if (
    Result.isFailure(configJson) ||
    !pluginConfigHasNoExcessProperties(configJson.success) ||
    Result.isFailure(config)
  ) {
    return Result.fail(
      new PluginAuthoringFailure({ operation: "parse", reason: "invalid-config.json" }),
    );
  }
  if (Result.isFailure(provenance)) return Result.fail(provenance.failure);
  if (manifest.success.runtime.entrypoint !== "dist/server.mjs") {
    return Result.fail(
      new PluginAuthoringFailure({ operation: "validate", reason: "entrypoint-mismatch" }),
    );
  }
  if (packageFiles[manifest.success.runtime.entrypoint] === undefined) {
    return Result.fail(
      new PluginAuthoringFailure({ operation: "validate", reason: "entrypoint-missing" }),
    );
  }
  const licenseEvidence = await validatePackagedPluginLicenseEvidence({
    files: packageFiles,
    manifest: manifest.success,
  });
  if (Result.isFailure(licenseEvidence)) {
    return Result.fail(
      new PluginAuthoringFailure({ operation: "validate", reason: licenseEvidence.failure }),
    );
  }
  const catalogDigest = await digestPluginBytes(catalogBytes);
  const configDigest = await digestPluginBytes(configBytes);
  if (
    catalogDigest !== manifest.success.catalog.sha256 ||
    configDigest !== manifest.success.config.sha256
  ) {
    return Result.fail(
      new PluginAuthoringFailure({ operation: "validate", reason: "declared-digest-mismatch" }),
    );
  }
  const toolIds = new Set<string>();
  for (const tool of catalog.success.tools) {
    if (toolIds.has(tool.id)) {
      return Result.fail(
        new PluginAuthoringFailure({ operation: "validate", reason: "duplicate-tool-id" }),
      );
    }
    toolIds.add(tool.id);
    if (
      (tool.classification === "write" && tool.defaultPolicy !== "require-approval") ||
      ((tool.classification === "destructive" || tool.classification === "unknown") &&
        tool.defaultPolicy !== "block")
    ) {
      return Result.fail(
        new PluginAuthoringFailure({ operation: "validate", reason: "unsafe-default-policy" }),
      );
    }
    const reviewedSchema = validateToolSchemaNode(tool.inputSchema, { nodes: 0 }, 0);
    if (Result.isFailure(reviewedSchema)) return Result.fail(reviewedSchema.failure);
  }
  if (config.success.fields.some((field) => field.sourcePolicy === "owner-required")) {
    return Result.fail(
      new PluginAuthoringFailure({ operation: "validate", reason: "owner-config-unavailable" }),
    );
  }
  if (config.success.fields.some((field) => field.runtimeName === "PLUGIN_ACCESS_TOKEN")) {
    return Result.fail(
      new PluginAuthoringFailure({
        operation: "validate",
        reason: "reserved-host-credential-name",
      }),
    );
  }
  if (
    manifest.success.authentication.kind !== "none" &&
    config.success.fields.some(
      (field) =>
        field.sensitivity === "secret" ||
        field.delivery === "token-minting-adapter-only" ||
        field.affects.includes("authentication"),
    )
  ) {
    return Result.fail(
      new PluginAuthoringFailure({
        operation: "validate",
        reason: "credential-bearing-config-declaration",
      }),
    );
  }
  return Result.succeed({
    directory: path.resolve(directory),
    manifest: manifest.success,
    catalog: catalog.success,
    config: config.success,
    provenance: provenance.success,
    files: packageFiles,
  });
}

/** Deterministically package a validated source and verify its bytes with the Phase 1 inspector. */
export async function preparePluginPackage(input: {
  readonly source: ValidatedPluginSource;
  readonly marketplaceId: string;
  readonly versionId: string;
  readonly publishedAt: number;
}): Promise<
  Result.Result<
    {
      readonly archiveBytes: Uint8Array;
      readonly artifactDigest: PluginSha256Type;
      readonly parsed: ParsedPackagedPluginArchive;
    },
    PluginAuthoringFailure
  >
> {
  const archiveBytes = buildDeterministicPluginArchive(input.source.files);
  const parsed = await parsePackagedPluginArchive({
    archiveBytes,
    marketplaceId: input.marketplaceId,
    versionId: input.versionId,
    publishedAt: input.publishedAt,
  });
  if (Result.isFailure(parsed)) {
    return Result.fail(
      new PluginAuthoringFailure({ operation: "inspect", reason: parsed.failure }),
    );
  }
  return Result.succeed({
    archiveBytes,
    artifactDigest: await digestPluginBytes(archiveBytes),
    parsed: parsed.success,
  });
}

/** Rewrite only catalog/config digest declarations after reviewed file changes. */
export async function synchronizePluginManifestDigests(directory: string): Promise<void> {
  const manifestPath = path.join(directory, "plugin.json");
  const manifestJson: Schema.Json = JSON.parse(await fs.readFile(manifestPath, "utf8"));
  const manifest = Schema.decodeUnknownSync(PackageManifest)(manifestJson);
  const catalogDigest = await digestPluginBytes(
    new Uint8Array(await fs.readFile(path.join(directory, "catalog.json"))),
  );
  const configDigest = await digestPluginBytes(
    new Uint8Array(await fs.readFile(path.join(directory, "config.json"))),
  );
  const updated = PackageManifest.make({
    ...manifest,
    catalog: { path: "catalog.json", sha256: catalogDigest },
    config: { path: "config.json", sha256: configDigest },
  });
  await fs.writeFile(manifestPath, encodePluginJsonFile(updated));
}
