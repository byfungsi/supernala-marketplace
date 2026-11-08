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
      comparatorSourceSha256: "f9f2788d1ee8e50b53cb940f130f9127a87b2150df57f799cff71e9612ed8902",
      goldenArtifactSha256: "7f9fdcd184bab697c6da00cd177059e4a052ae3f126b5c8c3fb3a7ce1802bba4",
      goldenSourceSha256: "de6e3c42db3a5d5ad42590062d2e8ac980f1affa796331a62eefa33f161a645f",
      goldenCatalogSha256: "64a98955eac37466707955ee4de9afcb3e7515f424fe7f6469b1ac1dded6571f",
    });
  });
});
