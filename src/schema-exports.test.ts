import { readFile } from "node:fs/promises";
import path from "node:path";
import { expect, it } from "@effect/vitest";
import { Schema } from "effect";
import { generateMarketplaceJsonSchemas } from "./schema-exports.js";

it("keeps portable JSON Schemas byte-aligned with owning Effect schemas", async () => {
  for (const [file, schema] of Object.entries(generateMarketplaceJsonSchemas())) {
    const committed = await readFile(path.join("schemas", file), "utf8");
    expect(JSON.parse(committed)).toEqual(schema);
  }
});

it("consumes the pinned Supernala authentication strategy schema bytes", async () => {
  const compatibility = Schema.decodeUnknownSync(
    Schema.Struct({ additionalReviewedSources: Schema.Record(Schema.String, Schema.String) }),
  )(JSON.parse(await readFile("compatibility/phase-1-sources.json", "utf8")));
  const expected =
    compatibility.additionalReviewedSources[
      "packages/domain/schema/plugin-auth-strategy-definition.v1.schema.json"
    ];
  const bytes = await readFile("schemas/plugin-auth-strategy-definition.schema.json");

  expect(createHash("sha256").update(bytes).digest("hex")).toBe(expected);
});

it("consumes the mechanically vendored app-owned authentication contract", async () => {
  const { execFile } = await import("node:child_process");
  const { promisify } = await import("node:util");
  await expect(
    promisify(execFile)("node", ["tools/vendor-plugin-auth-strategy-contract.mjs", "check"]),
  ).resolves.toMatchObject({ stdout: expect.stringContaining("verified vendored auth strategy") });
});

it("exports the five-field OAuth digest binding through package and plan schemas", () => {
  const schemas = generateMarketplaceJsonSchemas();
  expect(schemas["oauth-provider-definition.schema.json"]).toBeDefined();
  for (const file of ["plugin.schema.json", "publication-plan.schema.json"]) {
    const schema = schemas[file];
    expect(JSON.stringify(schema)).toContain('"providerDefinitionDigest"');
  }
});
import { createHash } from "node:crypto";
