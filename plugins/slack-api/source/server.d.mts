/** Run the MCP stdio process with serial dispatch and bounded frames. */
export function startSlackApiMcpServer(input?: {
  readonly input?: AsyncIterable<Uint8Array | string>;
  readonly output?: { readonly write: (chunk: string) => void };
  readonly accessToken?: string | undefined;
  readonly fetch?: typeof globalThis.fetch;
}): Promise<void>;
