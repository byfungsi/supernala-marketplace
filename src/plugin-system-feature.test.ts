import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { expect, it } from "vitest";
import { Result, Schema } from "effect";
import { PluginCatalogSnapshot, PluginToolId } from "./plugin-contract.js";
import { PluginSystemFeatures, parsePluginSystemFeatures } from "./plugin-system-feature.js";
import { validateManagedRemotePluginRelease } from "./remote-release.js";

const notion = JSON.parse(
  readFileSync(new URL("../plugins/remotes/notion.json", import.meta.url), "utf8"),
);
const catalog = Schema.decodeUnknownSync(PluginCatalogSnapshot)(notion.catalog);
const fetchTool = catalog.tools.find((tool) => tool.mcpName === "notion-fetch");
if (fetchTool === undefined) throw new Error("Notion fetch fixture is missing");
const declaration = PluginSystemFeatures.make({
  schemaVersion: 1,
  operations: [
    {
      feature: "unfurl",
      contractVersion: 1,
      operation: "get-detail",
      access: "read-only",
      toolId: fetchTool.id,
      inputMapping: {
        schemaVersion: 1,
        fields: [{ target: ["id"], source: { kind: "input", path: ["resourceReference"] } }],
      },
      outputMapping: {
        schemaVersion: 1,
        kind: "json-fields",
        envelope: "mcp-text-json",
        title: { path: ["title"] },
        canonicalUrl: { path: ["url"] },
      },
    },
  ],
});

it("accepts a versioned feature implementation on an exact reviewed read tool", () => {
  expect(Result.isSuccess(parsePluginSystemFeatures(declaration, catalog))).toBe(true);
  const release = validateManagedRemotePluginRelease(
    { ...notion, systemFeatures: declaration },
    "publication",
  );
  expect(Result.isSuccess(release) && release.success.systemFeatures).toEqual(declaration);
});

it("rejects missing tools, write tools, excess properties, and unsupported versions", () => {
  const missing = PluginSystemFeatures.make({
    ...declaration,
    operations: declaration.operations.map((operation) => ({
      ...operation,
      toolId: PluginToolId.make("missing-tool"),
    })),
  });
  expect(Result.isFailure(parsePluginSystemFeatures(missing, catalog))).toBe(true);
  const writeCatalog = PluginCatalogSnapshot.make({
    ...catalog,
    tools: catalog.tools.map((tool) =>
      tool.id === fetchTool.id ? { ...tool, classification: "write" } : tool,
    ),
  });
  expect(Result.isFailure(parsePluginSystemFeatures(declaration, writeCatalog))).toBe(true);
  for (const systemFeatures of [
    { ...declaration, schemaVersion: 2 },
    { ...declaration, execute: "unreviewed code" },
    {
      ...declaration,
      operations: declaration.operations.map((operation) => ({ ...operation, contractVersion: 2 })),
    },
  ])
    expect(
      Result.isFailure(
        validateManagedRemotePluginRelease({ ...notion, systemFeatures }, "publication"),
      ),
    ).toBe(true);
});

it("checks generated runtime schemas against their immutable owner distribution", () => {
  expect(() =>
    execFileSync(process.execPath, ["tools/vendor-plugin-system-feature-contract.mjs", "check"], {
      cwd: new URL("..", import.meta.url),
      stdio: "pipe",
    }),
  ).not.toThrow();
});
