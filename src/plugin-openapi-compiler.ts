import { Result, Schema } from "effect";
import {
  canonicalPluginOpenApiJson,
  comparePluginOpenApiUtf8Keys,
} from "./plugin-openapi-canonical.js";
import {
  parsePluginOpenApiContract,
  type PluginOpenApiContract,
} from "./plugin-openapi-contract.js";
import {
  digestPluginBytes,
  PluginCatalogSnapshotId,
  PluginSha256,
  PluginToolId,
  PluginVersionId,
} from "./plugin-contract.js";
import { PluginAuthStrategyDefinition } from "./plugin-auth-strategy.js";
import { isBoundedPluginOpenApiJson } from "./plugin-openapi-json-bounds.js";
import { pluginOpenApiOperationIdentity } from "./plugin-openapi-operation-identity.js";

/** A reviewed operation selection keeps tool identities stable across source reordering. */
export const PluginOpenApiOperationSelection = Schema.Struct({
  operationId: Schema.NonEmptyString,
  toolId: PluginToolId,
  title: Schema.NonEmptyString,
  classification: Schema.Literals(["read", "write", "destructive", "unknown"]),
  defaultPolicy: Schema.Literals(["allow", "require-approval", "block"]),
  maximumOutputBytes: Schema.Int,
});
export const PluginOpenApiAuthoring = Schema.Struct({
  schemaVersion: Schema.Literal(1),
  pluginVersionId: PluginVersionId,
  catalogSnapshotId: PluginCatalogSnapshotId,
  providerRegistrationId: Schema.NonEmptyString,
  credential: Schema.Struct({
    field: Schema.NonEmptyString,
    label: Schema.NonEmptyString,
    minimumLength: Schema.Int,
    maximumLength: Schema.Int,
    displayLabel: Schema.NonEmptyString,
    securityScheme: Schema.NonEmptyString,
  }),
  operations: Schema.Array(PluginOpenApiOperationSelection).pipe(
    Schema.check(Schema.isLengthBetween(1, 2_000)),
  ),
});
/** Reviewed OpenAPI authoring input; never contains credential values. */
export type PluginOpenApiAuthoring = typeof PluginOpenApiAuthoring.Type;

type JsonObject = Schema.JsonObject;
const isObject = Schema.is(Schema.JsonObject);
const isString = Schema.is(Schema.String);
const encoder = new TextEncoder();
const failure = (reason: string): Result.Result<never, string> => Result.fail(`openapi-${reason}`);
const object = (value: Schema.Json): JsonObject | null => (isObject(value) ? value : null);

const pointer = (source: JsonObject, reference: string): Schema.Json | null => {
  if (!reference.startsWith("#/")) return null;
  let value: Schema.Json = source;
  for (const token of reference.slice(2).split("/")) {
    const key = token.replaceAll("~1", "/").replaceAll("~0", "~");
    const parent = object(value);
    if (parent === null || !Object.hasOwn(parent, key)) return null;
    value = parent[key] ?? null;
  }
  return value;
};

const resolveLocalReference = (
  value: Schema.Json,
  source: JsonObject,
  visited: ReadonlySet<string> = new Set(),
  depth = 0,
): Result.Result<JsonObject, string> => {
  if (depth > 16) return failure("reference-depth");
  const entry = object(value);
  if (entry === null) return failure("reference-invalid");
  if (entry.$ref === undefined) return Result.succeed(entry);
  if (!isString(entry.$ref) || Object.keys(entry).length !== 1 || visited.has(entry.$ref))
    return failure("reference-unsupported");
  const target = pointer(source, entry.$ref);
  if (target === null) return failure("reference-unsupported");
  return resolveLocalReference(target, source, new Set([...visited, entry.$ref]), depth + 1);
};

const resolveInputSchema = (
  value: Schema.Json,
  source: JsonObject,
  visited: ReadonlySet<string> = new Set(),
  depth = 0,
): Result.Result<JsonObject, string> => {
  if (depth > 16) return failure("schema-depth");
  const entry = object(value);
  if (entry === null) return failure("schema-unsupported");
  if (entry.$ref !== undefined) {
    if (!isString(entry.$ref) || Object.keys(entry).length !== 1 || visited.has(entry.$ref)) {
      return failure("reference-unsupported");
    }
    const target = pointer(source, entry.$ref);
    if (target === null) return failure("reference-unsupported");
    return resolveInputSchema(target, source, new Set([...visited, entry.$ref]), depth + 1);
  }
  if (entry.allOf !== undefined) {
    if (!Array.isArray(entry.allOf) || entry.allOf.length !== 2 || Object.keys(entry).length !== 1)
      return failure("schema-unsupported");
    const [first, second] = entry.allOf;
    const annotation = object(second ?? null);
    if (
      annotation === null ||
      !isString(annotation.description) ||
      Object.keys(annotation).length !== 1
    )
      return failure("schema-unsupported");
    const base = resolveInputSchema(first, source, visited, depth + 1);
    return Result.isFailure(base)
      ? base
      : Result.succeed({
          ...Object.fromEntries(Object.entries(base.success)),
          description: annotation.description,
        });
  }
  if (entry.oneOf !== undefined) {
    if (
      !Array.isArray(entry.oneOf) ||
      entry.oneOf.length !== 2 ||
      Object.keys(entry).some((key) => key !== "oneOf" && key !== "description")
    )
      return failure("schema-unsupported");
    const branches = entry.oneOf.map((branch) =>
      resolveInputSchema(branch, source, visited, depth + 1),
    );
    const invalid = branches.find(Result.isFailure);
    if (invalid !== undefined) return invalid;
    const resolved = branches.map((branch) => (Result.isSuccess(branch) ? branch.success : {}));
    if (
      resolved.every(
        (branch) =>
          Object.keys(branch).length === 1 &&
          isString(branch.type) &&
          ["string", "number", "integer", "boolean", "null"].includes(branch.type),
      ) &&
      resolved[0]?.type !== resolved[1]?.type &&
      !(
        resolved.some((branch) => branch.type === "integer") &&
        resolved.some((branch) => branch.type === "number")
      )
    ) {
      return Result.succeed({
        type: resolved.map((branch) => branch.type ?? null),
        ...(entry.description === undefined ? {} : { description: entry.description }),
      });
    }
    const string = resolved.find((branch) => branch.type === "string");
    const array = resolved.find((branch) => branch.type === "array");
    if (
      string === undefined ||
      array === undefined ||
      Object.keys(string).some(
        (key) => !["type", "description", "minLength", "maxLength", "enum", "const"].includes(key),
      ) ||
      Object.keys(array).some(
        (key) =>
          !["type", "description", "items", "minItems", "maxItems", "enum", "const"].includes(key),
      ) ||
      string.enum !== undefined ||
      string.const !== undefined ||
      array.enum !== undefined ||
      array.const !== undefined ||
      (entry.description !== undefined && !isString(entry.description))
    )
      return failure("schema-unsupported");
    const { type: _stringType, description: _stringDescription, ...stringRules } = string;
    const { type: _arrayType, description: _arrayDescription, ...arrayRules } = array;
    return Result.succeed({
      type: ["string", "array"],
      ...stringRules,
      ...arrayRules,
      ...(entry.description === undefined ? {} : { description: entry.description }),
    });
  }
  const output: Record<string, Schema.Json> = Object.fromEntries(Object.entries(entry));
  // OpenAPI examples/defaults are documentation, not required input constraints.
  delete output.example;
  delete output.default;
  if (entry.deprecated !== undefined) {
    if (typeof entry.deprecated !== "boolean") return failure("schema-unsupported");
    delete output.deprecated;
  }
  if (entry.format !== undefined) {
    // OpenAPI binary is a transport hint on a string. JSON requests still carry a string.
    if (entry.type !== "string" || entry.format !== "binary") return failure("schema-unsupported");
    delete output.format;
    output.description = `${isString(entry.description) ? `${entry.description} ` : ""}Attachment content is passed as a JSON string without binary conversion.`;
  }
  if (entry.nullable !== undefined) {
    if (typeof entry.nullable !== "boolean" || !isString(entry.type))
      return failure("schema-unsupported");
    delete output.nullable;
    if (entry.nullable) {
      if (entry.enum !== undefined || entry.const !== undefined)
        return failure("schema-unsupported");
      output.type = [entry.type, "null"];
    }
  }
  if (entry.properties !== undefined) {
    const properties = object(entry.properties);
    if (properties === null) return failure("schema-unsupported");
    const resolved: Record<string, Schema.Json> = {};
    for (const [key, child] of Object.entries(properties)) {
      if (["__proto__", "constructor", "prototype"].includes(key))
        return failure("schema-unsupported");
      const nested = resolveInputSchema(child, source, visited, depth + 1);
      if (Result.isFailure(nested)) return nested;
      resolved[key] = nested.success;
    }
    output.properties = resolved;
  }
  if (entry.items !== undefined) {
    const nested = resolveInputSchema(entry.items, source, visited, depth + 1);
    if (Result.isFailure(nested)) return nested;
    output.items = nested.success;
  }
  if (isObject(entry.additionalProperties)) {
    const nested = resolveInputSchema(entry.additionalProperties, source, visited, depth + 1);
    if (Result.isFailure(nested)) return nested;
    output.additionalProperties = nested.success;
  }
  return Result.succeed(output);
};

const selectSecurity = (
  operation: JsonObject,
  root: JsonObject,
  schemeName: string,
): Result.Result<"none" | "connection", string> => {
  const security = Object.hasOwn(operation, "security") ? operation.security : root.security;
  if (security === undefined) return Result.succeed("none");
  if (!Array.isArray(security)) return failure("security-unsupported");
  if (security.length === 0) return Result.succeed("none");
  if (
    security.length !== 1 ||
    !isObject(security[0]) ||
    Object.keys(security[0]).length !== 1 ||
    !Array.isArray(security[0][schemeName]) ||
    security[0][schemeName]?.length !== 0
  )
    return failure("security-unsupported");
  return Result.succeed("connection");
};

/** Compile a bounded, selected OpenAPI 3.x JSON source to the app-owned immutable wire contract. */
export async function compilePluginOpenApi(input: {
  readonly sourceText: string;
  readonly authoring: PluginOpenApiAuthoring;
}): Promise<
  Result.Result<
    {
      readonly contract: PluginOpenApiContract;
      readonly bundleBytes: Uint8Array;
      readonly artifactDigest: typeof PluginSha256.Type;
    },
    string
  >
> {
  if (encoder.encode(input.sourceText).byteLength > 1_048_576) return failure("source-too-large");
  if (!isBoundedPluginOpenApiJson(input.sourceText)) return failure("source-bounds-exceeded");
  let decoded: Schema.Json;
  try {
    decoded = Schema.decodeUnknownSync(Schema.Json)(JSON.parse(input.sourceText));
  } catch {
    return failure("source-invalid");
  }
  const root = object(decoded);
  if (root === null || !isString(root.openapi) || !/^3\.[01]\./u.test(root.openapi)) {
    return failure("version-unsupported");
  }
  const server =
    Array.isArray(root.servers) && root.servers.length === 1 ? object(root.servers[0]) : null;
  const origin = server?.url;
  const paths = object(root.paths ?? null);
  const schemes = object(object(root.components ?? null)?.securitySchemes ?? null);
  const scheme = object(schemes?.[input.authoring.credential.securityScheme] ?? null);
  if (!isString(origin) || paths === null || scheme === null) return failure("source-unsupported");
  const headerName =
    scheme.type === "http" && scheme.scheme === "bearer" ? "Authorization" : scheme.name;
  const encoding = scheme.type === "http" && scheme.scheme === "bearer" ? "bearer" : "raw";
  if (
    (encoding === "raw" && (scheme.type !== "apiKey" || scheme.in !== "header")) ||
    !isString(headerName)
  )
    return failure("security-scheme-unsupported");
  const auth = Schema.decodeUnknownResult(PluginAuthStrategyDefinition)({
    schemaVersion: 1,
    profile: "api-key",
    providerRegistrationId: input.authoring.providerRegistrationId,
    fields: [
      {
        key: input.authoring.credential.field,
        label: input.authoring.credential.label,
        secret: true,
        minimumLength: input.authoring.credential.minimumLength,
        maximumLength: input.authoring.credential.maximumLength,
      },
    ],
    delivery: [{ kind: "header", field: input.authoring.credential.field, headerName, encoding }],
    identity: { kind: "opaque-connection", displayLabel: input.authoring.credential.displayLabel },
    resources: { kind: "none" },
  });
  if (Result.isFailure(auth)) return failure("auth-definition-invalid");
  const entries = new Map<
    string,
    { method: string; path: string; operation: JsonObject; pathItem: JsonObject }
  >();
  for (const [path, rawPathItem] of Object.entries(paths)) {
    const pathItem = object(rawPathItem);
    if (pathItem === null || pathItem.$ref !== undefined) return failure("path-unsupported");
    for (const method of ["get", "post", "put", "patch", "delete"]) {
      const operation = object(pathItem[method] ?? null);
      if (operation === null) continue;
      const operationId = pluginOpenApiOperationIdentity(method, path, operation.operationId);
      if (operationId === null) return failure("operation-id-invalid");
      if (
        entries.has(operationId) &&
        input.authoring.operations.some((selected) => selected.operationId === operationId)
      )
        return failure("operation-id-collision");
      entries.set(operationId, {
        method: method.toUpperCase(),
        path,
        operation,
        pathItem,
      });
    }
  }
  const tools: Array<Schema.JsonObject> = [];
  const bindings: Array<Schema.JsonObject> = [];
  const ids = new Set<string>();
  const names = new Set<string>();
  for (const selected of input.authoring.operations.toSorted((a, b) =>
    comparePluginOpenApiUtf8Keys(a.toolId, b.toolId),
  )) {
    const entry = entries.get(selected.operationId);
    if (entry === undefined) return failure("selected-operation-missing");
    if (ids.has(selected.toolId)) return failure("tool-id-collision");
    ids.add(selected.toolId);
    const mcpName = selected.toolId.replaceAll(/[.-]/gu, "_");
    if (names.has(mcpName)) return failure("tool-name-collision");
    names.add(mcpName);
    if (
      entry.operation.servers !== undefined ||
      entry.pathItem.servers !== undefined ||
      entry.operation.callbacks !== undefined
    )
      return failure("operation-unsupported");
    const security = selectSecurity(
      entry.operation,
      root,
      input.authoring.credential.securityScheme,
    );
    if (Result.isFailure(security)) return Result.fail(security.failure);
    const parameters: Array<Schema.JsonObject> = [];
    const containers: Record<string, Record<string, Schema.Json>> = {};
    const required: Record<string, string[]> = {};
    const byKey = new Map<string, JsonObject>();
    for (const rawList of [entry.pathItem.parameters, entry.operation.parameters]) {
      if (rawList === undefined) continue;
      if (!Array.isArray(rawList)) return failure("parameters-unsupported");
      const namesInList = new Set<string>();
      for (const rawParameter of rawList) {
        const resolved = resolveLocalReference(rawParameter, root);
        if (Result.isFailure(resolved)) return Result.fail(resolved.failure);
        const parameter = resolved.success;
        if (!isString(parameter.name) || !isString(parameter.in))
          return failure("parameters-unsupported");
        const key = `${parameter.in}:${parameter.in === "header" ? parameter.name.toLowerCase() : parameter.name}`;
        if (namesInList.has(key)) return failure("parameter-collision");
        namesInList.add(key);
        byKey.set(key, parameter);
      }
    }
    for (const parameter of byKey.values()) {
      const location = parameter.in;
      if (location !== "path" && location !== "query" && location !== "header")
        return failure("parameters-unsupported");
      const name = parameter.name;
      if (!isString(name)) return failure("parameters-unsupported");
      if (
        ["__proto__", "constructor", "prototype"].includes(name) ||
        (parameter.required !== undefined && typeof parameter.required !== "boolean") ||
        (parameter.explode !== undefined && typeof parameter.explode !== "boolean")
      )
        return failure("parameters-unsupported");
      if (
        parameter.content !== undefined ||
        parameter.allowReserved !== undefined ||
        parameter.allowEmptyValue !== undefined ||
        (parameter.style !== undefined && parameter.style !== "form" && location === "query")
      )
        return failure("parameters-unsupported");
      if (
        location !== "query" &&
        parameter.style !== undefined &&
        parameter.style !== (location === "path" ? "simple" : "simple")
      )
        return failure("parameters-unsupported");
      if (location !== "query" && parameter.explode !== undefined)
        return failure("parameters-unsupported");
      const schema = resolveInputSchema(parameter.schema ?? null, root);
      if (Result.isFailure(schema)) return Result.fail(schema.failure);
      const shape = schema.success.type;
      if (!isString(shape)) return failure("parameters-unsupported");
      if (location !== "query" && (shape === "array" || shape === "object"))
        return failure("parameters-unsupported");
      if (shape !== "array" && shape !== "object" && parameter.explode !== undefined)
        return failure("parameters-unsupported");
      const requiredField = location === "path" || parameter.required === true;
      const container = location === "header" ? "headers" : location;
      containers[container] ??= {};
      required[container] ??= [];
      containers[container][name] = schema.success;
      if (requiredField) required[container].push(name);
      parameters.push({
        name,
        location,
        required: requiredField,
        ...(shape === "array" || shape === "object"
          ? { shape, explode: parameter.explode !== false }
          : {}),
      });
    }
    const inputProperties: Record<string, Schema.Json> = {};
    const rootRequired: string[] = [];
    for (const location of ["path", "query", "headers"]) {
      if (containers[location] === undefined) continue;
      inputProperties[location] = {
        type: "object",
        properties: containers[location],
        required: required[location] ?? [],
        additionalProperties: false,
      };
      if ((required[location]?.length ?? 0) > 0) rootRequired.push(location);
    }
    let body: "none" | "application/json" = "none";
    let bodyRequired = false;
    if (entry.operation.requestBody !== undefined) {
      const requestBody = resolveLocalReference(entry.operation.requestBody, root);
      if (Result.isFailure(requestBody)) return Result.fail(requestBody.failure);
      if (
        requestBody.success.required !== undefined &&
        typeof requestBody.success.required !== "boolean"
      )
        return failure("body-unsupported");
      const content = object(requestBody.success.content ?? null);
      const media = object(content?.["application/json"] ?? null);
      if (media === null || Object.keys(content ?? {}).length !== 1 || media.encoding !== undefined)
        return failure("body-unsupported");
      const schema = resolveInputSchema(media.schema ?? null, root);
      if (Result.isFailure(schema)) return Result.fail(schema.failure);
      body = "application/json";
      bodyRequired = requestBody.success.required === true;
      inputProperties.body = schema.success;
      if (bodyRequired) rootRequired.push("body");
    }
    const inputSchema = {
      type: "object",
      properties: inputProperties,
      required: rootRequired,
      additionalProperties: false,
    };
    tools.push({
      id: selected.toolId,
      mcpName,
      title: selected.title,
      description: isString(entry.operation.description)
        ? entry.operation.description
        : selected.title,
      classification: selected.classification,
      defaultPolicy: selected.defaultPolicy,
      maximumOutputBytes: selected.maximumOutputBytes,
      inputSchema,
    });
    bindings.push({
      toolId: selected.toolId,
      method: entry.method,
      origin,
      pathTemplate: entry.path,
      parameters,
      body,
      bodyRequired,
      authentication: security.success,
    });
  }
  const sourceDigest = await digestPluginBytes(encoder.encode(input.sourceText));
  const catalog = {
    id: input.authoring.catalogSnapshotId,
    schemaVersion: 1,
    digest: await digestPluginBytes(
      encoder.encode(
        canonicalPluginOpenApiJson({
          id: input.authoring.catalogSnapshotId,
          schemaVersion: 1,
          tools,
        }),
      ),
    ),
    tools,
  };
  const contract = parsePluginOpenApiContract({
    schemaVersion: 1,
    runtimeKind: "managed-openapi",
    pluginVersionId: input.authoring.pluginVersionId,
    sourceText: input.sourceText,
    sourceDigest,
    catalog,
    authStrategy: auth.success,
    bindings,
  });
  if (Result.isFailure(contract)) return failure(contract.failure.reason);
  const bundleBytes = encoder.encode(JSON.stringify(contract.success));
  return Result.succeed({
    contract: contract.success,
    bundleBytes,
    artifactDigest: await digestPluginBytes(bundleBytes),
  });
}
