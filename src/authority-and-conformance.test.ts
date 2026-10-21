import { readFile } from "node:fs/promises";
import { describe, expect, it } from "@effect/vitest";
import { Result, Schema } from "effect";
import {
  derivePluginAuthoritySnapshot,
  diffPluginAuthority,
  PluginAuthoritySnapshot,
} from "./authority-diff.js";
import { validatePluginSource } from "./authoring-validation.js";
import { inspectMcpJsonLines, inspectMcpStreamableHttpBody } from "./mcp-conformance.js";
import { digestPluginOAuthProviderDefinition } from "./oauth-provider-definition.js";
import { canonicalPluginJson, digestPluginBytes } from "./plugin-contract.js";
import { validateManagedRemotePluginRelease } from "./remote-release.js";

describe("authority and protocol gates", () => {
  it("detects no authority expansion for an exact reviewed snapshot", async () => {
    const source = await validatePluginSource("plugins/offline-fixture");
    expect(Result.isSuccess(source)).toBe(true);
    if (Result.isFailure(source)) return;
    const snapshot = derivePluginAuthoritySnapshot(source.success);
    const diff = await diffPluginAuthority(snapshot, snapshot);
    expect(diff.expandsAuthority).toBe(false);
    expect(diff.addedTools).toEqual([]);
    expect(diff.changedTools).toEqual([]);
  });

  it("detects tool/schema/network expansion for exact approval", async () => {
    const source = await validatePluginSource("plugins/offline-fixture");
    expect(Result.isSuccess(source)).toBe(true);
    if (Result.isFailure(source)) return;
    const before = derivePluginAuthoritySnapshot(source.success);
    const after = PluginAuthoritySnapshot.make({
      runtimeKind: before.runtimeKind,
      authenticationKind: before.authenticationKind,
      requestedScopes: before.requestedScopes,
      endpoint: before.endpoint,
      endpointRegistrationId: before.endpointRegistrationId,
      providerRegistrationId: before.providerRegistrationId,
      providerDefinitionDigest: before.providerDefinitionDigest,
      allowedHosts: ["api.example.invalid"],
      tools: [
        ...before.tools,
        {
          id: "synthetic.write",
          classification: "write",
          defaultPolicy: "require-approval",
          inputSchema: { type: "object", properties: {}, additionalProperties: false },
        },
      ],
      config: before.config,
    });
    const diff = await diffPluginAuthority(before, after);
    expect(diff.expandsAuthority).toBe(true);
    expect(diff.addedTools).toEqual(["synthetic.write"]);
    expect(diff.addedHosts).toEqual(["api.example.invalid"]);
    expect(diff.diffDigest).toMatch(/^[a-f0-9]{64}$/u);
  });

  it("treats runtime, provider, OAuth, endpoint and complete Config changes as authority changes", async () => {
    const source = await validatePluginSource("plugins/offline-fixture");
    expect(Result.isSuccess(source)).toBe(true);
    if (Result.isFailure(source)) return;
    const before = derivePluginAuthoritySnapshot(source.success);
    const field = before.config[0] ?? {
      key: "synthetic",
      type: "string",
      scope: "connection",
      required: false,
      atomicGroup: null,
      sensitivity: "non-secret",
      sourcePolicy: "platform-only",
      delivery: "control-plane-only",
      affects: [],
      runtimeName: null,
    };
    const after = PluginAuthoritySnapshot.make({
      runtimeKind: "managed-remote-mcp",
      authenticationKind: "oauth",
      requestedScopes: ["synthetic.read"],
      endpoint: "https://mcp.example.invalid/mcp",
      endpointRegistrationId: "synthetic-endpoint-v1",
      providerRegistrationId: "synthetic-provider-v1",
      providerDefinitionDigest: "a".repeat(64),
      tools: before.tools,
      allowedHosts: before.allowedHosts,
      config: [
        {
          key: field.key,
          type: "url",
          scope: field.scope,
          required: true,
          atomicGroup: "oauth",
          sensitivity: field.sensitivity,
          sourcePolicy: field.sourcePolicy,
          delivery: field.delivery,
          affects: field.affects,
          runtimeName: field.runtimeName,
        },
      ],
    });
    const diff = await diffPluginAuthority(before, after);
    expect(diff.changedRuntimeAuthority).toBe(true);
    expect(diff.changedConfig).toEqual([field.key]);
    expect(diff.expandsAuthority).toBe(true);
  });

  it("treats an OAuth provider-definition digest change as reviewed authority expansion", async () => {
    const source = await validatePluginSource("plugins/offline-fixture");
    expect(Result.isSuccess(source)).toBe(true);
    if (Result.isFailure(source)) return;
    const before = derivePluginAuthoritySnapshot(source.success);
    const after = PluginAuthoritySnapshot.make({
      runtimeKind: before.runtimeKind,
      authenticationKind: "oauth",
      requestedScopes: ["synthetic.mail.read"],
      endpoint: before.endpoint,
      endpointRegistrationId: before.endpointRegistrationId,
      providerRegistrationId: "synthetic-mail-rest-v1",
      providerDefinitionDigest: "a".repeat(64),
      tools: before.tools,
      allowedHosts: before.allowedHosts,
      config: before.config,
    });
    const changedDigest = PluginAuthoritySnapshot.make({
      runtimeKind: after.runtimeKind,
      authenticationKind: after.authenticationKind,
      requestedScopes: after.requestedScopes,
      endpoint: after.endpoint,
      endpointRegistrationId: after.endpointRegistrationId,
      providerRegistrationId: after.providerRegistrationId,
      providerDefinitionDigest: "b".repeat(64),
      tools: after.tools,
      allowedHosts: after.allowedHosts,
      config: after.config,
    });
    expect((await diffPluginAuthority(before, after)).changedRuntimeAuthority).toBe(true);
    expect((await diffPluginAuthority(after, changedDigest)).changedRuntimeAuthority).toBe(true);
  });

  it("requires exact bounded response IDs for both standard transports", async () => {
    const stdio = new Uint8Array(await readFile("fixtures/mcp/stdio.jsonl"));
    expect(inspectMcpJsonLines({ bytes: stdio, expectedIds: [1, 2, "call-1"] })).toMatchObject({
      _tag: "Success",
    });
    expect(inspectMcpJsonLines({ bytes: stdio, expectedIds: [1, 2, "wrong"] })).toEqual(
      Result.fail("mcp-response-id-mismatch"),
    );
    const http = new Uint8Array(await readFile("fixtures/mcp/streamable-http.json"));
    expect(
      inspectMcpStreamableHttpBody({
        contentType: "application/json; charset=utf-8",
        bytes: http,
        expectedId: "http-1",
      }),
    ).toMatchObject({ _tag: "Success" });
  });

  it("enforces each remote candidate's reviewed publication status and exact endpoint host", async () => {
    for (const [name, publicationEligible] of [
      ["linear", true],
      ["maple", true],
      ["cloudflare", true],
      ["notion", true],
      ["atlassian", false],
      ["gmail", false],
      ["resend", true],
    ] as const) {
      const value: unknown = JSON.parse(await readFile(`plugins/remotes/${name}.json`, "utf8"));
      const authoring = validateManagedRemotePluginRelease(value, "authoring");
      expect(Result.isSuccess(authoring)).toBe(true);
      if (Result.isFailure(authoring)) continue;
      if (name === "atlassian") {
        expect(authoring.success.verificationNotes).toContain(
          "MCP audience token is accepted by /me and /oauth/token/accessible-resources",
        );
        expect(authoring.success.verificationNotes).toContain(
          "exact reviewed public MCP identity tools may be required instead",
        );
      }
      const publication = validateManagedRemotePluginRelease(authoring.success, "publication");
      if (publicationEligible) expect(Result.isSuccess(publication)).toBe(true);
      else expect(publication).toEqual(Result.fail("remote-release-not-reviewed"));
    }
  });

  it("keeps Linear bound to its captured dynamic OAuth authority and reviewed catalog", async () => {
    const value: unknown = JSON.parse(await readFile("plugins/remotes/linear.json", "utf8"));
    const decoded = validateManagedRemotePluginRelease(value, "authoring");
    expect(Result.isSuccess(decoded)).toBe(true);
    if (Result.isFailure(decoded)) return;

    expect(decoded.success.status).toBe("reviewed-publishable");
    expect(decoded.success.endpoint).toBe("https://mcp.linear.app/mcp");
    expect(decoded.success.oauthRegistrationMode).toBe("dynamic");
    expect(decoded.success.scopes).toEqual(["read", "write"]);
    expect(decoded.success.authStrategy).toMatchObject({
      profile: "mcp-oauth",
      providerRegistrationId: "linear-oauth-v1",
      requestedScopes: ["read", "write"],
      clientRegistration: {
        kind: "dynamic",
        authorizationServerMetadataUrl:
          "https://mcp.linear.app/.well-known/oauth-authorization-server",
      },
      resourceMetadataUrl: "https://mcp.linear.app/.well-known/oauth-protected-resource/mcp",
    });
    expect(decoded.success.oauthProviderDefinition).toMatchObject({
      issuer: "https://mcp.linear.app",
      authorizationEndpoint: "https://mcp.linear.app/authorize",
      tokenEndpoint: "https://mcp.linear.app/token",
      tokenEndpointAuthMethod: "none",
      authorizationResponseIssuer: "required",
      pkce: { method: "S256" },
      scopes: ["read", "write"],
    });
    expect(decoded.success.catalog.tools).toHaveLength(65);
    expect(
      decoded.success.catalog.tools.find((tool) => tool.mcpName === "merge_diff"),
    ).toMatchObject({
      classification: "destructive",
      defaultPolicy: "require-approval",
    });
    expect(
      Result.isSuccess(validateManagedRemotePluginRelease(decoded.success, "publication")),
    ).toBe(true);
  });

  it("keeps Maple bound to its captured dynamic OAuth authority and read-only catalog", async () => {
    const value: unknown = JSON.parse(await readFile("plugins/remotes/maple.json", "utf8"));
    const decoded = validateManagedRemotePluginRelease(value, "authoring");
    expect(Result.isSuccess(decoded)).toBe(true);
    if (Result.isFailure(decoded)) return;

    expect(decoded.success.status).toBe("reviewed-publishable");
    expect(decoded.success.endpoint).toBe("https://api.maple.dev/mcp");
    expect(decoded.success.oauthRegistrationMode).toBe("dynamic");
    expect(decoded.success.scopes).toEqual(["mcp:tools"]);
    expect(decoded.success.authStrategy).toMatchObject({
      profile: "mcp-oauth",
      providerRegistrationId: "maple-oauth-v1",
      requestedScopes: ["mcp:tools"],
      clientRegistration: {
        kind: "dynamic",
        authorizationServerMetadataUrl:
          "https://api.maple.dev/.well-known/oauth-authorization-server",
      },
      resourceMetadataUrl: "https://api.maple.dev/.well-known/oauth-protected-resource/mcp",
    });
    expect(decoded.success.oauthProviderDefinition).toMatchObject({
      issuer: "https://api.maple.dev",
      authorizationEndpoint: "https://api.maple.dev/oauth/authorize",
      tokenEndpoint: "https://api.maple.dev/oauth/token",
      tokenEndpointAuthMethod: "none",
      authorizationResponseIssuer: "not-supported",
      pkce: { method: "S256" },
      scopes: ["mcp:tools"],
    });
    if (decoded.success.oauthProviderDefinition === undefined) return;
    expect(decoded.success.providerDefinitionDigest).toBe(
      await digestPluginOAuthProviderDefinition(decoded.success.oauthProviderDefinition),
    );
    expect(decoded.success.catalog.tools).toHaveLength(24);
    expect(
      decoded.success.catalog.tools.every(
        (tool) => tool.classification === "read" && tool.defaultPolicy === "allow",
      ),
    ).toBe(true);
    expect(decoded.success.catalog.tools.map((tool) => tool.mcpName)).not.toContain("run_sql");
    expect(decoded.success.catalog.digest).toBe(
      await digestPluginBytes(
        new TextEncoder().encode(
          canonicalPluginJson({
            schemaVersion: decoded.success.catalog.schemaVersion,
            tools: decoded.success.catalog.tools,
          }),
        ),
      ),
    );
    expect(
      Result.isSuccess(validateManagedRemotePluginRelease(decoded.success, "publication")),
    ).toBe(true);
  });

  it("admits only a bare lowercase provider hostname as a remote logo declaration", async () => {
    const value = JSON.parse(await readFile("plugins/remotes/cloudflare.json", "utf8")) as Record<
      string,
      unknown
    >;
    for (const [logoDomain, admitted] of [
      ["cloudflare.com", true],
      ["ok-site.co.id", true],
      ["https://cloudflare.com", false],
      ["Cloudflare.com", false],
      ["cloudflare", false],
      ["cloudflare.com/logo.png", false],
      ["-bad.com", false],
    ] as const) {
      expect(
        Result.isSuccess(validateManagedRemotePluginRelease({ ...value, logoDomain }, "authoring")),
      ).toBe(admitted);
    }
  });

  it("keeps Cloudflare bound to its captured dynamic OAuth authority and code-mode catalog", async () => {
    const value: unknown = JSON.parse(await readFile("plugins/remotes/cloudflare.json", "utf8"));
    const decoded = validateManagedRemotePluginRelease(value, "authoring");
    expect(Result.isSuccess(decoded)).toBe(true);
    if (Result.isFailure(decoded)) return;

    expect(decoded.success.status).toBe("reviewed-publishable");
    expect(decoded.success.endpoint).toBe("https://mcp.cloudflare.com/mcp");
    expect(decoded.success.logoDomain).toBe("cloudflare.com");
    expect(decoded.success.oauthRegistrationMode).toBe("dynamic");
    expect(decoded.success.scopes).toHaveLength(62);
    expect(decoded.success.scopes).toEqual(
      expect.arrayContaining(["account:read", "offline_access", "user:read"]),
    );
    expect(decoded.success.scopes).not.toContain("zone.write");
    expect(decoded.success.authStrategy).toMatchObject({
      profile: "mcp-oauth",
      providerRegistrationId: "cloudflare-oauth-v1",
      requestedScopes: decoded.success.scopes,
      clientRegistration: {
        kind: "dynamic",
        authorizationServerMetadataUrl:
          "https://mcp.cloudflare.com/.well-known/oauth-authorization-server",
      },
      resourceMetadataUrl: "https://mcp.cloudflare.com/.well-known/oauth-protected-resource/mcp",
      identity: {
        kind: "mcp-tool",
        operation: { endpoint: "https://mcp.cloudflare.com/mcp", toolName: "whoami" },
        subjectPath: ["id"],
        subjectStability: "stable",
      },
    });
    expect(decoded.success.oauthProviderDefinition).toMatchObject({
      issuer: "https://mcp.cloudflare.com",
      authorizationEndpoint: "https://mcp.cloudflare.com/authorize",
      tokenEndpoint: "https://mcp.cloudflare.com/token",
      tokenEndpointAuthMethod: "none",
      authorizationResponseIssuer: "required",
      pkce: { method: "S256" },
      scopes: decoded.success.scopes,
    });
    if (decoded.success.oauthProviderDefinition === undefined) return;
    expect(decoded.success.providerDefinitionDigest).toBe(
      await digestPluginOAuthProviderDefinition(decoded.success.oauthProviderDefinition),
    );
    expect(
      decoded.success.catalog.tools.map((tool) => [
        tool.mcpName,
        tool.classification,
        tool.defaultPolicy,
      ]),
    ).toEqual([
      ["docs", "read", "allow"],
      ["search", "read", "allow"],
      ["execute", "destructive", "require-approval"],
      ["whoami", "read", "allow"],
    ]);
    expect(decoded.success.catalog.digest).toBe(
      await digestPluginBytes(
        new TextEncoder().encode(
          canonicalPluginJson({
            schemaVersion: decoded.success.catalog.schemaVersion,
            tools: decoded.success.catalog.tools,
          }),
        ),
      ),
    );
    expect(
      Result.isSuccess(validateManagedRemotePluginRelease(decoded.success, "publication")),
    ).toBe(true);
  });

  for (const name of ["notion", "resend"]) {
    it(`pins ${name} provider authority and rejects host, ownership, and scope drift`, async () => {
      const value: unknown = JSON.parse(await readFile(`plugins/remotes/${name}.json`, "utf8"));
      const decoded = validateManagedRemotePluginRelease(value, "authoring");
      expect(Result.isSuccess(decoded)).toBe(true);
      if (Result.isFailure(decoded)) return;
      const remote = decoded.success;
      if (
        remote.authStrategy === undefined ||
        remote.authStrategy.profile !== "mcp-oauth" ||
        remote.oauthProviderDefinition === undefined
      ) {
        throw new Error(`${name}-oauth-authority-missing`);
      }
      const remoteJson = Schema.decodeUnknownSync(Schema.JsonObject)(
        JSON.parse(JSON.stringify(remote)),
      );
      const authStrategyJson = Schema.decodeUnknownSync(Schema.JsonObject)(remoteJson.authStrategy);

      expect(await digestPluginOAuthProviderDefinition(remote.oauthProviderDefinition)).toBe(
        remote.authStrategy.providerDefinitionDigest,
      );
      expect(
        validateManagedRemotePluginRelease(
          { ...remoteJson, endpoint: "https://authority-drift.example/mcp" },
          "authoring",
        ),
      ).toEqual(Result.fail("remote-endpoint-authority-mismatch"));
      expect(
        validateManagedRemotePluginRelease(
          {
            ...remoteJson,
            authStrategy: {
              ...authStrategyJson,
              providerRegistrationId: `${name}-different-owner`,
            },
          },
          "authoring",
        ),
      ).toEqual(Result.fail("remote-auth-provider-registration-mismatch"));
      expect(
        validateManagedRemotePluginRelease(
          { ...remoteJson, scopes: [...remote.scopes, "full_access"] },
          "authoring",
        ),
      ).toEqual(Result.fail("remote-auth-oauth-authority-mismatch"));
    });
  }
});
