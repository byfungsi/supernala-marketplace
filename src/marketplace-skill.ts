import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { Result, Schema } from "effect";
import { parse as parseYaml } from "yaml";

/*
 * Curated Marketplace Skills. Each Skill lives in `skills/<publisher>/<slug>/` as a reviewed
 * `skill.json` plus the exact upstream folder in `files/`. These rules mirror the application's
 * Skill folder contract (`packages/domain/src/agent-skill-bundle.ts` and `marketplace-skill.ts`),
 * so anything this repository accepts is a Skill the application can install.
 */

/** The application generates `SKILL.md` from a Skill's metadata and instructions. */
export const SKILL_INSTRUCTIONS_FILE = "SKILL.md";
export const SKILL_MAX_FILES = 200;
export const SKILL_MAX_FILE_BYTES = 10_000_000;
export const SKILL_MAX_TOTAL_BYTES = 50_000_000;
const SKILL_MAX_INSTRUCTIONS_LENGTH = 32_000;
const MAX_PATH_LENGTH = 256;
const MAX_PATH_DEPTH = 10;
const MAX_SEGMENT_LENGTH = 120;

/** Files that are packaging debris rather than Skill content; never published. */
const IGNORED_FILE_NAMES = new Set([".DS_Store", "Thumbs.db"]);

const SlugPattern = /^[a-z0-9](?:[a-z0-9-]{0,78}[a-z0-9])?$/u;
const Slug = Schema.String.pipe(Schema.check(Schema.isPattern(SlugPattern)));
const SemanticVersion = Schema.String.pipe(Schema.check(Schema.isPattern(/^\d+\.\d+\.\d+$/u)));

/** Permissive licenses the application admits; anything else never enters the catalog. */
export const MarketplaceSkillLicense = Schema.Literals([
  "MIT",
  "Apache-2.0",
  "BSD-2-Clause",
  "BSD-3-Clause",
  "ISC",
  "CC-BY-4.0",
  "CC0-1.0",
  "0BSD",
  "Unlicense",
  "LicenseRef-Supernala",
]);
export type MarketplaceSkillLicense = typeof MarketplaceSkillLicense.Type;

/** Where a curated version came from; Supernala-authored Skills have no upstream. */
export const MarketplaceSkillSource = Schema.Union([
  Schema.TaggedStruct("github", {
    repository: Schema.String.pipe(Schema.check(Schema.isPattern(/^[\w.-]+\/[\w.-]+$/u))),
    commit: Schema.String.pipe(Schema.check(Schema.isPattern(/^[0-9a-f]{40}$/u))),
    path: Schema.String.pipe(Schema.check(Schema.isMaxLength(512))),
  }),
  Schema.TaggedStruct("supernala", {}),
]);
export type MarketplaceSkillSource = typeof MarketplaceSkillSource.Type;

/** `skill.json`: catalog presentation plus the reviewed upstream identity of `files/`. */
export const MarketplaceSkillManifest = Schema.Struct({
  schemaVersion: Schema.Literal(1),
  marketplaceId: Slug,
  publisher: Schema.Struct({
    namespace: Slug,
    name: Schema.String.pipe(Schema.check(Schema.isLengthBetween(1, 120))),
  }),
  slug: Slug,
  version: SemanticVersion,
  name: Schema.String.pipe(Schema.check(Schema.isLengthBetween(1, 120))),
  shortDescription: Schema.String.pipe(Schema.check(Schema.isLengthBetween(1, 600))),
  longDescription: Schema.String.pipe(Schema.check(Schema.isMaxLength(8_000))),
  categories: Schema.Array(Schema.String.pipe(Schema.check(Schema.isLengthBetween(1, 60)))).pipe(
    Schema.check(Schema.isMaxLength(8)),
  ),
  /** Lower ranks are featured first; `null` is not featured. */
  featuredRank: Schema.NullOr(Schema.Int.pipe(Schema.check(Schema.isGreaterThanOrEqualTo(0)))),
  license: MarketplaceSkillLicense,
  attribution: Schema.String.pipe(Schema.check(Schema.isMaxLength(4_000))),
  source: MarketplaceSkillSource,
  /** Files Supernala added beside the upstream ones, such as a license notice upstream omitted. */
  addedFiles: Schema.Array(Schema.String),
});
export type MarketplaceSkillManifest = typeof MarketplaceSkillManifest.Type;

/** `releases/skills.json`: which curated Skills may be published, and why. */
export const MarketplaceSkillReleaseIndex = Schema.Struct({
  schemaVersion: Schema.Literal(1),
  skills: Schema.Array(
    Schema.Struct({
      id: Schema.String,
      publicationEligible: Schema.Boolean,
      reason: Schema.String.pipe(Schema.check(Schema.isLengthBetween(1, 1_000))),
    }),
  ),
});
export type MarketplaceSkillReleaseIndex = typeof MarketplaceSkillReleaseIndex.Type;

/** One file of a Skill folder beside `SKILL.md`, as the application stores it. */
export interface MarketplaceSkillFile {
  readonly path: string;
  readonly byteSize: number;
  readonly sha256: string;
}

/** A validated, publishable Skill version with the exact bytes of every file. */
export interface MarketplaceSkillRelease {
  readonly id: string;
  readonly versionId: string;
  readonly manifest: MarketplaceSkillManifest;
  /** The Skill's own name and description from `SKILL.md`, as installed into a Workspace. */
  readonly skillName: string;
  readonly skillDescription: string;
  readonly instructionsMarkdown: string;
  readonly files: ReadonlyArray<MarketplaceSkillFile>;
  readonly byteSize: number;
  readonly contents: ReadonlyMap<string, Uint8Array>;
  /** Digest of everything a published version makes immutable. */
  readonly releaseDigest: string;
}

export type MarketplaceSkillProblem =
  | "skill-manifest-invalid"
  | "skill-identity-mismatch"
  | "skill-instructions-missing"
  | "skill-frontmatter-invalid"
  | "skill-continued-instructions-conflict"
  | "skill-file-link-not-allowed"
  | "skill-file-path-invalid"
  | "skill-too-many-files"
  | "skill-file-too-large"
  | "skill-too-large"
  | "skill-path-conflict"
  | "skill-added-file-missing"
  | "skill-release-index-invalid";

const sha256Hex = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");

const isSafeSegment = (segment: string) =>
  segment.length > 0 &&
  segment.length <= MAX_SEGMENT_LENGTH &&
  segment !== "." &&
  segment !== ".." &&
  segment.trim() === segment &&
  // oxlint-disable-next-line no-control-regex -- Control characters are exactly what is refused.
  !/[\\:\u0000-\u001f\u007f]/u.test(segment);

/** Relative POSIX path the application accepts inside a Skill folder, excluding root `SKILL.md`. */
export const isSkillFilePath = (filePath: string): boolean => {
  if (filePath.length > MAX_PATH_LENGTH) return false;
  if (!filePath.isWellFormed() || filePath.normalize("NFC") !== filePath) return false;
  const segments = filePath.split("/");
  if (segments.length > MAX_PATH_DEPTH || !segments.every(isSafeSegment)) return false;

  return filePath.toLowerCase() !== SKILL_INSTRUCTIONS_FILE.toLowerCase();
};

/** Folder invariants for a path-sorted file list, as the application checks them. */
export const skillFilesProblem = (
  files: ReadonlyArray<Pick<MarketplaceSkillFile, "path" | "byteSize">>,
): MarketplaceSkillProblem | undefined => {
  if (files.length > SKILL_MAX_FILES) return "skill-too-many-files";
  if (files.some((file) => file.byteSize > SKILL_MAX_FILE_BYTES)) return "skill-file-too-large";
  if (files.reduce((sum, file) => sum + file.byteSize, 0) > SKILL_MAX_TOTAL_BYTES) {
    return "skill-too-large";
  }
  const paths = new Set(files.map((file) => file.path));
  if (paths.size !== files.length) return "skill-path-conflict";
  for (const filePath of paths) {
    const segments = filePath.split("/");
    for (let depth = 1; depth < segments.length; depth += 1) {
      if (paths.has(segments.slice(0, depth).join("/"))) return "skill-path-conflict";
    }
  }

  return undefined;
};

const SKILL_MAX_DESCRIPTION_LENGTH = 600;

const FrontmatterFields = Schema.Struct({
  name: Schema.String.pipe(Schema.check(Schema.isLengthBetween(1, 120))),
  description: Schema.String.pipe(Schema.check(Schema.isMinLength(1))),
});

/** Where the remainder of over-long instructions goes, matching the application's Skill import. */
export const CONTINUED_INSTRUCTIONS_FILE = "references/SKILL.continued.md";

/** Clips a description to the stored limit the way the application's Skill import does. */
export const clipSkillDescription = (text: string): string =>
  text.length <= SKILL_MAX_DESCRIPTION_LENGTH
    ? text
    : `${text.slice(0, SKILL_MAX_DESCRIPTION_LENGTH - 1).trimEnd()}…`;

/**
 * Splits instructions longer than the stored limit at a heading or paragraph boundary; the rest
 * becomes a folder file the kept part points to. Identical to the application's
 * `splitLongInstructions`, so a curated Skill installs exactly as an imported one would.
 */
export const splitLongInstructions = (
  instructionsMarkdown: string,
): { readonly kept: string; readonly rest: string } | undefined => {
  if (instructionsMarkdown.length <= SKILL_MAX_INSTRUCTIONS_LENGTH) return undefined;
  const budget = SKILL_MAX_INSTRUCTIONS_LENGTH - 400;
  const window = instructionsMarkdown.slice(0, budget);
  const heading = window.lastIndexOf("\n#");
  const paragraph = window.lastIndexOf("\n\n");
  const cut = heading > budget / 2 ? heading : paragraph > budget / 2 ? paragraph : budget;
  const kept = `${instructionsMarkdown.slice(0, cut).trimEnd()}\n\n---\n\nThese instructions continue in \`${CONTINUED_INSTRUCTIONS_FILE}\` in this skill's folder. Read it when the task needs the rest.`;

  return { kept, rest: instructionsMarkdown.slice(cut).trimStart() };
};

/** Splits `SKILL.md` into its frontmatter `name`/`description` and the instructions body. */
export const parseSkillMarkdown = (
  markdown: string,
): Result.Result<
  { readonly name: string; readonly description: string; readonly instructions: string },
  MarketplaceSkillProblem
> => {
  const normalized = markdown.replaceAll("\r\n", "\n");
  const match = /^---\n([\s\S]*?)\n---(?:\n|$)/u.exec(normalized);
  if (match === null) return Result.fail("skill-frontmatter-invalid");
  let parsed: unknown;
  try {
    parsed = parseYaml(match[1] ?? "");
  } catch {
    return Result.fail("skill-frontmatter-invalid");
  }
  const decoded = Schema.decodeUnknownResult(FrontmatterFields)(
    typeof parsed === "object" && parsed !== null
      ? {
          name: String(Reflect.get(parsed, "name") ?? "").trim(),
          description: String(Reflect.get(parsed, "description") ?? "")
            .replaceAll(/\s+/gu, " ")
            .trim(),
        }
      : {},
  );
  if (Result.isFailure(decoded)) return Result.fail("skill-frontmatter-invalid");
  const instructions = normalized.slice(match[0].length).replace(/^\n+/u, "").trimEnd();
  if (instructions.trim() === "") return Result.fail("skill-instructions-missing");

  return Result.succeed({ ...decoded.success, instructions });
};

/** Canonical JSON with sorted object keys, so a digest never depends on key order. */
export const canonicalSkillJson = (value: unknown): string => {
  if (Array.isArray(value)) return `[${value.map(canonicalSkillJson).join(",")}]`;
  if (value !== null && typeof value === "object") {
    return `{${Object.keys(value)
      .toSorted()
      .map((key) => `${JSON.stringify(key)}:${canonicalSkillJson(Reflect.get(value, key))}`)
      .join(",")}}`;
  }

  return JSON.stringify(value);
};

const walkFiles = async (
  root: string,
  relative = "",
): Promise<Result.Result<ReadonlyArray<string>, MarketplaceSkillProblem>> => {
  const found: Array<string> = [];
  const entries = await fs.readdir(path.join(root, relative), { withFileTypes: true });
  for (const entry of entries) {
    const child = relative === "" ? entry.name : `${relative}/${entry.name}`;
    if (entry.isSymbolicLink()) return Result.fail("skill-file-link-not-allowed");
    if (entry.isDirectory()) {
      // oxlint-disable-next-line no-await-in-loop -- A Skill folder is small and walked in order.
      const nested = await walkFiles(root, child);
      if (Result.isFailure(nested)) return nested;
      found.push(...nested.success);
    } else if (entry.isFile() && !IGNORED_FILE_NAMES.has(entry.name)) {
      found.push(child);
    }
  }

  return Result.succeed(found);
};

/** The fields a published version makes immutable; the release digest covers exactly these. */
export const skillReleaseDigest = (input: {
  readonly versionId: string;
  readonly skillName: string;
  readonly skillDescription: string;
  readonly instructionsMarkdown: string;
  readonly files: ReadonlyArray<MarketplaceSkillFile>;
  readonly license: MarketplaceSkillLicense;
  readonly attribution: string;
  readonly source: MarketplaceSkillSource;
}): string => sha256Hex(new TextEncoder().encode(canonicalSkillJson(input)));

/** Reads and validates one `skills/<publisher>/<slug>/` directory into a publishable release. */
export const loadMarketplaceSkill = async (
  directory: string,
): Promise<Result.Result<MarketplaceSkillRelease, MarketplaceSkillProblem>> => {
  let manifestJson: unknown;
  try {
    manifestJson = JSON.parse(await fs.readFile(path.join(directory, "skill.json"), "utf8"));
  } catch {
    return Result.fail("skill-manifest-invalid");
  }
  const manifest = Schema.decodeUnknownResult(MarketplaceSkillManifest)(manifestJson);
  if (Result.isFailure(manifest)) return Result.fail("skill-manifest-invalid");
  const { publisher, slug } = manifest.success;
  // The directory is the identity: skills/<publisher>/<slug>.
  if (
    path.basename(directory) !== slug ||
    path.basename(path.dirname(directory)) !== publisher.namespace
  ) {
    return Result.fail("skill-identity-mismatch");
  }

  const filesRoot = path.join(directory, "files");
  let markdown: string;
  try {
    markdown = await fs.readFile(path.join(filesRoot, SKILL_INSTRUCTIONS_FILE), "utf8");
  } catch {
    return Result.fail("skill-instructions-missing");
  }
  const parsed = parseSkillMarkdown(markdown);
  if (Result.isFailure(parsed)) return Result.fail(parsed.failure);

  const listed = await walkFiles(filesRoot);
  if (Result.isFailure(listed)) return Result.fail(listed.failure);
  // Code-unit order, matching the application's `previous.path >= file.path` sort check.
  const filePaths = listed.success
    .filter((filePath) => filePath !== SKILL_INSTRUCTIONS_FILE)
    .toSorted((left, right) => (left < right ? -1 : left > right ? 1 : 0));
  if (!filePaths.every(isSkillFilePath)) return Result.fail("skill-file-path-invalid");
  if (manifest.success.addedFiles.some((added) => !filePaths.includes(added))) {
    return Result.fail("skill-added-file-missing");
  }

  // Over-long instructions continue in a folder file, exactly as the application imports them.
  const split = splitLongInstructions(parsed.success.instructions);
  if (split !== undefined && filePaths.includes(CONTINUED_INSTRUCTIONS_FILE)) {
    return Result.fail("skill-continued-instructions-conflict");
  }
  const instructionsMarkdown = split?.kept ?? parsed.success.instructions;
  const skillDescription = clipSkillDescription(parsed.success.description);

  const contents = new Map<string, Uint8Array>();
  const sources = new Map<string, Uint8Array>();
  for (const filePath of filePaths) {
    // oxlint-disable-next-line no-await-in-loop -- Bounded by SKILL_MAX_FILES; sequential keeps memory flat.
    sources.set(filePath, new Uint8Array(await fs.readFile(path.join(filesRoot, filePath))));
  }
  if (split !== undefined) {
    sources.set(CONTINUED_INSTRUCTIONS_FILE, new TextEncoder().encode(`${split.rest}\n`));
  }
  const files: Array<MarketplaceSkillFile> = [];
  for (const filePath of [...sources.keys()].toSorted((left, right) =>
    left < right ? -1 : left > right ? 1 : 0,
  )) {
    const bytes = sources.get(filePath) ?? new Uint8Array();
    const sha256 = sha256Hex(bytes);
    contents.set(sha256, bytes);
    files.push({ path: filePath, byteSize: bytes.byteLength, sha256 });
  }
  const problem = skillFilesProblem(files);
  if (problem !== undefined) return Result.fail(problem);

  const id = `${publisher.namespace}/${slug}`;
  const versionId = `${id}@${manifest.success.version}`;

  const releaseDigest = skillReleaseDigest({
    versionId,
    skillName: parsed.success.name,
    skillDescription,
    instructionsMarkdown,
    files,
    license: manifest.success.license,
    attribution: manifest.success.attribution,
    source: manifest.success.source,
  });

  return Result.succeed({
    id,
    versionId,
    manifest: manifest.success,
    skillName: parsed.success.name,
    skillDescription,
    instructionsMarkdown,
    files,
    byteSize: files.reduce((sum, file) => sum + file.byteSize, 0),
    contents,
    releaseDigest,
  });
};

/** Every `skills/<publisher>/<slug>/` directory under a repository root, in identity order. */
export const listMarketplaceSkillDirectories = async (
  repositoryRoot: string,
): Promise<ReadonlyArray<string>> => {
  const root = path.join(repositoryRoot, "skills");
  const publishers = await fs.readdir(root, { withFileTypes: true }).catch(() => []);
  const directories: Array<string> = [];
  for (const publisher of publishers.filter((entry) => entry.isDirectory())) {
    // oxlint-disable-next-line no-await-in-loop -- Few publishers; ordered listing keeps output stable.
    const slugs = await fs.readdir(path.join(root, publisher.name), { withFileTypes: true });
    for (const slug of slugs.filter((entry) => entry.isDirectory())) {
      directories.push(path.join(root, publisher.name, slug.name));
    }
  }

  return directories.toSorted();
};

/** Reads `releases/skills.json`. */
export const readMarketplaceSkillReleaseIndex = async (
  repositoryRoot: string,
): Promise<Result.Result<MarketplaceSkillReleaseIndex, MarketplaceSkillProblem>> => {
  try {
    const json: unknown = JSON.parse(
      await fs.readFile(path.join(repositoryRoot, "releases", "skills.json"), "utf8"),
    );
    const decoded = Schema.decodeUnknownResult(MarketplaceSkillReleaseIndex)(json);

    return Result.isSuccess(decoded)
      ? Result.succeed(decoded.success)
      : Result.fail("skill-release-index-invalid");
  } catch {
    return Result.fail("skill-release-index-invalid");
  }
};

/** Semantic version order of two `major.minor.patch` versions. */
export const compareSemanticVersions = (left: string, right: string): number => {
  const parts = (version: string) => version.split(".").map((part) => Number(part));
  const [a, b] = [parts(left), parts(right)];
  for (let index = 0; index < 3; index += 1) {
    const difference = (a[index] ?? 0) - (b[index] ?? 0);
    if (difference !== 0) return Math.sign(difference);
  }

  return 0;
};
