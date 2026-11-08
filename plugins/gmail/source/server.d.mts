/** Exact Gmail tool catalog exposed over MCP: four reading tools and one plain-text send. */
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

/** Create the Gmail handler around an injected transport and actor-owned access token. */
export function createGmailToolHandler(input: {
  readonly accessToken: string | undefined;
  readonly fetch?: typeof globalThis.fetch;
}): (name: string, input: unknown) => Promise<unknown>;

/** Construct bounded, header-safe plain-text MIME for one message, base64url encoded. */
export function encodeGmailSendMime(input: {
  readonly from: string;
  readonly to: string;
  readonly subject: string;
  readonly bodyText: string;
}): string;
