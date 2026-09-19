/** Exact read-only Gmail tool catalog exposed over MCP. */
export const gmailToolCatalog: ReadonlyArray<{
  readonly name: string;
  readonly description: string;
  readonly inputSchema: Readonly<Record<string, unknown>>;
}>;

/** Bounded attachment metadata without message attachment bytes. */
export interface GmailAttachmentMetadata {
  readonly attachmentId?: string;
  readonly filename: string;
  readonly mediaType: string;
  readonly sizeBytes: number;
}

/** Parsed untrusted Gmail message content with explicit truncation state. */
export interface GmailMessageResult {
  readonly messageId: string;
  readonly threadId: string;
  readonly internalDate?: string;
  readonly headers: Readonly<Record<string, string>>;
  readonly snippet: string;
  readonly bodyText: string;
  readonly attachments: ReadonlyArray<GmailAttachmentMetadata>;
  readonly labelIds: ReadonlyArray<string>;
  readonly contentTrust: "untrusted-email-content";
  readonly truncation: {
    readonly headers: boolean;
    readonly snippet: boolean;
    readonly body: boolean;
    readonly attachments: boolean;
    readonly labels: boolean;
    readonly metadata: boolean;
  };
}

/** Parse one untrusted Gmail message without returning raw MIME or attachment bytes. */
export function parseGmailMessage(message: unknown): GmailMessageResult;

/** Create the four-tool Gmail handler around an injected transport and actor-owned access token. */
export function createGmailToolHandler(input: {
  readonly accessToken: string | undefined;
  readonly fetch?: typeof globalThis.fetch;
}): (name: string, input: unknown) => Promise<unknown>;
