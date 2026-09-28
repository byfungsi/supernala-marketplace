import { Result, Schema } from "effect";
import { compilePluginOpenApi, type PluginOpenApiAuthoring } from "./plugin-openapi-compiler.js";
import { PluginToolId } from "./plugin-contract.js";
import { isBoundedPluginOpenApiJson } from "./plugin-openapi-json-bounds.js";

const object = (value: unknown): Record<string, unknown> | null =>
  value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;

/** Lists supported declared header/bearer security schemes without inferring credentials. */
export function discoverPluginOpenApiSecuritySchemes(sourceText: string): ReadonlyArray<string> {
  if (
    new TextEncoder().encode(sourceText).byteLength > 1_048_576 ||
    !isBoundedPluginOpenApiJson(sourceText)
  )
    throw new Error("openapi-discovery-bounds-exceeded");
  const root = object(JSON.parse(sourceText));
  const schemes = object(object(root?.components)?.securitySchemes);
  if (schemes === null) return [];
  return Object.entries(schemes)
    .filter(([, raw]) => {
      const scheme = object(raw);
      return (
        scheme !== null &&
        ((scheme.type === "apiKey" && scheme.in === "header" && typeof scheme.name === "string") ||
          (scheme.type === "http" && scheme.scheme === "bearer"))
      );
    })
    .map(([name]) => name)
    .sort();
}

/** An operation candidate is informational until explicitly selected and reviewed. */
export interface PluginOpenApiCandidate {
  readonly operationId: string | null;
  readonly method: string;
  readonly path: string;
  readonly authentication: "none" | "connection" | "unsupported";
  readonly toolId: string | null;
  readonly reason: string | null;
}

/** Reuses the release compiler for support and effective-auth decisions, rather than maintaining another profile parser. */
export async function discoverPluginOpenApiCandidates(
  sourceText: string,
  authoring: PluginOpenApiAuthoring,
): Promise<ReadonlyArray<PluginOpenApiCandidate>> {
  if (
    new TextEncoder().encode(sourceText).byteLength > 1_048_576 ||
    !isBoundedPluginOpenApiJson(sourceText)
  )
    throw new Error("openapi-discovery-bounds-exceeded");
  const root = object(JSON.parse(sourceText));
  const paths = object(root?.paths);
  if (paths === null) throw new Error("openapi-discovery-paths-invalid");
  const entries: Array<{ path: string; method: string; id: string | null }> = [];
  for (const [path, pathItem] of Object.entries(paths)) {
    const pathEntry = object(pathItem);
    if (pathEntry === null) continue;
    for (const method of ["get", "post", "put", "patch", "delete", "head", "options", "trace"]) {
      const operation = object(pathEntry[method]);
      if (operation === null) continue;
      if (entries.length >= 100) throw new Error("openapi-discovery-candidate-limit");
      entries.push({
        path,
        method: method.toUpperCase(),
        id:
          typeof operation.operationId === "string" && operation.operationId.length > 0
            ? operation.operationId
            : null,
      });
    }
  }
  const idCounts = new Map<string, number>();
  const toolCounts = new Map<string, number>();
  const reviewed = new Map(
    authoring.operations.map((operation) => [operation.operationId, operation.toolId]),
  );
  const selectedToolCounts = new Map<string, number>();
  const selectedNameCounts = new Map<string, number>();
  for (const operation of authoring.operations)
    selectedToolCounts.set(operation.toolId, (selectedToolCounts.get(operation.toolId) ?? 0) + 1);
  for (const operation of authoring.operations) {
    const name = operation.toolId.replaceAll(/[.-]/gu, "_");
    selectedNameCounts.set(name, (selectedNameCounts.get(name) ?? 0) + 1);
  }
  const toolIdFor = (id: string) =>
    id
      .toLowerCase()
      .replaceAll(/[^a-z0-9]+/gu, ".")
      .replaceAll(/^\.+|\.+$/gu, "");
  for (const entry of entries) {
    if (entry.id === null) continue;
    idCounts.set(entry.id, (idCounts.get(entry.id) ?? 0) + 1);
    if (!reviewed.has(entry.id)) {
      const toolId = toolIdFor(entry.id);
      toolCounts.set(toolId, (toolCounts.get(toolId) ?? 0) + 1);
    }
  }
  const candidates: PluginOpenApiCandidate[] = [];
  for (const entry of entries) {
    const toolId = entry.id === null ? null : (reviewed.get(entry.id) ?? toolIdFor(entry.id));
    let reason: string | null = null;
    if (entry.id === null) reason = "openapi-operation-id-missing";
    else if ((idCounts.get(entry.id) ?? 0) > 1) reason = "openapi-operation-id-collision";
    else if (toolId === null || Result.isFailure(Schema.decodeUnknownResult(PluginToolId)(toolId)))
      reason = "openapi-tool-id-invalid";
    else if (
      reviewed.has(entry.id) &&
      ((selectedToolCounts.get(toolId) ?? 0) > 1 ||
        (selectedNameCounts.get(toolId.replaceAll(/[.-]/gu, "_")) ?? 0) > 1)
    )
      reason = "openapi-tool-id-collision";
    else if (
      !reviewed.has(entry.id) &&
      ((toolCounts.get(toolId) ?? 0) > 1 ||
        authoring.operations.some(
          (selected) =>
            selected.toolId.replaceAll(/[.-]/gu, "_") === toolId.replaceAll(/[.-]/gu, "_"),
        ))
    )
      reason = "openapi-tool-id-collision";
    else if (["HEAD", "OPTIONS", "TRACE"].includes(entry.method))
      reason = "openapi-method-unsupported";
    if (reason !== null || entry.id === null || toolId === null) {
      candidates.push({
        operationId: entry.id,
        method: entry.method,
        path: entry.path,
        authentication: "unsupported",
        toolId,
        reason,
      });
      continue;
    }
    const compiled = await compilePluginOpenApi({
      sourceText,
      authoring: {
        ...authoring,
        operations: [
          {
            operationId: entry.id,
            toolId: PluginToolId.make(toolId),
            title: entry.id,
            classification: "unknown",
            defaultPolicy: "block",
            maximumOutputBytes: 4096,
          },
        ],
      },
    });
    candidates.push({
      operationId: entry.id,
      method: entry.method,
      path: entry.path,
      authentication: Result.isSuccess(compiled)
        ? (compiled.success.contract.bindings[0]?.authentication ?? "unsupported")
        : "unsupported",
      toolId,
      reason: Result.isFailure(compiled) ? compiled.failure : null,
    });
  }
  return candidates;
}
