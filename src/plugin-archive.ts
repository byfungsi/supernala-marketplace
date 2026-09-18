import { Result, Schema } from "effect";

/** Supported immutable archive entry kinds. */
export const PluginArchiveEntryKind = Schema.Literals([
  "file",
  "directory",
  "symlink",
  "hardlink",
  "device",
  "socket",
  "fifo",
]);
/** Supported immutable archive entry kinds. */
export type PluginArchiveEntryKind = typeof PluginArchiveEntryKind.Type;

/** Metadata inspected before attacker-controlled archive bytes are expanded. */
export const PluginArchiveEntry = Schema.Struct({
  path: Schema.String.pipe(Schema.check(Schema.isLengthBetween(1, 1_024))),
  kind: PluginArchiveEntryKind,
  compressedBytes: Schema.Int.pipe(Schema.check(Schema.isGreaterThanOrEqualTo(0))),
  expandedBytes: Schema.Int.pipe(Schema.check(Schema.isGreaterThanOrEqualTo(0))),
});
/** Metadata inspected before attacker-controlled archive bytes are expanded. */
export interface PluginArchiveEntry extends Schema.Schema.Type<typeof PluginArchiveEntry> {}

/** Platform maxima used before extraction. */
export interface PluginArchiveSafetyLimits {
  readonly maximumFiles: number;
  readonly maximumExpandedBytes: number;
  readonly maximumFileBytes: number;
  readonly maximumCompressionRatio: number;
}

/** Safe archive rejection with no private path or package bytes. */
export class PluginArchiveRejected extends Schema.TaggedError<PluginArchiveRejected>()(
  "PluginArchiveRejected",
  {
    reason: Schema.Literals([
      "absolute-path",
      "path-traversal",
      "unsupported-entry-kind",
      "duplicate-path",
      "path-case-collision",
      "too-many-files",
      "expanded-size-exceeded",
      "file-size-exceeded",
      "compression-ratio-exceeded",
      "entrypoint-missing",
      "entrypoint-not-file",
    ]),
    path: Schema.optionalKey(Schema.String),
  },
) {}

/** Successful pre-extraction archive summary. */
export interface PluginArchiveInspection {
  readonly fileCount: number;
  readonly expandedBytes: number;
  readonly normalizedEntrypoint: string;
}

const inspectPluginArchivePath = (
  rawPath: string,
): Result.Result<string, PluginArchiveRejected> => {
  if (rawPath.startsWith("/") || /^[A-Za-z]:[\\/]/.test(rawPath)) {
    return Result.fail(new PluginArchiveRejected({ reason: "absolute-path", path: rawPath }));
  }
  if (rawPath.includes("\\")) {
    return Result.fail(new PluginArchiveRejected({ reason: "path-traversal", path: rawPath }));
  }
  const segments = rawPath.split("/").filter((segment) => segment !== "" && segment !== ".");
  if (segments.length === 0 || segments.some((segment) => segment === "..")) {
    return Result.fail(new PluginArchiveRejected({ reason: "path-traversal", path: rawPath }));
  }
  return Result.succeed(segments.join("/"));
};

/** Inspect archive metadata using the accepted Phase 1 path and bound semantics. */
export function inspectPluginArchive(input: {
  readonly entries: ReadonlyArray<PluginArchiveEntry>;
  readonly entrypoint: string;
  readonly limits: PluginArchiveSafetyLimits;
}): Result.Result<PluginArchiveInspection, PluginArchiveRejected> {
  if (input.entries.length > input.limits.maximumFiles) {
    return Result.fail(new PluginArchiveRejected({ reason: "too-many-files" }));
  }
  const entrypoint = inspectPluginArchivePath(input.entrypoint);
  if (Result.isFailure(entrypoint)) return Result.fail(entrypoint.failure);
  const exactPaths = new Set<string>();
  const foldedPaths = new Set<string>();
  let expandedBytes = 0;
  let entrypointKind: PluginArchiveEntryKind | undefined;
  for (const entry of input.entries) {
    const path = inspectPluginArchivePath(entry.path);
    if (Result.isFailure(path)) return Result.fail(path.failure);
    if (exactPaths.has(path.success)) {
      return Result.fail(
        new PluginArchiveRejected({ reason: "duplicate-path", path: path.success }),
      );
    }
    const folded = path.success.toLocaleLowerCase("en-US");
    if (foldedPaths.has(folded)) {
      return Result.fail(
        new PluginArchiveRejected({ reason: "path-case-collision", path: path.success }),
      );
    }
    exactPaths.add(path.success);
    foldedPaths.add(folded);
    if (entry.kind !== "file" && entry.kind !== "directory") {
      return Result.fail(
        new PluginArchiveRejected({ reason: "unsupported-entry-kind", path: path.success }),
      );
    }
    if (entry.kind === "file" && entry.expandedBytes > input.limits.maximumFileBytes) {
      return Result.fail(
        new PluginArchiveRejected({ reason: "file-size-exceeded", path: path.success }),
      );
    }
    if (
      entry.kind === "file" &&
      entry.expandedBytes > 0 &&
      (entry.compressedBytes === 0 ||
        entry.expandedBytes / entry.compressedBytes > input.limits.maximumCompressionRatio)
    ) {
      return Result.fail(
        new PluginArchiveRejected({ reason: "compression-ratio-exceeded", path: path.success }),
      );
    }
    expandedBytes += entry.expandedBytes;
    if (expandedBytes > input.limits.maximumExpandedBytes) {
      return Result.fail(new PluginArchiveRejected({ reason: "expanded-size-exceeded" }));
    }
    if (path.success === entrypoint.success) entrypointKind = entry.kind;
  }
  if (entrypointKind === undefined) {
    return Result.fail(
      new PluginArchiveRejected({ reason: "entrypoint-missing", path: entrypoint.success }),
    );
  }
  if (entrypointKind !== "file") {
    return Result.fail(
      new PluginArchiveRejected({ reason: "entrypoint-not-file", path: entrypoint.success }),
    );
  }
  return Result.succeed({
    fileCount: input.entries.filter((entry) => entry.kind === "file").length,
    expandedBytes,
    normalizedEntrypoint: entrypoint.success,
  });
}
