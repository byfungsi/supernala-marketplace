import { Result, Schema } from "effect";
import { unzipSync, zipSync, type Zippable } from "fflate";
import {
  inspectPluginArchive,
  type PluginArchiveEntry,
  type PluginArchiveInspection,
} from "./plugin-archive.js";
import {
  digestPluginBytes,
  PluginCatalogSnapshot,
  PluginCatalogSnapshotId,
  PluginCatalogTool,
  PluginConfigSchema,
  PluginMarketplaceId,
  PluginPublisherNamespace,
  ProviderRegistrationId,
  PluginSemanticVersion,
  PluginSha256,
  PluginSlug,
  PluginVersion,
  PluginVersionId,
  type PluginSha256 as PluginSha256Type,
  type PluginVersion as PluginVersionType,
} from "./plugin-contract.js";
import { pluginConfigHasNoExcessProperties } from "./plugin-config-validation.js";
import { PackagedOAuthAuthentication } from "./oauth-provider-definition.js";

/** Maximum accepted file count shared with Phase 1. */
export const maximumPluginArchiveFiles = 5_000;
/** Maximum accepted expanded archive bytes shared with Phase 1. */
export const maximumPluginExpandedBytes = 52_428_800;
/** Maximum accepted individual file bytes shared with Phase 1. */
export const maximumPluginFileBytes = 20_971_520;
/** Maximum accepted compression ratio shared with Phase 1. */
export const maximumPluginCompressionRatio = 100;

/** Exact accepted managed-package authentication declaration. */
export const PackagedPluginAuthentication = Schema.Union([
  Schema.Struct({ kind: Schema.Literal("none") }),
  Schema.Struct({
    kind: Schema.Literal("github-app"),
    providerRegistration: ProviderRegistrationId,
    credentialDelivery: Schema.Literal("short-lived-installation-token-only"),
  }),
  PackagedOAuthAuthentication,
]);
/** Exact accepted managed-package authentication declaration. */
export type PackagedPluginAuthentication = typeof PackagedPluginAuthentication.Type;

/** Return the provider registration bound by packaged authentication, when required. */
export function packagedAuthenticationProviderRegistration(
  authentication: PackagedPluginAuthentication,
): string | null {
  return authentication.kind === "none" ? null : authentication.providerRegistration;
}

/** Return the deterministic OAuth scopes bound by packaged authentication. */
export function packagedAuthenticationRequestedScopes(
  authentication: PackagedPluginAuthentication,
): ReadonlyArray<string> {
  return authentication.kind === "oauth" ? authentication.requestedScopes : [];
}

/** Return the reviewed OAuth provider-definition digest, when required. */
export function packagedAuthenticationProviderDefinitionDigest(
  authentication: PackagedPluginAuthentication,
): PluginSha256Type | null {
  return authentication.kind === "oauth" ? authentication.providerDefinitionDigest : null;
}

/** Digest-bound full MIT license and notice evidence carried by new first-party packages. */
export const PackagedPluginLicenseEvidence = Schema.Struct({
  kind: Schema.Literal("spdx-mit-full-text"),
  license: Schema.Struct({ path: Schema.Literal("LICENSE"), sha256: PluginSha256 }),
  notice: Schema.Struct({ path: Schema.Literal("NOTICE"), sha256: PluginSha256 }),
});

export const PackageManifest = Schema.Struct({
  schemaVersion: Schema.Literal(1),
  id: PluginSlug,
  publisher: PluginPublisherNamespace,
  version: PluginSemanticVersion,
  name: PluginVersion.fields.name,
  description: PluginVersion.fields.description,
  license: PluginVersion.fields.license,
  licenseEvidence: Schema.optionalKey(PackagedPluginLicenseEvidence),
  runtime: Schema.Struct({
    kind: Schema.Literal("managed-package"),
    type: Schema.Literal("node"),
    node: Schema.Literal("22.x"),
    entrypoint: Schema.String,
  }),
  catalog: Schema.Struct({ path: Schema.Literal("catalog.json"), sha256: PluginSha256 }),
  config: Schema.Struct({ path: Schema.Literal("config.json"), sha256: PluginSha256 }),
  authentication: PackagedPluginAuthentication,
  network: Schema.Struct({ allowedHosts: PluginVersion.fields.allowedHosts }),
  limits: Schema.Struct({
    expandedBytes: Schema.Int.pipe(
      Schema.check(Schema.isBetween({ minimum: 1, maximum: maximumPluginExpandedBytes })),
    ),
    files: Schema.Int.pipe(
      Schema.check(Schema.isBetween({ minimum: 1, maximum: maximumPluginArchiveFiles })),
    ),
  }),
  provenance: Schema.Literal("provenance.json"),
});
/** Exact accepted managed-package manifest representation. */
export interface PackageManifest extends Schema.Schema.Type<typeof PackageManifest> {}

/** Exact catalog file representation before its digest is attached. */
export const PackageCatalog = Schema.Struct({
  id: PluginCatalogSnapshotId,
  schemaVersion: Schema.Literal(1),
  tools: Schema.Array(PluginCatalogTool).pipe(Schema.check(Schema.isLengthBetween(1, 2_000))),
});
/** Exact catalog file representation before its digest is attached. */
export interface PackageCatalog extends Schema.Schema.Type<typeof PackageCatalog> {}

/** Parsed package result produced from actual ZIP bytes. */
export interface ParsedPackagedPluginArchive {
  readonly archive: PluginArchiveInspection;
  readonly entries: ReadonlyArray<PluginArchiveEntry>;
  readonly version: PluginVersionType;
  readonly configDigest: PluginSha256Type;
  readonly manifest: PackageManifest;
  readonly authentication: PackagedPluginAuthentication;
  readonly provenance: Schema.Json;
}

const utf8 = new TextDecoder("utf-8", { fatal: true });

const canonicalMitBody = `Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.`;

const parseCanonicalMitCopyright = (licenseText: string): string | null => {
  const normalized = licenseText.replaceAll("\r\n", "\n").trim();
  if (normalized.includes("\r")) return null;
  const lines = normalized.split("\n");
  const copyright = lines[2];
  const copyrightPrefix = "Copyright (c) ";
  const holder = copyright?.slice(copyrightPrefix.length);
  return lines[0] === "MIT License" &&
    lines[1] === "" &&
    copyright !== undefined &&
    copyright.startsWith(copyrightPrefix) &&
    holder !== undefined &&
    holder.trim() !== "" &&
    holder === holder.trim() &&
    copyright.length <= 240 &&
    lines[3] === "" &&
    lines.slice(4).join("\n") === canonicalMitBody
    ? copyright
    : null;
};

/** Validate legacy marker licenses or the exact digest-bound full MIT evidence contract. */
export async function validatePackagedPluginLicenseEvidence(input: {
  readonly files: Readonly<Record<string, Uint8Array>>;
  readonly manifest: PackageManifest;
}): Promise<Result.Result<void, string>> {
  const licenseFile = input.files.LICENSE;
  if (licenseFile === undefined) return Result.fail("required-evidence-missing");
  try {
    if (input.manifest.licenseEvidence === undefined) {
      return utf8.decode(licenseFile).trim() === input.manifest.license
        ? Result.succeed(undefined)
        : Result.fail("required-evidence-missing");
    }
    const evidence = input.manifest.licenseEvidence;
    const noticeFile = input.files[evidence.notice.path];
    if (
      input.manifest.license !== "MIT" ||
      noticeFile === undefined ||
      (await digestPluginBytes(licenseFile)) !== evidence.license.sha256 ||
      (await digestPluginBytes(noticeFile)) !== evidence.notice.sha256
    ) {
      return Result.fail("invalid-license-evidence");
    }
    const copyright = parseCanonicalMitCopyright(utf8.decode(licenseFile));
    const normalizedNotice = utf8.decode(noticeFile).replaceAll("\r\n", "\n").trim();
    return copyright !== null &&
      normalizedNotice !== "" &&
      !normalizedNotice.includes("\r") &&
      normalizedNotice.split("\n").includes(copyright)
      ? Result.succeed(undefined)
      : Result.fail("invalid-license-evidence");
  } catch {
    return Result.fail("invalid-license-evidence");
  }
}
const encodeUtf8 = new TextEncoder();

const findEndOfCentralDirectory = (bytes: Uint8Array): number => {
  const minimum = Math.max(0, bytes.byteLength - 65_557);
  for (let index = bytes.byteLength - 22; index >= minimum; index -= 1) {
    if (
      bytes[index] === 0x50 &&
      bytes[index + 1] === 0x4b &&
      bytes[index + 2] === 0x05 &&
      bytes[index + 3] === 0x06
    ) {
      return index;
    }
  }
  return -1;
};

/** Parse ZIP central-directory metadata without expanding attacker-controlled bytes. */
export function parsePluginZipEntries(
  bytes: Uint8Array,
): Result.Result<ReadonlyArray<PluginArchiveEntry>, string> {
  const eocdOffset = findEndOfCentralDirectory(bytes);
  if (eocdOffset < 0) return Result.fail("zip-end-record-missing");
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const disk = view.getUint16(eocdOffset + 4, true);
  const centralDisk = view.getUint16(eocdOffset + 6, true);
  const diskEntries = view.getUint16(eocdOffset + 8, true);
  const entryCount = view.getUint16(eocdOffset + 10, true);
  const centralSize = view.getUint32(eocdOffset + 12, true);
  const centralOffset = view.getUint32(eocdOffset + 16, true);
  if (
    disk !== 0 ||
    centralDisk !== 0 ||
    diskEntries !== entryCount ||
    entryCount === 0xffff ||
    centralOffset + centralSize > eocdOffset
  ) {
    return Result.fail("unsupported-zip-layout");
  }
  const entries: Array<PluginArchiveEntry> = [];
  let offset = centralOffset;
  for (let index = 0; index < entryCount; index += 1) {
    if (offset + 46 > eocdOffset || view.getUint32(offset, true) !== 0x02014b50) {
      return Result.fail("invalid-central-directory");
    }
    const flags = view.getUint16(offset + 8, true);
    const method = view.getUint16(offset + 10, true);
    const compressedBytes = view.getUint32(offset + 20, true);
    const expandedBytes = view.getUint32(offset + 24, true);
    const nameLength = view.getUint16(offset + 28, true);
    const extraLength = view.getUint16(offset + 30, true);
    const commentLength = view.getUint16(offset + 32, true);
    const externalAttributes = view.getUint32(offset + 38, true);
    const nextOffset = offset + 46 + nameLength + extraLength + commentLength;
    if (nextOffset > eocdOffset || (flags & 1) !== 0 || (method !== 0 && method !== 8)) {
      return Result.fail("unsupported-zip-entry");
    }
    let path: string;
    try {
      path = utf8.decode(bytes.subarray(offset + 46, offset + 46 + nameLength));
    } catch {
      return Result.fail("invalid-entry-name");
    }
    const unixKind = (externalAttributes >>> 16) & 0o170000;
    const kind = path.endsWith("/")
      ? "directory"
      : unixKind === 0o120000
        ? "symlink"
        : unixKind !== 0 && unixKind !== 0o100000
          ? "device"
          : "file";
    entries.push({ path, kind, compressedBytes, expandedBytes });
    offset = nextOffset;
  }
  return offset === centralOffset + centralSize
    ? Result.succeed(entries)
    : Result.fail("central-directory-size-mismatch");
}

const parseJsonFile = (
  files: Record<string, Uint8Array>,
  path: string,
): Result.Result<Schema.Json, string> => {
  const bytes = files[path];
  if (bytes === undefined) return Result.fail(`missing-${path}`);
  try {
    return Schema.decodeUnknownResult(Schema.Json)(JSON.parse(utf8.decode(bytes))).pipe(
      Result.mapError(() => `invalid-${path}`),
    );
  } catch {
    return Result.fail(`invalid-${path}`);
  }
};

/** Parse package bytes with the accepted Phase 1 inspector semantics. */
export async function parsePackagedPluginArchive(input: {
  readonly archiveBytes: Uint8Array;
  readonly marketplaceId: string;
  readonly versionId: string;
  readonly publishedAt: number;
}): Promise<Result.Result<ParsedPackagedPluginArchive, string>> {
  const marketplaceId = Schema.decodeUnknownResult(PluginMarketplaceId)(input.marketplaceId);
  const versionId = Schema.decodeUnknownResult(PluginVersionId)(input.versionId);
  if (Result.isFailure(marketplaceId) || Result.isFailure(versionId)) {
    return Result.fail("invalid-publication-identity");
  }
  const entries = parsePluginZipEntries(input.archiveBytes);
  if (Result.isFailure(entries)) return Result.fail(entries.failure);
  const initialInspection = inspectPluginArchive({
    entries: entries.success,
    entrypoint: "plugin.json",
    limits: {
      maximumFiles: maximumPluginArchiveFiles,
      maximumExpandedBytes: maximumPluginExpandedBytes,
      maximumFileBytes: maximumPluginFileBytes,
      maximumCompressionRatio: maximumPluginCompressionRatio,
    },
  });
  if (Result.isFailure(initialInspection)) return Result.fail(initialInspection.failure.reason);
  let files: Record<string, Uint8Array>;
  try {
    files = unzipSync(input.archiveBytes);
  } catch {
    return Result.fail("zip-expansion-failed");
  }
  const centralFiles = entries.success.filter((entry) => entry.kind === "file");
  if (
    Object.keys(files).length !== centralFiles.length ||
    centralFiles.some((entry) => files[entry.path]?.byteLength !== entry.expandedBytes)
  ) {
    return Result.fail("zip-entry-metadata-mismatch");
  }
  const manifestFile = files["plugin.json"];
  if (manifestFile === undefined) return Result.fail("invalid-plugin.json");
  const manifestJson = parseJsonFile(files, "plugin.json");
  if (Result.isFailure(manifestJson)) return Result.fail(manifestJson.failure);
  const manifest = Schema.decodeUnknownResult(PackageManifest, { onExcessProperty: "error" })(
    manifestJson.success,
  ).pipe(Result.mapError(() => "invalid-plugin.json"));
  if (Result.isFailure(manifest)) return Result.fail(manifest.failure);
  const archive = inspectPluginArchive({
    entries: entries.success,
    entrypoint: manifest.success.runtime.entrypoint,
    limits: {
      maximumFiles: Math.min(manifest.success.limits.files, maximumPluginArchiveFiles),
      maximumExpandedBytes: Math.min(
        manifest.success.limits.expandedBytes,
        maximumPluginExpandedBytes,
      ),
      maximumFileBytes: maximumPluginFileBytes,
      maximumCompressionRatio: maximumPluginCompressionRatio,
    },
  });
  if (Result.isFailure(archive)) return Result.fail(archive.failure.reason);
  const catalogFile = files[manifest.success.catalog.path];
  const configFile = files[manifest.success.config.path];
  if (catalogFile === undefined || configFile === undefined)
    return Result.fail("declared-file-missing");
  const catalogDigest = await digestPluginBytes(catalogFile);
  const configDigest = await digestPluginBytes(configFile);
  if (
    catalogDigest !== manifest.success.catalog.sha256 ||
    configDigest !== manifest.success.config.sha256
  ) {
    return Result.fail("declared-digest-mismatch");
  }
  const catalogJson = parseJsonFile(files, manifest.success.catalog.path);
  const configJson = parseJsonFile(files, manifest.success.config.path);
  const provenanceJson = parseJsonFile(files, manifest.success.provenance);
  if (Result.isFailure(catalogJson)) return Result.fail(catalogJson.failure);
  if (Result.isFailure(configJson)) return Result.fail(configJson.failure);
  if (!pluginConfigHasNoExcessProperties(configJson.success)) {
    return Result.fail("invalid-config.json");
  }
  if (Result.isFailure(provenanceJson)) return Result.fail(provenanceJson.failure);
  const catalog = Schema.decodeUnknownResult(PackageCatalog)(catalogJson.success).pipe(
    Result.mapError(() => "invalid-catalog.json"),
  );
  const config = Schema.decodeUnknownResult(PluginConfigSchema, { onExcessProperty: "error" })(
    configJson.success,
  ).pipe(Result.mapError(() => "invalid-config.json"));
  if (Result.isFailure(catalog)) return Result.fail(catalog.failure);
  if (Result.isFailure(config)) return Result.fail(config.failure);
  if (config.success.fields.some((field) => field.runtimeName === "PLUGIN_ACCESS_TOKEN")) {
    return Result.fail("reserved-host-credential-name");
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
    return Result.fail("credential-bearing-config-declaration");
  }
  const licenseEvidence = await validatePackagedPluginLicenseEvidence({
    files,
    manifest: manifest.success,
  });
  if (Result.isFailure(licenseEvidence)) return Result.fail(licenseEvidence.failure);
  const artifactDigest = await digestPluginBytes(input.archiveBytes);
  const manifestDigest = await digestPluginBytes(manifestFile);
  return Result.succeed({
    archive: archive.success,
    entries: entries.success,
    configDigest,
    manifest: manifest.success,
    authentication: manifest.success.authentication,
    provenance: provenanceJson.success,
    version: PluginVersion.make({
      id: versionId.success,
      marketplaceId: marketplaceId.success,
      publisherNamespace: manifest.success.publisher,
      pluginSlug: manifest.success.id,
      version: manifest.success.version,
      name: manifest.success.name,
      description: manifest.success.description,
      license: manifest.success.license,
      runtime: {
        _tag: "ManagedPackage",
        kind: "managed-package",
        artifactDigest,
        manifestDigest,
        entrypoint: manifest.success.runtime.entrypoint,
        node: "22.x",
      },
      catalog: PluginCatalogSnapshot.make({
        id: catalog.success.id,
        schemaVersion: 1,
        digest: catalogDigest,
        tools: catalog.success.tools,
      }),
      config: config.success,
      allowedHosts: manifest.success.network.allowedHosts,
      status: "published",
      publishedAt: input.publishedAt,
    }),
  });
}

/** Build deterministic ZIP bytes from already reviewed package files. */
export function buildDeterministicPluginArchive(
  files: Readonly<Record<string, Uint8Array>>,
): Uint8Array {
  const entries: Zippable = {};
  for (const path of Object.keys(files).toSorted()) {
    const bytes = files[path];
    if (bytes !== undefined) {
      entries[path] = [bytes, { level: 9, mtime: new Date("1980-01-01T00:00:00.000Z") }];
    }
  }
  return zipSync(entries, { level: 9 });
}

/** Encode a JSON file with stable indentation and a final newline. */
export function encodePluginJsonFile(value: Schema.Json): Uint8Array {
  return encodeUtf8.encode(`${JSON.stringify(value, null, 2)}\n`);
}
