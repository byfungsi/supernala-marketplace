import { Result, Schema } from "effect";

const PluginOpaqueId = Schema.NonEmptyString;

/** Stable identity for one Plugin Marketplace catalog source. */
export const PluginMarketplaceId = PluginOpaqueId.pipe(Schema.brand("PluginMarketplaceId"));
/** Stable identity for one Plugin Marketplace catalog source. */
export type PluginMarketplaceId = typeof PluginMarketplaceId.Type;

/** Stable identity for one immutable published Plugin version. */
export const PluginVersionId = PluginOpaqueId.pipe(Schema.brand("PluginVersionId"));
/** Stable identity for one immutable published Plugin version. */
export type PluginVersionId = typeof PluginVersionId.Type;

/** Stable identity for one immutable reviewed Plugin tool catalog. */
export const PluginCatalogSnapshotId = PluginOpaqueId.pipe(Schema.brand("PluginCatalogSnapshotId"));
/** Stable identity for one immutable reviewed Plugin tool catalog. */
export type PluginCatalogSnapshotId = typeof PluginCatalogSnapshotId.Type;

/** Stable identity for one curated managed remote MCP endpoint registration. */
export const RemoteMcpEndpointRegistrationId = PluginOpaqueId.pipe(
  Schema.brand("RemoteMcpEndpointRegistrationId"),
);
/** Stable identity for one curated managed remote MCP endpoint registration. */
export type RemoteMcpEndpointRegistrationId = typeof RemoteMcpEndpointRegistrationId.Type;

/** Stable identity for one platform-managed provider registration. */
export const ProviderRegistrationId = PluginOpaqueId.pipe(Schema.brand("ProviderRegistrationId"));
/** Stable identity for one platform-managed provider registration. */
export type ProviderRegistrationId = typeof ProviderRegistrationId.Type;

/** Stable identity for one Workspace-owned OAuth client registration. */
export const PluginOAuthAppId = PluginOpaqueId.pipe(Schema.brand("PluginOAuthAppId"));
/** Stable identity for one Workspace-owned OAuth client registration. */
export type PluginOAuthAppId = typeof PluginOAuthAppId.Type;

/** Stable identity for one durable profile-independent authentication setup attempt. */
export const PluginAuthSetupAttemptId = PluginOpaqueId.pipe(
  Schema.brand("PluginAuthSetupAttemptId"),
);

/** Stable identity of one installed Plugin connection. */
export const PluginConnectionId = PluginOpaqueId.pipe(Schema.brand("PluginConnectionId"));
/** Stable identity for one durable profile-independent authentication setup attempt. */
export type PluginAuthSetupAttemptId = typeof PluginAuthSetupAttemptId.Type;

/** Lowercase publisher namespace scoped to one Plugin Marketplace. */
export const PluginPublisherNamespace = Schema.String.pipe(
  Schema.check(Schema.isPattern(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)),
  Schema.check(Schema.isLengthBetween(1, 80)),
  Schema.brand("PluginPublisherNamespace"),
);
/** Lowercase publisher namespace scoped to one Plugin Marketplace. */
export type PluginPublisherNamespace = typeof PluginPublisherNamespace.Type;

/** Lowercase stable Plugin slug scoped to one Marketplace publisher. */
export const PluginSlug = Schema.String.pipe(
  Schema.check(Schema.isPattern(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)),
  Schema.check(Schema.isLengthBetween(1, 80)),
  Schema.brand("PluginSlug"),
);
/** Lowercase stable Plugin slug scoped to one Marketplace publisher. */
export type PluginSlug = typeof PluginSlug.Type;

/** Reviewed normalized tool identifier independent of the underlying MCP name. */
export const PluginToolId = Schema.String.pipe(
  Schema.check(Schema.isPattern(/^[a-z0-9]+(?:[._-][a-z0-9]+)*$/)),
  Schema.check(Schema.isLengthBetween(1, 160)),
  Schema.brand("PluginToolId"),
);
/** Reviewed normalized tool identifier independent of the underlying MCP name. */
export type PluginToolId = typeof PluginToolId.Type;

/** Lowercase SHA-256 digest without an algorithm prefix. */
export const PluginSha256 = Schema.String.pipe(
  Schema.check(Schema.isPattern(/^[a-f0-9]{64}$/)),
  Schema.brand("PluginSha256"),
);
/** Lowercase SHA-256 digest without an algorithm prefix. */
export type PluginSha256 = typeof PluginSha256.Type;

/** Exact semantic version accepted by the immutable Plugin publication contract. */
export const PluginSemanticVersion = Schema.String.pipe(
  Schema.check(
    Schema.isPattern(
      /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/,
    ),
  ),
  Schema.brand("PluginSemanticVersion"),
);
/** Exact semantic version accepted by the immutable Plugin publication contract. */
export type PluginSemanticVersion = typeof PluginSemanticVersion.Type;

/** Reviewed Plugin tool behavior classification. */
export const PluginToolClassification = Schema.Literals([
  "read",
  "write",
  "destructive",
  "unknown",
]);
/** Reviewed Plugin tool behavior classification. */
export type PluginToolClassification = typeof PluginToolClassification.Type;

/** Owner-selectable policy after stricter reviewed constraints are applied. */
export const PluginToolPolicy = Schema.Literals(["allow", "require-approval", "block"]);
/** Owner-selectable policy after stricter reviewed constraints are applied. */
export type PluginToolPolicy = typeof PluginToolPolicy.Type;

/** Immutable runtime descriptor with exactly the two accepted managed runtime kinds. */
export const PluginRuntimeDescriptor = Schema.TaggedUnion({
  ManagedPackage: {
    kind: Schema.Literal("managed-package"),
    artifactDigest: PluginSha256,
    manifestDigest: PluginSha256,
    entrypoint: Schema.String.pipe(Schema.check(Schema.isLengthBetween(1, 512))),
    node: Schema.Literal("22.x"),
  },
  ManagedRemoteMcp: {
    kind: Schema.Literal("managed-remote-mcp"),
    endpointRegistrationId: RemoteMcpEndpointRegistrationId,
    providerRegistrationId: ProviderRegistrationId,
    transport: Schema.Literal("streamable-http"),
  },
});
/** Immutable runtime descriptor with exactly the two accepted managed runtime kinds. */
export type PluginRuntimeDescriptor = typeof PluginRuntimeDescriptor.Type;

/** One bounded JSON Schema object retained in a reviewed normalized catalog. */
export const PluginToolInputSchema = Schema.JsonObject.pipe(Schema.brand("PluginToolInputSchema"));
/** One bounded JSON Schema object retained in a reviewed normalized catalog. */
export type PluginToolInputSchema = typeof PluginToolInputSchema.Type;

/** One reviewed static tool entry. */
export const PluginCatalogTool = Schema.Struct({
  id: PluginToolId,
  mcpName: Schema.String.pipe(Schema.check(Schema.isLengthBetween(1, 160))),
  title: Schema.Trimmed.pipe(Schema.check(Schema.isLengthBetween(1, 160))),
  description: Schema.Trimmed.pipe(Schema.check(Schema.isLengthBetween(1, 1_000))),
  classification: PluginToolClassification,
  defaultPolicy: PluginToolPolicy,
  inputSchema: PluginToolInputSchema,
  maximumOutputBytes: Schema.Int.pipe(
    Schema.check(Schema.isGreaterThanOrEqualTo(1)),
    Schema.check(Schema.isLessThanOrEqualTo(1_048_576)),
  ),
});
/** One reviewed static tool entry. */
export interface PluginCatalogTool extends Schema.Schema.Type<typeof PluginCatalogTool> {}

/** Immutable reviewed normalized catalog pinned by one Plugin version. */
export const PluginCatalogSnapshot = Schema.Struct({
  id: PluginCatalogSnapshotId,
  schemaVersion: Schema.Literal(1),
  digest: PluginSha256,
  tools: Schema.Array(PluginCatalogTool).pipe(Schema.check(Schema.isMaxLength(2_000))),
});
/** Immutable reviewed normalized catalog pinned by one Plugin version. */
export interface PluginCatalogSnapshot extends Schema.Schema.Type<typeof PluginCatalogSnapshot> {}

/** Public declaration of one typed Config value and permitted destination. */
export const PluginConfigField = Schema.Struct({
  key: Schema.String.pipe(
    Schema.check(Schema.isPattern(/^[A-Za-z][A-Za-z0-9_.-]*$/)),
    Schema.check(Schema.isLengthBetween(1, 120)),
  ),
  label: Schema.Trimmed.pipe(Schema.check(Schema.isLengthBetween(1, 160))),
  type: Schema.Literals(["string", "boolean", "integer", "url"]),
  scope: Schema.Literals(["workspace-activation", "connection"]),
  sensitivity: Schema.Literals(["non-secret", "secret"]),
  sourcePolicy: Schema.Literals([
    "platform-only",
    "owner-required",
    "owner-optional",
    "platform-default-owner-override",
  ]),
  delivery: Schema.Literals([
    "oauth-broker-only",
    "token-minting-adapter-only",
    "plugin-host-environment",
    "remote-mcp-header",
    "control-plane-only",
  ]),
  runtimeName: Schema.optionalKey(
    Schema.String.pipe(Schema.check(Schema.isPattern(/^[A-Z][A-Z0-9_]*$/))),
  ),
  affects: Schema.Array(
    Schema.Literals(["authentication", "network-egress", "tool-behavior"]),
  ).pipe(Schema.check(Schema.isMaxLength(3))),
});
/** Public declaration of one typed Config value and permitted destination. */
export interface PluginConfigField extends Schema.Schema.Type<typeof PluginConfigField> {}

/** Immutable public Config declaration containing no values. */
export const PluginConfigSchema = Schema.Struct({
  revision: Schema.Int.pipe(Schema.check(Schema.isGreaterThanOrEqualTo(1))),
  fields: Schema.Array(PluginConfigField).pipe(Schema.check(Schema.isMaxLength(100))),
});
/** Immutable public Config declaration containing no values. */
export interface PluginConfigSchema extends Schema.Schema.Type<typeof PluginConfigSchema> {}

/** Immutable exact Plugin version published by one Marketplace-scoped definition. */
export const PluginVersion = Schema.Struct({
  id: PluginVersionId,
  marketplaceId: PluginMarketplaceId,
  publisherNamespace: PluginPublisherNamespace,
  pluginSlug: PluginSlug,
  version: PluginSemanticVersion,
  name: Schema.Trimmed.pipe(Schema.check(Schema.isLengthBetween(1, 120))),
  description: Schema.Trimmed.pipe(Schema.check(Schema.isLengthBetween(1, 2_000))),
  license: Schema.String.pipe(Schema.check(Schema.isLengthBetween(1, 80))),
  runtime: PluginRuntimeDescriptor,
  catalog: PluginCatalogSnapshot,
  config: PluginConfigSchema,
  allowedHosts: Schema.Array(
    Schema.String.pipe(
      Schema.check(Schema.isPattern(/^(?=.{1,253}$)(?!-)[a-z0-9-]+(?:\.[a-z0-9-]+)+$/)),
    ),
  ).pipe(Schema.check(Schema.isMaxLength(100))),
  status: Schema.Literals(["published", "revoked"]),
  publishedAt: Schema.Int.pipe(Schema.check(Schema.isGreaterThanOrEqualTo(0))),
});
/** Immutable exact Plugin version published by one Marketplace-scoped definition. */
export interface PluginVersion extends Schema.Schema.Type<typeof PluginVersion> {}

/** Render JSON with recursively sorted object keys and no insignificant whitespace. */
export function canonicalPluginJson(value: Schema.Json): string {
  if (Array.isArray(value)) return `[${value.map(canonicalPluginJson).join(",")}]`;
  if (Schema.is(Schema.JsonObject)(value)) {
    return `{${Object.entries(value)
      .toSorted(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => `${JSON.stringify(key)}:${canonicalPluginJson(entry)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

/** Compute a lowercase SHA-256 digest for exact bytes. */
export async function digestPluginBytes(bytes: Uint8Array): Promise<PluginSha256> {
  const digest = await crypto.subtle.digest("SHA-256", Uint8Array.from(bytes).buffer);
  return PluginSha256.make(
    [...new Uint8Array(digest)].map((value) => value.toString(16).padStart(2, "0")).join(""),
  );
}

/** Require exact equality between observed and reviewed remote catalogs. */
export function compareRemotePluginCatalogs(
  reviewed: PluginCatalogSnapshot,
  observed: PluginCatalogSnapshot,
): Result.Result<PluginCatalogSnapshot, "catalog-drift"> {
  return canonicalPluginJson(reviewed) === canonicalPluginJson(observed)
    ? Result.succeed(reviewed)
    : Result.fail("catalog-drift");
}
