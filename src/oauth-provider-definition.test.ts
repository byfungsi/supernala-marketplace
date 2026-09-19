import { describe, expect, it } from "vitest";
import { Result, Schema } from "effect";
import {
  decodePluginOAuthProviderDefinition,
  digestPluginOAuthProviderDefinition,
  encodePluginOAuthProviderDefinitionCanonicalJson,
  OAuthAccountProjection,
  OAuthAuthorizationParameter,
  OAuthRefreshPolicy,
  OAuthRevocationPolicy,
  OAuthTokenPolicy,
  PackagedOAuthAuthentication,
} from "./oauth-provider-definition.js";

const auroraDefinition = {
  schemaVersion: 1,
  protocol: "oauth2-authorization-code",
  issuer: "https://identity.aurora.example",
  provider: "aurora-mail",
  resourceIdentity: "mail-api.aurora.example",
  authorizationEndpoint: "https://identity.aurora.example/oauth/authorize",
  tokenEndpoint: "https://identity.aurora.example/oauth/token",
  tokenEndpointAuthMethod: "client_secret_post",
  authorizationResponseIssuer: "required",
  pkce: { method: "S256" },
  authorizationParameters: [
    { name: "audience", value: "mail-api" },
    { name: "prompt", value: "consent" },
  ],
  scopes: ["mailbox.metadata", "mailbox.read"],
  account: {
    kind: "https-json",
    endpoint: "https://mail-api.aurora.example/v1/account",
    authorization: "bearer",
    subjectPath: ["account", "mailboxId"],
    displayLabelPath: ["account", "displayName"],
    subjectStability: "stable",
    maximumResponseBytes: 65_536,
    maximumJsonDepth: 8,
    maximumObjectKeys: 256,
    maximumSubjectLength: 200,
    maximumDisplayLabelLength: 120,
  },
  tokens: {
    accessTokenType: "bearer",
    expiresIn: { required: true, minimumSeconds: 60, maximumSeconds: 7_200 },
    grantedScopes: { whenPresent: "exact-match", whenOmitted: "requested-scopes" },
    initialRefreshToken: "required",
    refreshResponseToken: "retain-current-if-omitted",
  },
  refresh: {
    kind: "standard-form-post",
    invalidGrant: "reauthorization-required",
    ambiguousOutcome: "fail-closed-no-replay",
  },
  revocation: {
    kind: "standard-form-post",
    endpoint: "https://identity.aurora.example/oauth/revoke",
    token: "refresh-token",
    clientAuthentication: "registration-method",
    outcome: "best-effort-observed",
  },
} as const;

const harborDefinition = {
  schemaVersion: 1,
  protocol: "oauth2-authorization-code",
  issuer: "https://login.harbor.example",
  provider: "harbor-records",
  resourceIdentity: "records.harbor.example",
  authorizationEndpoint: "https://login.harbor.example/authorize",
  tokenEndpoint: "https://login.harbor.example/token",
  tokenEndpointAuthMethod: "client_secret_basic",
  authorizationResponseIssuer: "not-supported",
  pkce: { method: "S256" },
  authorizationParameters: [{ name: "tenant", value: "primary" }],
  scopes: ["records.read"],
  account: {
    kind: "https-json",
    endpoint: "https://records.harbor.example/account/profile",
    authorization: "bearer",
    subjectPath: ["identity", "subject"],
    displayLabelPath: ["profile", "label"],
    subjectStability: "mutable",
    maximumResponseBytes: 32_768,
    maximumJsonDepth: 6,
    maximumObjectKeys: 128,
    maximumSubjectLength: 180,
    maximumDisplayLabelLength: 100,
  },
  tokens: {
    accessTokenType: "bearer",
    expiresIn: { required: true, minimumSeconds: 30, maximumSeconds: 3_600 },
    grantedScopes: { whenPresent: "exact-match", whenOmitted: "requested-scopes" },
    initialRefreshToken: "required",
    refreshResponseToken: "retain-current-if-omitted",
  },
  refresh: {
    kind: "standard-form-post",
    invalidGrant: "reauthorization-required",
    ambiguousOutcome: "fail-closed-no-replay",
  },
  revocation: { kind: "none" },
} as const;

const cinderDefinition = {
  schemaVersion: 1,
  protocol: "oauth2-authorization-code",
  issuer: "https://auth.cinder.example",
  provider: "cinder-documents",
  resourceIdentity: "documents.cinder.example",
  authorizationEndpoint: "https://auth.cinder.example/oauth/authorize",
  tokenEndpoint: "https://auth.cinder.example/oauth/token",
  tokenEndpointAuthMethod: "client_secret_basic",
  authorizationResponseIssuer: "required",
  pkce: { method: "S256" },
  authorizationParameters: [
    { name: "audience", value: "cinder-documents" },
    { name: "prompt", value: "select_account" },
  ],
  scopes: ["documents.read"],
  account: {
    kind: "https-json",
    endpoint: "https://documents.cinder.example/v2/principal",
    authorization: "bearer",
    subjectPath: ["principal", "recordId"],
    displayLabelPath: ["principal", "name"],
    subjectStability: "stable",
    maximumResponseBytes: 49_152,
    maximumJsonDepth: 7,
    maximumObjectKeys: 192,
    maximumSubjectLength: 220,
    maximumDisplayLabelLength: 110,
  },
  tokens: {
    accessTokenType: "bearer",
    expiresIn: { required: true, minimumSeconds: 45, maximumSeconds: 5_400 },
    grantedScopes: { whenPresent: "exact-match", whenOmitted: "requested-scopes" },
    initialRefreshToken: "required",
    refreshResponseToken: "retain-current-if-omitted",
  },
  refresh: {
    kind: "standard-form-post",
    invalidGrant: "reauthorization-required",
    ambiguousOutcome: "fail-closed-no-replay",
  },
  revocation: {
    kind: "standard-form-post",
    endpoint: "https://auth.cinder.example/oauth/revoke",
    token: "access-token",
    clientAuthentication: "token-only",
    outcome: "best-effort-observed",
  },
} as const;

const auroraCanonicalJson = [
  '{"account":{"authorization":"bearer","displayLabelPath":["account","displayName"],"endpoint":"https://mail-api.aurora.example/v1/account","kind":"https-json","maximumDisplayLabelLength":120,"maximumJsonDepth":8,"maximumObjectKeys":256,"maximumResponseBytes":65536,"maximumSubjectLength":200,"subjectPath":["account","mailboxId"],"subjectStability":"stable"},',
  '"authorizationEndpoint":"https://identity.aurora.example/oauth/authorize","authorizationParameters":[{"name":"audience","value":"mail-api"},{"name":"prompt","value":"consent"}],"authorizationResponseIssuer":"required","issuer":"https://identity.aurora.example","pkce":{"method":"S256"},"protocol":"oauth2-authorization-code","provider":"aurora-mail",',
  '"refresh":{"ambiguousOutcome":"fail-closed-no-replay","invalidGrant":"reauthorization-required","kind":"standard-form-post"},"resourceIdentity":"mail-api.aurora.example","revocation":{"clientAuthentication":"registration-method","endpoint":"https://identity.aurora.example/oauth/revoke","kind":"standard-form-post","outcome":"best-effort-observed","token":"refresh-token"},',
  '"schemaVersion":1,"scopes":["mailbox.metadata","mailbox.read"],"tokenEndpoint":"https://identity.aurora.example/oauth/token","tokenEndpointAuthMethod":"client_secret_post","tokens":{"accessTokenType":"bearer","expiresIn":{"maximumSeconds":7200,"minimumSeconds":60,"required":true},"grantedScopes":{"whenOmitted":"requested-scopes","whenPresent":"exact-match"},"initialRefreshToken":"required","refreshResponseToken":"retain-current-if-omitted"}}',
].join("");

const harborCanonicalJson = [
  '{"account":{"authorization":"bearer","displayLabelPath":["profile","label"],"endpoint":"https://records.harbor.example/account/profile","kind":"https-json","maximumDisplayLabelLength":100,"maximumJsonDepth":6,"maximumObjectKeys":128,"maximumResponseBytes":32768,"maximumSubjectLength":180,"subjectPath":["identity","subject"],"subjectStability":"mutable"},',
  '"authorizationEndpoint":"https://login.harbor.example/authorize","authorizationParameters":[{"name":"tenant","value":"primary"}],"authorizationResponseIssuer":"not-supported","issuer":"https://login.harbor.example","pkce":{"method":"S256"},"protocol":"oauth2-authorization-code","provider":"harbor-records",',
  '"refresh":{"ambiguousOutcome":"fail-closed-no-replay","invalidGrant":"reauthorization-required","kind":"standard-form-post"},"resourceIdentity":"records.harbor.example","revocation":{"kind":"none"},"schemaVersion":1,"scopes":["records.read"],"tokenEndpoint":"https://login.harbor.example/token","tokenEndpointAuthMethod":"client_secret_basic",',
  '"tokens":{"accessTokenType":"bearer","expiresIn":{"maximumSeconds":3600,"minimumSeconds":30,"required":true},"grantedScopes":{"whenOmitted":"requested-scopes","whenPresent":"exact-match"},"initialRefreshToken":"required","refreshResponseToken":"retain-current-if-omitted"}}',
].join("");

const cinderCanonicalJson = [
  '{"account":{"authorization":"bearer","displayLabelPath":["principal","name"],"endpoint":"https://documents.cinder.example/v2/principal","kind":"https-json","maximumDisplayLabelLength":110,"maximumJsonDepth":7,"maximumObjectKeys":192,"maximumResponseBytes":49152,"maximumSubjectLength":220,"subjectPath":["principal","recordId"],"subjectStability":"stable"},',
  '"authorizationEndpoint":"https://auth.cinder.example/oauth/authorize","authorizationParameters":[{"name":"audience","value":"cinder-documents"},{"name":"prompt","value":"select_account"}],"authorizationResponseIssuer":"required","issuer":"https://auth.cinder.example","pkce":{"method":"S256"},"protocol":"oauth2-authorization-code","provider":"cinder-documents",',
  '"refresh":{"ambiguousOutcome":"fail-closed-no-replay","invalidGrant":"reauthorization-required","kind":"standard-form-post"},"resourceIdentity":"documents.cinder.example","revocation":{"clientAuthentication":"token-only","endpoint":"https://auth.cinder.example/oauth/revoke","kind":"standard-form-post","outcome":"best-effort-observed","token":"access-token"},',
  '"schemaVersion":1,"scopes":["documents.read"],"tokenEndpoint":"https://auth.cinder.example/oauth/token","tokenEndpointAuthMethod":"client_secret_basic","tokens":{"accessTokenType":"bearer","expiresIn":{"maximumSeconds":5400,"minimumSeconds":45,"required":true},"grantedScopes":{"whenOmitted":"requested-scopes","whenPresent":"exact-match"},"initialRefreshToken":"required","refreshResponseToken":"retain-current-if-omitted"}}',
].join("");

const cinderCanonicalDigest = "f29262e2ee1b175b6d7bd2242ab404a7f009f08ef4b2fe1a45069eca3b0f8677";

const cinderRegistrationMethodDigest =
  "0e987b99bcca1a4d7ad87161cc17628c06bbc90697f96cbb9d08d2b2444af16b";

const reservedStaticAuthorizationParameterNames = [
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
] as const;

const decodeDefinition = (input: Schema.Json) => {
  const decoded = decodePluginOAuthProviderDefinition(input);
  if (Result.isFailure(decoded)) throw decoded.failure;

  return decoded.success;
};

describe("Plugin OAuth provider definition", () => {
  it("produces stable canonical bytes and digests for two unrelated synthetic providers", async () => {
    const aurora = decodeDefinition(auroraDefinition);
    const harbor = decodeDefinition(harborDefinition);

    expect(new TextDecoder().decode(encodePluginOAuthProviderDefinitionCanonicalJson(aurora))).toBe(
      auroraCanonicalJson,
    );
    expect(new TextDecoder().decode(encodePluginOAuthProviderDefinitionCanonicalJson(harbor))).toBe(
      harborCanonicalJson,
    );
    expect(await digestPluginOAuthProviderDefinition(aurora)).toBe(
      "17859823e252d9118dd8d116240a662926341bd97b9fc9ba32877dc1fc053d9d",
    );
    expect(await digestPluginOAuthProviderDefinition(harbor)).toBe(
      "3fce3eccb13a88910211022e3578109a18abcfdeeac37083e0c5844c666f2d96",
    );
  });

  it("pins token-only revocation for an unrelated confidential-client provider", async () => {
    const cinder = decodeDefinition(cinderDefinition);
    const cinderCanonicalBytes = encodePluginOAuthProviderDefinitionCanonicalJson(cinder);

    expect(new TextDecoder().decode(cinderCanonicalBytes)).toBe(cinderCanonicalJson);
    expect(cinderCanonicalBytes.byteLength).toBe(1_504);
    expect(await digestPluginOAuthProviderDefinition(cinder)).toBe(cinderCanonicalDigest);

    const registrationMethod = decodeDefinition({
      ...cinderDefinition,
      revocation: {
        ...cinderDefinition.revocation,
        clientAuthentication: "registration-method",
      },
    });

    await expect(digestPluginOAuthProviderDefinition(registrationMethod)).resolves.toBe(
      cinderRegistrationMethodDigest,
    );
    expect(cinderRegistrationMethodDigest).not.toBe(cinderCanonicalDigest);
  });

  it.each([
    {
      label: "unsupported method",
      fields: { clientAuthentication: "provider-default" },
    },
    { label: "missing method", fields: {} },
  ])("rejects $label for revocation client authentication", ({ fields }) => {
    expect(
      Result.isFailure(
        decodePluginOAuthProviderDefinition({
          ...cinderDefinition,
          revocation: {
            kind: "standard-form-post",
            endpoint: cinderDefinition.revocation.endpoint,
            token: "access-token",
            ...fields,
            outcome: "best-effort-observed",
          },
        }),
      ),
    ).toBe(true);
  });

  it.each([
    ["credential", { clientSecret: "test" }],
    ["authorization header", { authorizationHeader: "Synthetic scheme" }],
    ["extra parameter", { parameters: [{ name: "token_type_hint", value: "access_token" }] }],
  ] as const)("rejects nested token-only %s transport authority", (_label, excess) => {
    expect(
      Result.isFailure(
        decodePluginOAuthProviderDefinition({
          ...cinderDefinition,
          revocation: { ...cinderDefinition.revocation, ...excess },
        }),
      ),
    ).toBe(true);
  });

  it("rejects nested excess properties and unsupported protocol capabilities", () => {
    const excess = {
      ...auroraDefinition,
      account: { ...auroraDefinition.account, executableProjection: "$.account.id" },
    };

    const unsupported = { ...auroraDefinition, protocol: "oauth2-device-code" };

    expect(Result.isFailure(decodePluginOAuthProviderDefinition(excess))).toBe(true);
    expect(Result.isFailure(decodePluginOAuthProviderDefinition(unsupported))).toBe(true);
  });

  it("rejects excess properties when nested component schemas are decoded directly", () => {
    expect(
      Result.isFailure(
        Schema.decodeUnknownResult(OAuthAuthorizationParameter, {
          onExcessProperty: "error",
        })({
          name: "prompt",
          value: "consent",
          executable: true,
        }),
      ),
    ).toBe(true);
    expect(
      Result.isFailure(
        Schema.decodeUnknownResult(OAuthAccountProjection, { onExcessProperty: "error" })({
          ...auroraDefinition.account,
          executable: true,
        }),
      ),
    ).toBe(true);
    expect(
      Result.isFailure(
        Schema.decodeUnknownResult(OAuthTokenPolicy, { onExcessProperty: "error" })({
          ...auroraDefinition.tokens,
          executable: true,
        }),
      ),
    ).toBe(true);
    expect(
      Result.isFailure(
        Schema.decodeUnknownResult(OAuthRefreshPolicy, { onExcessProperty: "error" })({
          ...auroraDefinition.refresh,
          executable: true,
        }),
      ),
    ).toBe(true);
    expect(
      Result.isFailure(
        Schema.decodeUnknownResult(OAuthRevocationPolicy, { onExcessProperty: "error" })({
          ...auroraDefinition.revocation,
          executable: true,
        }),
      ),
    ).toBe(true);
  });

  it("rejects unsafe endpoints, paths, parameters, and noncanonical scope authority", () => {
    const cases = [
      { ...auroraDefinition, tokenEndpoint: "http://identity.aurora.example/token" },
      {
        ...auroraDefinition,
        account: { ...auroraDefinition.account, subjectPath: ["__proto__"] },
      },
      {
        ...auroraDefinition,
        authorizationParameters: [{ name: "state", value: "fixed" }],
      },
      {
        ...auroraDefinition,
        authorizationParameters: [
          { name: "prompt", value: "consent" },
          { name: "audience", value: "mail-api" },
        ],
      },
      { ...auroraDefinition, scopes: ["mailbox.read", "mailbox.metadata"] },
      { ...auroraDefinition, scopes: ["mailbox.read", "mailbox.read"] },
      { ...auroraDefinition, scopes: ["mailbox read"] },
    ];

    expect(
      cases.every((value) => Result.isFailure(decodePluginOAuthProviderDefinition(value))),
    ).toBe(true);
  });

  it.each(reservedStaticAuthorizationParameterNames)(
    "rejects the reserved static authorization parameter %s",
    (name) => {
      expect(
        Result.isFailure(
          decodePluginOAuthProviderDefinition({
            ...auroraDefinition,
            authorizationParameters: [{ name, value: "synthetic-public-value" }],
          }),
        ),
      ).toBe(true);
    },
  );

  it("retains explicitly reviewed audience and resource as digest-bound public provider data", () => {
    const definition = decodePluginOAuthProviderDefinition({
      ...auroraDefinition,
      authorizationParameters: [
        { name: "audience", value: "mail-api" },
        { name: "prompt", value: "consent" },
        { name: "resource", value: "https://mail-api.aurora.example" },
      ],
    });

    expect(Result.isSuccess(definition)).toBe(true);
  });

  it.each([
    ["tokenEndpoint", "https://identity.aurora.example:443/oauth/token"],
    ["tokenEndpoint", " https://identity.aurora.example/oauth/token"],
    ["tokenEndpoint", "https://identity.aurora.example/oauth/token?"],
    ["tokenEndpoint", "https://identity.aurora.example/oauth/token#"],
    ["tokenEndpoint", "https://identity.aurora.example/one/../oauth/token"],
    ["tokenEndpoint", "https://identity.aurora.example/oauth\\token"],
    ["tokenEndpoint", "https://identity.aurora.example/\toauth/token"],
    ["tokenEndpoint", "https://IDENTITY.aurora.example/oauth/token"],
    ["tokenEndpoint", "https://identity.aurora.example/oauth/%74oken"],
    ["tokenEndpoint", "https://identity.aurora.example/oauth/%2ftoken"],
    ["tokenEndpoint", "https://identity.aurora.example:8443/oauth/token"],
    ["tokenEndpoint", "https://synthetic-user@identity.aurora.example/oauth/token"],
    ["issuer", "https://identity.aurora.example/"],
    ["issuer", "https://identity.aurora.example/oauth"],
    ["issuer", "https://identity.aurora.example?"],
  ] as const)("rejects non-exact %s spelling %s", (field, value) => {
    expect(
      Result.isFailure(
        decodePluginOAuthProviderDefinition({ ...auroraDefinition, [field]: value }),
      ),
    ).toBe(true);
  });

  it("requires definition digest authority in every new packaged OAuth declaration", () => {
    const fourFieldOAuth = {
      kind: "oauth",
      providerRegistration: "synthetic-aurora-v1",
      requestedScopes: ["mailbox.read"],
      credentialDelivery: "short-lived-access-token-only",
    };

    const exactOAuth = {
      ...fourFieldOAuth,
      providerDefinitionDigest: "a".repeat(64),
    };

    expect(
      Result.isFailure(
        Schema.decodeUnknownResult(PackagedOAuthAuthentication, {
          onExcessProperty: "error",
        })(fourFieldOAuth),
      ),
    ).toBe(true);
    expect(
      Result.isSuccess(
        Schema.decodeUnknownResult(PackagedOAuthAuthentication, {
          onExcessProperty: "error",
        })(exactOAuth),
      ),
    ).toBe(true);
  });

  it("changes digest when endpoint or account projection authority changes", async () => {
    const original = decodeDefinition(auroraDefinition);

    const endpointChanged = decodeDefinition({
      ...auroraDefinition,
      tokenEndpoint: "https://identity.aurora.example/oauth/token-v2",
    });

    const projectionChanged = decodeDefinition({
      ...auroraDefinition,
      account: { ...auroraDefinition.account, subjectPath: ["account", "alternateId"] },
    });

    await expect(digestPluginOAuthProviderDefinition(endpointChanged)).resolves.not.toBe(
      await digestPluginOAuthProviderDefinition(original),
    );
    await expect(digestPluginOAuthProviderDefinition(projectionChanged)).resolves.not.toBe(
      await digestPluginOAuthProviderDefinition(original),
    );
  });

  it("constructs the complete schema without provider-name branching", () => {
    expect(decodeDefinition(auroraDefinition).provider).toBe("aurora-mail");
    expect(decodeDefinition(harborDefinition).provider).toBe("harbor-records");
  });
});
