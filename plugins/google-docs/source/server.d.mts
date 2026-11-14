/** Exact Google Docs tool catalog exposed over MCP. */
export const docsToolCatalog: ReadonlyArray<{
  readonly name: string;
  readonly description: string;
  readonly inputSchema: Readonly<Record<string, unknown>>;
}>;

/** A Google file id, or the id inside a Drive, Docs or Sheets link. */
export function parseGoogleFileId(value: unknown, field?: string): string;

/** Create the Google Docs handler around an injected transport and actor-owned access token. */
export function createDocsToolHandler(input: {
  readonly accessToken: string | undefined;
  readonly fetch?: typeof fetch;
}): (name: string, input: unknown) => Promise<Readonly<Record<string, unknown>>>;

/** A document's structure as plain text with light Markdown marks. */
export function documentToText(body: unknown): string;
