import { Result, Schema } from "effect";
import {
  PluginCatalogSnapshot,
  PluginConfigSchema,
  PluginMarketplaceId,
  PluginPublisherNamespace,
  PluginSemanticVersion,
  PluginSlug,
  PluginVersionId,
  ProviderRegistrationId,
  RemoteMcpEndpointRegistrationId,
} from "./plugin-contract.js";

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
  oauthRegistrationMode: Schema.Literals(["dynamic", "platform-pre-registered"]),
  scopes: Schema.Array(Schema.String.pipe(Schema.check(Schema.isLengthBetween(1, 300)))).pipe(
    Schema.check(Schema.isMaxLength(100)),
  ),
  catalog: PluginCatalogSnapshot,
  config: PluginConfigSchema,
  allowedHosts: Schema.Array(Schema.String).pipe(Schema.check(Schema.isLengthBetween(1, 100))),
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
  return parsed;
}
