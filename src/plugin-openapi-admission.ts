import { Result, Schema } from "effect";
import { canonicalPluginOpenApiJson } from "./plugin-openapi-canonical.js";
import {
  parsePluginOpenApiContract,
  type PluginOpenApiContract,
} from "./plugin-openapi-contract.js";
import { digestPluginBytes, PluginConfigSchema, type PluginSha256 } from "./plugin-contract.js";
import { PluginAuthStrategyDefinition } from "./plugin-auth-strategy.js";
import { isBoundedPluginOpenApiJson } from "./plugin-openapi-json-bounds.js";

/** Exact application publication projections checked before staging and after durable readback. */
export interface MarketplaceOpenApiAdmissionInput {
  readonly bundleBytes: Uint8Array;
  readonly artifactDigest: PluginSha256;
  readonly manifestDigest: PluginSha256;
  readonly objectKey: string;
  readonly pluginVersionId: string;
  readonly catalogSnapshotId: string;
  readonly catalogDigest: PluginSha256;
  readonly catalogToolsJson: string;
  readonly authDefinitionJson: string;
  readonly providerRegistrationId: string;
  readonly configSchemaJson: string;
  readonly configSchemaDigest: PluginSha256;
  readonly provenanceJson: string;
  readonly allowedHostsJson: string;
}

/** Admits exact OpenAPI bundle bytes against source, catalog, auth, config, provenance and host authority. */
export async function admitMarketplaceOpenApiCandidate(
  input: MarketplaceOpenApiAdmissionInput,
): Promise<Result.Result<PluginOpenApiContract, string>> {
  if (
    input.objectKey !== `openapi/${input.artifactDigest}` ||
    input.manifestDigest !== input.artifactDigest ||
    (await digestPluginBytes(input.bundleBytes)) !== input.artifactDigest ||
    input.bundleBytes.byteLength > 10 * 1_048_576
  )
    return Result.fail("openapi-artifact");
  let bundle: Schema.Json;
  let tools: Schema.Json;
  let auth: typeof PluginAuthStrategyDefinition.Type;
  let config: typeof PluginConfigSchema.Type;
  let provenance: Schema.JsonObject;
  let hosts: ReadonlyArray<string>;
  try {
    const decoder = new TextDecoder("utf-8", { fatal: true });
    const text = decoder.decode(input.bundleBytes);
    if (!isBoundedPluginOpenApiJson(text)) return Result.fail("openapi-artifact");
    bundle = Schema.decodeUnknownSync(Schema.Json)(JSON.parse(text));
    tools = Schema.decodeUnknownSync(Schema.Json)(JSON.parse(input.catalogToolsJson));
    auth = Schema.decodeUnknownSync(PluginAuthStrategyDefinition)(
      JSON.parse(input.authDefinitionJson),
    );
    config = Schema.decodeUnknownSync(PluginConfigSchema)(JSON.parse(input.configSchemaJson));
    provenance = Schema.decodeUnknownSync(Schema.JsonObject)(JSON.parse(input.provenanceJson));
    hosts = Schema.decodeUnknownSync(Schema.Array(Schema.String))(
      JSON.parse(input.allowedHostsJson),
    );
  } catch {
    return Result.fail("openapi-artifact");
  }
  const contract = parsePluginOpenApiContract(bundle);
  if (Result.isFailure(contract)) return Result.fail("openapi-artifact");
  if (
    contract.success.pluginVersionId !== input.pluginVersionId ||
    (await digestPluginBytes(new TextEncoder().encode(contract.success.sourceText))) !==
      contract.success.sourceDigest ||
    (await digestPluginBytes(
      new TextEncoder().encode(
        canonicalPluginOpenApiJson({
          id: contract.success.catalog.id,
          schemaVersion: contract.success.catalog.schemaVersion,
          tools: contract.success.catalog.tools,
        }),
      ),
    )) !== contract.success.catalog.digest
  )
    return Result.fail("openapi-artifact");
  if (
    input.catalogSnapshotId !== contract.success.catalog.id ||
    input.catalogDigest !== contract.success.catalog.digest ||
    canonicalPluginOpenApiJson(tools) !== canonicalPluginOpenApiJson(contract.success.catalog.tools)
  ) {
    return Result.fail("openapi-catalog");
  }
  if (
    auth.profile !== "api-key" ||
    auth.providerRegistrationId !== input.providerRegistrationId ||
    canonicalPluginOpenApiJson(auth) !== canonicalPluginOpenApiJson(contract.success.authStrategy)
  ) {
    return Result.fail("openapi-authentication");
  }
  if (
    config.fields.length !== 0 ||
    (await digestPluginBytes(new TextEncoder().encode(input.configSchemaJson))) !==
      input.configSchemaDigest
  ) {
    return Result.fail("openapi-config");
  }
  if (provenance.sourceDigest !== contract.success.sourceDigest)
    return Result.fail("openapi-provenance");
  const expectedHosts = [
    ...new Set(contract.success.bindings.map((binding) => new URL(binding.origin).hostname)),
  ].toSorted();
  if (
    canonicalPluginOpenApiJson([...hosts].toSorted()) !== canonicalPluginOpenApiJson(expectedHosts)
  ) {
    return Result.fail("openapi-destination");
  }
  return Result.succeed(contract.success);
}
