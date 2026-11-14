// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Supernala contributors

import { pathToFileURL } from "node:url";

const appName = "Google Docs";
const apiLabel = "The Google Docs API";

const maximumInputLineBytes = 1_200_000;
const maximumProviderResponseBytes = 4_194_304;
const maximumProviderRequestDurationMs = 20_000;
const maximumOutputBytes = 262_144;
const supportedMcpProtocolVersions = new Set(["2025-03-26", "2025-06-18"]);
const driveApiOrigin = "https://www.googleapis.com";
const googleFileIdPattern = /^[A-Za-z0-9_-]{10,200}$/u;
const googleFileUrlIdPattern = /\/(?:d|folders)\/([A-Za-z0-9_-]{10,200})(?:[/?#]|$)/u;

const isRecord = (value) => typeof value === "object" && value !== null && !Array.isArray(value);

const assertBoundedJson = (value, depth = 0, state = { nodes: 0 }) => {
  state.nodes += 1;
  if (depth > 64 || state.nodes > 400_000)
    throw new Error(`${appName} adapter JSON bounds exceeded`);
  if (Array.isArray(value)) {
    if (value.length > 100_000) throw new Error(`${appName} adapter JSON array bound exceeded`);
    for (const entry of value) assertBoundedJson(entry, depth + 1, state);
  } else if (isRecord(value)) {
    const entries = Object.entries(value);
    if (entries.length > 1_000) throw new Error(`${appName} adapter JSON object bound exceeded`);
    for (const [, entry] of entries) assertBoundedJson(entry, depth + 1, state);
  }
};

const assertExactKeys = (value, allowed, required = []) => {
  if (!isRecord(value)) throw new Error(`${appName} adapter arguments invalid`);
  if (Object.keys(value).some((key) => !allowed.includes(key))) {
    throw new Error(`${appName} adapter arguments contain an excess field`);
  }
  if (required.some((key) => !(key in value))) {
    throw new Error(`${appName} adapter arguments missing a required field`);
  }
  return value;
};

const boundedString = (value, field, minimum, maximum) => {
  if (typeof value !== "string" || value.length < minimum || value.length > maximum) {
    throw new Error(`${appName} adapter ${field} invalid`);
  }
  return value;
};

const optionalString = (value, field, minimum, maximum) =>
  value === undefined ? undefined : boundedString(value, field, minimum, maximum);

const optionalInteger = (value, field, minimum, maximum, fallback) => {
  if (value === undefined) return fallback;
  if (!Number.isInteger(value) || value < minimum || value > maximum) {
    throw new Error(`${appName} adapter ${field} invalid`);
  }
  return value;
};

/** A Google file id, or the id inside a Drive, Docs or Sheets link. */
export const parseGoogleFileId = (value, field = "file id") => {
  const text = boundedString(value, field, 1, 2_048).trim();
  if (googleFileIdPattern.test(text)) return text;
  const fromUrl = googleFileUrlIdPattern.exec(text);
  if (fromUrl !== null && /^https:\/\/(?:docs|drive|sheets)\.google\.com\//u.test(text)) {
    return fromUrl[1];
  }
  throw new Error(`${appName} adapter ${field} invalid: pass an id or a Google link`);
};

const truncateText = (value, maximumBytes) => {
  if (Buffer.byteLength(value, "utf8") <= maximumBytes) return { value, truncated: false };
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

const boundedField = (value, maximumBytes) =>
  typeof value === "string" ? truncateText(value, maximumBytes).value : undefined;

const readBoundedResponseBytes = async (response, maximumBytes) => {
  const declaredLength = response.headers.get("Content-Length");
  if (declaredLength !== null) {
    const parsedLength = Number(declaredLength);
    if (!Number.isSafeInteger(parsedLength) || parsedLength < 0) {
      throw new Error(`${appName} adapter response content length invalid`);
    }
    if (parsedLength > maximumBytes) {
      throw new Error(`${appName} adapter response exceeded transport bound`);
    }
  }
  if (response.body === null) return new Uint8Array(0);
  const reader = response.body.getReader();
  const chunks = [];
  let totalBytes = 0;
  while (true) {
    const next = await reader.read();
    if (next.done) break;
    totalBytes += next.value.byteLength;
    if (totalBytes > maximumBytes) {
      await reader.cancel();
      throw new Error(`${appName} adapter response exceeded transport bound`);
    }
    chunks.push(next.value);
  }
  return Buffer.concat(chunks.map((chunk) => Buffer.from(chunk)));
};

/** Explains a Google API refusal in words the Bot can act on, without echoing the request. */
const describeProviderFailure = async (response) => {
  let reason = "";
  let message = "";
  try {
    const value = JSON.parse(
      new TextDecoder("utf-8").decode(await readBoundedResponseBytes(response, 65_536)),
    );
    const error = isRecord(value) && isRecord(value.error) ? value.error : {};
    message = boundedField(error.message, 400) ?? "";
    const first = Array.isArray(error.errors) && isRecord(error.errors[0]) ? error.errors[0] : {};
    reason =
      boundedField(first.reason, 80) ??
      (Array.isArray(error.details) && isRecord(error.details[0])
        ? (boundedField(error.details[0].reason, 80) ?? "")
        : "");
  } catch {
    // An unreadable error body still gets the status explanation below.
  }
  if (response.status === 401) {
    return `${appName} rejected the connection (401); reconnect the Google account in Supernala`;
  }
  if (
    response.status === 403 &&
    (reason === "accessNotConfigured" || reason === "SERVICE_DISABLED")
  ) {
    // Docs and Sheets search through Drive, so name the API Google says is off.
    const api = /Drive API/u.test(message) ? "The Google Drive API" : apiLabel;
    return `${api} is not enabled in the Google Cloud project; enable it there, then try again`;
  }
  if (response.status === 403 && /insufficient|scope/iu.test(`${reason} ${message}`)) {
    return `${appName} lacks permission for this; reconnect the account and approve every requested access`;
  }
  if (response.status === 404)
    return `${appName} found nothing with that id, or this account cannot open it`;
  if (response.status === 429)
    return `${appName} is rate limited by Google; wait a minute and try again`;
  return `${appName} request failed with status ${response.status}${message === "" ? "" : `: ${message}`}`;
};

const makeRedactedAccessToken = (value) => ({
  unsafeRead: () => {
    if (typeof value !== "string" || value === "") {
      throw new Error(`${appName} adapter credential unavailable`);
    }
    return value;
  },
  toJSON: () => "[REDACTED]",
  toString: () => "[REDACTED]",
});

/**
 * One Google API request with the connection's short-lived token. Reads return parsed JSON or
 * bounded text; a write's failure after dispatch is reported as ambiguous and never retried.
 */
const makeGoogleRequest =
  ({ credential, fetch: fetchImplementation }) =>
  async ({
    origin,
    resource,
    query = {},
    method = "GET",
    json,
    body,
    contentType,
    as = "json",
  }) => {
    const url = new URL(resource, origin);
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined) url.searchParams.set(key, String(value));
    }
    const write = method !== "GET";
    let response;
    try {
      response = await fetchImplementation(url, {
        method,
        redirect: "error",
        signal: AbortSignal.timeout(maximumProviderRequestDurationMs),
        headers: {
          Accept: as === "json" ? "application/json" : "*/*",
          Authorization: `Bearer ${credential.unsafeRead()}`,
          ...(json === undefined && contentType === undefined
            ? {}
            : { "Content-Type": contentType ?? "application/json" }),
        },
        ...(json === undefined && body === undefined
          ? {}
          : { body: json === undefined ? body : JSON.stringify(json) }),
      });
    } catch {
      throw new Error(
        write
          ? `${appName} change outcome unknown; check before trying again`
          : `${appName} could not reach Google; try again`,
      );
    }
    if (!response.ok) throw new Error(await describeProviderFailure(response));
    const bytes = await readBoundedResponseBytes(response, maximumProviderResponseBytes);
    if (as === "text") return new TextDecoder("utf-8", { fatal: false }).decode(bytes);
    if (bytes.byteLength === 0) return {};
    let value;
    try {
      value = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
    } catch {
      throw new Error(`${appName} adapter response JSON invalid`);
    }
    assertBoundedJson(value);
    return value;
  };

const googleMimeTypes = {
  document: "application/vnd.google-apps.document",
  spreadsheet: "application/vnd.google-apps.spreadsheet",
  presentation: "application/vnd.google-apps.presentation",
  folder: "application/vnd.google-apps.folder",
  pdf: "application/pdf",
};

/** A Drive query string literal: backslashes and quotes escaped, as Drive's query language requires. */
const driveLiteral = (value) => `'${value.replaceAll("\\", "\\\\").replaceAll("'", "\\'")}'`;

const fileFields =
  "id,name,mimeType,modifiedTime,createdTime,size,webViewLink,parents,shared,owners(displayName,emailAddress)";

/** Inert, bounded file metadata. */
const parseFile = (file) => {
  if (!isRecord(file)) throw new Error(`${appName} adapter file response invalid`);
  const owners = Array.isArray(file.owners) ? file.owners.slice(0, 5).filter(isRecord) : [];
  return {
    fileId: boundedString(file.id, "file id", 1, 256),
    name: boundedField(file.name, 1_024) ?? "",
    mimeType: boundedField(file.mimeType, 256) ?? "",
    ...(typeof file.modifiedTime === "string"
      ? { modifiedTime: boundedField(file.modifiedTime, 64) }
      : {}),
    ...(typeof file.createdTime === "string"
      ? { createdTime: boundedField(file.createdTime, 64) }
      : {}),
    ...(typeof file.size === "string" && /^\d{1,20}$/u.test(file.size)
      ? { sizeBytes: Number(file.size) }
      : {}),
    ...(typeof file.webViewLink === "string" && file.webViewLink.startsWith("https://")
      ? { url: boundedField(file.webViewLink, 2_048) }
      : {}),
    ...(Array.isArray(file.parents)
      ? {
          parentIds: file.parents
            .slice(0, 10)
            .filter((id) => typeof id === "string" && id.length <= 256),
        }
      : {}),
    ...(typeof file.shared === "boolean" ? { shared: file.shared } : {}),
    owners: owners.map((owner) => ({
      ...(typeof owner.displayName === "string"
        ? { name: boundedField(owner.displayName, 256) }
        : {}),
      ...(typeof owner.emailAddress === "string"
        ? { email: boundedField(owner.emailAddress, 320) }
        : {}),
    })),
  };
};

const parseFileList = (value) => {
  if (!isRecord(value)) throw new Error(`${appName} adapter list response invalid`);
  const files = Array.isArray(value.files) ? value.files : [];
  return {
    files: files.slice(0, 100).map(parseFile),
    ...(typeof value.nextPageToken === "string" && value.nextPageToken.length <= 2_048
      ? { nextPageToken: value.nextPageToken }
      : {}),
    ...(value.incompleteSearch === true ? { incompleteSearch: true } : {}),
  };
};

/**
 * Searches Drive with a query built from fixed clauses and escaped literals; Bots never supply
 * raw Drive query syntax.
 */
const searchDrive = (
  request,
  { text, name, mimeType, folderId, modifiedAfter, pageSize, pageToken },
) => {
  const clauses = ["trashed = false"];
  if (mimeType !== undefined) {
    clauses.push(
      mimeType === "image/" ? "mimeType contains 'image/'" : `mimeType = ${driveLiteral(mimeType)}`,
    );
  }
  if (name !== undefined) clauses.push(`name contains ${driveLiteral(name)}`);
  if (text !== undefined) clauses.push(`fullText contains ${driveLiteral(text)}`);
  if (folderId !== undefined) clauses.push(`${driveLiteral(folderId)} in parents`);
  if (modifiedAfter !== undefined) clauses.push(`modifiedTime > ${driveLiteral(modifiedAfter)}`);
  return request({
    origin: driveApiOrigin,
    resource: "/drive/v3/files",
    query: {
      q: clauses.join(" and "),
      pageSize,
      pageToken,
      fields: `nextPageToken,incompleteSearch,files(${fileFields})`,
      // Drive refuses an ordering when the query searches full text.
      orderBy: text === undefined ? "modifiedTime desc" : undefined,
      corpora: "allDrives",
      includeItemsFromAllDrives: true,
      supportsAllDrives: true,
    },
  }).then(parseFileList);
};

const searchInputSchema = {
  type: "object",
  properties: {
    text: { type: "string", minLength: 1, maxLength: 200 },
    name: { type: "string", minLength: 1, maxLength: 200 },
    modifiedAfter: {
      type: "string",
      pattern: "^\\d{4}-\\d{2}-\\d{2}(T\\d{2}:\\d{2}:\\d{2}(\\.\\d{1,3})?Z)?$",
    },
    pageSize: { type: "integer", minimum: 1, maximum: 50 },
    pageToken: { type: "string", minLength: 1, maxLength: 2048 },
  },
  additionalProperties: false,
};

const parseSearchInput = (input, extraKeys = []) => {
  const args = assertExactKeys(input, [
    "text",
    "name",
    "modifiedAfter",
    "pageSize",
    "pageToken",
    ...extraKeys,
  ]);
  const modifiedAfter = optionalString(args.modifiedAfter, "modifiedAfter", 10, 24);
  if (
    modifiedAfter !== undefined &&
    !/^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}:\d{2}(\.\d{1,3})?Z)?$/u.test(modifiedAfter)
  ) {
    throw new Error(`${appName} adapter modifiedAfter invalid`);
  }
  return {
    args,
    search: {
      text: optionalString(args.text, "text", 1, 200),
      name: optionalString(args.name, "name", 1, 200),
      modifiedAfter:
        modifiedAfter === undefined || modifiedAfter.length > 10
          ? modifiedAfter
          : `${modifiedAfter}T00:00:00Z`,
      pageSize: optionalInteger(args.pageSize, "pageSize", 1, 50, 25),
      pageToken: optionalString(args.pageToken, "pageToken", 1, 2_048),
    },
  };
};

const encodeMcpResponse = (value) => {
  const encoded = JSON.stringify(value);
  if (Buffer.byteLength(encoded, "utf8") > maximumOutputBytes + 16_384) {
    throw new Error(`${appName} adapter response exceeded output bound`);
  }
  return `${encoded}\n`;
};

/** MCP over stdio: initialize, tools/list and tools/call, one JSON object per line. */
const startMcpServer = ({ serverName, version, catalog, createHandler }) => {
  const callTool = createHandler({ accessToken: process.env.PLUGIN_ACCESS_TOKEN });
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
      request = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
      assertBoundedJson(request);
      if (!isRecord(request)) throw new Error(`${appName} adapter request invalid`);
      if (!Object.hasOwn(request, "id")) return;
      if (request.method === "initialize") {
        const params = isRecord(request.params) ? request.params : {};
        const protocolVersion = boundedString(params.protocolVersion, "protocol version", 1, 32);
        if (!supportedMcpProtocolVersions.has(protocolVersion)) {
          throw new Error(`${appName} adapter protocol version unsupported`);
        }
        respond(request.id, {
          protocolVersion,
          capabilities: { tools: {} },
          serverInfo: { name: serverName, version },
        });
      } else if (request.method === "tools/list") {
        respond(request.id, { tools: catalog });
      } else if (request.method === "tools/call") {
        const params = assertExactKeys(request.params, ["name", "arguments"], ["name"]);
        const name = boundedString(params.name, "tool name", 1, 160);
        respond(request.id, await callTool(name, params.arguments ?? {}));
      } else {
        throw new Error(`${appName} adapter method unavailable`);
      }
    } catch (error) {
      fail(
        isRecord(request) ? request.id : null,
        error instanceof Error ? error.message : `${appName} adapter failed`,
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
    if (lineExceeded) fail(null, `${appName} adapter request exceeded input bound`);
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

const maximumTextBytes = 196_608;

const optionalBoolean = (value, field, fallback) => {
  if (value === undefined) return fallback;
  if (typeof value !== "boolean") throw new Error(`${appName} adapter ${field} invalid`);
  return value;
};

const docsApiOrigin = "https://docs.googleapis.com";
const maximumWriteTextLength = 100_000;

/** Only the text structure of a document; styles and images are never fetched. */
const documentFields =
  "documentId,title,revisionId,body(content(paragraph(elements(textRun(content)),paragraphStyle(namedStyleType),bullet(nestingLevel)),table(tableRows(tableCells(content(paragraph(elements(textRun(content)))))))))";

/** Exact Google Docs tool catalog: two reading tools and three writing ones. */
export const docsToolCatalog = [
  {
    name: "search_documents",
    description:
      "Search Google Docs by words in the content or the title, or by last change; returns document details, not contents",
    inputSchema: searchInputSchema,
  },
  {
    name: "get_document",
    description:
      "Read one Google Doc by id or link as text, with headings marked by # and lists by -, and tables as rows",
    inputSchema: {
      type: "object",
      properties: { documentId: { type: "string", minLength: 1, maxLength: 2048 } },
      required: ["documentId"],
      additionalProperties: false,
    },
  },
  {
    name: "create_document",
    description: "Create one new Google Doc with a title and, optionally, starting text",
    inputSchema: {
      type: "object",
      properties: {
        title: { type: "string", minLength: 1, maxLength: 255 },
        text: { type: "string", minLength: 1, maxLength: maximumWriteTextLength },
      },
      required: ["title"],
      additionalProperties: false,
    },
  },
  {
    name: "append_text",
    description:
      "Add text at the end of one Google Doc; begin the text with a new line to start a new paragraph",
    inputSchema: {
      type: "object",
      properties: {
        documentId: { type: "string", minLength: 1, maxLength: 2048 },
        text: { type: "string", minLength: 1, maxLength: maximumWriteTextLength },
      },
      required: ["documentId", "text"],
      additionalProperties: false,
    },
  },
  {
    name: "replace_text",
    description:
      "Replace every occurrence of exact text in one Google Doc and report how many changed; an empty replacement removes the text",
    inputSchema: {
      type: "object",
      properties: {
        documentId: { type: "string", minLength: 1, maxLength: 2048 },
        find: { type: "string", minLength: 1, maxLength: 1000 },
        replaceWith: { type: "string", maxLength: 10000 },
        matchCase: { type: "boolean" },
      },
      required: ["documentId", "find", "replaceWith"],
      additionalProperties: false,
    },
  },
];

const headingMarks = {
  TITLE: "# ",
  SUBTITLE: "## ",
  HEADING_1: "# ",
  HEADING_2: "## ",
  HEADING_3: "### ",
  HEADING_4: "#### ",
  HEADING_5: "##### ",
  HEADING_6: "###### ",
};

const paragraphText = (paragraph) =>
  (Array.isArray(paragraph.elements) ? paragraph.elements : [])
    .map((element) =>
      isRecord(element) && isRecord(element.textRun) && typeof element.textRun.content === "string"
        ? element.textRun.content
        : "",
    )
    .join("")
    .replace(/\n$/u, "");

/** A document's structure as plain text with light Markdown marks. */
export const documentToText = (body) => {
  const lines = [];
  for (const element of isRecord(body) && Array.isArray(body.content) ? body.content : []) {
    if (!isRecord(element)) continue;
    if (isRecord(element.paragraph)) {
      const paragraph = element.paragraph;
      const text = paragraphText(paragraph);
      const style = isRecord(paragraph.paragraphStyle)
        ? paragraph.paragraphStyle.namedStyleType
        : "";
      if (isRecord(paragraph.bullet)) {
        const level = Number.isInteger(paragraph.bullet.nestingLevel)
          ? Math.min(paragraph.bullet.nestingLevel, 8)
          : 0;
        lines.push(`${"  ".repeat(level)}- ${text}`);
      } else if (typeof style === "string" && style in headingMarks && text.trim() !== "") {
        lines.push(`${headingMarks[style]}${text}`);
      } else {
        lines.push(text);
      }
    } else if (isRecord(element.table)) {
      for (const row of Array.isArray(element.table.tableRows) ? element.table.tableRows : []) {
        if (!isRecord(row)) continue;
        const cells = (Array.isArray(row.tableCells) ? row.tableCells : []).map((cell) =>
          (isRecord(cell) && Array.isArray(cell.content) ? cell.content : [])
            .map((part) =>
              isRecord(part) && isRecord(part.paragraph) ? paragraphText(part.paragraph) : "",
            )
            .filter((part) => part !== "")
            .join(" ")
            .replaceAll("|", "\\|"),
        );
        lines.push(`| ${cells.join(" | ")} |`);
      }
    }
  }
  return lines
    .join("\n")
    .replace(/\n{3,}/gu, "\n\n")
    .trim();
};

const documentUrl = (documentId) => `https://docs.google.com/document/d/${documentId}/edit`;

/** Create the Google Docs handler around an injected transport and actor-owned access token. */
export const createDocsToolHandler = ({ accessToken, fetch: fetchImplementation = fetch }) => {
  const request = makeGoogleRequest({
    credential: makeRedactedAccessToken(accessToken),
    fetch: fetchImplementation,
  });

  const batchUpdate = (documentId, requests) =>
    request({
      origin: docsApiOrigin,
      resource: `/v1/documents/${encodeURIComponent(documentId)}:batchUpdate`,
      method: "POST",
      json: { requests },
    });

  return async (name, input) => {
    assertBoundedJson(input);
    if (name === "search_documents") {
      const { search } = parseSearchInput(input);
      return searchDrive(request, { ...search, mimeType: googleMimeTypes.document });
    }
    if (name === "get_document") {
      const args = assertExactKeys(input, ["documentId"], ["documentId"]);
      const documentId = parseGoogleFileId(args.documentId, "document id");
      const document = await request({
        origin: docsApiOrigin,
        resource: `/v1/documents/${encodeURIComponent(documentId)}`,
        query: { fields: documentFields },
      });
      if (!isRecord(document)) throw new Error("Google Docs adapter document response invalid");
      const text = truncateText(documentToText(document.body), maximumTextBytes);
      return {
        documentId: boundedString(document.documentId, "document id", 1, 256),
        title: boundedField(document.title, 1_024) ?? "",
        ...(typeof document.revisionId === "string"
          ? { revisionId: boundedField(document.revisionId, 256) }
          : {}),
        url: documentUrl(documentId),
        text: text.value,
        truncated: text.truncated,
        contentTrust: "untrusted-file-content",
      };
    }
    if (name === "create_document") {
      const args = assertExactKeys(input, ["title", "text"], ["title"]);
      const title = boundedString(args.title, "title", 1, 255);
      const text = optionalString(args.text, "text", 1, maximumWriteTextLength);
      const created = await request({
        origin: docsApiOrigin,
        resource: "/v1/documents",
        method: "POST",
        json: { title },
      });
      if (!isRecord(created)) throw new Error("Google Docs adapter create response invalid");
      const documentId = boundedString(created.documentId, "document id", 1, 256);
      const result = { documentId, title, url: documentUrl(documentId) };
      if (text === undefined) return result;
      try {
        await batchUpdate(documentId, [{ insertText: { text, location: { index: 1 } } }]);
      } catch (error) {
        // The document exists either way; say so rather than inviting a second one.
        return {
          ...result,
          textAdded: false,
          note: `The document was created, but adding its text failed: ${error instanceof Error ? error.message : "unknown"}. Use append_text on this document instead of creating another.`,
        };
      }
      return { ...result, textAdded: true };
    }
    if (name === "append_text") {
      const args = assertExactKeys(input, ["documentId", "text"], ["documentId", "text"]);
      const documentId = parseGoogleFileId(args.documentId, "document id");
      await batchUpdate(documentId, [
        {
          insertText: {
            text: boundedString(args.text, "text", 1, maximumWriteTextLength),
            endOfSegmentLocation: {},
          },
        },
      ]);
      return { documentId, appended: true, url: documentUrl(documentId) };
    }
    if (name === "replace_text") {
      const args = assertExactKeys(
        input,
        ["documentId", "find", "replaceWith", "matchCase"],
        ["documentId", "find", "replaceWith"],
      );
      const documentId = parseGoogleFileId(args.documentId, "document id");
      const value = await batchUpdate(documentId, [
        {
          replaceAllText: {
            containsText: {
              text: boundedString(args.find, "find", 1, 1_000),
              matchCase: optionalBoolean(args.matchCase, "matchCase", true),
            },
            replaceText: boundedString(args.replaceWith, "replaceWith", 0, 10_000),
          },
        },
      ]);
      const reply =
        isRecord(value) && Array.isArray(value.replies) && isRecord(value.replies[0])
          ? value.replies[0].replaceAllText
          : undefined;
      const occurrencesChanged =
        isRecord(reply) && Number.isSafeInteger(reply.occurrencesChanged)
          ? reply.occurrencesChanged
          : 0;
      return { documentId, occurrencesChanged, url: documentUrl(documentId) };
    }
    throw new Error("Google Docs adapter tool unavailable");
  };
};

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  startMcpServer({
    serverName: "supernala-google-docs",
    version: "1.0.0",
    catalog: docsToolCatalog,
    createHandler: createDocsToolHandler,
  });
}
