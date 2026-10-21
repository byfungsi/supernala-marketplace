import { Schema } from "effect";
import { failBatchGuard, type D1Statement } from "./cloudflare-adapters.js";

/**
 * Provider domain whose logo the application renders through its fixed logo proxy. A bare
 * lowercase hostname, never a URL, so a declaration cannot choose an image host.
 */
export const PluginLogoDomain = Schema.String.pipe(
  Schema.check(Schema.isLengthBetween(4, 253)),
  Schema.check(
    Schema.isPattern(/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/u, {
      expected: "a lowercase provider hostname such as cloudflare.com",
    }),
  ),
);

/**
 * Definition logo statements for a declared domain; undeclared releases emit nothing so their
 * publication SQL is unchanged. A declaration fills an empty logo once and otherwise must equal
 * the stored one: replacing a published provider logo remains an application migration.
 */
export function definitionLogoDomainStatements(
  definitionId: string,
  logoDomain: string | undefined,
): ReadonlyArray<D1Statement> {
  if (logoDomain === undefined) return [];
  return [
    {
      sql: `UPDATE plugin_definitions SET logo_domain = ?
        WHERE plugin_definition_id = ? AND logo_domain IS NULL`,
      params: [logoDomain, definitionId],
    },
    failBatchGuard(
      "SELECT 1 FROM plugin_definitions WHERE plugin_definition_id = ? AND logo_domain = ?",
      [definitionId, logoDomain],
    ),
  ];
}
