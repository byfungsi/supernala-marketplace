/** Exact Google Sheets tool catalog exposed over MCP. */
export const sheetsToolCatalog: ReadonlyArray<{
  readonly name: string;
  readonly description: string;
  readonly inputSchema: Readonly<Record<string, unknown>>;
}>;

/** A Google file id, or the id inside a Drive, Docs or Sheets link. */
export function parseGoogleFileId(value: unknown, field?: string): string;

/** Create the Google Sheets handler around an injected transport and actor-owned access token. */
export function createSheetsToolHandler(input: {
  readonly accessToken: string | undefined;
  readonly fetch?: typeof fetch;
}): (name: string, input: unknown) => Promise<Readonly<Record<string, unknown>>>;
