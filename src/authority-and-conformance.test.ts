import { readFile } from "node:fs/promises";
import { describe, expect, it } from "@effect/vitest";
import { Result } from "effect";
import {
  derivePluginAuthoritySnapshot,
  diffPluginAuthority,
  PluginAuthoritySnapshot,
} from "./authority-diff.js";
import { validatePluginSource } from "./authoring-validation.js";
import { inspectMcpJsonLines, inspectMcpStreamableHttpBody } from "./mcp-conformance.js";
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

  it("keeps every remote candidate staged and validates exact endpoint host", async () => {
    for (const name of ["linear", "notion", "atlassian", "gmail"]) {
      const value: unknown = JSON.parse(await readFile(`plugins/remotes/${name}.json`, "utf8"));
      const authoring = validateManagedRemotePluginRelease(value, "authoring");
      expect(Result.isSuccess(authoring)).toBe(true);
      if (Result.isFailure(authoring)) continue;
      expect(validateManagedRemotePluginRelease(authoring.success, "publication")).toEqual(
        Result.fail("remote-release-not-reviewed"),
      );
    }
  });
});
