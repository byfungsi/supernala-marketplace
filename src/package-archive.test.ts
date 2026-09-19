import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "@effect/vitest";
import { Result, Schema } from "effect";
import { validatePluginSource, preparePluginPackage } from "./authoring-validation.js";
import { canonicalPluginJson, digestPluginBytes } from "./plugin-contract.js";
import { inspectPluginArchive } from "./plugin-archive.js";
import {
  buildDeterministicPluginArchive,
  PackageManifest,
  parsePackagedPluginArchive,
} from "./package-archive.js";

const githubPackageFiles = async (): Promise<Readonly<Record<string, Uint8Array>>> => {
  const packagePaths = [
    ["plugin.json", "plugins/github/package-manifest.json"],
    ["catalog.json", "plugins/github/catalog.json"],
    ["config.json", "plugins/github/config.json"],
    ["provenance.json", "plugins/github/provenance.json"],
    ["dist/server.mjs", "plugins/github/source/server.mjs"],
    ["LICENSE", "plugins/github/LICENSE"],
    ["NOTICE", "plugins/github/NOTICE"],
  ] as const;
  const entries = await Promise.all(
    packagePaths.map(
      async ([destination, source]) =>
        [destination, new Uint8Array(await readFile(source))] as const,
    ),
  );
  return Object.fromEntries(entries);
};

const syntheticOAuthPackageFiles = async (): Promise<Readonly<Record<string, Uint8Array>>> => {
  const files = await githubPackageFiles();
  const manifest = Schema.decodeUnknownSync(Schema.JsonObject)(
    JSON.parse(new TextDecoder().decode(files["plugin.json"])),
  );
  return {
    ...files,
    "plugin.json": new TextEncoder().encode(
      JSON.stringify({
        ...manifest,
        authentication: {
          kind: "oauth",
          providerRegistration: "synthetic-mail-rest-v1",
          providerDefinitionDigest: "a".repeat(64),
          requestedScopes: ["synthetic.mail.read"],
          credentialDelivery: "short-lived-access-token-only",
        },
      }),
    ),
  };
};

const loadGolden = async (): Promise<{
  readonly artifactDigest: string;
  readonly manifestDigest: string;
  readonly catalogDigest: string;
  readonly configDigest: string;
  readonly byteLength: number;
  readonly entryOrder: ReadonlyArray<string>;
}> => JSON.parse(await readFile("fixtures/golden/offline-package.json", "utf8"));

const createBuildRecipeFixture = async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "marketplace-build-recipe-"));
  const directory = path.join(root, "plugin");
  const inputs = path.join(directory, "inputs");
  await mkdir(inputs, { recursive: true });
  const packageFiles = await githubPackageFiles();
  const sources = {
    "plugin.json": "inputs/plugin.json",
    "catalog.json": "inputs/catalog.json",
    "config.json": "inputs/config.json",
    "provenance.json": "inputs/provenance.json",
    "dist/server.mjs": "inputs/server.mjs",
    LICENSE: "inputs/LICENSE",
    NOTICE: "inputs/NOTICE",
  };
  const recipePackageFiles = [];
  for (const [destination, source] of Object.entries(sources)) {
    const bytes = packageFiles[destination];
    if (bytes === undefined) throw new Error(`test-package-file-missing:${destination}`);
    await writeFile(path.join(directory, source), bytes);
    recipePackageFiles.push({ source, destination, sha256: await digestPluginBytes(bytes) });
  }
  const recipe = {
    schemaVersion: 1,
    source: sources["dist/server.mjs"],
    output: "dist/server.mjs",
    manifest: sources["plugin.json"],
    runtime: "node-22.x",
    runtimeDependencies: [],
    networkDuringBuild: false,
    lifecycleScripts: false,
    deterministicCopy: true,
    license: "MIT",
    licenseFile: sources.LICENSE,
    noticeFile: sources.NOTICE,
    preservedThirdPartyNotices: [],
    packageFiles: recipePackageFiles,
  };
  const writeRecipe = () =>
    writeFile(path.join(directory, "build-recipe.json"), `${JSON.stringify(recipe, null, 2)}\n`);
  await writeRecipe();
  return { root, directory, recipe, writeRecipe };
};

describe("Phase 1 package archive parity", () => {
  it("materializes the real Gmail recipe in memory and preserves direct prepared sources", async () => {
    const gmail = await validatePluginSource("plugins/gmail");
    if (Result.isFailure(gmail)) throw gmail.failure;
    expect(Object.keys(gmail.success.files).toSorted()).toEqual([
      "LICENSE",
      "NOTICE",
      "catalog.json",
      "config.json",
      "dist/server.mjs",
      "plugin.json",
      "provenance.json",
    ]);
    const preparedGmail = await preparePluginPackage({
      source: gmail.success,
      marketplaceId: "supernala-public",
      versionId: "supernala-public:supernala:gmail@0.1.0",
      publishedAt: 1,
    });
    expect(Result.isSuccess(preparedGmail)).toBe(true);

    const direct = await validatePluginSource("plugins/offline-fixture");
    if (Result.isFailure(direct)) throw direct.failure;
    expect(direct.success.files["build-recipe.json"]).toBeUndefined();
    expect(Object.keys(direct.success.files).toSorted()).toEqual(
      (await loadGolden()).entryOrder.toSorted(),
    );
  });

  it("rejects hash-tampered recipe sources", async () => {
    const fixture = await createBuildRecipeFixture();
    try {
      await writeFile(path.join(fixture.directory, fixture.recipe.source), "tampered");
      const result = await validatePluginSource(fixture.directory);
      expect(result).toMatchObject({
        _tag: "Failure",
        failure: { operation: "build-recipe", reason: "source-digest-mismatch" },
      });
    } finally {
      await rm(fixture.root, { recursive: true });
    }
  });

  it("rejects recursively excess recipe properties", async () => {
    const fixture = await createBuildRecipeFixture();
    try {
      await writeFile(
        path.join(fixture.directory, "build-recipe.json"),
        JSON.stringify({
          ...fixture.recipe,
          packageFiles: fixture.recipe.packageFiles.map((entry, index) =>
            index === 0 ? { ...entry, unreviewed: true } : entry,
          ),
        }),
      );
      const result = await validatePluginSource(fixture.directory);
      expect(result).toMatchObject({
        _tag: "Failure",
        failure: { operation: "parse", reason: "invalid-build-recipe.json" },
      });
    } finally {
      await rm(fixture.root, { recursive: true });
    }
  });

  it("rejects traversal and absolute recipe source or destination paths", async () => {
    for (const mutate of [
      (fixture: Awaited<ReturnType<typeof createBuildRecipeFixture>>) => {
        const first = fixture.recipe.packageFiles[0];
        if (first === undefined) throw new Error("test-recipe-file-missing");
        first.source = "../outside";
      },
      (fixture: Awaited<ReturnType<typeof createBuildRecipeFixture>>) => {
        const first = fixture.recipe.packageFiles[0];
        if (first === undefined) throw new Error("test-recipe-file-missing");
        first.source = path.resolve(fixture.root, "outside");
      },
      (fixture: Awaited<ReturnType<typeof createBuildRecipeFixture>>) => {
        const first = fixture.recipe.packageFiles[0];
        if (first === undefined) throw new Error("test-recipe-file-missing");
        first.destination = "../plugin.json";
      },
      (fixture: Awaited<ReturnType<typeof createBuildRecipeFixture>>) => {
        const first = fixture.recipe.packageFiles[0];
        if (first === undefined) throw new Error("test-recipe-file-missing");
        first.destination = path.resolve(fixture.root, "plugin.json");
      },
    ]) {
      const fixture = await createBuildRecipeFixture();
      try {
        mutate(fixture);
        await fixture.writeRecipe();
        expect(Result.isFailure(await validatePluginSource(fixture.directory))).toBe(true);
      } finally {
        await rm(fixture.root, { recursive: true });
      }
    }
  });

  it("rejects symlink recipe sources and duplicate destinations", async () => {
    const symlinkFixture = await createBuildRecipeFixture();
    try {
      const server = path.join(symlinkFixture.directory, symlinkFixture.recipe.source);
      await rm(server);
      await symlink(path.join(symlinkFixture.directory, "inputs", "catalog.json"), server);
      expect(Result.isFailure(await validatePluginSource(symlinkFixture.directory))).toBe(true);
    } finally {
      await rm(symlinkFixture.root, { recursive: true });
    }

    const duplicateFixture = await createBuildRecipeFixture();
    try {
      const [first, second] = duplicateFixture.recipe.packageFiles;
      if (first === undefined || second === undefined) throw new Error("test-recipe-files-missing");
      second.destination = first.destination;
      await duplicateFixture.writeRecipe();
      const result = await validatePluginSource(duplicateFixture.directory);
      expect(result).toMatchObject({
        _tag: "Failure",
        failure: { operation: "build-recipe", reason: "destination-duplicate" },
      });
    } finally {
      await rm(duplicateFixture.root, { recursive: true });
    }
  });

  it("produces identical bytes twice and matches golden contract digests", async () => {
    const expectedGolden = await loadGolden();
    const sourceResult = await validatePluginSource("plugins/offline-fixture");
    expect(Result.isSuccess(sourceResult)).toBe(true);
    if (Result.isFailure(sourceResult)) return;
    const input = {
      source: sourceResult.success,
      marketplaceId: "supernala-public",
      versionId: "offline-fixture-1.0.0",
      publishedAt: 0,
    };
    const first = await preparePluginPackage(input);
    const second = await preparePluginPackage(input);
    expect(Result.isSuccess(first)).toBe(true);
    expect(Result.isSuccess(second)).toBe(true);
    if (Result.isFailure(first) || Result.isFailure(second)) return;
    expect(first.success.archiveBytes).toEqual(second.success.archiveBytes);
    expect(first.success.artifactDigest).toBe(expectedGolden.artifactDigest);
    expect(first.success.parsed.version.catalog.digest).toBe(expectedGolden.catalogDigest);
    expect(first.success.parsed.configDigest).toBe(expectedGolden.configDigest);
    expect(first.success.parsed.version.runtime).toMatchObject({
      kind: "managed-package",
      manifestDigest: expectedGolden.manifestDigest,
      entrypoint: "dist/server.mjs",
      node: "22.x",
    });
    expect(first.success.archiveBytes.byteLength).toBe(expectedGolden.byteLength);
    expect(first.success.parsed.entries.map((entry) => entry.path)).toEqual(
      expectedGolden.entryOrder,
    );
  });

  it("parses generated bytes against checked golden Phase 1 version metadata", async () => {
    const expectedGolden = await loadGolden();
    const sourceResult = await validatePluginSource("plugins/offline-fixture");
    expect(Result.isSuccess(sourceResult)).toBe(true);
    if (Result.isFailure(sourceResult)) return;
    const prepared = await preparePluginPackage({
      source: sourceResult.success,
      marketplaceId: "supernala-public",
      versionId: "offline-fixture-1.0.0",
      publishedAt: 0,
    });
    expect(Result.isSuccess(prepared)).toBe(true);
    if (Result.isFailure(prepared)) return;
    const bytes = prepared.success.archiveBytes;
    const parsed = await parsePackagedPluginArchive({
      archiveBytes: bytes,
      marketplaceId: "supernala-public",
      versionId: "offline-fixture-1.0.0",
      publishedAt: 0,
    });
    expect(Result.isSuccess(parsed)).toBe(true);
    if (Result.isFailure(parsed)) return;
    expect(await digestPluginBytes(bytes)).toBe(expectedGolden.artifactDigest);
    expect(canonicalPluginJson(parsed.success.version)).toContain(
      '"publisherNamespace":"supernala"',
    );
    expect(parsed.success.version).toMatchObject({
      id: "offline-fixture-1.0.0",
      marketplaceId: "supernala-public",
      pluginSlug: "offline-fixture",
      version: "1.0.0",
      license: "LicenseRef-Testing-Only",
      status: "published",
      publishedAt: 0,
    });
  });

  it("rejects traversal, links, collisions, bombs, and missing entrypoints", () => {
    const limits = {
      maximumFiles: 2,
      maximumExpandedBytes: 100,
      maximumFileBytes: 80,
      maximumCompressionRatio: 10,
    };
    const cases = [
      { path: "../server.mjs", kind: "file", compressedBytes: 1, expandedBytes: 1 },
      { path: "server.mjs", kind: "symlink", compressedBytes: 1, expandedBytes: 1 },
      { path: "server.mjs", kind: "file", compressedBytes: 0, expandedBytes: 1 },
      { path: "server.mjs", kind: "file", compressedBytes: 1, expandedBytes: 81 },
    ] as const;
    for (const entry of cases) {
      const result = inspectPluginArchive({ entries: [entry], entrypoint: "server.mjs", limits });
      expect(Result.isFailure(result)).toBe(true);
    }
    const collision = inspectPluginArchive({
      entries: [
        { path: "Server.mjs", kind: "file", compressedBytes: 1, expandedBytes: 1 },
        { path: "server.mjs", kind: "file", compressedBytes: 1, expandedBytes: 1 },
      ],
      entrypoint: "server.mjs",
      limits,
    });
    expect(Result.isFailure(collision)).toBe(true);
  });

  it("accepts exact GitHub auth and MIT evidence while rejecting stripped or excess metadata", async () => {
    const files = await githubPackageFiles();
    const parse = (packageFiles: Readonly<Record<string, Uint8Array>>) =>
      parsePackagedPluginArchive({
        archiveBytes: buildDeterministicPluginArchive(packageFiles),
        marketplaceId: "supernala-public",
        versionId: "supernala-public:supernala:github@0.1.0",
        publishedAt: 1,
      });
    const accepted = await parse(files);
    expect(accepted).toMatchObject({
      _tag: "Success",
      success: {
        authentication: {
          kind: "github-app",
          providerRegistration: "supernala-github-app-v1",
          credentialDelivery: "short-lived-installation-token-only",
        },
      },
    });

    const manifest = Schema.decodeUnknownSync(Schema.JsonObject)(
      JSON.parse(new TextDecoder().decode(files["plugin.json"])),
    );
    const { licenseEvidence: _licenseEvidence, ...withoutEvidence } = manifest;
    expect(
      await parse({
        ...files,
        "plugin.json": new TextEncoder().encode(JSON.stringify(withoutEvidence)),
      }),
    ).toEqual(Result.fail("required-evidence-missing"));
    expect(await parse({ ...files, LICENSE: new TextEncoder().encode("MIT\n") })).toEqual(
      Result.fail("invalid-license-evidence"),
    );

    const authentication = Schema.decodeUnknownSync(Schema.JsonObject)(manifest.authentication);
    expect(
      await parse({
        ...files,
        "plugin.json": new TextEncoder().encode(
          JSON.stringify({
            ...manifest,
            authentication: { ...authentication, unreviewedCredential: "forbidden" },
          }),
        ),
      }),
    ).toEqual(Result.fail("invalid-plugin.json"));

    const typedManifest = Schema.decodeUnknownSync(PackageManifest, {
      onExcessProperty: "error",
    })(manifest);
    if (typedManifest.licenseEvidence === undefined)
      throw new Error("test-license-evidence-missing");
    const mismatchedNotice = new TextEncoder().encode(
      "Copyright (c) 2026 Different synthetic holder\n",
    );
    const noticeManifest = PackageManifest.make({
      ...typedManifest,
      licenseEvidence: {
        ...typedManifest.licenseEvidence,
        notice: { path: "NOTICE", sha256: await digestPluginBytes(mismatchedNotice) },
      },
    });
    expect(
      await parse({
        ...files,
        NOTICE: mismatchedNotice,
        "plugin.json": new TextEncoder().encode(JSON.stringify(noticeManifest)),
      }),
    ).toEqual(Result.fail("invalid-license-evidence"));
  });

  it("accepts digest-bound OAuth auth and rejects four-field, noncanonical, or excess declarations", async () => {
    const files = await syntheticOAuthPackageFiles();
    const parse = (packageFiles: Readonly<Record<string, Uint8Array>>) =>
      parsePackagedPluginArchive({
        archiveBytes: buildDeterministicPluginArchive(packageFiles),
        marketplaceId: "supernala-public",
        versionId: "supernala-public:supernala:synthetic-mail@0.1.0",
        publishedAt: 1,
      });
    await expect(parse(files)).resolves.toMatchObject({
      _tag: "Success",
      success: {
        authentication: {
          kind: "oauth",
          providerRegistration: "synthetic-mail-rest-v1",
          providerDefinitionDigest: "a".repeat(64),
          requestedScopes: ["synthetic.mail.read"],
          credentialDelivery: "short-lived-access-token-only",
        },
      },
    });

    const manifest = Schema.decodeUnknownSync(Schema.JsonObject)(
      JSON.parse(new TextDecoder().decode(files["plugin.json"])),
    );
    const authentication = Schema.decodeUnknownSync(Schema.JsonObject)(manifest.authentication);
    const { providerDefinitionDigest: _providerDefinitionDigest, ...fourFieldAuthentication } =
      authentication;
    await expect(
      parse({
        ...files,
        "plugin.json": new TextEncoder().encode(
          JSON.stringify({ ...manifest, authentication: fourFieldAuthentication }),
        ),
      }),
    ).resolves.toEqual(Result.fail("invalid-plugin.json"));
    for (const requestedScopes of [
      [],
      ["synthetic.read", "synthetic.read"],
      ["synthetic.write", "synthetic.read"],
      [""],
      ["synthetic scope"],
    ]) {
      await expect(
        parse({
          ...files,
          "plugin.json": new TextEncoder().encode(
            JSON.stringify({ ...manifest, authentication: { ...authentication, requestedScopes } }),
          ),
        }),
      ).resolves.toEqual(Result.fail("invalid-plugin.json"));
    }
    await expect(
      parse({
        ...files,
        "plugin.json": new TextEncoder().encode(
          JSON.stringify({
            ...manifest,
            authentication: {
              ...authentication,
              unreviewedNestedField: { enabled: true },
            },
          }),
        ),
      }),
    ).resolves.toEqual(Result.fail("invalid-plugin.json"));

    const credentialConfig = new TextEncoder().encode(
      JSON.stringify({
        revision: 1,
        fields: [
          {
            key: "clientSecret",
            label: "OAuth client secret",
            type: "string",
            scope: "connection",
            sensitivity: "secret",
            sourcePolicy: "platform-only",
            delivery: "oauth-broker-only",
            affects: ["authentication"],
          },
        ],
      }),
    );
    const configDeclaration = Schema.decodeUnknownSync(Schema.JsonObject)(manifest.config);
    await expect(
      parse({
        ...files,
        "config.json": credentialConfig,
        "plugin.json": new TextEncoder().encode(
          JSON.stringify({
            ...manifest,
            config: {
              ...configDeclaration,
              sha256: await digestPluginBytes(credentialConfig),
            },
          }),
        ),
      }),
    ).resolves.toEqual(Result.fail("credential-bearing-config-declaration"));
  });
});
