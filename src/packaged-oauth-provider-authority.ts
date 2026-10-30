import { readFile } from "node:fs/promises";
import path from "node:path";
import { Result, Schema } from "effect";
import { canonicalPluginJson, PluginSha256, ProviderRegistrationId } from "./plugin-contract.js";
import {
  decodePluginOAuthProviderDefinition,
  digestPluginOAuthProviderDefinition,
  type PackagedOAuthAuthentication,
} from "./oauth-provider-definition.js";
import {
  loadReviewedWorkspaceOAuthProviderAuthority,
  type ReviewedWorkspaceOAuthProviderAuthority,
} from "./workspace-oauth-provider-authority.js";

const BindingName = Schema.String.pipe(Schema.check(Schema.isPattern(/^[A-Z][A-Z0-9_]{0,127}$/u)));
const PlatformOAuthProviderBindings = Schema.Struct({
  providerRegistration: ProviderRegistrationId,
  providerDefinition: Schema.Struct({
    path: Schema.Literal("oauth-provider.json"),
    canonicalSha256: PluginSha256,
  }),
  providerMetadata: Schema.Struct({
    provider: Schema.NonEmptyString,
    resourceIdentity: Schema.NonEmptyString,
    registrationMode: Schema.Literal("platform-pre-registered"),
    source: Schema.Literal("platform"),
    approvedScopes: Schema.Array(Schema.String),
  }),
  deploymentClient: Schema.Struct({
    clientIdBinding: BindingName,
    clientSecretBinding: BindingName,
    tokenEndpointAuthMethod: Schema.Literals(["client_secret_post", "client_secret_basic"]),
  }),
});

/** Source review selects admission ownership; platform mode requires separately deployed authority. */
export type ReviewedPackagedOAuthProviderAuthority =
  | {
      readonly kind: "workspace-oauth-app";
      readonly authority: ReviewedWorkspaceOAuthProviderAuthority;
    }
  | { readonly kind: "platform-pre-registered" };

/**
 * Validate a package's exact public provider bindings without reading or admitting platform credentials.
 * Platform registrations are subsequently checked against deployed material by the publication adapter;
 * only Workspace-owned registrations can be admitted by the release command.
 */
export async function loadReviewedPackagedOAuthProviderAuthority(input: {
  readonly sourceDirectory: string;
  readonly authentication: PackagedOAuthAuthentication;
}): Promise<Result.Result<ReviewedPackagedOAuthProviderAuthority, string>> {
  try {
    const encodedBindings = await readFile(
      path.join(input.sourceDirectory, "platform-bindings.json"),
      "utf8",
    );
    if (Buffer.byteLength(encodedBindings) > 65536)
      return Result.fail("packaged-oauth-bindings-invalid");
    const selection = Schema.decodeUnknownSync(
      Schema.fromJsonString(
        Schema.Struct({
          providerMetadata: Schema.Struct({
            registrationMode: Schema.Literals(["workspace-oauth-app", "platform-pre-registered"]),
          }),
        }),
      ),
    )(encodedBindings);
    if (selection.providerMetadata.registrationMode === "workspace-oauth-app") {
      return (await loadReviewedWorkspaceOAuthProviderAuthority(input)).pipe(
        Result.map((authority) => ({ kind: "workspace-oauth-app", authority }) as const),
      );
    }
    const bindings = Schema.decodeUnknownSync(
      Schema.fromJsonString(PlatformOAuthProviderBindings),
      { onExcessProperty: "error" },
    )(encodedBindings);
    const encodedDefinition = await readFile(
      path.join(input.sourceDirectory, "oauth-provider.json"),
      "utf8",
    );
    if (Buffer.byteLength(encodedDefinition) > 65536)
      return Result.fail("packaged-oauth-provider-definition-invalid");
    const definition = decodePluginOAuthProviderDefinition(
      Schema.decodeUnknownSync(Schema.fromJsonString(Schema.Json))(encodedDefinition),
    );
    if (Result.isFailure(definition))
      return Result.fail("packaged-oauth-provider-definition-invalid");
    const digest = await digestPluginOAuthProviderDefinition(definition.success);
    if (
      digest !== input.authentication.providerDefinitionDigest ||
      digest !== bindings.providerDefinition.canonicalSha256 ||
      input.authentication.providerRegistration !== bindings.providerRegistration ||
      canonicalPluginJson(input.authentication.requestedScopes) !==
        canonicalPluginJson(definition.success.scopes) ||
      canonicalPluginJson(bindings.providerMetadata.approvedScopes) !==
        canonicalPluginJson(definition.success.scopes) ||
      bindings.providerMetadata.provider !== definition.success.provider ||
      bindings.providerMetadata.resourceIdentity !== definition.success.resourceIdentity ||
      bindings.deploymentClient.tokenEndpointAuthMethod !==
        definition.success.tokenEndpointAuthMethod ||
      bindings.deploymentClient.clientIdBinding === bindings.deploymentClient.clientSecretBinding ||
      definition.success.account.kind !== "https-json" ||
      definition.success.account.displayLabelPath === undefined
    ) {
      return Result.fail("packaged-oauth-provider-authority-mismatch");
    }
    return Result.succeed({ kind: "platform-pre-registered" });
  } catch {
    return Result.fail("packaged-oauth-bindings-invalid");
  }
}
