import { promises as fs } from "node:fs";
import path from "node:path";
import { Result, Schema } from "effect";
import {
  type BehaviorCatalogTool,
  checkPluginBehaviorDeclaration,
  parsePluginBehavior,
  PLUGIN_BEHAVIORS_DIRECTORY,
  type PluginBehavior,
} from "./plugin-behavior.js";
import { loadPluginOpenApiSource } from "./plugin-openapi-source.js";

/*
 * Loads behaviour declarations and the reviewed catalogs they refer to. A definition can be
 * released from more than one source over time (Slack moved from a hosted MCP release to a
 * package), so the catalog a declaration is checked against is the publication-eligible source
 * for that definition. The application repeats the check against each installed version.
 */

const ReleaseIndex = Schema.Struct({
  plugins: Schema.Array(
    Schema.Struct({
      sourceDirectory: Schema.String,
      kind: Schema.Literals(["managed-package", "managed-openapi", "managed-remote-mcp"]),
      publicationEligible: Schema.Boolean,
    }),
  ),
});

const CatalogTools = Schema.Struct({
  tools: Schema.Array(
    Schema.Struct({
      id: Schema.String,
      classification: Schema.String,
      inputSchema: Schema.JsonObject,
    }),
  ),
});

const PackageSource = Schema.Struct({ publisher: Schema.String, id: Schema.String });

const RemoteSource = Schema.Struct({
  marketplaceId: Schema.String,
  publisherNamespace: Schema.String,
  pluginSlug: Schema.String,
  catalog: CatalogTools,
});

/** One definition's reviewed catalog, as behaviour validation sees it. */
export interface BehaviorCatalogSource {
  readonly definitionId: string;
  readonly sourceDirectory: string;
  readonly publicationEligible: boolean;
  readonly tools: ReadonlyArray<BehaviorCatalogTool>;
}

/** Reduces one catalog tool to the facts behaviour validation needs. */
export const behaviorCatalogTool = (tool: {
  readonly id: string;
  readonly classification: string;
  readonly inputSchema: Schema.JsonObject;
}): BehaviorCatalogTool => ({
  id: tool.id,
  classification: tool.classification,
  inputSchema: tool.inputSchema,
});

const readJson = async <A>(schema: Schema.Codec<A>, file: string) =>
  Schema.decodeUnknownResult(schema)(JSON.parse(await fs.readFile(file, "utf8")));

/** Every definition's catalog from `releases/index.json`, preferring the eligible source. */
export const loadBehaviorCatalogSources = async (
  repositoryRoot: string,
): Promise<Result.Result<ReadonlyMap<string, BehaviorCatalogSource>, string>> => {
  const index = await readJson(ReleaseIndex, path.join(repositoryRoot, "releases", "index.json"));
  if (Result.isFailure(index)) return Result.fail("release-index-invalid");
  const sources = new Map<string, BehaviorCatalogSource>();
  for (const entry of index.success.plugins) {
    const source = path.join(repositoryRoot, entry.sourceDirectory);
    let loaded: Omit<BehaviorCatalogSource, "sourceDirectory" | "publicationEligible">;
    if (entry.kind === "managed-package") {
      // oxlint-disable-next-line no-await-in-loop -- Index order keeps the failing entry exact.
      const [manifest, catalog] = await Promise.all([
        readJson(PackageSource, path.join(source, "package-manifest.json")).catch(() =>
          // The conformance fixture predates the source manifest name.
          readJson(PackageSource, path.join(source, "plugin.json")),
        ),
        readJson(CatalogTools, path.join(source, "catalog.json")),
      ]);
      if (Result.isFailure(manifest) || Result.isFailure(catalog)) {
        return Result.fail(`behavior-catalog-invalid: ${entry.sourceDirectory}`);
      }
      loaded = {
        definitionId: `supernala-public:${manifest.success.publisher}:${manifest.success.id}`,
        tools: catalog.success.tools.map(behaviorCatalogTool),
      };
    } else if (entry.kind === "managed-remote-mcp") {
      // oxlint-disable-next-line no-await-in-loop -- Index order keeps the failing entry exact.
      const remote = await readJson(RemoteSource, source);
      if (Result.isFailure(remote)) {
        return Result.fail(`behavior-catalog-invalid: ${entry.sourceDirectory}`);
      }
      loaded = {
        definitionId: `${remote.success.marketplaceId}:${remote.success.publisherNamespace}:${remote.success.pluginSlug}`,
        tools: remote.success.catalog.tools.map(behaviorCatalogTool),
      };
    } else {
      // oxlint-disable-next-line no-await-in-loop -- Index order keeps the failing entry exact.
      const openApi = await loadPluginOpenApiSource(source);
      if (Result.isFailure(openApi)) {
        return Result.fail(`behavior-catalog-invalid: ${entry.sourceDirectory}`);
      }
      const { source: declared, compiled } = openApi.success;
      loaded = {
        definitionId: `${declared.marketplaceId}:${declared.publisherNamespace}:${declared.pluginSlug}`,
        tools: compiled.contract.catalog.tools.map(behaviorCatalogTool),
      };
    }
    const existing = sources.get(loaded.definitionId);
    if (existing === undefined || (!existing.publicationEligible && entry.publicationEligible)) {
      sources.set(loaded.definitionId, {
        ...loaded,
        sourceDirectory: entry.sourceDirectory,
        publicationEligible: entry.publicationEligible,
      });
    }
  }
  return Result.succeed(sources);
};

/** Reads every behaviour file in identity order; the first invalid one fails with its path. */
export const loadPluginBehaviors = async (
  repositoryRoot: string,
): Promise<Result.Result<ReadonlyArray<PluginBehavior>, string>> => {
  const root = path.join(repositoryRoot, PLUGIN_BEHAVIORS_DIRECTORY);
  const publishers = (await fs.readdir(root, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .toSorted();
  const behaviors: Array<PluginBehavior> = [];
  for (const publisher of publishers) {
    // oxlint-disable-next-line no-await-in-loop -- Files load in identity order so failures name the first bad one.
    const files = (await fs.readdir(path.join(root, publisher)))
      .filter((name) => name.endsWith(".json"))
      .toSorted();
    for (const file of files) {
      const relativePath = [PLUGIN_BEHAVIORS_DIRECTORY, publisher, file].join("/");
      // oxlint-disable-next-line no-await-in-loop -- Sequential reads keep the failing path exact.
      const source = await fs.readFile(path.join(repositoryRoot, relativePath), "utf8");
      const behavior = parsePluginBehavior(relativePath, source);
      if (Result.isFailure(behavior)) {
        return Result.fail(
          `${behavior.failure.problem} at ${behavior.failure.at}: ${relativePath}`,
        );
      }
      behaviors.push(behavior.success);
    }
  }
  return Result.succeed(behaviors);
};

/** Loads every declaration and checks it against its definition's reviewed catalog. */
export const validatePluginBehaviors = async (
  repositoryRoot: string,
): Promise<Result.Result<ReadonlyArray<PluginBehavior>, ReadonlyArray<string>>> => {
  const [behaviors, sources] = await Promise.all([
    loadPluginBehaviors(repositoryRoot),
    loadBehaviorCatalogSources(repositoryRoot),
  ]);
  if (Result.isFailure(behaviors)) return Result.fail([behaviors.failure]);
  if (Result.isFailure(sources)) return Result.fail([sources.failure]);
  const problems: Array<string> = [];
  for (const behavior of behaviors.success) {
    const source = sources.success.get(behavior.definitionId);
    if (source === undefined) {
      problems.push(`behavior-plugin-unknown at $.plugin: ${behavior.relativePath}`);
      continue;
    }
    for (const issue of checkPluginBehaviorDeclaration(behavior.declaration, source.tools)) {
      problems.push(`${issue.problem} at ${issue.at}: ${behavior.relativePath}`);
    }
  }
  return problems.length === 0 ? Result.succeed(behaviors.success) : Result.fail(problems);
};
