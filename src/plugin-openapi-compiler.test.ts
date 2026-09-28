import { readFileSync } from "node:fs";
import { Result, Schema } from "effect";
import { describe, expect, it } from "vitest";
import { compilePluginOpenApi, PluginOpenApiAuthoring } from "./plugin-openapi-compiler.js";
import { parsePluginOpenApiContract } from "./plugin-openapi-contract.js";
import { canonicalPluginOpenApiJson } from "./plugin-openapi-canonical.js";
import { digestPluginBytes } from "./plugin-contract.js";
import { admitMarketplaceOpenApiCandidate } from "./plugin-openapi-admission.js";
import { isBoundedPluginOpenApiJson } from "./plugin-openapi-json-bounds.js";

const fixture = JSON.parse(
  readFileSync(
    new URL("../compatibility/openapi-v1/plugin-openapi-golden.v1.json", import.meta.url),
    "utf8",
  ),
);
const accepted = JSON.parse(fixture.accepted.bundleJson);
const authoring = Schema.decodeUnknownSync(PluginOpenApiAuthoring)({
  schemaVersion: 1,
  pluginVersionId: accepted.pluginVersionId,
  catalogSnapshotId: accepted.catalog.id,
  providerRegistrationId: "inventory-provider",
  credential: {
    field: "token",
    label: "Inventory token",
    minimumLength: 8,
    maximumLength: 200,
    displayLabel: "Inventory account",
    securityScheme: "InventoryKey",
  },
  operations: [
    {
      operationId: "items_list",
      toolId: "items.list",
      title: "List items",
      classification: "read",
      defaultPolicy: "allow",
      maximumOutputBytes: 1024,
    },
    {
      operationId: "items_update",
      toolId: "items.update",
      title: "Update item",
      classification: "write",
      defaultPolicy: "require-approval",
      maximumOutputBytes: 1024,
    },
  ],
});

describe("OpenAPI compiler and vendored application golden contract", () => {
  it("parses the authoritative fixture with exact independent digest ordering", async () => {
    expect(Result.isSuccess(parsePluginOpenApiContract(accepted))).toBe(true);
    expect(await digestPluginBytes(new TextEncoder().encode(fixture.accepted.bundleJson))).toBe(
      fixture.accepted.artifactDigest,
    );
    expect(
      await digestPluginBytes(
        new TextEncoder().encode(
          canonicalPluginOpenApiJson({
            id: accepted.catalog.id,
            schemaVersion: accepted.catalog.schemaVersion,
            tools: accepted.catalog.tools,
          }),
        ),
      ),
    ).toBe(fixture.accepted.catalogDigest);
    for (const entry of fixture.rejected) {
      const result = parsePluginOpenApiContract(JSON.parse(entry.bundleJson));
      expect(Result.isFailure(result) ? result.failure.reason : null).toBe(entry.contractReason);
    }
    const candidate = fixture.accepted.candidate;
    const admitted = await admitMarketplaceOpenApiCandidate({
      ...candidate,
      bundleBytes: new TextEncoder().encode(fixture.accepted.bundleJson),
    });
    expect(Result.isSuccess(admitted)).toBe(true);
    for (const entry of fixture.rejected) {
      const rejected = await admitMarketplaceOpenApiCandidate({
        ...candidate,
        artifactDigest: entry.artifactDigest,
        manifestDigest: entry.artifactDigest,
        objectKey: `openapi/${entry.artifactDigest}`,
        bundleBytes: new TextEncoder().encode(entry.bundleJson),
      });
      expect(rejected).toMatchObject({ _tag: "Failure", failure: "openapi-artifact" });
    }
    for (const entry of fixture.rejectedCandidate) {
      const rejected = await admitMarketplaceOpenApiCandidate({
        ...candidate,
        ...entry.override,
        bundleBytes: new TextEncoder().encode(fixture.accepted.bundleJson),
      });
      expect(rejected).toMatchObject({
        _tag: "Failure",
        failure: `openapi-${entry.admissionReason}`,
      });
    }
  });

  it("compiles selected public and secured operations from the same source", async () => {
    const result = await compilePluginOpenApi({ sourceText: accepted.sourceText, authoring });
    expect(Result.isSuccess(result)).toBe(true);
    if (Result.isFailure(result)) return;
    expect(result.success.contract.bindings.map((binding) => binding.authentication)).toEqual([
      "none",
      "connection",
    ]);
    expect(result.success.contract.catalog.tools.map((tool) => tool.id)).toEqual([
      "items.list",
      "items.update",
    ]);
    const repeated = await compilePluginOpenApi({
      sourceText: accepted.sourceText,
      authoring: { ...authoring, operations: [...authoring.operations].reverse() },
    });
    expect(Result.isSuccess(repeated) && repeated.success.artifactDigest).toBe(
      result.success.artifactDigest,
    );
  });

  it("uses one compiler for another provider and rejects ambiguous security and external references", async () => {
    const secondSource = JSON.stringify({
      openapi: "3.0.3",
      info: { title: "Ledger", version: "1.0.0" },
      servers: [{ url: "https://ledger.example.org" }],
      components: {
        securitySchemes: { BearerAuth: { type: "http", scheme: "bearer" } },
        parameters: {
          Account: {
            name: "id",
            in: "path",
            required: true,
            schema: { type: "string", minLength: 2 },
          },
        },
      },
      security: [{ BearerAuth: [] }],
      paths: {
        "/accounts/{id}": {
          parameters: [{ $ref: "#/components/parameters/Account" }],
          get: {
            operationId: "accounts_lookup",
            description: "Find account",
            responses: { "200": { description: "Account" } },
          },
        },
      },
    });
    const second = {
      ...authoring,
      pluginVersionId: authoring.pluginVersionId,
      catalogSnapshotId: authoring.catalogSnapshotId,
      credential: { ...authoring.credential, securityScheme: "BearerAuth" },
      operations: [
        {
          ...authoring.operations[0]!,
          operationId: "accounts_lookup",
          toolId: authoring.operations[0]!.toolId,
        },
      ],
    };
    const valid = await compilePluginOpenApi({ sourceText: secondSource, authoring: second });
    expect(Result.isSuccess(valid)).toBe(true);
    if (Result.isFailure(valid)) return;
    expect(valid.success.contract.bindings[0]).toMatchObject({
      origin: "https://ledger.example.org",
      authentication: "connection",
      parameters: [{ name: "id", location: "path", required: true }],
    });
    if (valid.success.contract.authStrategy.profile !== "api-key")
      throw new Error("openapi-auth-test-invalid");
    expect(valid.success.contract.authStrategy.delivery[0]).toMatchObject({
      headerName: "Authorization",
      encoding: "bearer",
    });
    const parsed = JSON.parse(secondSource);
    parsed.paths["/accounts/{id}"].get.security = [{ BearerAuth: [] }, {}];
    expect(
      await compilePluginOpenApi({ sourceText: JSON.stringify(parsed), authoring: second }),
    ).toMatchObject({ _tag: "Failure", failure: "openapi-security-unsupported" });
    parsed.paths["/accounts/{id}"].get.security = [{ BearerAuth: [] }];
    parsed.paths["/accounts/{id}"].parameters = [
      { $ref: "https://outside.example.org/parameter.json" },
    ];
    expect(
      await compilePluginOpenApi({ sourceText: JSON.stringify(parsed), authoring: second }),
    ).toMatchObject({ _tag: "Failure", failure: "openapi-reference-unsupported" });
  });

  it("overrides path parameters at operation level and retains bounded form query and JSON body schemas", async () => {
    const sourceText = JSON.stringify({
      openapi: "3.1.0",
      info: { title: "Ledger", version: "1" },
      servers: [{ url: "https://ledger.example.org" }],
      components: { securitySchemes: { BearerAuth: { type: "http", scheme: "bearer" } } },
      security: [{ BearerAuth: [] }],
      paths: {
        "/accounts/{id}": {
          parameters: [
            { name: "id", in: "path", required: true, schema: { type: "string", minLength: 2 } },
          ],
          post: {
            operationId: "accounts_update",
            parameters: [
              { name: "id", in: "path", required: true, schema: { type: "string", minLength: 4 } },
              {
                name: "tags",
                in: "query",
                required: false,
                style: "form",
                explode: false,
                schema: { type: "array", items: { type: "string" }, maxItems: 3 },
              },
              {
                name: "sort",
                in: "query",
                required: true,
                style: "form",
                explode: true,
                schema: {
                  type: "object",
                  properties: { Z: { type: "integer" }, a: { type: "string" } },
                  additionalProperties: false,
                },
              },
            ],
            requestBody: {
              required: false,
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: { note: { type: "string", maxLength: 50 } },
                    additionalProperties: false,
                  },
                },
              },
            },
            responses: { "200": { description: "Updated" } },
          },
        },
      },
    });
    const selected = {
      ...authoring,
      credential: { ...authoring.credential, securityScheme: "BearerAuth" },
      operations: [{ ...authoring.operations[1]!, operationId: "accounts_update" }],
    };
    const result = await compilePluginOpenApi({ sourceText, authoring: selected });
    expect(Result.isSuccess(result)).toBe(true);
    if (Result.isFailure(result)) return;
    const schema = result.success.contract.catalog.tools[0]?.inputSchema;
    expect(schema).toMatchObject({
      properties: {
        path: { properties: { id: { minLength: 4 } } },
        query: { properties: { tags: { maxItems: 3 }, sort: { type: "object" } } },
        body: { properties: { note: { maxLength: 50 } } },
      },
      required: ["path", "query"],
    });
    expect(result.success.contract.bindings[0]).toMatchObject({
      body: "application/json",
      bodyRequired: false,
      parameters: [
        { name: "id", location: "path" },
        { name: "tags", shape: "array", explode: false },
        { name: "sort", shape: "object", explode: true },
      ],
    });
  });

  it("fails closed on malformed explicit security, booleans, duplicate parameters and dangerous keys", async () => {
    const source = JSON.parse(accepted.sourceText);
    const operation = source.paths["/items"].post;
    const reject = async (expected: string) => {
      const result = await compilePluginOpenApi({ sourceText: JSON.stringify(source), authoring });
      expect(result).toMatchObject({ _tag: "Failure", failure: expected });
    };
    operation.security = null;
    await reject("openapi-security-unsupported");
    operation.security = [{ InventoryKey: [] }];
    operation.parameters = [
      { name: "id", in: "query", schema: { type: "string" }, required: "false" },
    ];
    await reject("openapi-parameters-unsupported");
    operation.parameters[0].required = false;
    operation.parameters[0].explode = "false";
    await reject("openapi-parameters-unsupported");
    operation.parameters[0].explode = false;
    operation.parameters.push({ ...operation.parameters[0] });
    await reject("openapi-parameter-collision");
    operation.parameters.pop();
    operation.parameters[0].name = "__proto__";
    await reject("openapi-parameters-unsupported");
    operation.parameters = [];
    operation.requestBody.required = "false";
    await reject("openapi-body-unsupported");
    operation.requestBody.required = true;
    operation.requestBody.content["application/json"].schema.properties = JSON.parse(
      '{"__proto__":{"type":"string"}}',
    );
    await reject("openapi-schema-unsupported");
  });

  it("checks JSON structural budget before recursive schema decoding", async () => {
    const deeplyNested = `${"[".repeat(65)}0${"]".repeat(65)}`;
    expect(await compilePluginOpenApi({ sourceText: deeplyNested, authoring })).toMatchObject({
      _tag: "Failure",
      failure: "openapi-source-bounds-exceeded",
    });
    expect(isBoundedPluginOpenApiJson(`${"[".repeat(64)}0${"]".repeat(64)}`)).toBe(true);
    expect(isBoundedPluginOpenApiJson(`{${'"a":0,'.repeat(100_000)}"a":0}`)).toBe(false);
    const bytes = new TextEncoder().encode(
      `${fixture.accepted.bundleJson.slice(0, -1)},"extra":${deeplyNested}}`,
    );
    const digest = await digestPluginBytes(bytes);
    expect(
      await admitMarketplaceOpenApiCandidate({
        ...fixture.accepted.candidate,
        bundleBytes: bytes,
        artifactDigest: digest,
        manifestDigest: digest,
        objectKey: `openapi/${digest}`,
      }),
    ).toMatchObject({ _tag: "Failure", failure: "openapi-artifact" });
    const tooLarge = new Uint8Array(10 * 1_048_576 + 1);
    expect(
      await admitMarketplaceOpenApiCandidate({
        ...fixture.accepted.candidate,
        bundleBytes: tooLarge,
      }),
    ).toMatchObject({ _tag: "Failure", failure: "openapi-artifact" });
  });
});
