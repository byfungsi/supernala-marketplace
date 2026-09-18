import { Result, Schema } from "effect";

const JsonRpcId = Schema.Union([Schema.String, Schema.Number]);
const JsonRpcResponse = Schema.Struct({
  jsonrpc: Schema.Literal("2.0"),
  id: JsonRpcId,
  result: Schema.optionalKey(Schema.Json),
  error: Schema.optionalKey(
    Schema.Struct({
      code: Schema.Int,
      message: Schema.String.pipe(Schema.check(Schema.isLengthBetween(1, 1_000))),
      data: Schema.optionalKey(Schema.Json),
    }),
  ),
});

/** Bounded MCP fixture conformance result for stdio or Streamable HTTP. */
export interface McpConformanceResult {
  readonly frameCount: number;
  readonly responseIds: ReadonlyArray<string | number>;
  readonly totalBytes: number;
}

/** Parse bounded MCP JSON-lines and require exact expected response IDs. */
export function inspectMcpJsonLines(input: {
  readonly bytes: Uint8Array;
  readonly expectedIds: ReadonlyArray<string | number>;
  readonly maximumFrames?: number;
  readonly maximumFrameBytes?: number;
  readonly maximumTotalBytes?: number;
}): Result.Result<McpConformanceResult, string> {
  const maximumFrames = input.maximumFrames ?? 100;
  const maximumFrameBytes = input.maximumFrameBytes ?? 262_144;
  const maximumTotalBytes = input.maximumTotalBytes ?? 1_048_576;
  if (input.bytes.byteLength > maximumTotalBytes) return Result.fail("mcp-total-bytes-exceeded");
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(input.bytes);
  } catch {
    return Result.fail("mcp-invalid-utf8");
  }
  const lines = text.split("\n").filter((line) => line.length > 0);
  if (lines.length > maximumFrames) return Result.fail("mcp-frame-count-exceeded");
  const responseIds: Array<string | number> = [];
  for (const line of lines) {
    if (new TextEncoder().encode(line).byteLength > maximumFrameBytes) {
      return Result.fail("mcp-frame-bytes-exceeded");
    }
    let json: unknown;
    try {
      json = JSON.parse(line);
    } catch {
      return Result.fail("mcp-frame-invalid-json");
    }
    const response = Schema.decodeUnknownResult(JsonRpcResponse)(json);
    if (Result.isFailure(response)) return Result.fail("mcp-frame-invalid-response");
    if ((response.success.result === undefined) === (response.success.error === undefined)) {
      return Result.fail("mcp-response-result-error-invalid");
    }
    responseIds.push(response.success.id);
  }
  if (
    responseIds.length !== input.expectedIds.length ||
    responseIds.some((id, index) => id !== input.expectedIds[index])
  ) {
    return Result.fail("mcp-response-id-mismatch");
  }
  return Result.succeed({
    frameCount: lines.length,
    responseIds,
    totalBytes: input.bytes.byteLength,
  });
}

/** Parse one bounded Streamable HTTP response body using the same JSON-RPC checks. */
export function inspectMcpStreamableHttpBody(input: {
  readonly contentType: string;
  readonly bytes: Uint8Array;
  readonly expectedId: string | number;
}): Result.Result<McpConformanceResult, string> {
  if (!input.contentType.toLowerCase().startsWith("application/json")) {
    return Result.fail("mcp-http-content-type-invalid");
  }
  if (input.bytes.byteLength > 1_048_576) return Result.fail("mcp-total-bytes-exceeded");
  let value: unknown;
  try {
    value = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(input.bytes));
  } catch {
    return Result.fail("mcp-frame-invalid-json");
  }
  const compact = new TextEncoder().encode(`${JSON.stringify(value)}\n`);
  return inspectMcpJsonLines({ bytes: compact, expectedIds: [input.expectedId] });
}
