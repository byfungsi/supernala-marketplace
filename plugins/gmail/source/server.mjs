// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Supernala contributors

import { pathToFileURL } from "node:url";

const gmailApiOrigin = "https://gmail.googleapis.com";
const maximumInputLineBytes = 131_072;
const maximumProviderResponseBytes = 1_048_576;
const maximumProviderRequestDurationMs = 15_000;
const maximumOutputBytes = 262_144;
const maximumBodyBytes = 131_072;
const maximumSnippetBytes = 4_096;
const maximumHeaderBytes = 4_096;
const maximumMimeDepth = 20;
const maximumMimeParts = 200;
const maximumAttachments = 50;
const maximumLabels = 100;
const supportedMcpProtocolVersions = new Set(["2025-03-26", "2025-06-18"]);

/** Exact read-only Gmail tool catalog exposed over MCP. */
export const gmailToolCatalog = [
  {
    name: "search_messages",
    description: "Search message identities in the connected Gmail mailbox without reading bodies",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", minLength: 1, maxLength: 500 },
        maxResults: { type: "integer", minimum: 1, maximum: 25 },
        pageToken: { type: "string", minLength: 1, maxLength: 2_048 },
      },
      required: ["query"],
      additionalProperties: false,
    },
  },
  {
    name: "get_message",
    description: "Read one message as bounded plain text and inert metadata",
    inputSchema: {
      type: "object",
      properties: { messageId: { type: "string", minLength: 1, maxLength: 256 } },
      required: ["messageId"],
      additionalProperties: false,
    },
  },
  {
    name: "list_drafts",
    description: "List draft identities in the connected Gmail mailbox without reading bodies",
    inputSchema: {
      type: "object",
      properties: {
        maxResults: { type: "integer", minimum: 1, maximum: 25 },
        pageToken: { type: "string", minLength: 1, maxLength: 2_048 },
      },
      additionalProperties: false,
    },
  },
  {
    name: "get_draft",
    description: "Read one draft as bounded plain text and inert metadata",
    inputSchema: {
      type: "object",
      properties: { draftId: { type: "string", minLength: 1, maxLength: 256 } },
      required: ["draftId"],
      additionalProperties: false,
    },
  },
];

const isRecord = (value) => typeof value === "object" && value !== null && !Array.isArray(value);

const assertBoundedJson = (value, depth = 0, state = { nodes: 0 }) => {
  state.nodes += 1;
  if (depth > maximumMimeDepth || state.nodes > 2_000) {
    throw new Error("Gmail adapter JSON bounds exceeded");
  }
  if (Array.isArray(value)) {
    if (value.length > 1_000) throw new Error("Gmail adapter JSON array bound exceeded");
    for (const entry of value) assertBoundedJson(entry, depth + 1, state);
  } else if (isRecord(value)) {
    const entries = Object.entries(value);
    if (entries.length > 200) throw new Error("Gmail adapter JSON object bound exceeded");
    for (const [, entry] of entries) assertBoundedJson(entry, depth + 1, state);
  }
};

const assertExactKeys = (value, allowed, required = []) => {
  if (!isRecord(value)) throw new Error("Gmail adapter arguments invalid");
  if (Object.keys(value).some((key) => !allowed.includes(key))) {
    throw new Error("Gmail adapter arguments contain an excess field");
  }
  if (required.some((key) => !(key in value))) {
    throw new Error("Gmail adapter arguments missing a required field");
  }
  return value;
};

const boundedString = (value, field, minimum, maximum) => {
  if (typeof value !== "string" || value.length < minimum || value.length > maximum) {
    throw new Error(`Gmail adapter ${field} invalid`);
  }
  return value;
};

const boundedMaxResults = (value) => {
  if (value === undefined) return 25;
  if (!Number.isInteger(value) || value < 1 || value > 25) {
    throw new Error("Gmail adapter maxResults invalid");
  }
  return value;
};

const optionalPageToken = (value) =>
  value === undefined ? undefined : boundedString(value, "pageToken", 1, 2_048);

const truncateText = (value, maximumBytes) => {
  const encoded = new TextEncoder().encode(value);
  if (encoded.byteLength <= maximumBytes) return { value, truncated: false };
  let usedBytes = 0;
  let bounded = "";
  for (const character of value) {
    const characterBytes = Buffer.byteLength(character, "utf8");
    if (usedBytes + characterBytes > maximumBytes) break;
    bounded += character;
    usedBytes += characterBytes;
  }
  return { value: bounded, truncated: true };
};

const decodeBase64UrlText = (value) => {
  if (typeof value !== "string" || value.length > maximumProviderResponseBytes * 2) {
    throw new Error("Gmail adapter MIME body invalid");
  }
  if (!/^[A-Za-z0-9_-]*={0,2}$/u.test(value)) {
    throw new Error("Gmail adapter MIME body encoding invalid");
  }
  const bytes = Buffer.from(value.replaceAll("-", "+").replaceAll("_", "/"), "base64");
  if (bytes.byteLength > maximumProviderResponseBytes) {
    throw new Error("Gmail adapter MIME body exceeded decode bound");
  }
  return new TextDecoder("utf-8", { fatal: false }).decode(bytes);
};

const decodeHtmlEntity = (entity) => {
  const named = { amp: "&", apos: "'", gt: ">", lt: "<", nbsp: " ", quot: '"' };
  if (entity in named) return named[entity];
  const codePoint = entity.startsWith("#x")
    ? Number.parseInt(entity.slice(2), 16)
    : entity.startsWith("#")
      ? Number.parseInt(entity.slice(1), 10)
      : Number.NaN;
  return Number.isInteger(codePoint) && codePoint >= 0 && codePoint <= 0x10ffff
    ? String.fromCodePoint(codePoint)
    : `&${entity};`;
};

const stripHtmlTags = (html) => {
  let text = "";
  let insideTag = false;
  for (const character of html) {
    if (character === "<") {
      insideTag = true;
      text += " ";
    } else if (character === ">" && insideTag) {
      insideTag = false;
    } else if (!insideTag) {
      text += character;
    }
  }
  return text;
};

const htmlToInertText = (html) => {
  const withoutActiveContent = html
    .replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1\s*>/giu, " ")
    .replace(/<!--[\s\S]*?-->/gu, " ")
    .replace(/<(br|\/p|\/div|\/li|\/tr|\/h[1-6])\b[^>]*>/giu, "\n");
  return stripHtmlTags(withoutActiveContent)
    .replace(/&(#x[0-9a-f]+|#\d+|amp|apos|gt|lt|nbsp|quot);/giu, (_, entity) =>
      decodeHtmlEntity(entity.toLowerCase()),
    )
    .replaceAll("<", "‹")
    .replaceAll(">", "›")
    .replace(/[\t ]+/gu, " ")
    .replace(/ *\n */gu, "\n")
    .replace(/\n{3,}/gu, "\n\n")
    .trim();
};

const parseHeaderMetadata = (headers) => {
  if (!Array.isArray(headers)) return { values: {}, truncated: false };
  const selected = new Map([
    ["from", "from"],
    ["to", "to"],
    ["cc", "cc"],
    ["bcc", "bcc"],
    ["subject", "subject"],
    ["date", "date"],
  ]);
  const values = {};
  let truncated = headers.length > 200;
  for (const header of headers.slice(0, 200)) {
    if (!isRecord(header) || typeof header.name !== "string" || typeof header.value !== "string") {
      continue;
    }
    const key = selected.get(header.name.toLowerCase());
    if (key === undefined || key in values) continue;
    const bounded = truncateText(header.value, maximumHeaderBytes);
    values[key] = bounded.value;
    truncated ||= bounded.truncated;
  }
  return { values, truncated };
};

const parseMimePayload = (payload) => {
  const state = { parts: 0, attachments: [], attachmentsTruncated: false };
  const plain = [];
  const html = [];
  const visit = (part, depth) => {
    if (!isRecord(part) || depth > maximumMimeDepth) {
      throw new Error("Gmail adapter MIME depth exceeded");
    }
    state.parts += 1;
    if (state.parts > maximumMimeParts) throw new Error("Gmail adapter MIME parts exceeded");
    const mimeType = typeof part.mimeType === "string" ? part.mimeType.toLowerCase() : "";
    const filename = typeof part.filename === "string" ? part.filename : "";
    const body = isRecord(part.body) ? part.body : {};
    const attachmentId = typeof body.attachmentId === "string" ? body.attachmentId : undefined;
    if (filename !== "" || attachmentId !== undefined) {
      if (state.attachments.length < maximumAttachments) {
        const boundedAttachmentId =
          attachmentId === undefined ? undefined : truncateText(attachmentId, 256);
        const boundedFilename = truncateText(filename, 512);
        const boundedMediaType = truncateText(mimeType, 128);
        const boundedSize =
          Number.isSafeInteger(body.size) && body.size >= 0
            ? Math.min(body.size, maximumProviderResponseBytes)
            : 0;
        state.attachments.push({
          ...(attachmentId === undefined ? {} : { attachmentId: boundedAttachmentId.value }),
          filename: boundedFilename.value,
          mediaType: boundedMediaType.value,
          sizeBytes: boundedSize,
        });
        state.attachmentsTruncated ||=
          boundedAttachmentId?.truncated === true ||
          boundedFilename.truncated ||
          boundedMediaType.truncated ||
          (Number.isSafeInteger(body.size) && body.size > maximumProviderResponseBytes);
      } else {
        state.attachmentsTruncated = true;
      }
      return;
    } else if (typeof body.data === "string") {
      if (mimeType === "text/plain") plain.push(decodeBase64UrlText(body.data));
      else if (mimeType === "text/html") html.push(decodeBase64UrlText(body.data));
    }
    if (part.parts !== undefined) {
      if (!Array.isArray(part.parts) || part.parts.length > maximumMimeParts) {
        throw new Error("Gmail adapter MIME parts invalid");
      }
      for (const child of part.parts) visit(child, depth + 1);
    }
  };
  visit(isRecord(payload) ? payload : {}, 0);
  const body = truncateText(
    plain.length > 0 ? plain.join("\n") : htmlToInertText(html.join("\n")),
    maximumBodyBytes,
  );
  return {
    bodyText: body.value,
    bodyTruncated: body.truncated,
    attachments: state.attachments,
    attachmentsTruncated: state.attachmentsTruncated,
  };
};

/** Parse one untrusted Gmail message without returning raw MIME or attachment bytes. */
export const parseGmailMessage = (message) => {
  if (!isRecord(message)) throw new Error("Gmail adapter message response invalid");
  assertBoundedJson(message);
  const messageId = boundedString(message.id, "message id", 1, 256);
  const threadId = boundedString(message.threadId, "thread id", 1, 256);
  const payload = isRecord(message.payload) ? message.payload : {};
  const headers = parseHeaderMetadata(payload.headers);
  const mime = parseMimePayload(payload);
  const snippet = truncateText(
    typeof message.snippet === "string" ? message.snippet : "",
    maximumSnippetBytes,
  );
  const rawLabelIds = Array.isArray(message.labelIds)
    ? message.labelIds.slice(0, maximumLabels).filter((label) => typeof label === "string")
    : [];
  const boundedLabelIds = rawLabelIds.map((label) => truncateText(label, 128));
  const internalDate =
    typeof message.internalDate === "string" ? truncateText(message.internalDate, 32) : undefined;
  return {
    messageId,
    threadId,
    ...(internalDate === undefined ? {} : { internalDate: internalDate.value }),
    headers: headers.values,
    snippet: snippet.value,
    bodyText: mime.bodyText,
    attachments: mime.attachments,
    labelIds: boundedLabelIds.map((label) => label.value),
    contentTrust: "untrusted-email-content",
    truncation: {
      headers: headers.truncated,
      snippet: snippet.truncated,
      body: mime.bodyTruncated,
      attachments: mime.attachmentsTruncated,
      labels:
        (Array.isArray(message.labelIds) && message.labelIds.length > maximumLabels) ||
        boundedLabelIds.some((label) => label.truncated),
      metadata: internalDate?.truncated === true,
    },
  };
};

const parseIdentityList = (value, field) => {
  if (!Array.isArray(value)) return { identities: [], truncated: false };
  return {
    identities: value.slice(0, 25).map((entry) => {
      if (!isRecord(entry)) throw new Error("Gmail adapter identity response invalid");
      const id = boundedString(entry.id, `${field} id`, 1, 256);
      const message = isRecord(entry.message) ? entry.message : entry;
      return field === "draft"
        ? {
            draftId: id,
            messageId: boundedString(message.id, "message id", 1, 256),
            threadId: boundedString(message.threadId, "thread id", 1, 256),
          }
        : { messageId: id, threadId: boundedString(entry.threadId, "thread id", 1, 256) };
    }),
    truncated: value.length > 25,
  };
};

const parsePageToken = (value) =>
  typeof value === "string" && value.length > 0
    ? truncateText(value, 2_048)
    : { value: undefined, truncated: false };

const readBoundedResponseBytes = async (response) => {
  const declaredLength = response.headers.get("Content-Length");
  if (declaredLength !== null) {
    const parsedLength = Number(declaredLength);
    if (!Number.isSafeInteger(parsedLength) || parsedLength < 0) {
      throw new Error("Gmail adapter response content length invalid");
    }
    if (parsedLength > maximumProviderResponseBytes) {
      throw new Error("Gmail adapter response exceeded transport bound");
    }
  }
  if (response.body === null) throw new Error("Gmail adapter response body unavailable");
  const reader = response.body.getReader();
  const chunks = [];
  let totalBytes = 0;
  while (true) {
    const next = await reader.read();
    if (next.done) break;
    totalBytes += next.value.byteLength;
    if (totalBytes > maximumProviderResponseBytes) {
      await reader.cancel();
      throw new Error("Gmail adapter response exceeded transport bound");
    }
    chunks.push(next.value);
  }
  const bytes = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
};

const parseJsonResponse = async (response) => {
  if (!response.ok) throw new Error(`Gmail adapter request failed with status ${response.status}`);
  const bytes = await readBoundedResponseBytes(response);
  let value;
  try {
    value = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch {
    throw new Error("Gmail adapter response JSON invalid");
  }
  assertBoundedJson(value);
  return value;
};

const makeRedactedAccessToken = (value) => ({
  unsafeRead: () => {
    if (typeof value !== "string" || value === "") {
      throw new Error("Gmail adapter credential unavailable");
    }
    return value;
  },
  toJSON: () => "[REDACTED]",
  toString: () => "[REDACTED]",
});

const makeGmailRequest =
  ({ credential, fetch: fetchImplementation }) =>
  async (resource, query) => {
    const url = new URL(resource, gmailApiOrigin);
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined) url.searchParams.set(key, String(value));
    }
    return parseJsonResponse(
      await fetchImplementation(url, {
        method: "GET",
        redirect: "error",
        signal: AbortSignal.timeout(maximumProviderRequestDurationMs),
        headers: {
          Accept: "application/json",
          Authorization: `Bearer ${credential.unsafeRead()}`,
        },
      }),
    );
  };

/** Create the four-tool Gmail handler around an injected transport and actor-owned access token. */
export const createGmailToolHandler = ({ accessToken, fetch: fetchImplementation = fetch }) => {
  const request = makeGmailRequest({
    credential: makeRedactedAccessToken(accessToken),
    fetch: fetchImplementation,
  });
  return async (name, input) => {
    assertBoundedJson(input);
    if (name === "search_messages") {
      const args = assertExactKeys(input, ["query", "maxResults", "pageToken"], ["query"]);
      const value = await request("/gmail/v1/users/me/messages", {
        q: boundedString(args.query, "query", 1, 500),
        maxResults: boundedMaxResults(args.maxResults),
        pageToken: optionalPageToken(args.pageToken),
      });
      if (!isRecord(value)) throw new Error("Gmail adapter search response invalid");
      const messages = parseIdentityList(value.messages, "message");
      const nextPageToken = parsePageToken(value.nextPageToken);
      return {
        messages: messages.identities,
        ...(nextPageToken.value === undefined ? {} : { nextPageToken: nextPageToken.value }),
        resultSizeEstimate:
          Number.isSafeInteger(value.resultSizeEstimate) && value.resultSizeEstimate >= 0
            ? value.resultSizeEstimate
            : 0,
        truncation: { messages: messages.truncated, nextPageToken: nextPageToken.truncated },
      };
    }
    if (name === "list_drafts") {
      const args = assertExactKeys(input, ["maxResults", "pageToken"]);
      const value = await request("/gmail/v1/users/me/drafts", {
        maxResults: boundedMaxResults(args.maxResults),
        pageToken: optionalPageToken(args.pageToken),
      });
      if (!isRecord(value)) throw new Error("Gmail adapter draft-list response invalid");
      const drafts = parseIdentityList(value.drafts, "draft");
      const nextPageToken = parsePageToken(value.nextPageToken);
      return {
        drafts: drafts.identities,
        ...(nextPageToken.value === undefined ? {} : { nextPageToken: nextPageToken.value }),
        truncation: { drafts: drafts.truncated, nextPageToken: nextPageToken.truncated },
      };
    }
    if (name === "get_message") {
      const args = assertExactKeys(input, ["messageId"], ["messageId"]);
      const messageId = boundedString(args.messageId, "message id", 1, 256);
      return parseGmailMessage(
        await request(`/gmail/v1/users/me/messages/${encodeURIComponent(messageId)}`, {
          format: "full",
        }),
      );
    }
    if (name === "get_draft") {
      const args = assertExactKeys(input, ["draftId"], ["draftId"]);
      const draftId = boundedString(args.draftId, "draft id", 1, 256);
      const value = await request(`/gmail/v1/users/me/drafts/${encodeURIComponent(draftId)}`, {
        format: "full",
      });
      if (!isRecord(value) || !isRecord(value.message)) {
        throw new Error("Gmail adapter draft response invalid");
      }
      return {
        draftId: boundedString(value.id, "draft id", 1, 256),
        ...parseGmailMessage(value.message),
      };
    }
    throw new Error("Gmail adapter tool unavailable");
  };
};

const encodeMcpResponse = (value) => {
  const encoded = JSON.stringify(value);
  if (Buffer.byteLength(encoded, "utf8") > maximumOutputBytes) {
    throw new Error("Gmail adapter response exceeded output bound");
  }
  return `${encoded}\n`;
};

const startGmailMcpServer = () => {
  const callTool = createGmailToolHandler({ accessToken: process.env.PLUGIN_ACCESS_TOKEN });
  const respond = (id, result) =>
    process.stdout.write(encodeMcpResponse({ jsonrpc: "2.0", id, result }));
  const fail = (id, message) =>
    process.stdout.write(
      encodeMcpResponse({ jsonrpc: "2.0", id, error: { code: -32000, message } }),
    );
  const handleLine = async (lineBytes) => {
    let request;
    try {
      const bytes =
        lineBytes.at(-1) === 0x0d ? lineBytes.subarray(0, lineBytes.byteLength - 1) : lineBytes;
      const line = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
      request = JSON.parse(line);
      assertBoundedJson(request);
      if (!isRecord(request)) throw new Error("Gmail adapter request invalid");
      if (!Object.hasOwn(request, "id")) return;
      if (request.method === "initialize") {
        const params = isRecord(request.params) ? request.params : {};
        const protocolVersion = boundedString(params.protocolVersion, "protocol version", 1, 32);
        if (!supportedMcpProtocolVersions.has(protocolVersion)) {
          throw new Error("Gmail adapter protocol version unsupported");
        }
        respond(request.id, {
          protocolVersion,
          capabilities: { tools: {} },
          serverInfo: { name: "supernala-gmail", version: "0.1.0-candidate" },
        });
      } else if (request.method === "tools/list") {
        respond(request.id, { tools: gmailToolCatalog });
      } else if (request.method === "tools/call") {
        const params = assertExactKeys(request.params, ["name", "arguments"], ["name"]);
        const name = boundedString(params.name, "tool name", 1, 160);
        respond(request.id, await callTool(name, params.arguments ?? {}));
      } else {
        throw new Error("Gmail adapter method unavailable");
      }
    } catch (error) {
      fail(
        isRecord(request) ? request.id : null,
        error instanceof Error ? error.message : "Gmail adapter failed",
      );
    }
  };
  let pendingLine = Buffer.alloc(0);
  let lineExceeded = false;
  const acceptSegment = (segment, complete) => {
    if (!lineExceeded) {
      if (pendingLine.byteLength + segment.byteLength > maximumInputLineBytes) {
        pendingLine = Buffer.alloc(0);
        lineExceeded = true;
      } else if (segment.byteLength > 0) {
        pendingLine = Buffer.concat([pendingLine, segment]);
      }
    }
    if (!complete) return;
    if (lineExceeded) fail(null, "Gmail adapter request exceeded input bound");
    else void handleLine(pendingLine);
    pendingLine = Buffer.alloc(0);
    lineExceeded = false;
  };
  process.stdin.on("data", (input) => {
    const chunk = Buffer.isBuffer(input) ? input : Buffer.from(input);
    let offset = 0;
    for (
      let newline = chunk.indexOf(0x0a, offset);
      newline >= 0;
      newline = chunk.indexOf(0x0a, offset)
    ) {
      acceptSegment(chunk.subarray(offset, newline), true);
      offset = newline + 1;
    }
    acceptSegment(chunk.subarray(offset), false);
  });
  process.stdin.on("end", () => {
    if (pendingLine.byteLength > 0 || lineExceeded) acceptSegment(Buffer.alloc(0), true);
  });
};

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  startGmailMcpServer();
}
