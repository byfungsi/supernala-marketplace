import { Schema } from "effect";
import { PluginProvenance } from "./authoring-validation.js";
import { PackageCatalog, PackageManifest } from "./package-archive.js";
import { PackagedPluginPublicationPlan } from "./publication-plan.js";
import { ManagedRemotePluginRelease } from "./remote-release.js";
import { PluginConfigSchema } from "./plugin-contract.js";

/** Generate portable JSON Schema documents from the owning Effect schemas. */
export function generateMarketplaceJsonSchemas(): Readonly<Record<string, object>> {
  return {
    "catalog.schema.json": Schema.toJsonSchemaDocument(PackageCatalog).schema,
    "config.schema.json": Schema.toJsonSchemaDocument(PluginConfigSchema).schema,
    "plugin.schema.json": Schema.toJsonSchemaDocument(PackageManifest).schema,
    "provenance.schema.json": Schema.toJsonSchemaDocument(PluginProvenance).schema,
    "publication-plan.schema.json": Schema.toJsonSchemaDocument(PackagedPluginPublicationPlan)
      .schema,
    "remote-release.schema.json": Schema.toJsonSchemaDocument(ManagedRemotePluginRelease).schema,
  };
}
