// GENERATED from @supernala/domain auth contract v1.
// Source SHA-256: ab48df365da7608ba41b2a9cdc65540668bca9a5fbeca895a479b5403de4ac80
// Run `pnpm auth-contract:vendor <distribution-directory>`; do not edit.
import { Schema } from "effect";
import {
  PluginAuthSetupAttemptId,
  PluginConnectionId,
  PluginOAuthAppId,
  PluginSha256,
  PluginToolId,
  ProviderRegistrationId,
} from "../plugin-contract.js";
import { OAuthScopeSet, OAuthTokenEndpointAuthMethod } from "../oauth-provider-definition.js";

const BoundedText = Schema.Trimmed.pipe(Schema.check(Schema.isLengthBetween(1, 500)));

const BoundedHttpsUrl = Schema.String.pipe(
  Schema.check(Schema.isLengthBetween(1, 2_048)),
  Schema.check(
    Schema.makeFilter<string>(
      (value) => {
        try {
          const url = new URL(value);

          return (
            url.protocol === "https:" &&
            url.username === "" &&
            url.password === "" &&
            url.port === "" &&
            url.href === value
          );
        } catch {
          return false;
        }
      },
      { expected: "an exact canonical HTTPS URL" },
    ),
  ),
);

const SafeProjectionKey = Schema.String.pipe(
  Schema.check(Schema.isLengthBetween(1, 128)),
  Schema.check(Schema.isPattern(/^[A-Za-z0-9][A-Za-z0-9_.-]*$/u)),
  Schema.check(
    Schema.makeFilter<string>(
      (key) => key !== "__proto__" && key !== "prototype" && key !== "constructor",
      { expected: "a safe literal JSON projection key" },
    ),
  ),
);

const ProjectionPath = Schema.Array(SafeProjectionKey).pipe(
  Schema.check(Schema.isLengthBetween(1, 8)),
);

const IdentitySubjectProjection = {
  subjectPath: Schema.optionalKey(ProjectionPath),
  subjectPaths: Schema.optionalKey(
    Schema.Array(ProjectionPath).pipe(Schema.check(Schema.isLengthBetween(2, 4))),
  ),
} as const;

const ProjectionLimits = {
  maximumResponseBytes: Schema.Int.pipe(
    Schema.check(Schema.isBetween({ minimum: 1_024, maximum: 262_144 })),
  ),
  maximumJsonDepth: Schema.Int.pipe(Schema.check(Schema.isBetween({ minimum: 1, maximum: 16 }))),
  maximumObjectKeys: Schema.Int.pipe(
    Schema.check(Schema.isBetween({ minimum: 1, maximum: 2_048 })),
  ),
} as const;

/** Author-facing authentication profile implemented by one reusable Connection strategy. */
export const PluginAuthProfile = Schema.Literals([
  "workspace-oauth",
  "mcp-oauth",
  "api-key",
  "device-oauth",
]);

/** Author-facing authentication profile implemented by one reusable Connection strategy. */
export type PluginAuthProfile = typeof PluginAuthProfile.Type;

/** One Owner-entered secret field whose value remains in the Plugin credential Vault. */
export const PluginCredentialField = Schema.Struct({
  key: Schema.String.pipe(
    Schema.check(Schema.isLengthBetween(1, 64)),
    Schema.check(Schema.isPattern(/^[a-z][a-z0-9_.-]*$/u)),
  ),
  label: Schema.Trimmed.pipe(Schema.check(Schema.isLengthBetween(1, 80))),
  secret: Schema.Boolean,
  minimumLength: Schema.Int.pipe(Schema.check(Schema.isBetween({ minimum: 1, maximum: 8_192 }))),
  maximumLength: Schema.Int.pipe(Schema.check(Schema.isBetween({ minimum: 1, maximum: 8_192 }))),
});

/** One Owner-entered secret field whose value remains in the Plugin credential Vault. */
export interface PluginCredentialField extends Schema.Schema.Type<typeof PluginCredentialField> {}

/** Declarative API credential attachment applied only by the trusted invocation adapter. */
export const PluginApiCredentialDelivery = Schema.Union([
  Schema.Struct({
    kind: Schema.Literal("header"),
    field: PluginCredentialField.fields.key,
    headerName: Schema.String.pipe(
      Schema.check(Schema.isLengthBetween(1, 128)),
      Schema.check(Schema.isPattern(/^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/u)),
      Schema.check(
        Schema.makeFilter<string>(
          (name) =>
            ![
              "connection",
              "content-length",
              "cookie",
              "host",
              "mcp-protocol-version",
              "mcp-session-id",
              "transfer-encoding",
            ].includes(name.toLowerCase()),
          { expected: "a credential header that cannot override transport authority" },
        ),
      ),
    ),
    encoding: Schema.Literals(["raw", "bearer"]),
  }),
]);

/** Declarative API credential attachment applied only by the trusted invocation adapter. */
export type PluginApiCredentialDelivery = typeof PluginApiCredentialDelivery.Type;

/** Fixed reviewed bootstrap MCP operation; neither tool name nor input is model supplied. */
export const PluginBootstrapMcpOperation = Schema.Struct({
  endpoint: BoundedHttpsUrl,
  toolName: Schema.String.pipe(Schema.check(Schema.isLengthBetween(1, 160))),
  input: Schema.JsonObject,
  maximumOutputBytes: Schema.Int.pipe(
    Schema.check(Schema.isBetween({ minimum: 1, maximum: 1_048_576 })),
  ),
});

/** Fixed reviewed bootstrap MCP operation; neither tool name nor input is model supplied. */
export interface PluginBootstrapMcpOperation extends Schema.Schema.Type<
  typeof PluginBootstrapMcpOperation
> {}

/** Provider-neutral identity resolution performed after credentials are acquired. */
export const PluginIdentityDeclaration = Schema.Union([
  Schema.Struct({
    kind: Schema.Literal("opaque-connection"),
    displayLabel: BoundedText,
  }),
  Schema.Struct({
    kind: Schema.Literal("token-response"),
    ...IdentitySubjectProjection,
    displayLabelPath: Schema.optionalKey(ProjectionPath),
  }),
  Schema.Struct({
    kind: Schema.Literals(["https-json", "oidc-userinfo"]),
    endpoint: BoundedHttpsUrl,
    authorization: Schema.Literal("bearer"),
    ...IdentitySubjectProjection,
    displayLabelPath: ProjectionPath,
    subjectStability: Schema.Literals(["stable", "mutable"]),
    ...ProjectionLimits,
  }),
  Schema.Struct({
    kind: Schema.Literal("mcp-tool"),
    operation: PluginBootstrapMcpOperation,
    ...IdentitySubjectProjection,
    displayLabelPath: ProjectionPath,
    subjectStability: Schema.Literals(["stable", "mutable"]),
    ...ProjectionLimits,
  }),
]).pipe(
  Schema.check(
    Schema.makeFilter<
      | { readonly kind: "opaque-connection" }
      | {
          readonly subjectPath?: ReadonlyArray<string>;
          readonly subjectPaths?: ReadonlyArray<ReadonlyArray<string>>;
        }
    >(
      (declaration) => {
        if ("kind" in declaration && declaration.kind === "opaque-connection") return true;

        const hasSubjectPath =
          "subjectPath" in declaration && declaration.subjectPath !== undefined;

        const hasSubjectPaths =
          "subjectPaths" in declaration && declaration.subjectPaths !== undefined;

        return hasSubjectPath !== hasSubjectPaths;
      },
      { expected: "exactly one identity subjectPath or subjectPaths projection" },
    ),
  ),
);

/** Provider-neutral identity resolution performed after credentials are acquired. */
export type PluginIdentityDeclaration = typeof PluginIdentityDeclaration.Type;

/** Retained resource authority mapped to exact reviewed invocation argument paths. */
export const PluginResourceBinding = Schema.Struct({
  appliesTo: Schema.Union([
    Schema.Struct({ kind: Schema.Literal("all-tools-with-argument") }),
    Schema.Struct({
      kind: Schema.Literal("tool-list"),
      toolIds: Schema.Array(PluginToolId).pipe(
        Schema.check(Schema.isLengthBetween(1, 2_000)),
        Schema.check(Schema.isUnique()),
      ),
    }),
  ]),
  argumentPath: ProjectionPath,
});

/** Retained resource authority mapped to exact reviewed invocation argument paths. */
export interface PluginResourceBinding extends Schema.Schema.Type<typeof PluginResourceBinding> {}

const PluginResourceProjection = {
  resourcesPath: Schema.optionalKey(ProjectionPath),
  idPath: ProjectionPath,
  displayLabelPath: ProjectionPath,
  selection: Schema.Literals(["exactly-one", "owner-select"]),
  binding: PluginResourceBinding,
  ...ProjectionLimits,
} as const;

/** Optional provider-neutral resource discovery and Owner selection declaration. */
export const PluginResourceDeclaration = Schema.Union([
  Schema.Struct({ kind: Schema.Literal("none") }),
  Schema.Struct({
    kind: Schema.Literal("https-json"),
    endpoint: BoundedHttpsUrl,
    authorization: Schema.Literal("bearer"),
    ...PluginResourceProjection,
  }),
  Schema.Struct({
    kind: Schema.Literal("mcp-tool"),
    operation: PluginBootstrapMcpOperation,
    ...PluginResourceProjection,
  }),
]);

/** Optional provider-neutral resource discovery and Owner selection declaration. */
export type PluginResourceDeclaration = typeof PluginResourceDeclaration.Type;

const OAuthAuthority = {
  providerRegistrationId: ProviderRegistrationId,
  providerDefinitionDigest: PluginSha256,
  requestedScopes: OAuthScopeSet,
} as const;

/** Versioned immutable authentication strategy declaration reviewed with one Plugin version. */
export const PluginAuthStrategyDefinition = Schema.Union([
  Schema.Struct({
    schemaVersion: Schema.Literal(1),
    profile: Schema.Literal("workspace-oauth"),
    ...OAuthAuthority,
    identity: PluginIdentityDeclaration,
    resources: PluginResourceDeclaration,
  }),
  Schema.Struct({
    schemaVersion: Schema.Literal(1),
    profile: Schema.Literal("mcp-oauth"),
    ...OAuthAuthority,
    clientRegistration: Schema.Union([
      Schema.Struct({ kind: Schema.Literal("pre-registered") }),
      Schema.Struct({
        kind: Schema.Literal("cimd"),
        clientIdMetadataDocumentUrl: BoundedHttpsUrl,
      }),
      Schema.Struct({
        kind: Schema.Literal("dynamic"),
        authorizationServerMetadataUrl: BoundedHttpsUrl,
      }),
    ]),
    resourceMetadataUrl: Schema.optionalKey(BoundedHttpsUrl),
    identity: PluginIdentityDeclaration,
    resources: PluginResourceDeclaration,
  }),
  Schema.Struct({
    schemaVersion: Schema.Literal(1),
    profile: Schema.Literal("api-key"),
    providerRegistrationId: ProviderRegistrationId,
    fields: Schema.Array(PluginCredentialField).pipe(
      Schema.check(Schema.isLengthBetween(1, 8)),
      Schema.check(Schema.isUnique({ projection: (field: PluginCredentialField) => field.key })),
    ),
    delivery: Schema.Array(PluginApiCredentialDelivery).pipe(
      Schema.check(Schema.isLengthBetween(1, 8)),
    ),
    verification: Schema.optionalKey(
      Schema.Struct({
        kind: Schema.Literal("https-json"),
        endpoint: BoundedHttpsUrl,
        expectedStatus: Schema.Int.pipe(
          Schema.check(Schema.isBetween({ minimum: 200, maximum: 299 })),
        ),
        ...ProjectionLimits,
      }),
    ),
    identity: PluginIdentityDeclaration,
    resources: PluginResourceDeclaration,
  }),
  Schema.Struct({
    schemaVersion: Schema.Literal(1),
    profile: Schema.Literal("device-oauth"),
    ...OAuthAuthority,
    client: Schema.Union([
      Schema.Struct({ kind: Schema.Literal("platform-pre-registered") }),
      Schema.Struct({ kind: Schema.Literal("workspace-oauth-app") }),
    ]),
    deviceAuthorizationEndpoint: BoundedHttpsUrl,
    tokenEndpoint: BoundedHttpsUrl,
    tokenEndpointAuthMethod: OAuthTokenEndpointAuthMethod,
    tokens: Schema.Struct({
      accessTokenType: Schema.Literal("bearer"),
      expiresIn: Schema.Literals(["required", "optional"]),
      ["refreshToken"]: Schema.Literals(["required", "optional"]),
      grantedScopes: Schema.Literals(["exact-match", "requested-scopes-if-omitted"]),
    }),
    polling: Schema.Struct({
      defaultIntervalSeconds: Schema.Int.pipe(
        Schema.check(Schema.isBetween({ minimum: 1, maximum: 60 })),
      ),
      slowDownIncrementSeconds: Schema.Int.pipe(
        Schema.check(Schema.isBetween({ minimum: 1, maximum: 60 })),
      ),
      maximumDurationSeconds: Schema.Int.pipe(
        Schema.check(Schema.isBetween({ minimum: 60, maximum: 1_800 })),
      ),
    }),
    identity: PluginIdentityDeclaration,
    resources: PluginResourceDeclaration,
  }),
]);

/** Versioned immutable authentication strategy declaration reviewed with one Plugin version. */
export type PluginAuthStrategyDefinition = typeof PluginAuthStrategyDefinition.Type;

/** Public non-secret action returned by the generic Connection setup lifecycle. */
export const PluginSetupAction = Schema.Union([
  Schema.Struct({
    _tag: Schema.Literal("NeedsCredentials"),
    fields: Schema.Array(PluginCredentialField),
  }),
  Schema.Struct({
    _tag: Schema.Literal("NeedsOAuthApp"),
    providerRegistrationId: ProviderRegistrationId,
  }),
  Schema.Struct({
    _tag: Schema.Literal("RedirectToProvider"),
    authorizationUrl: BoundedHttpsUrl,
    expiresAt: Schema.Int,
    flowId: PluginSha256,
  }),
  Schema.Struct({
    _tag: Schema.Literal("DisplayDeviceCode"),
    verificationUri: BoundedHttpsUrl,
    verificationUriComplete: Schema.optionalKey(BoundedHttpsUrl),
    userCode: Schema.String.pipe(Schema.check(Schema.isLengthBetween(1, 128))),
    expiresAt: Schema.Int,
    pollAfter: Schema.Int,
  }),
  Schema.Struct({
    _tag: Schema.Literal("NeedsResourceSelection"),
    resources: Schema.Array(
      Schema.Struct({
        id: Schema.String.pipe(Schema.check(Schema.isLengthBetween(1, 300))),
        displayLabel: Schema.Trimmed.pipe(Schema.check(Schema.isLengthBetween(1, 160))),
      }),
    ).pipe(Schema.check(Schema.isLengthBetween(2, 100))),
  }),
  Schema.Struct({ _tag: Schema.Literal("ReadyForIdentityResolution") }),
  Schema.Struct({ _tag: Schema.Literal("Connected") }),
  Schema.Struct({
    _tag: Schema.Literal("SetupEnded"),
    reason: Schema.Literals(["cancelled", "denied", "expired", "failed"]),
  }),
]);

/** Public non-secret action returned by the generic Connection setup lifecycle. */
export type PluginSetupAction = typeof PluginSetupAction.Type;

/** Durable setup attempt identity paired with its current public non-secret action. */
export const PluginSetupProgress = Schema.Struct({
  setupAttemptId: PluginAuthSetupAttemptId,
  action: PluginSetupAction,
});

/** Durable setup attempt identity paired with its current public non-secret action. */
export interface PluginSetupProgress extends Schema.Schema.Type<typeof PluginSetupProgress> {}

/** Submitted Owner setup input; secret field values are redacted immediately at the API boundary. */
export const PluginSetupSubmission = Schema.Union([
  Schema.Struct({
    _tag: Schema.Literal("CredentialsSubmitted"),
    values: Schema.Record(Schema.String, Schema.String),
    replacementConnectionId: Schema.optionalKey(PluginConnectionId),
    expectedConnectionRevision: Schema.optionalKey(
      Schema.Int.pipe(Schema.check(Schema.isGreaterThanOrEqualTo(1))),
    ),
  }),
  Schema.Struct({
    _tag: Schema.Literal("OAuthAppSelected"),
    oauthAppId: PluginOAuthAppId,
  }),
  Schema.Struct({
    _tag: Schema.Literal("OAuthCallbackReceived"),
    code: Schema.String.pipe(Schema.check(Schema.isLengthBetween(1, 8_192))),
    state: Schema.String.pipe(Schema.check(Schema.isLengthBetween(1, 8_192))),
    authorizationResponseIssuer: Schema.optionalKey(
      Schema.String.pipe(Schema.check(Schema.isLengthBetween(1, 2_048))),
    ),
  }),
  Schema.Struct({
    _tag: Schema.Literal("ResourceSelected"),
    resourceId: Schema.String.pipe(Schema.check(Schema.isLengthBetween(1, 300))),
  }),
  Schema.Struct({ _tag: Schema.Literal("DevicePollingCancelled") }),
]);

/** Submitted Owner setup input; secret field values are redacted immediately at the API boundary. */
export type PluginSetupSubmission = typeof PluginSetupSubmission.Type;
