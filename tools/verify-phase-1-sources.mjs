import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";

const appRoot = process.argv[2];
if (appRoot === undefined) {
  throw new Error("usage: node tools/verify-phase-1-sources.mjs <supernala-root>");
}

const manifest = JSON.parse(await readFile("compatibility/phase-1-sources.json", "utf8"));
const entries = [
  ...Object.entries(manifest.files),
  ...Object.entries(manifest.additionalReviewedSources),
];
const mismatches = [];

for (const [relativePath, expectedDigest] of entries) {
  const bytes = await readFile(path.resolve(appRoot, relativePath));
  const actualDigest = createHash("sha256").update(bytes).digest("hex");
  if (actualDigest !== expectedDigest) {
    mismatches.push(`${relativePath}: expected ${expectedDigest}, received ${actualDigest}`);
  }
}

if (mismatches.length > 0) {
  throw new Error(`phase-1 compatibility mismatch\n${mismatches.join("\n")}`);
}

process.stdout.write(`verified ${entries.length} phase-1 source hashes\n`);
