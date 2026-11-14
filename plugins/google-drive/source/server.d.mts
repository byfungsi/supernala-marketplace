/** Exact Google Drive tool catalog exposed over MCP. */
export const driveToolCatalog: ReadonlyArray<{
  readonly name: string;
  readonly description: string;
  readonly inputSchema: Readonly<Record<string, unknown>>;
}>;

/** A Google file id, or the id inside a Drive, Docs or Sheets link. */
export function parseGoogleFileId(value: unknown, field?: string): string;

/** Create the Google Drive handler around an injected transport and actor-owned access token. */
export function createDriveToolHandler(input: {
  readonly accessToken: string | undefined;
  readonly fetch?: typeof fetch;
}): (name: string, input: unknown) => Promise<Readonly<Record<string, unknown>>>;
