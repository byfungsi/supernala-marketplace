/** Send-only Gmail tool catalog for a separate OAuth connection. */
export const gmailSendToolCatalog: ReadonlyArray<{
  readonly name: string;
  readonly description: string;
  readonly inputSchema: Readonly<Record<string, unknown>>;
}>;

/** Encode a validated plain-text message as base64url MIME for Gmail users.messages.send. */
export function encodeGmailSendMime(input: unknown): string;

/** Dispatch once; transport or response ambiguity requires manual reconciliation. */
export function createGmailSendToolHandler(input: {
  readonly accessToken: string | undefined;
  readonly fetch?: typeof globalThis.fetch;
}): (name: string, input: unknown) => Promise<{ readonly messageId: string }>;
