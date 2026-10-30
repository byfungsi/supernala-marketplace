import type { SlackJson } from "./slack-web-api.mjs";

/** Fixed API methods, scopes and catalog fields; callers cannot supply transport destinations. */
export const slackApiToolDefinitions: ReadonlyArray<{
  readonly name: string;
  readonly method: string;
  readonly description: string;
  readonly inputSchema: { readonly [key: string]: SlackJson };
  readonly classification: "read" | "write" | "destructive";
  readonly scopes: ReadonlyArray<string>;
  readonly resultKeys: ReadonlyArray<string>;
}>;

/** Exact managed-package tools/list projection, compared to the reviewed publication catalog. */
export const slackApiToolCatalog: ReadonlyArray<{
  readonly name: string;
  readonly description: string;
  readonly inputSchema: { readonly [key: string]: SlackJson };
}>;
