import { Result, Schema } from "effect";
import { canonicalPluginJson, digestPluginBytes, PluginSha256 } from "./plugin-contract.js";

const ObservedMcpTool = Schema.Struct({
  name: Schema.String.pipe(Schema.check(Schema.isLengthBetween(1, 160))),
  description: Schema.optionalKey(Schema.String.pipe(Schema.check(Schema.isMaxLength(1_000)))),
  inputSchema: Schema.JsonObject,
});

const ObservedMcpCatalog = Schema.Struct({
  tools: Schema.Array(ObservedMcpTool).pipe(Schema.check(Schema.isLengthBetween(1, 2_000))),
});

/** Credential-free normalized evidence captured from a consented MCP tools/list response. */
export interface RemoteCatalogCapture {
  readonly schemaVersion: 1;
  readonly digest: typeof PluginSha256.Type;
  readonly tools: ReadonlyArray<{
    readonly name: string;
    readonly description?: string;
    readonly inputSchema: Schema.JsonObject;
  }>;
}

/** Normalizes controlled tools/list evidence without assigning review classifications or policy. */
export async function captureRemoteMcpCatalog(
  input: unknown,
): Promise<Result.Result<RemoteCatalogCapture, "remote-catalog-capture-invalid">> {
  const parsed = Schema.decodeUnknownResult(ObservedMcpCatalog, { onExcessProperty: "error" })(
    input,
  );
  if (Result.isFailure(parsed)) return Result.fail("remote-catalog-capture-invalid");
  const tools = parsed.success.tools
    .map((tool) =>
      tool.description === undefined
        ? { name: tool.name, inputSchema: tool.inputSchema }
        : { name: tool.name, description: tool.description, inputSchema: tool.inputSchema },
    )
    .toSorted((left, right) => left.name.localeCompare(right.name));
  if (new Set(tools.map((tool) => tool.name)).size !== tools.length) {
    return Result.fail("remote-catalog-capture-invalid");
  }
  return Result.succeed({
    schemaVersion: 1,
    digest: await digestPluginBytes(
      new TextEncoder().encode(canonicalPluginJson({ schemaVersion: 1, tools })),
    ),
    tools,
  });
}
