import { Result, Schema } from "effect";
import {
  PluginCatalogSnapshot,
  PluginConfigSchema,
  PluginMarketplaceId,
  PluginPublisherNamespace,
  PluginSemanticVersion,
  PluginSha256,
  PluginSlug,
  PluginVersionId,
  ProviderRegistrationId,
  RemoteMcpEndpointRegistrationId,
} from "./plugin-contract.js";
import { PluginAuthStrategyDefinition } from "./plugin-auth-strategy.js";
import { OAuthScopeSet, PluginOAuthProviderDefinition } from "./oauth-provider-definition.js";

/** Curated managed-remote authoring record; staged records cannot enter a publication plan. */
export const ManagedRemotePluginRelease = Schema.Struct({
  schemaVersion: Schema.Literal(1),
  status: Schema.Literals(["staged-unverified", "reviewed-publishable"]),
  id: PluginVersionId,
  marketplaceId: PluginMarketplaceId,
  publisherNamespace: PluginPublisherNamespace,
  pluginSlug: PluginSlug,
  version: PluginSemanticVersion,
  name: Schema.Trimmed.pipe(Schema.check(Schema.isLengthBetween(1, 120))),
  description: Schema.Trimmed.pipe(Schema.check(Schema.isLengthBetween(1, 2_000))),
  license: Schema.String.pipe(Schema.check(Schema.isLengthBetween(1, 80))),
  runtime: Schema.Struct({
    _tag: Schema.Literal("ManagedRemoteMcp"),
    kind: Schema.Literal("managed-remote-mcp"),
    endpointRegistrationId: RemoteMcpEndpointRegistrationId,
    providerRegistrationId: ProviderRegistrationId,
    transport: Schema.Literal("streamable-http"),
  }),
  endpoint: Schema.String.pipe(Schema.check(Schema.isLengthBetween(1, 2_048))),
  oauthRegistrationMode: Schema.Literals([
    "dynamic",
    "cimd",
    "platform-pre-registered",
    "workspace-oauth-app",
  ]),
  authStrategy: Schema.optionalKey(PluginAuthStrategyDefinition),
  oauthProviderDefinition: Schema.optionalKey(PluginOAuthProviderDefinition),
  providerDefinitionDigest: Schema.optionalKey(PluginSha256),
  scopes: Schema.Array(Schema.String.pipe(Schema.check(Schema.isLengthBetween(1, 300)))).pipe(
    Schema.check(Schema.isMaxLength(100)),
  ),
  catalog: PluginCatalogSnapshot,
  config: PluginConfigSchema,
  allowedHosts: Schema.Array(Schema.String).pipe(Schema.check(Schema.isLengthBetween(1, 100))),
  protocolPolicy: Schema.optionalKey(
    Schema.Struct({
      catalogCompatibility: Schema.Literals(["exact", "reviewed-subset"]),
      maximumCatalogPages: Schema.Int.pipe(
        Schema.check(Schema.isBetween({ minimum: 1, maximum: 20 })),
      ),
    }),
  ),
  evidenceUrls: Schema.optionalKey(
    Schema.Array(Schema.String.pipe(Schema.check(Schema.isLengthBetween(1, 2_048)))).pipe(
      Schema.check(Schema.isMaxLength(20)),
    ),
  ),
  verificationNotes: Schema.Trimmed.pipe(Schema.check(Schema.isLengthBetween(1, 2_000))),
});
/** Curated managed-remote authoring record; staged records cannot enter a publication plan. */
export interface ManagedRemotePluginRelease extends Schema.Schema.Type<
  typeof ManagedRemotePluginRelease
> {}

/** Validate exact HTTPS endpoint/host agreement and fail staged records closed for publication. */
export function validateManagedRemotePluginRelease(
  input: unknown,
  mode: "authoring" | "publication",
): Result.Result<ManagedRemotePluginRelease, string> {
  const parsed = Schema.decodeUnknownResult(ManagedRemotePluginRelease)(input).pipe(
    Result.mapError(() => "remote-release-invalid"),
  );
  if (Result.isFailure(parsed)) return parsed;
  let endpoint: URL;
  try {
    endpoint = new URL(parsed.success.endpoint);
  } catch {
    return Result.fail("remote-endpoint-invalid");
  }
  if (
    endpoint.protocol !== "https:" ||
    endpoint.username !== "" ||
    endpoint.password !== "" ||
    endpoint.port !== "" ||
    parsed.success.allowedHosts.length !== 1 ||
    parsed.success.allowedHosts[0] !== endpoint.hostname
  ) {
    return Result.fail("remote-endpoint-authority-mismatch");
  }
  if (mode === "publication" && parsed.success.status !== "reviewed-publishable") {
    return Result.fail("remote-release-not-reviewed");
  }
  if (
    mode === "publication" &&
    ((parsed.success.authStrategy === undefined &&
      parsed.success.providerDefinitionDigest === undefined) ||
      parsed.success.catalog.tools.length === 0 ||
      /^0{64}$/u.test(parsed.success.catalog.digest) ||
      parsed.success.protocolPolicy === undefined ||
      parsed.success.evidenceUrls === undefined ||
      parsed.success.evidenceUrls.length === 0)
  ) {
    return Result.fail("remote-release-evidence-incomplete");
  }
  if (parsed.success.authStrategy !== undefined) {
    const strategy = parsed.success.authStrategy;
    if (strategy.providerRegistrationId !== parsed.success.runtime.providerRegistrationId) {
      return Result.fail("remote-auth-provider-registration-mismatch");
    }
    if (
      strategy.profile !== "api-key" &&
      (parsed.success.providerDefinitionDigest !== strategy.providerDefinitionDigest ||
        parsed.success.scopes.length !== strategy.requestedScopes.length ||
        parsed.success.scopes.some((scope, index) => scope !== strategy.requestedScopes[index]))
    ) {
      return Result.fail("remote-auth-oauth-authority-mismatch");
    }
    if (
      strategy.profile === "api-key" &&
      (parsed.success.providerDefinitionDigest !== undefined || parsed.success.scopes.length !== 0)
    ) {
      return Result.fail("remote-auth-api-key-authority-mismatch");
    }
  }
  if (mode === "publication" && parsed.success.authStrategy?.profile !== "api-key") {
    const scopes = Schema.decodeUnknownResult(OAuthScopeSet)(parsed.success.scopes);
    if (
      Result.isFailure(scopes) ||
      scopes.success.some((scope, index) => scope !== parsed.success.scopes[index])
    ) {
      return Result.fail("remote-oauth-scopes-invalid");
    }
  }
  if (mode === "publication") {
    const names = new Set<string>();
    for (const tool of parsed.success.catalog.tools) {
      if (names.has(tool.mcpName)) return Result.fail("remote-catalog-duplicate-tool-name");
      names.add(tool.mcpName);
      if (
        tool.mcpName === "discover" ||
        tool.mcpName === "executeRead" ||
        tool.mcpName === "executeWrite" ||
        tool.mcpName === "executeDestructive"
      ) {
        return Result.fail("remote-catalog-generic-dispatch-tool-forbidden");
      }
    }
  }
  return parsed;
}
