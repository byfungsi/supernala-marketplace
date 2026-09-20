import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { format } from "oxfmt";

const repositoryRoot = resolve(import.meta.dirname, "..");
const vendorDirectory = resolve(repositoryRoot, "vendor/supernala-auth-strategy-v1");
const generatedSourcePath = resolve(repositoryRoot, "src/generated/plugin-auth-strategy.v1.ts");
const marketplaceSchemaPath = resolve(
  repositoryRoot,
  "schemas/plugin-auth-strategy-definition.schema.json",
);
const providerChainsPath = resolve(repositoryRoot, "fixtures/auth-profile-provider-chains.v1.json");
const legacySourcePath = resolve(vendorDirectory, "plugin-auth-strategy.v1.source.ts");
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");

const decodeManifest = (bytes) => {
  const value = JSON.parse(bytes.toString("utf8"));
  if (
    value === null ||
    typeof value !== "object" ||
    value.contractVersion !== 1 ||
    value.owner !== "@supernala/domain" ||
    value.sourceFile !== "plugin-auth-strategy.v1.source.txt" ||
    typeof value.sourceSha256 !== "string" ||
    typeof value.schemaSha256 !== "string" ||
    typeof value.providerChainsSha256 !== "string"
  ) {
    throw new Error("auth contract distribution manifest is invalid");
  }
  return value;
};

const loadDistribution = async (directory) => {
  const manifestBytes = await readFile(resolve(directory, "manifest.json"));
  const manifest = decodeManifest(manifestBytes);
  const source = await readFile(resolve(directory, manifest.sourceFile));
  const schema = await readFile(
    resolve(directory, "plugin-auth-strategy-definition.v1.schema.json"),
  );
  const providerChains = await readFile(resolve(directory, "auth-profile-provider-chains.v1.json"));
  if (
    sha256(source) !== manifest.sourceSha256 ||
    sha256(schema) !== manifest.schemaSha256 ||
    sha256(providerChains) !== manifest.providerChainsSha256
  ) {
    throw new Error("auth contract distribution digest mismatch");
  }
  return { source, schema, providerChains, manifestBytes, manifest };
};

const renderMarketplaceSource = async ({ source, manifest }) => {
  const ownerSource = source.toString("utf8");
  const rendered = ownerSource
    .replace('} from "./plugin-identity.ts"', '} from "../plugin-contract.js"')
    .replace(
      'import { OAuthScopeSet, OAuthTokenEndpointAuthMethod } from "./plugin-oauth.ts"',
      'import { OAuthScopeSet, OAuthTokenEndpointAuthMethod } from "../oauth-provider-definition.js"',
    );
  if (rendered === ownerSource || rendered.includes('./plugin-identity.ts"')) {
    throw new Error("auth contract source imports did not match the versioned transform");
  }
  const generated = `// GENERATED from @supernala/domain auth contract v${manifest.contractVersion}.\n// Source SHA-256: ${manifest.sourceSha256}\n// Run \`pnpm auth-contract:vendor <distribution-directory>\`; do not edit.\n${rendered}`;
  const formatted = await format(generatedSourcePath, generated);
  if (formatted.errors.length > 0) {
    throw new Error("generated auth contract source could not be formatted");
  }
  return formatted.code;
};

const command = process.argv[2];
if (command === "vendor") {
  const distributionDirectory = process.argv[3];
  if (distributionDirectory === undefined) {
    throw new Error("usage: pnpm auth-contract:vendor <distribution-directory>");
  }
  const distribution = await loadDistribution(resolve(distributionDirectory));
  await mkdir(vendorDirectory, { recursive: true });
  await mkdir(resolve(generatedSourcePath, ".."), { recursive: true });
  await rm(legacySourcePath, { force: true });
  await writeFile(resolve(vendorDirectory, distribution.manifest.sourceFile), distribution.source);
  await writeFile(
    resolve(vendorDirectory, "plugin-auth-strategy-definition.v1.schema.json"),
    distribution.schema,
  );
  await writeFile(resolve(vendorDirectory, "manifest.json"), distribution.manifestBytes);
  await writeFile(
    resolve(vendorDirectory, "auth-profile-provider-chains.v1.json"),
    distribution.providerChains,
  );
  await writeFile(generatedSourcePath, await renderMarketplaceSource(distribution));
  await writeFile(marketplaceSchemaPath, distribution.schema);
  await writeFile(providerChainsPath, distribution.providerChains);
  console.log(`vendored auth strategy contract v${distribution.manifest.contractVersion}`);
} else if (command === "check") {
  if ((await readdir(vendorDirectory)).includes("plugin-auth-strategy.v1.source.ts")) {
    throw new Error("legacy TypeScript auth contract distribution source is present");
  }
  const distribution = await loadDistribution(vendorDirectory);
  const expectedSource = await renderMarketplaceSource(distribution);
  const [actualSource, actualSchema, actualProviderChains] = await Promise.all([
    readFile(generatedSourcePath, "utf8"),
    readFile(marketplaceSchemaPath),
    readFile(providerChainsPath),
  ]);
  if (
    actualSource !== expectedSource ||
    !actualSchema.equals(distribution.schema) ||
    !actualProviderChains.equals(distribution.providerChains)
  ) {
    throw new Error("vendored auth contract outputs are stale");
  }
  console.log(`verified vendored auth strategy contract v${distribution.manifest.contractVersion}`);
} else {
  throw new Error("usage: node tools/vendor-plugin-auth-strategy-contract.mjs vendor <dir>|check");
}
