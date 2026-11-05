import { Result, Schema } from "effect";
import { PluginSystemFeatures } from "./generated/plugin-system-feature.v1.js";
import type { PluginCatalogSnapshot } from "./plugin-contract.js";

export { PluginSystemFeatures } from "./generated/plugin-system-feature.v1.js";

/** Publication validation binds every declared operation to an exact reviewed read-only tool. */
export function parsePluginSystemFeatures(
  input: typeof PluginSystemFeatures.Type,
  catalog: PluginCatalogSnapshot,
): Result.Result<typeof PluginSystemFeatures.Type, string> {
  const parsed = Schema.decodeUnknownResult(PluginSystemFeatures, { onExcessProperty: "error" })(
    input,
  );
  if (Result.isFailure(parsed)) return Result.fail("system-feature-declaration-invalid");
  for (const operation of parsed.success.operations) {
    const tool = catalog.tools.find((entry) => entry.id === operation.toolId);
    if (tool === undefined || tool.classification !== "read") {
      return Result.fail("system-feature-read-tool-required");
    }
  }
  return Result.succeed(parsed.success);
}
