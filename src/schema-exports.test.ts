import { readFile } from "node:fs/promises";
import path from "node:path";
import { expect, it } from "@effect/vitest";
import { generateMarketplaceJsonSchemas } from "./schema-exports.js";

it("keeps portable JSON Schemas byte-aligned with owning Effect schemas", async () => {
  for (const [file, schema] of Object.entries(generateMarketplaceJsonSchemas())) {
    const committed = await readFile(path.join("schemas", file), "utf8");
    expect(JSON.parse(committed)).toEqual(schema);
  }
});
