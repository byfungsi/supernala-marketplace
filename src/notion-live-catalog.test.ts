import { readFile } from "node:fs/promises";
import { expect, it } from "@effect/vitest";
import { Result } from "effect";
import { canonicalPluginJson, digestPluginBytes } from "./plugin-contract.js";
import { validateManagedRemotePluginRelease } from "./remote-release.js";

it("prepares the captured Notion read catalog with search, access metadata, and exact digest", async () => {
  const source = JSON.parse(await readFile("plugins/remotes/notion.json", "utf8"));
  const parsed = validateManagedRemotePluginRelease(source, "authoring");
  expect(Result.isSuccess(parsed)).toBe(true);
  if (Result.isFailure(parsed)) return;

  const release = parsed.success;
  const index = JSON.parse(await readFile("releases/index.json", "utf8"));
  const indexEntry = index.plugins.find(
    (plugin: { sourceDirectory: string }) =>
      plugin.sourceDirectory === "plugins/remotes/notion.json",
  );
  expect(indexEntry).toMatchObject({
    publicationEligible: release.status === "reviewed-publishable",
    reason: expect.stringContaining("independent source and authority review approved"),
  });
  expect(release.id).toBe("supernala-public:supernala:notion@1.0.3");
  expect(release.status).toBe("reviewed-publishable");
  expect(release.catalog.tools.map((tool) => tool.mcpName)).toEqual([
    "notion-get-tool-access",
    "notion-fetch",
    "notion-search",
  ]);
  expect(release.catalog.tools.every((tool) => tool.defaultPolicy === "allow")).toBe(true);
  expect(
    release.catalog.tools.find((tool) => tool.mcpName === "notion-search")?.inputSchema,
  ).toMatchObject({
    required: ["query"],
    additionalProperties: {},
    properties: {
      query: { type: "string" },
      query_type: { type: "string" },
      filters: { type: "object" },
      page_size: { type: "integer" },
    },
  });
  expect(
    release.catalog.tools.find((tool) => tool.mcpName === "notion-get-tool-access")?.inputSchema,
  ).toMatchObject({ properties: { tool_names: { type: "array" } } });
  expect(release.catalog.digest).toBe(
    await digestPluginBytes(
      new TextEncoder().encode(
        canonicalPluginJson({
          schemaVersion: release.catalog.schemaVersion,
          tools: release.catalog.tools,
        }),
      ),
    ),
  );
  expect(Result.isSuccess(validateManagedRemotePluginRelease(source, "publication"))).toBe(true);
});
