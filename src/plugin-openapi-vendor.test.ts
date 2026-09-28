import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const root = new URL("../compatibility/openapi-v1/", import.meta.url);
const hash = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");

describe("vendored OpenAPI application contract", () => {
  it("pins the exact schema, source provenance, canonical sources, and golden fixture", () => {
    const manifest = JSON.parse(readFileSync(new URL("manifest.json", root), "utf8"));
    for (const [file, field] of [
      ["plugin-openapi-contract.v1.schema.json", "schemaSha256"],
      ["plugin-openapi-contract.v1.source.txt", "sourceSha256"],
      ["plugin-openapi-canonical.v1.source.txt", "canonicalSourceSha256"],
      ["plugin-openapi-golden.v1.json", "goldenFixtureSha256"],
    ] as const) {
      expect(hash(readFileSync(new URL(file, root)))).toBe(manifest[field]);
    }
    expect(
      readFileSync(new URL("../schemas/openapi-contract.schema.json", import.meta.url)),
    ).toEqual(readFileSync(new URL("plugin-openapi-contract.v1.schema.json", root)));
    expect(manifest).toMatchObject({
      contractVersion: 1,
      comparatorSourceSha256: "803954807e6c501ab77b3b509d48ba12e547646cdf9581e4dac8a05286c8ed53",
      goldenArtifactSha256: "7f9fdcd184bab697c6da00cd177059e4a052ae3f126b5c8c3fb3a7ce1802bba4",
      goldenSourceSha256: "de6e3c42db3a5d5ad42590062d2e8ac980f1affa796331a62eefa33f161a645f",
      goldenCatalogSha256: "64a98955eac37466707955ee4de9afcb3e7515f424fe7f6469b1ac1dded6571f",
    });
  });
});
