import { promises as fs } from "node:fs";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { Result, Schema } from "effect";
import { digestPluginBytes, PluginSha256, PluginToolId } from "./plugin-contract.js";
import {
  compilePluginOpenApi,
  PluginOpenApiAuthoring,
  PluginOpenApiOperationSelection,
} from "./plugin-openapi-compiler.js";
import {
  discoverPluginOpenApiCandidates,
  discoverPluginOpenApiSecuritySchemes,
} from "./plugin-openapi-discovery.js";
import {
  fetchPluginOpenApiHostedJson,
  parsePluginOpenApiHostedUrl,
  type PluginOpenApiHostedTransport,
} from "./plugin-openapi-hosted-fetch.js";
import {
  PluginMarketplaceId,
  PluginPublisherNamespace,
  PluginSemanticVersion,
  PluginSlug,
} from "./plugin-contract.js";

/** Reviewed OpenAPI source metadata and selected operations; no credential values. */
export const PluginOpenApiSource = Schema.Struct({
  ...PluginOpenApiAuthoring.fields,
  operations: Schema.Array(PluginOpenApiOperationSelection).pipe(
    Schema.check(Schema.isLengthBetween(0, 2_000)),
  ),
  status: Schema.Literals(["staged-unverified", "reviewed-publishable"]),
  marketplaceId: PluginMarketplaceId,
  publisherNamespace: PluginPublisherNamespace,
  pluginSlug: PluginSlug,
  version: PluginSemanticVersion,
  name: Schema.NonEmptyString,
  description: Schema.NonEmptyString,
  license: Schema.NonEmptyString,
  hostedSource: Schema.optionalKey(
    Schema.Struct({
      url: Schema.NonEmptyString,
      sha256: PluginSha256,
      pluginVersionId: PluginOpenApiAuthoring.fields.pluginVersionId,
      catalogSnapshotId: PluginOpenApiAuthoring.fields.catalogSnapshotId,
    }),
  ),
  hostedSourceUrl: Schema.optionalKey(Schema.NonEmptyString),
});
/** Reviewed OpenAPI authoring record used by create, validate, and prepare. */
export type PluginOpenApiSource = typeof PluginOpenApiSource.Type;

/** Reads local spec and selection without links or external reference resolution. */
export async function loadPluginOpenApiSource(sourcePath: string): Promise<
  Result.Result<
    {
      readonly source: PluginOpenApiSource;
      readonly sourceText: string;
      readonly compiled: Awaited<ReturnType<typeof compilePluginOpenApi>> extends Result.Result<
        infer A,
        string
      >
        ? A
        : never;
    },
    string
  >
> {
  try {
    const stat = await fs.lstat(sourcePath);
    if (!stat.isDirectory() || stat.isSymbolicLink())
      return Result.fail("openapi-source-directory-invalid");
    const metadataPath = path.join(sourcePath, "openapi-source.json");
    const metadataInfo = await fs.lstat(metadataPath);
    if (!metadataInfo.isFile() || metadataInfo.isSymbolicLink() || metadataInfo.size > 1_048_576)
      return Result.fail("openapi-source-file-invalid");
    const source = Schema.decodeUnknownResult(PluginOpenApiSource, { onExcessProperty: "error" })(
      JSON.parse(await fs.readFile(metadataPath, "utf8")),
    );
    if (Result.isFailure(source)) return Result.fail("openapi-authoring-invalid");
    if (
      source.success.hostedSourceUrl !== undefined &&
      (source.success.hostedSource === undefined ||
        source.success.hostedSource.url !== source.success.hostedSourceUrl ||
        parsePluginOpenApiHostedUrl(source.success.hostedSourceUrl) === null)
    )
      return Result.fail("openapi-hosted-pin-required");
    if (source.success.hostedSource !== undefined && source.success.hostedSourceUrl === undefined)
      return Result.fail("openapi-hosted-pin-invalid");
    if (
      source.success.hostedSource !== undefined &&
      (source.success.hostedSource.pluginVersionId !== source.success.pluginVersionId ||
        source.success.hostedSource.catalogSnapshotId !== source.success.catalogSnapshotId)
    )
      return Result.fail("openapi-hosted-pin-version-mismatch");
    const specFile =
      source.success.hostedSource === undefined
        ? "openapi.json"
        : `openapi-${source.success.hostedSource.sha256}.json`;
    const files = [specFile];
    for (const file of files) {
      const info = await fs.lstat(path.join(sourcePath, file));
      if (!info.isFile() || info.isSymbolicLink() || info.size > 1_048_576) {
        return Result.fail("openapi-source-file-invalid");
      }
    }
    if (
      source.success.pluginVersionId !==
      `${source.success.marketplaceId}:${source.success.publisherNamespace}:${source.success.pluginSlug}@${source.success.version}`
    ) {
      return Result.fail("openapi-source-identity-mismatch");
    }
    const sourceBytes = new Uint8Array(await fs.readFile(path.join(sourcePath, specFile)));
    if (
      source.success.hostedSource !== undefined &&
      (await digestPluginBytes(sourceBytes)) !== source.success.hostedSource.sha256
    )
      return Result.fail("openapi-hosted-pin-mismatch");
    const sourceText = new TextDecoder("utf-8", { fatal: true }).decode(sourceBytes);
    const compiled = await compilePluginOpenApi({ sourceText, authoring: source.success });
    if (Result.isFailure(compiled)) return Result.fail(compiled.failure);
    return Result.succeed({ source: source.success, sourceText, compiled: compiled.success });
  } catch {
    return Result.fail("openapi-source-invalid");
  }
}

/** Explicitly refreshes hosted OpenAPI JSON, staging immutable bytes before atomically replacing metadata. */
export async function refreshPluginOpenApiHostedSource(input: {
  readonly sourcePath: string;
  readonly transport?: PluginOpenApiHostedTransport;
}): Promise<
  Result.Result<
    {
      readonly candidates: Awaited<ReturnType<typeof discoverPluginOpenApiCandidates>>;
      readonly added: ReadonlyArray<string>;
      readonly removed: ReadonlyArray<string>;
      readonly sha256: string;
    },
    string
  >
> {
  let lock: Awaited<ReturnType<typeof fs.open>>;
  const lockPath = path.join(input.sourcePath, ".openapi-refresh.lock");
  try {
    lock = await fs.open(lockPath, "wx");
  } catch {
    return Result.fail("openapi-hosted-refresh-locked");
  }
  try {
    const dir = await fs.lstat(input.sourcePath);
    const metadataPath = path.join(input.sourcePath, "openapi-source.json");
    const stat = await fs.lstat(metadataPath);
    if (
      !dir.isDirectory() ||
      dir.isSymbolicLink() ||
      !stat.isFile() ||
      stat.isSymbolicLink() ||
      stat.size > 1_048_576
    )
      return Result.fail("openapi-source-file-invalid");
    const original = Schema.decodeUnknownResult(PluginOpenApiSource, { onExcessProperty: "error" })(
      JSON.parse(await fs.readFile(metadataPath, "utf8")),
    );
    if (Result.isFailure(original)) return Result.fail("openapi-authoring-invalid");
    const source = original.success;
    if (
      source.hostedSourceUrl === undefined ||
      parsePluginOpenApiHostedUrl(source.hostedSourceUrl) === null
    )
      return Result.fail("openapi-hosted-url-invalid");
    if (
      source.pluginVersionId !==
      `${source.marketplaceId}:${source.publisherNamespace}:${source.pluginSlug}@${source.version}`
    )
      return Result.fail("openapi-source-identity-mismatch");
    const text = await fetchPluginOpenApiHostedJson(source.hostedSourceUrl, input.transport);
    const securitySchemes = discoverPluginOpenApiSecuritySchemes(text);
    const selectedScheme =
      source.hostedSource === undefined &&
      source.operations.length === 0 &&
      securitySchemes.length === 1
        ? securitySchemes[0]
        : source.credential.securityScheme;
    const preparedSource =
      selectedScheme === undefined
        ? source
        : { ...source, credential: { ...source.credential, securityScheme: selectedScheme } };
    const sha256 = await digestPluginBytes(new TextEncoder().encode(text));
    if (
      source.hostedSource !== undefined &&
      source.hostedSource.sha256 !== sha256 &&
      (source.pluginVersionId === source.hostedSource.pluginVersionId ||
        source.catalogSnapshotId === source.hostedSource.catalogSnapshotId)
    )
      return Result.fail("openapi-hosted-new-version-required");
    const candidates = await discoverPluginOpenApiCandidates(text, preparedSource);
    const candidateIds = new Set(
      candidates
        .filter((candidate) => candidate.reason === null)
        .map((candidate) => candidate.operationId),
    );
    const presentIds = new Set(candidates.map((candidate) => candidate.operationId));
    const oldIds = new Set(source.operations.map((operation) => operation.operationId));
    const removed = source.operations
      .filter((operation) => !candidateIds.has(operation.operationId))
      .map((operation) => operation.operationId);
    const added = candidates
      .filter(
        (candidate) =>
          candidate.reason === null &&
          candidate.operationId !== null &&
          !oldIds.has(candidate.operationId),
      )
      .map((candidate) => candidate.operationId ?? "");
    if (removed.length > 0)
      return Result.fail(
        removed.some((id) => presentIds.has(id))
          ? "openapi-selected-operation-incompatible"
          : "openapi-selected-operation-removed",
      );
    const operations =
      source.operations.length > 0
        ? source.operations
        : candidates
            .filter(
              (candidate) =>
                candidate.reason === null &&
                candidate.operationId !== null &&
                candidate.toolId !== null,
            )
            .map((candidate) => ({
              operationId: candidate.operationId ?? "",
              toolId: PluginToolId.make(candidate.toolId ?? ""),
              title: candidate.operationId ?? "",
              classification: "unknown" as const,
              defaultPolicy: "block" as const,
              maximumOutputBytes: 4096,
            }));
    if (operations.length === 0) return Result.fail("openapi-no-supported-operations");
    const next = {
      ...preparedSource,
      status:
        source.hostedSource?.sha256 === sha256 &&
        source.hostedSource.pluginVersionId === source.pluginVersionId &&
        source.hostedSource.catalogSnapshotId === source.catalogSnapshotId
          ? source.status
          : ("staged-unverified" as const),
      operations,
      hostedSource: {
        url: source.hostedSourceUrl,
        sha256,
        pluginVersionId: source.pluginVersionId,
        catalogSnapshotId: source.catalogSnapshotId,
      },
    };
    const compiled = await compilePluginOpenApi({ sourceText: text, authoring: next });
    if (Result.isFailure(compiled)) return Result.fail(compiled.failure);
    const pinnedFile = path.join(input.sourcePath, `openapi-${sha256}.json`);
    await fs
      .writeFile(pinnedFile, text, { flag: "wx" })
      .catch(async (error: NodeJS.ErrnoException) => {
        if (error.code !== "EEXIST") throw error;
        const info = await fs.lstat(pinnedFile);
        if (!info.isFile() || info.isSymbolicLink() || info.size > 1_048_576)
          throw new Error("openapi-hosted-pin-conflict");
        if ((await digestPluginBytes(new Uint8Array(await fs.readFile(pinnedFile)))) !== sha256)
          throw new Error("openapi-hosted-pin-conflict");
      });
    const temporary = path.join(input.sourcePath, `.openapi-source-${randomUUID()}.json`);
    try {
      await fs.writeFile(temporary, `${JSON.stringify(next, null, 2)}\n`, { flag: "wx" });
      await fs.rename(temporary, metadataPath);
    } finally {
      await fs.rm(temporary, { force: true });
    }
    return Result.succeed({ candidates, added, removed, sha256 });
  } catch (error) {
    return Result.fail(
      error instanceof Error && /^openapi-[a-z-]+$/u.test(error.message)
        ? error.message
        : "openapi-hosted-refresh-failed",
    );
  } finally {
    await lock.close();
    await fs.rm(lockPath, { force: true });
  }
}

/** Inspects a hosted source candidate without modifying its pin or reviewed selection. */
export async function inspectPluginOpenApiHostedCandidates(input: {
  readonly sourcePath: string;
  readonly transport?: PluginOpenApiHostedTransport;
}): Promise<
  Result.Result<
    {
      readonly securitySchemes: ReadonlyArray<string>;
      readonly candidates: Awaited<ReturnType<typeof discoverPluginOpenApiCandidates>>;
      readonly removed: ReadonlyArray<string>;
      readonly incompatible: ReadonlyArray<string>;
    },
    string
  >
> {
  try {
    const dir = await fs.lstat(input.sourcePath);
    const file = path.join(input.sourcePath, "openapi-source.json");
    const info = await fs.lstat(file);
    if (
      !dir.isDirectory() ||
      dir.isSymbolicLink() ||
      !info.isFile() ||
      info.isSymbolicLink() ||
      info.size > 1_048_576
    )
      return Result.fail("openapi-source-file-invalid");
    const decoded = Schema.decodeUnknownResult(PluginOpenApiSource, { onExcessProperty: "error" })(
      JSON.parse(await fs.readFile(file, "utf8")),
    );
    if (Result.isFailure(decoded) || decoded.success.hostedSourceUrl === undefined)
      return Result.fail("openapi-authoring-invalid");
    const source = decoded.success;
    const text = await fetchPluginOpenApiHostedJson(source.hostedSourceUrl ?? "", input.transport);
    const securitySchemes = discoverPluginOpenApiSecuritySchemes(text);
    const chosen =
      source.hostedSource === undefined &&
      source.operations.length === 0 &&
      securitySchemes.length === 1
        ? securitySchemes[0]
        : source.credential.securityScheme;
    const candidates = await discoverPluginOpenApiCandidates(text, {
      ...source,
      credential: {
        ...source.credential,
        securityScheme: chosen ?? source.credential.securityScheme,
      },
    });
    const removed = source.operations
      .filter(
        (operation) =>
          !candidates.some((candidate) => candidate.operationId === operation.operationId),
      )
      .map((operation) => operation.operationId);
    const incompatible = source.operations
      .filter((operation) =>
        candidates.some(
          (candidate) =>
            candidate.operationId === operation.operationId && candidate.reason !== null,
        ),
      )
      .map((operation) => operation.operationId);
    return Result.succeed({ securitySchemes, candidates, removed, incompatible });
  } catch (error) {
    return Result.fail(
      error instanceof Error && /^openapi-[a-z-]+$/u.test(error.message)
        ? error.message
        : "openapi-hosted-discovery-failed",
    );
  }
}
