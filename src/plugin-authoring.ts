import { promises as fs } from "node:fs";
import path from "node:path";
import { Result, Schema } from "effect";
import {
  preparePluginPackage,
  synchronizePluginManifestDigests,
  validatePluginSource,
} from "./authoring-validation.js";
import { canonicalPluginJson, PluginSlug } from "./plugin-contract.js";
import {
  type ManagedRemotePluginRelease,
  validateManagedRemotePluginRelease,
} from "./remote-release.js";
import type { PluginAuthProfile } from "./plugin-auth-strategy.js";

export type PluginAuthoringRuntime = "managed-package" | "managed-remote-mcp";
/** Authentication profile scaffolded as a credential-free reviewed declaration. */
export type PluginAuthoringAuthProfile = PluginAuthProfile;

export interface ValidatedPluginAuthoringSource {
  readonly runtime: PluginAuthoringRuntime;
  readonly plugin: string;
  readonly version: string;
  readonly tools: number;
  readonly publicationEligible: boolean;
  readonly publicationBlocker: string | null;
}

interface ResolvedRemoteSource {
  readonly file: string;
  readonly release: ManagedRemotePluginRelease;
}

const PackagePublicationStatus = Schema.Struct({
  publication: Schema.Struct({
    eligible: Schema.Boolean,
    reason: Schema.optionalKey(Schema.String),
  }),
});

const readRemoteSource = async (
  sourcePath: string,
): Promise<Result.Result<ResolvedRemoteSource, string>> => {
  try {
    const stat = await fs.lstat(sourcePath);
    if (stat.isSymbolicLink()) return Result.fail("plugin-source-link-not-allowed");
    const file = stat.isDirectory() ? path.join(sourcePath, "remote.json") : sourcePath;
    const fileStat = await fs.lstat(file);
    if (!fileStat.isFile() || fileStat.isSymbolicLink()) {
      return Result.fail("remote-source-file-invalid");
    }
    let json: unknown;
    try {
      json = JSON.parse(await fs.readFile(file, "utf8"));
    } catch {
      return Result.fail("remote-source-json-invalid");
    }
    const parsed = validateManagedRemotePluginRelease(json, "authoring");
    return Result.isFailure(parsed)
      ? Result.fail(parsed.failure)
      : Result.succeed({ file, release: parsed.success });
  } catch {
    return Result.fail("plugin-source-not-found");
  }
};

const sourceHasFile = async (directory: string, file: string): Promise<boolean> => {
  try {
    return (await fs.lstat(path.join(directory, file))).isFile();
  } catch {
    return false;
  }
};

/** Validates either packaged source or one managed-remote declaration through one author command. */
export async function validatePluginAuthoringSource(
  sourcePath: string,
): Promise<Result.Result<ValidatedPluginAuthoringSource, string>> {
  if (
    (await sourceHasFile(sourcePath, "plugin.json")) ||
    (await sourceHasFile(sourcePath, "build-recipe.json"))
  ) {
    const source = await validatePluginSource(sourcePath);
    if (Result.isFailure(source)) return Result.fail(source.failure.message);
    const publication = Schema.decodeUnknownResult(PackagePublicationStatus)(
      source.success.provenance,
    );
    const publicationEligible =
      Result.isSuccess(publication) && publication.success.publication.eligible;
    return Result.succeed({
      runtime: "managed-package",
      plugin: `${source.success.manifest.publisher}/${source.success.manifest.id}`,
      version: source.success.manifest.version,
      tools: source.success.catalog.tools.length,
      publicationEligible,
      publicationBlocker: publicationEligible
        ? null
        : Result.isSuccess(publication)
          ? (publication.success.publication.reason ?? "package-publication-not-eligible")
          : "package-publication-status-missing",
    });
  }
  const remote = await readRemoteSource(sourcePath);
  if (Result.isFailure(remote)) return Result.fail(remote.failure);
  const publication = validateManagedRemotePluginRelease(remote.success.release, "publication");
  return Result.succeed({
    runtime: "managed-remote-mcp",
    plugin: `${remote.success.release.publisherNamespace}/${remote.success.release.pluginSlug}`,
    version: remote.success.release.version,
    tools: remote.success.release.catalog.tools.length,
    publicationEligible: Result.isSuccess(publication),
    publicationBlocker: Result.isFailure(publication) ? publication.failure : null,
  });
}

/** Prepares package bytes or a canonical credential-free remote authoring envelope. */
export async function preparePluginAuthoringSource(input: {
  readonly sourcePath: string;
  readonly outputFile: string;
}): Promise<
  Result.Result<
    | {
        readonly runtime: "managed-package";
        readonly artifactDigest: string;
        readonly byteLength: number;
      }
    | {
        readonly runtime: "managed-remote-mcp";
        readonly publicationEligible: boolean;
        readonly publicationBlocker: string | null;
      },
    string
  >
> {
  if (
    (await sourceHasFile(input.sourcePath, "plugin.json")) ||
    (await sourceHasFile(input.sourcePath, "build-recipe.json"))
  ) {
    if (await sourceHasFile(input.sourcePath, "plugin.json")) {
      await synchronizePluginManifestDigests(input.sourcePath);
    }
    const source = await validatePluginSource(input.sourcePath);
    if (Result.isFailure(source)) return Result.fail(source.failure.message);
    const prepared = await preparePluginPackage({
      source: source.success,
      marketplaceId: "supernala-public",
      versionId: `${source.success.manifest.id}-${source.success.manifest.version}`,
      publishedAt: 0,
    });
    if (Result.isFailure(prepared)) return Result.fail(prepared.failure.message);
    await fs.mkdir(path.dirname(path.resolve(input.outputFile)), { recursive: true });
    await fs.writeFile(input.outputFile, prepared.success.archiveBytes);
    return Result.succeed({
      runtime: "managed-package",
      artifactDigest: prepared.success.artifactDigest,
      byteLength: prepared.success.archiveBytes.byteLength,
    });
  }
  const remote = await readRemoteSource(input.sourcePath);
  if (Result.isFailure(remote)) return Result.fail(remote.failure);
  const publication = validateManagedRemotePluginRelease(remote.success.release, "publication");
  const envelope = {
    schemaVersion: 1,
    kind: "managed-remote-mcp",
    publication: "not-performed",
    publicationEligible: Result.isSuccess(publication),
    publicationBlocker: Result.isFailure(publication) ? publication.failure : null,
    declaration: remote.success.release,
  } as const;
  try {
    await fs.mkdir(path.dirname(path.resolve(input.outputFile)), { recursive: true });
    await fs.writeFile(input.outputFile, `${canonicalPluginJson(envelope)}\n`, { flag: "wx" });
  } catch {
    return Result.fail("prepared-output-already-exists");
  }
  return Result.succeed({
    runtime: "managed-remote-mcp",
    publicationEligible: envelope.publicationEligible,
    publicationBlocker: envelope.publicationBlocker,
  });
}

const writeJsonFile = (file: string, value: Schema.Json): Promise<void> =>
  fs.writeFile(file, `${JSON.stringify(value, null, 2)}\n`, { flag: "wx" });

/** Creates safe, explicitly non-publishable starter files without overwriting user work. */
export async function scaffoldPluginAuthoringSource(input: {
  readonly rootDirectory: string;
  readonly slug: string;
  readonly runtime: PluginAuthoringRuntime;
  readonly auth?: PluginAuthoringAuthProfile;
}): Promise<
  Result.Result<{ readonly directory: string; readonly files: ReadonlyArray<string> }, string>
> {
  const slug = Schema.decodeUnknownResult(PluginSlug)(input.slug);
  if (Result.isFailure(slug)) return Result.fail("plugin-slug-invalid");
  if (
    input.runtime === "managed-package" &&
    input.auth !== undefined &&
    input.auth !== "workspace-oauth"
  ) {
    return Result.fail("managed-package-auth-profile-unsupported");
  }
  const directory = path.join(path.resolve(input.rootDirectory), slug.success);
  try {
    await fs.mkdir(directory, { recursive: false });
  } catch {
    return Result.fail("plugin-source-already-exists");
  }
  try {
    const authStrategy =
      input.auth === undefined
        ? undefined
        : input.auth === "api-key"
          ? {
              schemaVersion: 1,
              profile: "api-key",
              providerRegistrationId: `${slug.success}-credentials-v1`,
              fields: [
                {
                  key: "token",
                  label: "API token",
                  secret: true,
                  minimumLength: 1,
                  maximumLength: 8192,
                },
              ],
              delivery: [
                {
                  kind: "header",
                  field: "token",
                  headerName: "authorization",
                  encoding: "bearer",
                },
              ],
              identity: { kind: "opaque-connection", displayLabel: `${slug.success} account` },
              resources: { kind: "none" },
            }
          : input.auth === "device-oauth"
            ? {
                schemaVersion: 1,
                profile: "device-oauth",
                providerRegistrationId: `${slug.success}-oauth-v1`,
                providerDefinitionDigest: "0".repeat(64),
                requestedScopes: ["replace.scope"],
                client: { kind: "platform-pre-registered" },
                deviceAuthorizationEndpoint: `https://${slug.success}.invalid/oauth/device`,
                tokenEndpoint: `https://${slug.success}.invalid/oauth/token`,
                tokenEndpointAuthMethod: "none",
                tokens: {
                  accessTokenType: "bearer",
                  expiresIn: "optional",
                  refreshToken: "optional",
                  grantedScopes: "requested-scopes-if-omitted",
                },
                polling: {
                  defaultIntervalSeconds: 5,
                  slowDownIncrementSeconds: 5,
                  maximumDurationSeconds: 900,
                },
                identity: { kind: "opaque-connection", displayLabel: `${slug.success} account` },
                resources: { kind: "none" },
              }
            : {
                schemaVersion: 1,
                profile: input.auth,
                providerRegistrationId: `${slug.success}-oauth-v1`,
                providerDefinitionDigest: "0".repeat(64),
                requestedScopes: ["replace.scope"],
                ...(input.auth === "mcp-oauth"
                  ? { clientRegistration: { kind: "pre-registered" } }
                  : {}),
                identity: { kind: "opaque-connection", displayLabel: `${slug.success} account` },
                resources: { kind: "none" },
              };
    if (input.runtime === "managed-remote-mcp") {
      const file = path.join(directory, "remote.json");
      await writeJsonFile(file, {
        schemaVersion: 1,
        status: "staged-unverified",
        id: `supernala-public:supernala:${slug.success}@1.0.0`,
        marketplaceId: "supernala-public",
        publisherNamespace: "supernala",
        pluginSlug: slug.success,
        version: "1.0.0",
        name: slug.success,
        description: `Staged ${slug.success} managed remote MCP candidate`,
        license: "LicenseRef-Provider-Service",
        runtime: {
          _tag: "ManagedRemoteMcp",
          kind: "managed-remote-mcp",
          endpointRegistrationId: `${slug.success}-mcp-v1`,
          providerRegistrationId:
            input.auth === "api-key"
              ? `${slug.success}-credentials-v1`
              : `${slug.success}-oauth-v1`,
          transport: "streamable-http",
        },
        endpoint: `https://${slug.success}.invalid/mcp`,
        oauthRegistrationMode: "dynamic",
        ...(authStrategy === undefined ? {} : { authStrategy }),
        ...(authStrategy === undefined || input.auth === "api-key"
          ? {}
          : { providerDefinitionDigest: authStrategy.providerDefinitionDigest }),
        scopes: input.auth === "api-key" ? [] : (authStrategy?.requestedScopes ?? []),
        catalog: {
          id: `${slug.success}-unverified-catalog`,
          schemaVersion: 1,
          digest: "0".repeat(64),
          tools: [],
        },
        config: { revision: 1, fields: [] },
        allowedHosts: [`${slug.success}.invalid`],
        protocolPolicy: { catalogCompatibility: "reviewed-subset", maximumCatalogPages: 10 },
        verificationNotes:
          "Template only. Capture and review real provider metadata, scopes, catalog, and evidence before publication.",
      });
      return Result.succeed({ directory, files: ["remote.json"] });
    }

    await fs.mkdir(path.join(directory, "dist"));
    const catalog = {
      id: `${slug.success}-catalog-v1`,
      schemaVersion: 1,
      tools: [
        {
          id: `${slug.success}.example`,
          mcpName: "example",
          title: "Example tool",
          description: "Template tool that must be replaced with reviewed behavior",
          classification: "read",
          defaultPolicy: "block",
          inputSchema: { type: "object", properties: {}, additionalProperties: false },
          maximumOutputBytes: 4_096,
        },
      ],
    } as const;
    const config = { revision: 1, fields: [] } as const;
    await Promise.all([
      writeJsonFile(path.join(directory, "catalog.json"), catalog),
      writeJsonFile(path.join(directory, "config.json"), config),
      writeJsonFile(path.join(directory, "provenance.json"), {
        source: { type: "first-party", path: `plugins/${slug.success}/dist/server.mjs` },
        build: {
          recipeVersion: 1,
          runtimeDependencies: [],
          reproducible: true,
          builtAt: "1980-01-01T00:00:00.000Z",
        },
        publication: { eligible: false, reason: "template-requires-review" },
      }),
      fs.writeFile(path.join(directory, "LICENSE"), "LicenseRef-Unreviewed\n", { flag: "wx" }),
      fs.writeFile(
        path.join(directory, "dist/server.mjs"),
        "// Replace with a reviewed MCP stdio implementation.\n",
        { flag: "wx" },
      ),
      ...(authStrategy === undefined
        ? []
        : [writeJsonFile(path.join(directory, "auth-strategy.json"), authStrategy)]),
    ]);
    await writeJsonFile(path.join(directory, "plugin.json"), {
      schemaVersion: 1,
      id: slug.success,
      publisher: "supernala",
      version: "1.0.0",
      name: slug.success,
      description: `Staged ${slug.success} managed package candidate`,
      license: "LicenseRef-Unreviewed",
      runtime: {
        kind: "managed-package",
        type: "node",
        node: "22.x",
        entrypoint: "dist/server.mjs",
      },
      catalog: { path: "catalog.json", sha256: "0".repeat(64) },
      config: { path: "config.json", sha256: "0".repeat(64) },
      authentication:
        input.auth === "workspace-oauth"
          ? {
              kind: "oauth",
              providerRegistration: `${slug.success}-oauth-v1`,
              providerDefinitionDigest: "0".repeat(64),
              requestedScopes: ["replace.scope"],
              credentialDelivery: "short-lived-access-token-only",
            }
          : { kind: "none" },
      ...(authStrategy === undefined ? {} : { authStrategy }),
      network: { allowedHosts: [] },
      limits: { expandedBytes: 1_048_576, files: 20 },
      provenance: "provenance.json",
    });
    await synchronizePluginManifestDigests(directory);
    return Result.succeed({
      directory,
      files: [
        "plugin.json",
        "catalog.json",
        "config.json",
        "provenance.json",
        "LICENSE",
        "dist/server.mjs",
        ...(authStrategy === undefined ? [] : ["auth-strategy.json"]),
      ],
    });
  } catch {
    return Result.fail("plugin-scaffold-write-failed");
  }
}
