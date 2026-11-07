import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { Result, Schema } from "effect";
import { parse as parseYaml } from "yaml";

/*
 * Setup guides tell an Owner how to prepare what an app needs, such as a Google OAuth client or
 * an API key, and the steps in Supernala. They live outside Plugin source roots, so improving a
 * guide never changes a package digest or needs a Plugin version. The application shows the
 * current revision on the app page, in Bot setup cards and to Bots through get_plugin_guide.
 */

/** Guides directory, one Markdown file per Plugin: `guides/<publisher>/<slug>.md`. */
export const PLUGIN_SETUP_GUIDES_DIRECTORY = "guides";

/** The application keeps guides short enough for a chat card and a Bot's context. */
export const PLUGIN_SETUP_GUIDE_MAX_CHARACTERS = 16_000;

/** Placeholders the application fills, so a guide never hard-codes a deployment URL. */
export const PLUGIN_SETUP_GUIDE_PLACEHOLDERS: ReadonlySet<string> = new Set(["oauthCallbackUrl"]);

/** Every guide ends with what to do in Supernala, under exactly this heading. */
export const PLUGIN_SETUP_GUIDE_SUPERNALA_HEADING = "## In Supernala";

const PluginDefinitionId = Schema.String.pipe(
  Schema.check(Schema.isPattern(/^[a-z0-9-]+:[a-z0-9-]+:[a-z0-9-]+$/u)),
);

const GuideFrontmatter = Schema.Struct({
  plugin: PluginDefinitionId,
  revision: Schema.Int.pipe(Schema.check(Schema.isGreaterThanOrEqualTo(1))),
});

/** One guide as the application stores it: the body below the frontmatter, and its digest. */
export interface PluginSetupGuide {
  readonly definitionId: string;
  readonly revision: number;
  readonly markdown: string;
  readonly contentSha256: string;
  readonly relativePath: string;
}

/** Problems that make a guide unpublishable; each names one rule. */
export type PluginSetupGuideProblem =
  | "guide-frontmatter-invalid"
  | "guide-path-mismatch"
  | "guide-empty"
  | "guide-too-long"
  | "guide-html-not-allowed"
  | "guide-image-not-allowed"
  | "guide-link-not-https"
  | "guide-placeholder-unknown"
  | "guide-supernala-section-missing";

/** Parses and checks one guide; `relativePath` must agree with the Plugin it names. */
export const parsePluginSetupGuide = (
  relativePath: string,
  source: string,
): Result.Result<PluginSetupGuide, PluginSetupGuideProblem> => {
  const normalized = source.replaceAll("\r\n", "\n");
  const match = /^---\n([\s\S]*?)\n---(?:\n|$)/u.exec(normalized);
  if (match === null) return Result.fail("guide-frontmatter-invalid");
  let parsed: unknown;
  try {
    parsed = parseYaml(match[1] ?? "");
  } catch {
    return Result.fail("guide-frontmatter-invalid");
  }
  const frontmatter = Schema.decodeUnknownResult(GuideFrontmatter, { onExcessProperty: "error" })(
    parsed,
  );
  if (Result.isFailure(frontmatter)) return Result.fail("guide-frontmatter-invalid");
  const [marketplaceId, publisher, slug] = frontmatter.success.plugin.split(":");
  if (
    marketplaceId !== "supernala-public" ||
    relativePath.split(path.sep).join("/") !==
      `${PLUGIN_SETUP_GUIDES_DIRECTORY}/${publisher}/${slug}.md`
  ) {
    return Result.fail("guide-path-mismatch");
  }

  const markdown = normalized.slice(match[0].length).trim();
  if (markdown === "") return Result.fail("guide-empty");
  if (markdown.length > PLUGIN_SETUP_GUIDE_MAX_CHARACTERS) return Result.fail("guide-too-long");
  // Inline code may show angle brackets; anything else that looks like a tag is rejected.
  const prose = markdown.replaceAll(/`[^`\n]*`/gu, "");
  if (/<[a-z/!]/iu.test(prose)) return Result.fail("guide-html-not-allowed");
  if (/!\[/u.test(prose)) return Result.fail("guide-image-not-allowed");
  if ([...prose.matchAll(/\]\(([^)\s]+)/gu)].some(([, url]) => !url?.startsWith("https://"))) {
    return Result.fail("guide-link-not-https");
  }
  if (
    [...markdown.matchAll(/\{\{\s*([^}\s]*)\s*\}\}/gu)].some(
      ([, name]) => !PLUGIN_SETUP_GUIDE_PLACEHOLDERS.has(name ?? ""),
    )
  ) {
    return Result.fail("guide-placeholder-unknown");
  }
  if (!markdown.split("\n").includes(PLUGIN_SETUP_GUIDE_SUPERNALA_HEADING)) {
    return Result.fail("guide-supernala-section-missing");
  }

  return Result.succeed({
    definitionId: frontmatter.success.plugin,
    revision: frontmatter.success.revision,
    markdown,
    contentSha256: createHash("sha256").update(markdown).digest("hex"),
    relativePath,
  });
};

/** Reads every guide in identity order; the first invalid one fails with its path. */
export const loadPluginSetupGuides = async (
  repositoryRoot: string,
): Promise<Result.Result<ReadonlyArray<PluginSetupGuide>, string>> => {
  const root = path.join(repositoryRoot, PLUGIN_SETUP_GUIDES_DIRECTORY);
  const publishers = (await fs.readdir(root, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .toSorted();
  const guides: Array<PluginSetupGuide> = [];
  for (const publisher of publishers) {
    // oxlint-disable-next-line no-await-in-loop -- Guides load in identity order so failures name the first bad one.
    const files = (await fs.readdir(path.join(root, publisher)))
      .filter((name) => name.endsWith(".md"))
      .toSorted();
    for (const file of files) {
      const relativePath = path.join(PLUGIN_SETUP_GUIDES_DIRECTORY, publisher, file);
      // oxlint-disable-next-line no-await-in-loop -- Sequential reads keep the failing path exact.
      const source = await fs.readFile(path.join(repositoryRoot, relativePath), "utf8");
      const guide = parsePluginSetupGuide(relativePath, source);
      if (Result.isFailure(guide)) return Result.fail(`${guide.failure}: ${relativePath}`);
      guides.push(guide.success);
    }
  }

  return Result.succeed(guides);
};

const ReleaseIndex = Schema.Struct({
  plugins: Schema.Array(
    Schema.Struct({
      sourceDirectory: Schema.String,
      kind: Schema.Literals(["managed-package", "managed-openapi", "managed-remote-mcp"]),
      publicationEligible: Schema.Boolean,
    }),
  ),
});

const PackageIdentity = Schema.Struct({ publisher: Schema.String, id: Schema.String });

const DeclaredIdentity = Schema.Struct({
  marketplaceId: Schema.String,
  publisherNamespace: Schema.String,
  pluginSlug: Schema.String,
});

const readJson = async <A>(schema: Schema.Codec<A>, file: string) =>
  Schema.decodeUnknownResult(schema)(JSON.parse(await fs.readFile(file, "utf8")));

/** Definition IDs of every publication-eligible Plugin in `releases/index.json`. */
export const eligiblePluginDefinitionIds = async (
  repositoryRoot: string,
): Promise<Result.Result<ReadonlyArray<string>, string>> => {
  const index = await readJson(ReleaseIndex, path.join(repositoryRoot, "releases", "index.json"));
  if (Result.isFailure(index)) return Result.fail("release-index-invalid");
  const ids: Array<string> = [];
  for (const entry of index.success.plugins.filter((plugin) => plugin.publicationEligible)) {
    const source = path.join(repositoryRoot, entry.sourceDirectory);
    if (entry.kind === "managed-package") {
      // oxlint-disable-next-line no-await-in-loop -- Index order keeps the failing entry exact.
      const manifest = await readJson(PackageIdentity, path.join(source, "package-manifest.json"));
      if (Result.isFailure(manifest))
        return Result.fail(`plugin-identity-invalid: ${entry.sourceDirectory}`);
      ids.push(`supernala-public:${manifest.success.publisher}:${manifest.success.id}`);
      continue;
    }
    const declared =
      entry.kind === "managed-openapi"
        ? // oxlint-disable-next-line no-await-in-loop -- Index order keeps the failing entry exact.
          await readJson(DeclaredIdentity, path.join(source, "openapi-source.json"))
        : // oxlint-disable-next-line no-await-in-loop -- Index order keeps the failing entry exact.
          await readJson(DeclaredIdentity, source);
    if (Result.isFailure(declared))
      return Result.fail(`plugin-identity-invalid: ${entry.sourceDirectory}`);
    ids.push(
      `${declared.success.marketplaceId}:${declared.success.publisherNamespace}:${declared.success.pluginSlug}`,
    );
  }

  return Result.succeed(ids);
};

/** Publication-eligible Plugins without a guide; every published app must explain its setup. */
export const pluginsMissingSetupGuides = (
  eligible: ReadonlyArray<string>,
  guides: ReadonlyArray<PluginSetupGuide>,
): ReadonlyArray<string> =>
  eligible.filter((id) => !guides.some((guide) => guide.definitionId === id));
