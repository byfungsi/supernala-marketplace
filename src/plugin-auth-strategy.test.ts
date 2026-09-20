import { describe, expect, it } from "vitest";
import { Schema } from "effect";
import { PluginAuthStrategyDefinition } from "./plugin-auth-strategy.js";

const digest = "f".repeat(64);
const identity = { kind: "opaque-connection", displayLabel: "Fixture account" } as const;
const resources = { kind: "none" } as const;

const fixtures = [
  ...["acme-mail", "orbit-calendar"].map((providerRegistrationId) => ({
    schemaVersion: 1,
    profile: "workspace-oauth",
    providerRegistrationId,
    providerDefinitionDigest: digest,
    requestedScopes: ["messages.read"],
    identity,
    resources,
  })),
  ...["acme-mcp", "orbit-mcp"].map((providerRegistrationId) => ({
    schemaVersion: 1,
    profile: "mcp-oauth",
    providerRegistrationId,
    providerDefinitionDigest: digest,
    requestedScopes: ["tools.call"],
    clientRegistration: { kind: "pre-registered" },
    identity,
    resources,
  })),
  ...["acme-api", "orbit-api"].map((providerRegistrationId) => ({
    schemaVersion: 1,
    profile: "api-key",
    providerRegistrationId,
    fields: [
      { key: "token", label: "API token", secret: true, minimumLength: 1, maximumLength: 200 },
    ],
    delivery: [{ kind: "header", field: "token", headerName: "authorization", encoding: "bearer" }],
    identity,
    resources,
  })),
  ...["acme-device", "orbit-device"].map((providerRegistrationId) => ({
    schemaVersion: 1,
    profile: "device-oauth",
    providerRegistrationId,
    providerDefinitionDigest: digest,
    requestedScopes: ["repo.read"],
    client: { kind: "platform-pre-registered" },
    deviceAuthorizationEndpoint: `https://${providerRegistrationId}.example/device`,
    tokenEndpoint: `https://${providerRegistrationId}.example/token`,
    tokenEndpointAuthMethod: "none",
    tokens: {
      accessTokenType: "bearer",
      expiresIn: "optional",
      refreshToken: "optional",
      grantedScopes: "requested-scopes-if-omitted",
    },
    polling: {
      defaultIntervalSeconds: 5,
      slowDownIncrementSeconds: 5,
      maximumDurationSeconds: 900,
    },
    identity,
    resources,
  })),
];

describe("PluginAuthStrategyDefinition", () => {
  it("accepts two unrelated providers for each frozen profile", () => {
    const decoded = fixtures.map((fixture) =>
      Schema.decodeUnknownSync(PluginAuthStrategyDefinition, { onExcessProperty: "error" })(
        fixture,
      ),
    );

    expect(decoded.map((definition) => definition.profile)).toEqual([
      "workspace-oauth",
      "workspace-oauth",
      "mcp-oauth",
      "mcp-oauth",
      "api-key",
      "api-key",
      "device-oauth",
      "device-oauth",
    ]);
    expect(new Set(decoded.map((definition) => definition.providerRegistrationId)).size).toBe(8);
  });

  it("rejects provider-controlled transport header overrides", () => {
    const unsafe = {
      schemaVersion: 1,
      profile: "api-key",
      providerRegistrationId: "unsafe-api",
      fields: [
        { key: "token", label: "API token", secret: true, minimumLength: 1, maximumLength: 200 },
      ],
      delivery: [{ kind: "header", field: "token", headerName: "host", encoding: "raw" }],
      identity,
      resources,
    };
    expect(() =>
      Schema.decodeUnknownSync(PluginAuthStrategyDefinition, { onExcessProperty: "error" })(unsafe),
    ).toThrow();
  });
});
