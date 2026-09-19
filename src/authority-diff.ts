import { Schema } from "effect";
import {
  canonicalPluginJson,
  digestPluginBytes,
  type PluginConfigSchema,
} from "./plugin-contract.js";
import {
  packagedAuthenticationProviderDefinitionDigest,
  packagedAuthenticationProviderRegistration,
  packagedAuthenticationRequestedScopes,
  type PackageCatalog,
  type PackageManifest,
} from "./package-archive.js";

/** Complete reviewed authority surface for one authoring release. */
export const PluginAuthoritySnapshot = Schema.Struct({
  runtimeKind: Schema.Literals(["managed-package", "managed-remote-mcp"]),
  authenticationKind: Schema.String,
  requestedScopes: Schema.Array(Schema.String),
  endpoint: Schema.NullOr(Schema.String),
  endpointRegistrationId: Schema.NullOr(Schema.String),
  providerRegistrationId: Schema.NullOr(Schema.String),
  providerDefinitionDigest: Schema.NullOr(Schema.String),
  tools: Schema.Array(
    Schema.Struct({
      id: Schema.String,
      classification: Schema.String,
      defaultPolicy: Schema.String,
      inputSchema: Schema.JsonObject,
    }),
  ),
  allowedHosts: Schema.Array(Schema.String),
  config: Schema.Array(
    Schema.Struct({
      key: Schema.String,
      type: Schema.String,
      scope: Schema.String,
      required: Schema.Boolean,
      atomicGroup: Schema.NullOr(Schema.String),
      sensitivity: Schema.String,
      sourcePolicy: Schema.String,
      delivery: Schema.String,
      affects: Schema.Array(Schema.String),
      runtimeName: Schema.NullOr(Schema.String),
    }),
  ),
});
/** Complete reviewed authority surface for one authoring release. */
export interface PluginAuthoritySnapshot extends Schema.Schema.Type<
  typeof PluginAuthoritySnapshot
> {}

/** Machine-reviewable authority change bound by its own digest. */
export interface PluginAuthorityDiff {
  readonly beforeDigest: string;
  readonly afterDigest: string;
  readonly diffDigest: string;
  readonly expandsAuthority: boolean;
  readonly addedTools: ReadonlyArray<string>;
  readonly removedTools: ReadonlyArray<string>;
  readonly changedTools: ReadonlyArray<string>;
  readonly addedHosts: ReadonlyArray<string>;
  readonly removedHosts: ReadonlyArray<string>;
  readonly changedConfig: ReadonlyArray<string>;
  readonly changedRuntimeAuthority: boolean;
}

/** Project package source into the complete reviewed authority surface. */
export function derivePluginAuthoritySnapshot(input: {
  readonly manifest: PackageManifest;
  readonly catalog: PackageCatalog;
  readonly config: PluginConfigSchema;
}): PluginAuthoritySnapshot {
  return PluginAuthoritySnapshot.make({
    runtimeKind: input.manifest.runtime.kind,
    authenticationKind: input.manifest.authentication.kind,
    requestedScopes: packagedAuthenticationRequestedScopes(input.manifest.authentication),
    endpoint: null,
    endpointRegistrationId: null,
    providerRegistrationId: packagedAuthenticationProviderRegistration(
      input.manifest.authentication,
    ),
    providerDefinitionDigest: packagedAuthenticationProviderDefinitionDigest(
      input.manifest.authentication,
    ),
    tools: input.catalog.tools.map((tool) => ({
      id: tool.id,
      classification: tool.classification,
      defaultPolicy: tool.defaultPolicy,
      inputSchema: tool.inputSchema,
    })),
    allowedHosts: input.manifest.network.allowedHosts,
    config: input.config.fields.map((field) => ({
      key: field.key,
      type: field.type,
      scope: field.scope,
      required: false,
      atomicGroup: null,
      sensitivity: field.sensitivity,
      sourcePolicy: field.sourcePolicy,
      delivery: field.delivery,
      affects: field.affects,
      runtimeName: field.runtimeName ?? null,
    })),
  });
}

/** Derive the unique no-prior-publication authority baseline for a runtime family. */
export function deriveBootstrapAuthoritySnapshot(
  after: PluginAuthoritySnapshot,
): PluginAuthoritySnapshot {
  return PluginAuthoritySnapshot.make({
    runtimeKind: after.runtimeKind,
    authenticationKind: "none",
    requestedScopes: [],
    endpoint: null,
    endpointRegistrationId: null,
    providerRegistrationId: null,
    providerDefinitionDigest: null,
    tools: [],
    allowedHosts: [],
    config: [],
  });
}

const jsonBytes = (value: Schema.Json): Uint8Array =>
  new TextEncoder().encode(canonicalPluginJson(value));

/** Compute tool, schema, policy, network, and Config authority changes. */
export async function diffPluginAuthority(
  before: PluginAuthoritySnapshot,
  after: PluginAuthoritySnapshot,
): Promise<PluginAuthorityDiff> {
  const beforeTools = new Map(before.tools.map((tool) => [tool.id, tool]));
  const afterTools = new Map(after.tools.map((tool) => [tool.id, tool]));
  const addedTools = [...afterTools.keys()].filter((id) => !beforeTools.has(id)).toSorted();
  const removedTools = [...beforeTools.keys()].filter((id) => !afterTools.has(id)).toSorted();
  const changedTools = [...afterTools.entries()]
    .filter(([id, tool]) => {
      const previous = beforeTools.get(id);
      return previous !== undefined && canonicalPluginJson(previous) !== canonicalPluginJson(tool);
    })
    .map(([id]) => id)
    .toSorted();
  const addedHosts = after.allowedHosts
    .filter((host) => !before.allowedHosts.includes(host))
    .toSorted();
  const removedHosts = before.allowedHosts
    .filter((host) => !after.allowedHosts.includes(host))
    .toSorted();
  const beforeConfig = new Map(before.config.map((field) => [field.key, field]));
  const afterConfig = new Map(after.config.map((field) => [field.key, field]));
  const changedConfig = [...new Set([...beforeConfig.keys(), ...afterConfig.keys()])]
    .filter(
      (key) =>
        canonicalPluginJson(beforeConfig.get(key) ?? null) !==
        canonicalPluginJson(afterConfig.get(key) ?? null),
    )
    .toSorted();
  const beforeDigest = await digestPluginBytes(jsonBytes(before));
  const afterDigest = await digestPluginBytes(jsonBytes(after));
  const runtimeAuthority = (snapshot: PluginAuthoritySnapshot) => ({
    runtimeKind: snapshot.runtimeKind,
    authenticationKind: snapshot.authenticationKind,
    requestedScopes: snapshot.requestedScopes,
    endpoint: snapshot.endpoint,
    endpointRegistrationId: snapshot.endpointRegistrationId,
    providerRegistrationId: snapshot.providerRegistrationId,
    providerDefinitionDigest: snapshot.providerDefinitionDigest,
  });
  const changedRuntimeAuthority =
    canonicalPluginJson(runtimeAuthority(before)) !== canonicalPluginJson(runtimeAuthority(after));
  const rawDiff = {
    beforeDigest,
    afterDigest,
    addedTools,
    removedTools,
    changedTools,
    addedHosts,
    removedHosts,
    changedConfig,
    changedRuntimeAuthority,
  };
  return {
    ...rawDiff,
    diffDigest: await digestPluginBytes(jsonBytes(rawDiff)),
    expandsAuthority:
      addedTools.length > 0 ||
      changedTools.length > 0 ||
      addedHosts.length > 0 ||
      changedConfig.length > 0 ||
      changedRuntimeAuthority,
  };
}
