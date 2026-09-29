import { Result, Schema } from "effect";
import { describe, expect, it } from "vitest";
import { compilePluginOpenApi } from "./plugin-openapi-compiler.js";
import { discoverPluginOpenApiCandidates } from "./plugin-openapi-discovery.js";
import { loadPluginOpenApiSource } from "./plugin-openapi-source.js";

const sourcePath = new URL("../plugins/resend-api", import.meta.url).pathname;

describe("Resend hosted OpenAPI source", () => {
  it("compiles the exact pinned source, retaining send body, idempotency header, and read parameters", async () => {
    const loaded = await loadPluginOpenApiSource(sourcePath);
    expect(Result.isSuccess(loaded)).toBe(true);
    if (Result.isFailure(loaded)) return;
    const { source, sourceText, compiled } = loaded.success;
    expect(source.status).toBe("staged-unverified");
    expect(source.operations.length).toBe(59);
    expect(source.operations.every((operation) => operation.defaultPolicy === "allow")).toBe(true);
    expect(compiled.contract.sourceText).toBe(sourceText);
    expect(compiled.contract.authStrategy.profile).toBe("api-key");
    const send = compiled.contract.catalog.tools.find((tool) => tool.id === "http.post.emails");
    const properties = send?.inputSchema.properties;
    const body = Schema.is(Schema.JsonObject)(properties) ? properties.body : undefined;
    expect(body).toMatchObject({
      type: "object",
      required: ["from", "to", "subject"],
      properties: {
        from: { type: "string" },
        to: { type: ["string", "array"], items: { type: "string" }, minItems: 1, maxItems: 50 },
        bcc: { type: ["string", "array"] },
        cc: { type: ["string", "array"] },
        reply_to: { type: ["string", "array"] },
        html: { type: "string" },
        text: { type: "string" },
        template: {
          type: "object",
          required: ["id"],
          properties: { variables: { additionalProperties: { type: ["string", "number"] } } },
        },
        attachments: {
          type: "array",
          items: { properties: { content: { type: "string" }, path: { type: "string" } } },
        },
        tags: { type: "array" },
      },
    });
    expect(Schema.is(Schema.JsonObject)(properties) ? properties.headers : undefined).toMatchObject(
      {
        properties: { "Idempotency-Key": { type: "string", maxLength: 256 } },
      },
    );
    expect(
      compiled.contract.bindings.find((binding) => binding.toolId === "http.post.emails"),
    ).toMatchObject({
      method: "POST",
      pathTemplate: "/emails",
      body: "application/json",
      parameters: [{ name: "Idempotency-Key", location: "header", required: false }],
      authentication: "connection",
    });
    expect(
      compiled.contract.bindings.find(
        (binding) => binding.toolId === "http.get.emails.by.email.id",
      ),
    ).toMatchObject({
      method: "GET",
      pathTemplate: "/emails/{email_id}",
      body: "none",
      parameters: [{ name: "email_id", location: "path", required: true }],
    });
    const candidates = await discoverPluginOpenApiCandidates(sourceText, source);
    expect(candidates).toHaveLength(83);
    expect(candidates.filter((candidate) => candidate.reason === null)).toHaveLength(63);
    expect(
      candidates.find((candidate) => candidate.path === "/emails" && candidate.method === "POST")
        ?.operationId,
    ).toBe("http:POST:/emails");
  });

  it("preserves explicit IDs, fails on selected identity collision and overlapping unions", async () => {
    const loaded = await loadPluginOpenApiSource(sourcePath);
    if (Result.isFailure(loaded)) throw new Error(loaded.failure);
    const { source, sourceText } = loaded.success;
    const spec = JSON.parse(sourceText);
    spec.paths["/emails"].get.operationId = "list_emails";
    const explicit = await compilePluginOpenApi({
      sourceText: JSON.stringify(spec),
      authoring: {
        ...source,
        operations: [{ ...source.operations[0]!, operationId: "list_emails" }],
      },
    });
    expect(Result.isSuccess(explicit)).toBe(true);
    spec.paths["/emails"].get.operationId = "http:POST:/emails";
    expect(
      await compilePluginOpenApi({
        sourceText: JSON.stringify(spec),
        authoring: {
          ...source,
          operations: [
            source.operations.find((operation) => operation.operationId === "http:POST:/emails")!,
          ],
        },
      }),
    ).toMatchObject({ _tag: "Failure", failure: "openapi-operation-id-collision" });
    delete spec.paths["/emails"].get.operationId;
    spec.paths["/emails"].get.operationId = 123;
    expect(
      await compilePluginOpenApi({ sourceText: JSON.stringify(spec), authoring: source }),
    ).toMatchObject({ _tag: "Failure", failure: "openapi-operation-id-invalid" });
    delete spec.paths["/emails"].get.operationId;
    spec.components.schemas.SendEmailRequest.properties.to.oneOf = [
      { type: "number" },
      { type: "integer" },
    ];
    expect(
      await compilePluginOpenApi({
        sourceText: JSON.stringify(spec),
        authoring: {
          ...source,
          operations: [
            source.operations.find((operation) => operation.operationId === "http:POST:/emails")!,
          ],
        },
      }),
    ).toMatchObject({ _tag: "Failure", failure: "openapi-schema-unsupported" });
  });
});
