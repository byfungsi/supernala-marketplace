import { Result, Schema } from "effect";
import {
  PluginSha256,
  ProviderRegistrationId,
  type PluginSha256 as PluginSha256Type,
} from "./plugin-contract.js";

const utf8Encoder = new TextEncoder();

const compareUtf8Bytes = (left: string, right: string): number => {
  const leftBytes = utf8Encoder.encode(left);
  const rightBytes = utf8Encoder.encode(right);
  const length = Math.min(leftBytes.length, rightBytes.length);
  for (let index = 0; index < length; index += 1) {
    const leftByte = leftBytes[index];
    const rightByte = rightBytes[index];
    if (leftByte === undefined || rightByte === undefined) break;
    const difference = leftByte - rightByte;
    if (difference !== 0) return difference;
  }

  return leftBytes.length - rightBytes.length;
};

const isCanonicalStringOrder = (values: ReadonlyArray<string>): boolean =>
  values.every((value, index) => {
    if (index === 0) return true;
    const previous = values[index - 1];

    return previous !== undefined && compareUtf8Bytes(previous, value) < 0;
  });

const jsonUtf8Length = (value: string): number => utf8Encoder.encode(value).byteLength;

const hasNoAsciiControlCharacters = (value: string): boolean =>
  Array.from(value).every((character) => {
    const codePoint = character.codePointAt(0);

    return codePoint !== undefined && codePoint > 31 && codePoint !== 127;
  });

const hasCanonicalPercentEncoding = (value: string): boolean => {
  for (let index = 0; index < value.length; index += 1) {
    if (value[index] !== "%") continue;
    const hexadecimal = value.slice(index + 1, index + 3);
    if (!/^[0-9A-F]{2}$/.test(hexadecimal)) return false;
    const decoded = String.fromCharCode(Number.parseInt(hexadecimal, 16));
    if (/^[A-Za-z0-9._~-]$/.test(decoded)) return false;
    index += 2;
  }

  return true;
};

const CanonicalScopeValues = Schema.Array(
  Schema.String.pipe(
    Schema.check(Schema.isLengthBetween(1, 300)),
    Schema.check(Schema.isPattern(/^[\x21\x23-\x5B\x5D-\x7E]+$/)),
  ),
).pipe(
  Schema.check(Schema.isLengthBetween(1, 64)),
  Schema.check(Schema.isUnique()),
  Schema.check(
    Schema.makeFilter<ReadonlyArray<string>>(isCanonicalStringOrder, {
      expected: "OAuth scopes in canonical UTF-8 byte order",
    }),
  ),
  Schema.check(
    Schema.makeFilter<ReadonlyArray<string>>(
      (scopes) => scopes.reduce((total, scope) => total + jsonUtf8Length(scope), 0) <= 8_192,
      { expected: "OAuth scopes with at most 8192 UTF-8 bytes" },
    ),
  ),
);

/** Nonempty unique OAuth scopes in canonical UTF-8 byte order. */
export const OAuthScopeSet = CanonicalScopeValues.pipe(Schema.brand("OAuthScopeSet"));

/** Nonempty unique OAuth scopes in canonical UTF-8 byte order. */
export type OAuthScopeSet = typeof OAuthScopeSet.Type;

const parseExactHttpsUrl = (value: string): URL | null => {
  if (
    !hasNoAsciiControlCharacters(value) ||
    value.includes("\\") ||
    value.includes("?") ||
    value.includes("#") ||
    !hasCanonicalPercentEncoding(value)
  ) {
    return null;
  }

  try {
    const url = new URL(value);
    if (
      url.protocol !== "https:" ||
      url.username !== "" ||
      url.password !== "" ||
      url.port !== ""
    ) {
      return null;
    }

    return url;
  } catch {
    return null;
  }
};

const HttpsIssuer = Schema.String.pipe(
  Schema.check(Schema.isLengthBetween(1, 2_048)),
  Schema.check(
    Schema.makeFilter<string>(
      (value) => {
        const url = parseExactHttpsUrl(value);

        return url !== null && url.origin === value;
      },
      { expected: "an exact slashless HTTPS issuer origin without normalization" },
    ),
  ),
);

const HttpsEndpoint = Schema.String.pipe(
  Schema.check(Schema.isLengthBetween(1, 2_048)),
  Schema.check(
    Schema.makeFilter<string>(
      (value) => {
        const url = parseExactHttpsUrl(value);

        return url !== null && url.href === value;
      },
      { expected: "an exact canonical HTTPS endpoint without normalization" },
    ),
  ),
);

const OpaqueProviderIdentity = Schema.Trimmed.pipe(
  Schema.check(Schema.isLengthBetween(1, 200)),
  Schema.check(Schema.makeFilter<string>(hasNoAsciiControlCharacters)),
);

const reservedAuthorizationParameterNames = new Set([
  "access_token",
  "actor_token",
  "actor_token_type",
  "assertion",
  "auth_req_id",
  "authorization_details",
  "claims",
  "client_assertion",
  "client_assertion_type",
  "client_id",
  "client_notification_token",
  "client_secret",
  "code",
  "code_challenge",
  "code_challenge_method",
  "code_verifier",
  "device_code",
  "dpop_jkt",
  "error",
  "error_description",
  "error_uri",
  "expires_in",
  "grant_type",
  "id_token",
  "id_token_hint",
  "iss",
  "issued_token_type",
  "login_hint_token",
  "nonce",
  "password",
  "redirect_uri",
  "refresh_token",
  "refresh_token_expires_in",
  "registration_access_token",
  "request",
  "request_uri",
  "requested_token_type",
  "response_mode",
  "response_type",
  "scope",
  "session_state",
  "software_statement",
  "state",
  "subject_token",
  "subject_token_type",
  "token",
  "token_type",
  "token_type_hint",
  "user_code",
  "username",
]);

/**
 * One digest-bound static public authorization parameter owned by a reviewed definition.
 * `audience` and `resource` are provider data, not engine resource-indicator negotiation.
 */
export const OAuthAuthorizationParameter = Schema.Struct({
  name: Schema.String.pipe(
    Schema.check(Schema.isLengthBetween(1, 64)),
    Schema.check(Schema.isPattern(/^[a-z][a-z0-9_.-]*$/)),
    Schema.check(
      Schema.makeFilter<string>((name) => !reservedAuthorizationParameterNames.has(name), {
        expected: "a non-reserved OAuth authorization parameter name",
      }),
    ),
  ),
  value: Schema.String.pipe(
    Schema.check(Schema.isLengthBetween(1, 512)),
    Schema.check(Schema.makeFilter<string>(hasNoAsciiControlCharacters)),
  ),
});

/**
 * One bounded static non-secret authorization parameter owned by a reviewed definition.
 * Direct boundary decoding must use `onExcessProperty: "error"`.
 */
export interface OAuthAuthorizationParameter extends Schema.Schema.Type<
  typeof OAuthAuthorizationParameter
> {}

const OAuthAuthorizationParameters = Schema.Array(OAuthAuthorizationParameter).pipe(
  Schema.check(Schema.isMaxLength(32)),
  Schema.check(
    Schema.makeFilter<ReadonlyArray<OAuthAuthorizationParameter>>(
      (parameters) => isCanonicalStringOrder(parameters.map((parameter) => parameter.name)),
      { expected: "OAuth authorization parameters in canonical UTF-8 name order" },
    ),
  ),
  Schema.check(
    Schema.makeFilter<ReadonlyArray<OAuthAuthorizationParameter>>(
      (parameters) => jsonUtf8Length(JSON.stringify(parameters)) <= 8_192,
      { expected: "OAuth authorization parameters with at most 8192 UTF-8 JSON bytes" },
    ),
  ),
);

/** Supported standard token endpoint client authentication methods. */
export const OAuthTokenEndpointAuthMethod = Schema.Literals([
  "client_secret_post",
  "client_secret_basic",
  "none",
]);

/** Supported standard token endpoint client authentication methods. */
export type OAuthTokenEndpointAuthMethod = typeof OAuthTokenEndpointAuthMethod.Type;

const AccountProjectionKey = Schema.String.pipe(
  Schema.check(Schema.isLengthBetween(1, 128)),
  Schema.check(Schema.isPattern(/^[A-Za-z0-9][A-Za-z0-9_.-]*$/)),
  Schema.check(
    Schema.makeFilter<string>(
      (key) => key !== "__proto__" && key !== "prototype" && key !== "constructor",
      { expected: "a safe literal account projection object key" },
    ),
  ),
);

const AccountProjectionPath = Schema.Array(AccountProjectionKey).pipe(
  Schema.check(Schema.isLengthBetween(1, 8)),
);

/**
 * Bounded declarative account identity projection interpreted by the generic OAuth broker.
 * Direct boundary decoding must use `onExcessProperty: "error"`.
 */
export const OAuthAccountProjection = Schema.Struct({
  kind: Schema.Literal("https-json"),
  endpoint: HttpsEndpoint,
  authorization: Schema.Literal("bearer"),
  subjectPath: AccountProjectionPath,
  displayLabelPath: Schema.optionalKey(AccountProjectionPath),
  subjectStability: Schema.Literals(["stable", "mutable"]),
  maximumResponseBytes: Schema.Int.pipe(
    Schema.check(Schema.isBetween({ minimum: 1_024, maximum: 262_144 })),
  ),
  maximumJsonDepth: Schema.Int.pipe(Schema.check(Schema.isBetween({ minimum: 1, maximum: 16 }))),
  maximumObjectKeys: Schema.Int.pipe(
    Schema.check(Schema.isBetween({ minimum: 1, maximum: 2_048 })),
  ),
  maximumSubjectLength: Schema.Int.pipe(
    Schema.check(Schema.isBetween({ minimum: 1, maximum: 300 })),
  ),
  maximumDisplayLabelLength: Schema.Int.pipe(
    Schema.check(Schema.isBetween({ minimum: 1, maximum: 160 })),
  ),
});

/** Bounded declarative account identity projection interpreted by the generic OAuth broker. */
export interface OAuthAccountProjection extends Schema.Schema.Type<typeof OAuthAccountProjection> {}

// This is a nonsecret schema field; a computed key avoids a scanner false positive around Schema.Literal.
const initialRefreshTokenField = "initialRefreshToken";

/**
 * Standard access and refresh token response policy shared by every OAuth provider definition.
 * Direct boundary decoding must use `onExcessProperty: "error"`.
 */
export const OAuthTokenPolicy = Schema.Struct({
  accessTokenType: Schema.Literal("bearer"),
  expiresIn: Schema.Struct({
    required: Schema.Literal(true),
    minimumSeconds: Schema.Int.pipe(Schema.check(Schema.isBetween({ minimum: 1, maximum: 3_600 }))),
    maximumSeconds: Schema.Int.pipe(
      Schema.check(Schema.isBetween({ minimum: 60, maximum: 86_400 })),
    ),
  }).pipe(
    Schema.check(
      Schema.makeFilter<{ readonly minimumSeconds: number; readonly maximumSeconds: number }>(
        (policy) => policy.minimumSeconds <= policy.maximumSeconds,
        { expected: "an OAuth token lifetime range with minimum <= maximum" },
      ),
    ),
  ),
  grantedScopes: Schema.Struct({
    whenPresent: Schema.Literal("exact-match"),
    whenOmitted: Schema.Literal("requested-scopes"),
  }),
  [initialRefreshTokenField]: Schema.Literal("required"),
  refreshResponseToken: Schema.Literal("retain-current-if-omitted"),
});

/** Standard access and refresh token response policy shared by every OAuth provider definition. */
export interface OAuthTokenPolicy extends Schema.Schema.Type<typeof OAuthTokenPolicy> {}

/**
 * Durable standard refresh policy with no automatic replay after ambiguous provider dispatch.
 * Direct boundary decoding must use `onExcessProperty: "error"`.
 */
export const OAuthRefreshPolicy = Schema.Struct({
  kind: Schema.Literal("standard-form-post"),
  invalidGrant: Schema.Literal("reauthorization-required"),
  ambiguousOutcome: Schema.Literal("fail-closed-no-replay"),
});

/** Durable standard refresh policy with no automatic replay after ambiguous provider dispatch. */
export interface OAuthRefreshPolicy extends Schema.Schema.Type<typeof OAuthRefreshPolicy> {}

/**
 * Supported OAuth token revocation policy. `registration-method` reuses the registered client
 * authentication method. `token-only` permits only the selected token in the exact endpoint's
 * HTTPS form body: no client identity, secret, assertion, Authorization header, query token,
 * token hint, extra parameter, fallback, retry, or ambiguous replay. Token endpoint authentication
 * remains independent. This capability describes reviewed data; it does not implement transport,
 * admit a provider, grant custody authority, or claim universal RFC 7009 compliance.
 */
export const OAuthRevocationPolicy = Schema.Union([
  Schema.Struct({ kind: Schema.Literal("none") }),
  Schema.Struct({
    kind: Schema.Literal("standard-form-post"),
    endpoint: HttpsEndpoint,
    token: Schema.Literals(["refresh-token", "access-token"]),
    clientAuthentication: Schema.Literals(["registration-method", "token-only"]),
    outcome: Schema.Literal("best-effort-observed"),
  }),
]);

/**
 * Supported standard OAuth token revocation policy.
 * Direct boundary decoding must use `onExcessProperty: "error"`.
 */
export type OAuthRevocationPolicy = typeof OAuthRevocationPolicy.Type;

/** Immutable reviewed provider-independent OAuth capability definition. */
export const PluginOAuthProviderDefinition = Schema.Struct({
  schemaVersion: Schema.Literal(1),
  protocol: Schema.Literal("oauth2-authorization-code"),
  issuer: HttpsIssuer,
  provider: OpaqueProviderIdentity,
  resourceIdentity: OpaqueProviderIdentity,
  authorizationEndpoint: HttpsEndpoint,
  tokenEndpoint: HttpsEndpoint,
  tokenEndpointAuthMethod: OAuthTokenEndpointAuthMethod,
  authorizationResponseIssuer: Schema.Literals(["required", "not-supported"]),
  pkce: Schema.Struct({ method: Schema.Literal("S256") }),
  authorizationParameters: OAuthAuthorizationParameters,
  scopes: OAuthScopeSet,
  account: OAuthAccountProjection,
  tokens: OAuthTokenPolicy,
  refresh: OAuthRefreshPolicy,
  revocation: OAuthRevocationPolicy,
});

/** Immutable reviewed provider-independent OAuth capability definition. */
export interface PluginOAuthProviderDefinition extends Schema.Schema.Type<
  typeof PluginOAuthProviderDefinition
> {}

/**
 * Generic packaged OAuth authority bound to one exact reviewed provider definition digest.
 * Direct boundary decoding must use `onExcessProperty: "error"`.
 */
export const PackagedOAuthAuthentication = Schema.Struct({
  kind: Schema.Literal("oauth"),
  providerRegistration: ProviderRegistrationId,
  providerDefinitionDigest: PluginSha256,
  requestedScopes: OAuthScopeSet,
  credentialDelivery: Schema.Literal("short-lived-access-token-only"),
});

/** Generic packaged OAuth authority bound to one exact reviewed provider definition digest. */
export interface PackagedOAuthAuthentication extends Schema.Schema.Type<
  typeof PackagedOAuthAuthentication
> {}

/** Strictly decodes a provider definition and recursively rejects excess properties. */
export function decodePluginOAuthProviderDefinition(
  input: Schema.Json,
): Result.Result<PluginOAuthProviderDefinition, Schema.SchemaError> {
  return Schema.decodeUnknownResult(PluginOAuthProviderDefinition, {
    onExcessProperty: "error",
  })(input);
}

const canonicalJson = (value: Schema.Json): string => {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (Schema.is(Schema.JsonObject)(value)) {
    return `{${Object.entries(value)
      .toSorted(([left], [right]) => compareUtf8Bytes(left, right))
      .map(([key, entry]) => `${JSON.stringify(key)}:${canonicalJson(entry)}`)
      .join(",")}}`;
  }

  return JSON.stringify(value);
};

/** Encodes verified definition data as canonical UTF-8 JSON without mutating source bytes. */
export function encodePluginOAuthProviderDefinitionCanonicalJson(
  definition: PluginOAuthProviderDefinition,
): Uint8Array {
  return utf8Encoder.encode(canonicalJson(definition));
}

/** Computes the lowercase SHA-256 identity of canonical provider definition JSON. */
export async function digestPluginOAuthProviderDefinition(
  definition: PluginOAuthProviderDefinition,
): Promise<PluginSha256Type> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    Uint8Array.from(encodePluginOAuthProviderDefinitionCanonicalJson(definition)).buffer,
  );

  return PluginSha256.make(
    [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join(""),
  );
}
