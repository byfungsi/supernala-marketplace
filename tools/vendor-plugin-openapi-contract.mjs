import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const [mode, sourceDirectory] = process.argv.slice(2);
if (!(["check", "vendor"].includes(mode) && sourceDirectory)) {
  throw new Error(
    "usage: node tools/vendor-plugin-openapi-contract.mjs check|vendor <application-export-directory>",
  );
}
const source = resolve(sourceDirectory);
const destination = resolve("compatibility/openapi-v1");
const files = {
  "plugin-openapi-contract.v1.schema.json": "schemaSha256",
  "plugin-openapi-contract.v1.source.txt": "sourceSha256",
  "plugin-openapi-canonical.v1.source.txt": "canonicalSourceSha256",
  "plugin-openapi-golden.v1.json": "goldenFixtureSha256",
};
const manifestBytes = await readFile(resolve(source, "manifest.json"));
const manifest = JSON.parse(manifestBytes.toString("utf8"));
if (manifest.contractVersion !== 1 || manifest.owner !== "@supernala/domain") {
  throw new Error("openapi-contract-version-mismatch");
}
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
if (
  hash(await readFile(resolve(source, "plugin-openapi-oauth-order.v1.source.txt"))) !==
  manifest.comparatorSourceSha256
)
  throw new Error("openapi-comparator-source-digest-mismatch");
for (const [file, field] of Object.entries(files)) {
  const bytes = await readFile(resolve(source, file));
  if (hash(bytes) !== manifest[field]) throw new Error(`openapi-source-digest-mismatch:${file}`);
  if (mode === "vendor") await writeFile(resolve(destination, file), bytes);
  else if (!bytes.equals(await readFile(resolve(destination, file)))) {
    throw new Error(`openapi-vendor-mismatch:${file}`);
  }
}
if (mode === "vendor") await writeFile(resolve(destination, "manifest.json"), manifestBytes);
else if (!manifestBytes.equals(await readFile(resolve(destination, "manifest.json")))) {
  throw new Error("openapi-manifest-mismatch");
}
process.stdout.write(`openapi-contract-${mode}-ok\n`);
