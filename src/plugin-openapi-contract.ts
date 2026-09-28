import { Result, Schema } from "effect";
import { PluginAuthStrategyDefinition } from "./plugin-auth-strategy.js";
import {
  PluginSha256,
  PluginToolId,
  PluginVersionId,
  PluginCatalogSnapshot,
} from "./plugin-contract.js";

/** Fixed HTTPS origin for one OpenAPI Plugin version; network egress policy is enforced at dispatch. */
export const PluginOpenApiOrigin = Schema.String.pipe(
  Schema.check(Schema.isLengthBetween(1, 2_048)),
  Schema.check(
    Schema.makeFilter<string>(
      (value) => {
        try {
          const url = new URL(value);

          return (
            url.protocol === "https:" &&
            url.origin === value &&
            url.username === "" &&
            url.password === "" &&
            url.port === "" &&
            /^(?:[a-z0-9-]+\.)+[a-z]{2,63}$/u.test(url.hostname) &&
            !url.hostname
              .split(".")
              .some((label) => label.startsWith("-") || label.endsWith("-")) &&
            !url.hostname.endsWith(".internal") &&
            !url.hostname.endsWith(".localhost")
          );
        } catch {
          return false;
        }
      },
      { expected: "a fixed HTTPS origin" },
    ),
  ),
  Schema.brand("PluginOpenApiOrigin"),
);
/** Fixed HTTPS origin admitted for one OpenAPI Plugin version. */
export type PluginOpenApiOrigin = typeof PluginOpenApiOrigin.Type;

const PluginOpenApiParameterName = Schema.String.pipe(
  Schema.check(Schema.isPattern(/^[A-Za-z_][A-Za-z0-9_.-]{0,127}$/u)),
);

/** Reviewed primitive parameter or bounded form query collection. */
export const PluginOpenApiParameter = Schema.Struct({
  name: PluginOpenApiParameterName,
  location: Schema.Literals(["path", "query", "header"]),
  required: Schema.Boolean,
  shape: Schema.optionalKey(Schema.Literals(["scalar", "array", "object"])),
  explode: Schema.optionalKey(Schema.Boolean),
});
/** Reviewed primitive parameter or bounded form query collection. */
export interface PluginOpenApiParameter extends Schema.Schema.Type<typeof PluginOpenApiParameter> {}

/** Immutable wire instructions for one published OpenAPI tool. */
export const PluginOpenApiBinding = Schema.Struct({
  toolId: PluginToolId,
  method: Schema.Literals(["GET", "POST", "PUT", "PATCH", "DELETE"]),
  origin: PluginOpenApiOrigin,
  pathTemplate: Schema.String.pipe(
    Schema.check(Schema.isLengthBetween(1, 2_048)),
    Schema.check(Schema.isPattern(/^\/(?!\/)[A-Za-z0-9_./{}~-]*$/u)),
  ),
  parameters: Schema.Array(PluginOpenApiParameter).pipe(Schema.check(Schema.isMaxLength(100))),
  body: Schema.Literals(["none", "application/json"]),
  bodyRequired: Schema.Boolean,
  authentication: Schema.Literals(["none", "connection"]),
});
/** Immutable wire instructions for one published OpenAPI tool. */
export interface PluginOpenApiBinding extends Schema.Schema.Type<typeof PluginOpenApiBinding> {}

/** Versioned compiler output; a Marketplace release pins these bindings to the reviewed catalog. */
export const PluginOpenApiContract = Schema.Struct({
  schemaVersion: Schema.Literal(1),
  runtimeKind: Schema.Literal("managed-openapi"),
  pluginVersionId: PluginVersionId,
  sourceDigest: PluginSha256,
  sourceText: Schema.String.pipe(Schema.check(Schema.isMaxLength(1_048_576))),
  catalog: PluginCatalogSnapshot,
  authStrategy: PluginAuthStrategyDefinition,
  bindings: Schema.Array(PluginOpenApiBinding).pipe(Schema.check(Schema.isMaxLength(2_000))),
});
/** Versioned compiler output for a single immutable OpenAPI Plugin release. */
export interface PluginOpenApiContract extends Schema.Schema.Type<typeof PluginOpenApiContract> {}

/** Safe incompatibility reason without provider data, source bytes, or credential values. */
export class PluginOpenApiContractFailure extends Schema.TaggedError<PluginOpenApiContractFailure>()(
  "PluginOpenApiContractFailure",
  {
    reason: Schema.Literals([
      "invalid-contract",
      "catalog-mismatch",
      "binding-invalid",
      "schema-unsupported",
    ]),
  },
) {}

const isJsonObject = Schema.is(Schema.JsonObject);
const isJsonString = Schema.is(Schema.String);
const isJsonBoolean = Schema.is(Schema.Boolean);
const isJsonNumber = Schema.is(Schema.Finite);

const supportedInputKeywords = new Set([
  "type",
  "properties",
  "required",
  "additionalProperties",
  "items",
  "enum",
  "const",
  "minimum",
  "maximum",
  "minLength",
  "maxLength",
  "minItems",
  "maxItems",
  "description",
]);

// Validate the entire tree, including optional fields no invocation happened to visit.
const isSupportedOpenApiInputSchema = (schema: Schema.JsonObject, depth = 0): boolean => {
  if (depth > 16 || Object.keys(schema).some((key) => !supportedInputKeywords.has(key))) {
    return false;
  }
  const type = schema.type;
  const types = isJsonString(type) ? [type] : type;
  if (
    !Array.isArray(types) ||
    types.length < 1 ||
    types.some(
      (item) =>
        !isJsonString(item) ||
        !["object", "array", "string", "number", "integer", "boolean", "null"].includes(item),
    )
  ) {
    return false;
  }
  if (
    schema.properties !== undefined &&
    (!isJsonObject(schema.properties) ||
      Object.values(schema.properties).some(
        (child) => !isJsonObject(child) || !isSupportedOpenApiInputSchema(child, depth + 1),
      ))
  ) {
    return false;
  }
  if (
    schema.items !== undefined &&
    (!isJsonObject(schema.items) || !isSupportedOpenApiInputSchema(schema.items, depth + 1))
  ) {
    return false;
  }
  if (
    schema.additionalProperties !== undefined &&
    !isJsonBoolean(schema.additionalProperties) &&
    (!isJsonObject(schema.additionalProperties) ||
      !isSupportedOpenApiInputSchema(schema.additionalProperties, depth + 1))
  ) {
    return false;
  }
  if (
    schema.required !== undefined &&
    (!Array.isArray(schema.required) ||
      schema.required.some(
        (key) =>
          !isJsonString(key) ||
          !isJsonObject(schema.properties) ||
          !Object.hasOwn(schema.properties, key),
      ))
  ) {
    return false;
  }
  if (schema.enum !== undefined && (!Array.isArray(schema.enum) || schema.enum.length === 0)) {
    return false;
  }
  for (const key of ["minimum", "maximum"]) {
    if (schema[key] !== undefined && !isJsonNumber(schema[key])) {
      return false;
    }
  }
  for (const key of ["minLength", "maxLength", "minItems", "maxItems"]) {
    const bound = schema[key];
    if (
      bound !== undefined &&
      (!isJsonNumber(bound) || !Number.isSafeInteger(bound) || bound < 0)
    ) {
      return false;
    }
  }
  for (const [minimum, maximum] of [
    ["minLength", "maxLength"],
    ["minItems", "maxItems"],
    ["minimum", "maximum"],
  ] as const) {
    const lower = schema[minimum];
    const upper = schema[maximum];
    if (isJsonNumber(lower) && isJsonNumber(upper) && lower > upper) return false;
  }

  return true;
};

const schemaMatchesOpenApiBinding = (
  schema: Schema.JsonObject,
  binding: PluginOpenApiBinding,
): boolean => {
  if (
    schema.type !== "object" ||
    schema.additionalProperties !== false ||
    !isJsonObject(schema.properties)
  ) {
    return false;
  }
  const properties = schema.properties;

  const expected = new Set<string>(
    binding.parameters.map((parameter) =>
      parameter.location === "header" ? "headers" : parameter.location,
    ),
  );
  if (binding.body !== "none") expected.add("body");
  if (
    Object.keys(properties).some((name) => !expected.has(name)) ||
    [...expected].some((name) => !Object.hasOwn(properties, name))
  ) {
    return false;
  }
  const rootRequired = schema.required;
  if (rootRequired !== undefined && !Array.isArray(rootRequired)) return false;
  for (const location of ["path", "query", "headers"] as const) {
    const parameters = binding.parameters.filter(
      (parameter) =>
        (parameter.location === "header" ? "headers" : parameter.location) === location,
    );
    if (parameters.length === 0) continue;
    const container = properties[location];
    if (
      !isJsonObject(container) ||
      container.type !== "object" ||
      container.additionalProperties !== false ||
      !isJsonObject(container.properties)
    ) {
      return false;
    }
    const containerProperties = container.properties;
    const fields = new Set(parameters.map((parameter) => parameter.name));
    if (
      Object.keys(containerProperties).some((name) => !fields.has(name)) ||
      [...fields].some((name) => !Object.hasOwn(containerProperties, name))
    ) {
      return false;
    }
    if (
      parameters.some((parameter) => {
        const field = containerProperties[parameter.name];
        if (!isJsonObject(field)) return true;
        const shape = parameter.shape ?? "scalar";
        if (shape === "scalar") {
          return (
            !isJsonString(field.type) ||
            !["string", "integer", "number", "boolean"].includes(field.type)
          );
        }
        if (location !== "query" || field.type !== shape) return true;
        if (shape === "array") {
          return (
            !isJsonObject(field.items) ||
            !isJsonString(field.items.type) ||
            !["string", "integer", "number", "boolean"].includes(field.items.type)
          );
        }

        return (
          !isJsonObject(field.properties) ||
          field.additionalProperties !== false ||
          Object.values(field.properties).some(
            (value) =>
              !isJsonObject(value) ||
              !isJsonString(value.type) ||
              !["string", "integer", "number", "boolean"].includes(value.type),
          )
        );
      })
    ) {
      return false;
    }
    const required = container.required;
    if (required !== undefined && !Array.isArray(required)) return false;
    if (
      parameters.some(
        (parameter) => Boolean(required?.includes(parameter.name)) !== parameter.required,
      )
    ) {
      return false;
    }
    if (parameters.some((parameter) => parameter.required) && !rootRequired?.includes(location)) {
      return false;
    }
  }

  return (
    binding.body === "none" || Boolean(rootRequired?.includes("body")) === binding.bodyRequired
  );
};

/** Parses a compiled OpenAPI Plugin contract and checks catalog/binding identity before admission. */
export function parsePluginOpenApiContract(
  value: Schema.Json,
): Result.Result<PluginOpenApiContract, PluginOpenApiContractFailure> {
  const parsed = Schema.decodeUnknownResult(PluginOpenApiContract, {
    onExcessProperty: "error",
  })(value);
  if (Result.isFailure(parsed)) {
    return Result.fail(new PluginOpenApiContractFailure({ reason: "invalid-contract" }));
  }

  const contract = parsed.success;
  if (contract.authStrategy.profile !== "api-key") {
    return Result.fail(new PluginOpenApiContractFailure({ reason: "invalid-contract" }));
  }
  const tools = new Set(contract.catalog.tools.map((tool) => tool.id));
  const bindings = new Set(contract.bindings.map((binding) => binding.toolId));
  if (
    tools.size !== contract.catalog.tools.length ||
    bindings.size !== contract.bindings.length ||
    tools.size !== bindings.size ||
    [...tools].some((toolId) => !bindings.has(toolId))
  ) {
    return Result.fail(new PluginOpenApiContractFailure({ reason: "catalog-mismatch" }));
  }

  for (const binding of contract.bindings) {
    if (
      binding.pathTemplate !== "/" &&
      binding.pathTemplate
        .slice(1)
        .split("/")
        .some((segment) => segment === ".." || segment === "." || segment === "")
    ) {
      return Result.fail(new PluginOpenApiContractFailure({ reason: "binding-invalid" }));
    }
    const declared = new Set<string>();
    const pathNames = new Set<string>();
    for (const parameter of binding.parameters) {
      const identity = `${parameter.location}:${parameter.location === "header" ? parameter.name.toLowerCase() : parameter.name}`;
      if (declared.has(identity) || (parameter.location === "path" && !parameter.required)) {
        return Result.fail(new PluginOpenApiContractFailure({ reason: "binding-invalid" }));
      }
      declared.add(identity);
      if (
        parameter.location !== "query" &&
        ((parameter.shape !== undefined && parameter.shape !== "scalar") ||
          parameter.explode !== undefined)
      ) {
        return Result.fail(new PluginOpenApiContractFailure({ reason: "binding-invalid" }));
      }
      if (parameter.location === "path") pathNames.add(parameter.name);
      if (
        (parameter.location === "header" &&
          [
            "authorization",
            "cookie",
            "host",
            "content-type",
            "content-length",
            "connection",
            "transfer-encoding",
            "proxy-authorization",
            "proxy-authenticate",
          ].includes(parameter.name.toLowerCase())) ||
        (parameter.location === "header" &&
          contract.authStrategy.delivery.some(
            (delivery) => delivery.headerName.toLowerCase() === parameter.name.toLowerCase(),
          ))
      ) {
        return Result.fail(new PluginOpenApiContractFailure({ reason: "binding-invalid" }));
      }
    }
    const placeholders = [...binding.pathTemplate.matchAll(/\{([^{}]+)\}/gu)];
    if (
      binding.pathTemplate.replaceAll(/\{[^{}]+\}/gu, "").includes("{") ||
      binding.pathTemplate.replaceAll(/\{[^{}]+\}/gu, "").includes("}") ||
      placeholders.length !== pathNames.size ||
      placeholders.some((match) => !pathNames.has(match[1] ?? "")) ||
      (binding.method === "GET" && binding.body !== "none") ||
      (binding.body === "none" && binding.bodyRequired)
    ) {
      return Result.fail(new PluginOpenApiContractFailure({ reason: "binding-invalid" }));
    }
    const tool = contract.catalog.tools.find((entry) => entry.id === binding.toolId);
    if (
      tool === undefined ||
      !isSupportedOpenApiInputSchema(tool.inputSchema) ||
      new TextEncoder().encode(JSON.stringify(tool.inputSchema)).byteLength > 65_536 ||
      !schemaMatchesOpenApiBinding(tool.inputSchema, binding)
    ) {
      return Result.fail(new PluginOpenApiContractFailure({ reason: "schema-unsupported" }));
    }
  }

  return Result.succeed(contract);
}
