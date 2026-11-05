import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { format } from "oxfmt";

const root = resolve(import.meta.dirname, "..");
const vendor = resolve(root, "vendor/supernala-system-feature-v1");
const generated = resolve(root, "src/generated/plugin-system-feature.v1.ts");
const command = process.argv[2];
const directory = command === "vendor" ? process.argv[3] : vendor;
if ((command !== "vendor" && command !== "check") || directory === undefined) {
  throw new Error("System feature vendor requires vendor <distribution-directory> or check");
}
const manifestBytes = await readFile(resolve(directory, "manifest.json"));
const manifest = JSON.parse(manifestBytes.toString("utf8"));
if (
  manifest.contractVersion !== 1 ||
  manifest.owner !== "@supernala/domain" ||
  manifest.sourceFile !== "plugin-system-feature.v1.source.txt" ||
  !/^[a-f0-9]{64}$/.test(manifest.sourceSha256)
) {
  throw new Error("System feature distribution manifest is invalid");
}
const source = await readFile(resolve(directory, manifest.sourceFile));
if (createHash("sha256").update(source).digest("hex") !== manifest.sourceSha256) {
  throw new Error("System feature distribution source digest mismatch");
}
const ownerSource = source.toString("utf8");
const portable = ownerSource.replace('"./plugin-identity.ts"', '"../plugin-contract.js"');
if (portable === ownerSource || portable.includes("./plugin-identity.ts")) {
  throw new Error("System feature distribution import transform did not match");
}
const rendered = await format(
  generated,
  `// GENERATED from @supernala/domain system feature contract v1.\n// Source SHA-256: ${manifest.sourceSha256}\n// Run tools/vendor-plugin-system-feature-contract.mjs; do not edit.\n${portable}`,
);
if (rendered.errors.length > 0) throw new Error("System feature generated source format failed");
if (command === "vendor") {
  await mkdir(vendor, { recursive: true });
  await writeFile(resolve(vendor, "manifest.json"), manifestBytes);
  await writeFile(resolve(vendor, manifest.sourceFile), source);
  await writeFile(generated, rendered.code);
} else if ((await readFile(generated, "utf8")) !== rendered.code) {
  throw new Error("System feature generated contract is stale");
}
