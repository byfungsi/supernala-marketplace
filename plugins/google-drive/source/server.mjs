// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Supernala contributors

import { pathToFileURL } from "node:url";

const appName = "Google Drive";
const apiLabel = "The Google Drive API";

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

const oneOf = (value, field, allowed, fallback) => {
  if (value === undefined) return fallback;
  if (!allowed.includes(value)) throw new Error(`${appName} adapter ${field} invalid`);
  return value;
};

const driveUploadOrigin = "https://www.googleapis.com";
const maximumReadSourceBytes = 2_097_152;
const maximumCreateBytes = 1_048_576;

/** Google file types exported as text, and the format each becomes. */
const exportFormats = new Map([
  ["application/vnd.google-apps.document", "text/plain"],
  ["application/vnd.google-apps.spreadsheet", "text/csv"],
  ["application/vnd.google-apps.presentation", "text/plain"],
]);

const textMimeTypes = new Set([
  "application/json",
  "application/xml",
  "application/javascript",
  "application/x-yaml",
  "application/yaml",
]);

const kinds = ["document", "spreadsheet", "presentation", "folder", "pdf", "image"];

/** Exact Google Drive tool catalog: four reading tools and two creating ones. */
export const driveToolCatalog = [
  {
    name: "search_files",
    description:
      "Search Google Drive by words in the content, words in the name, type, folder or last change; returns file details, not contents",
    inputSchema: {
      ...searchInputSchema,
      properties: {
        ...searchInputSchema.properties,
        kind: { type: "string", enum: kinds },
        folderId: { type: "string", minLength: 1, maxLength: 2048 },
      },
    },
  },
  {
    name: "list_folder",
    description:
      "List what one Google Drive folder contains, folders first; My Drive when no folder is given",
    inputSchema: {
      type: "object",
      properties: {
        folderId: { type: "string", minLength: 1, maxLength: 2048 },
        pageSize: { type: "integer", minimum: 1, maximum: 100 },
        pageToken: { type: "string", minLength: 1, maxLength: 2048 },
      },
      additionalProperties: false,
    },
  },
  {
    name: "get_file",
    description:
      "Get one Google Drive file's details by id or link: name, type, owners, size, dates and link",
    inputSchema: {
      type: "object",
      properties: { fileId: { type: "string", minLength: 1, maxLength: 2048 } },
      required: ["fileId"],
      additionalProperties: false,
    },
  },
  {
    name: "read_file",
    description:
      "Read one Google Drive file as text: Google Docs and Slides as plain text, Google Sheets as CSV of the first sheet, and text files as they are; other files report that they cannot be read as text",
    inputSchema: {
      type: "object",
      properties: { fileId: { type: "string", minLength: 1, maxLength: 2048 } },
      required: ["fileId"],
      additionalProperties: false,
    },
  },
  {
    name: "create_text_file",
    description:
      "Create one new file in Google Drive from text, optionally converted to a Google Doc (plain text or Markdown) or a Google Sheet (CSV); never changes existing files",
    inputSchema: {
      type: "object",
      properties: {
        name: { type: "string", minLength: 1, maxLength: 255 },
        content: { type: "string", maxLength: 100000 },
        format: { type: "string", enum: ["text", "markdown", "csv", "json"] },
        convertTo: { type: "string", enum: ["document", "spreadsheet"] },
        folderId: { type: "string", minLength: 1, maxLength: 2048 },
      },
      required: ["name", "content"],
      additionalProperties: false,
    },
  },
  {
    name: "create_folder",
    description: "Create one new folder in Google Drive, inside another folder or in My Drive",
    inputSchema: {
      type: "object",
      properties: {
        name: { type: "string", minLength: 1, maxLength: 255 },
        parentId: { type: "string", minLength: 1, maxLength: 2048 },
      },
      required: ["name"],
      additionalProperties: false,
    },
  },
];

const formatMimeTypes = {
  text: "text/plain",
  markdown: "text/markdown",
  csv: "text/csv",
  json: "application/json",
};

/** Multipart body for one Drive upload: JSON metadata, then the text. */
const multipartBody = (metadata, mimeType, content) => {
  const boundary = `supernala-${globalThis.crypto.randomUUID()}`;
  return {
    boundary,
    body: [
      `--${boundary}`,
      "Content-Type: application/json; charset=UTF-8",
      "",
      JSON.stringify(metadata),
      `--${boundary}`,
      `Content-Type: ${mimeType}; charset=UTF-8`,
      "",
      content,
      `--${boundary}--`,
      "",
    ].join("\r\n"),
  };
};

/** Create the Google Drive handler around an injected transport and actor-owned access token. */
export const createDriveToolHandler = ({ accessToken, fetch: fetchImplementation = fetch }) => {
  const request = makeGoogleRequest({
    credential: makeRedactedAccessToken(accessToken),
    fetch: fetchImplementation,
  });

  const getFile = (fileId) =>
    request({
      origin: driveApiOrigin,
      resource: `/drive/v3/files/${encodeURIComponent(fileId)}`,
      query: { fields: fileFields, supportsAllDrives: true },
    }).then(parseFile);

  const readFile = async (fileId) => {
    const file = await getFile(fileId);
    const exportFormat = exportFormats.get(file.mimeType);
    const readable =
      exportFormat !== undefined ||
      file.mimeType.startsWith("text/") ||
      textMimeTypes.has(file.mimeType);
    if (!readable) {
      return {
        file,
        readable: false,
        reason: "Only Google Docs, Sheets, Slides and text files can be read as text",
      };
    }
    if (exportFormat === undefined && (file.sizeBytes ?? 0) > maximumReadSourceBytes) {
      return { file, readable: false, reason: "The file is larger than 2 MB" };
    }
    const text = await request(
      exportFormat === undefined
        ? {
            origin: driveApiOrigin,
            resource: `/drive/v3/files/${encodeURIComponent(fileId)}`,
            query: { alt: "media", supportsAllDrives: true },
            as: "text",
          }
        : {
            origin: driveApiOrigin,
            resource: `/drive/v3/files/${encodeURIComponent(fileId)}/export`,
            query: { mimeType: exportFormat },
            as: "text",
          },
    );
    const bounded = truncateText(text, maximumTextBytes);
    return {
      file,
      readable: true,
      format: exportFormat ?? file.mimeType,
      text: bounded.value,
      truncated: bounded.truncated,
      contentTrust: "untrusted-file-content",
    };
  };

  const createTextFile = async (input) => {
    const args = assertExactKeys(
      input,
      ["name", "content", "format", "convertTo", "folderId"],
      ["name", "content"],
    );
    const name = boundedString(args.name, "name", 1, 255);
    const content = boundedString(args.content, "content", 0, 100_000);
    if (Buffer.byteLength(content, "utf8") > maximumCreateBytes) {
      throw new Error("Google Drive adapter content exceeds 1 MB");
    }
    const format = oneOf(args.format, "format", Object.keys(formatMimeTypes), "text");
    const convertTo = oneOf(args.convertTo, "convertTo", ["document", "spreadsheet"], undefined);
    if (convertTo === "spreadsheet" && format !== "csv") {
      throw new Error("Google Drive adapter converts only CSV to a Google Sheet");
    }
    if (convertTo === "document" && format !== "text" && format !== "markdown") {
      throw new Error("Google Drive adapter converts only text or Markdown to a Google Doc");
    }
    const folderId =
      args.folderId === undefined ? undefined : parseGoogleFileId(args.folderId, "folder id");
    const metadata = {
      name,
      ...(convertTo === undefined ? {} : { mimeType: googleMimeTypes[convertTo] }),
      ...(folderId === undefined ? {} : { parents: [folderId] }),
    };
    const { boundary, body } = multipartBody(metadata, formatMimeTypes[format], content);
    const created = await request({
      origin: driveUploadOrigin,
      resource: "/upload/drive/v3/files",
      query: { uploadType: "multipart", supportsAllDrives: true, fields: fileFields },
      method: "POST",
      body,
      contentType: `multipart/related; boundary=${boundary}`,
    });
    return { created: parseFile(created) };
  };

  const createFolder = async (input) => {
    const args = assertExactKeys(input, ["name", "parentId"], ["name"]);
    const parentId =
      args.parentId === undefined ? undefined : parseGoogleFileId(args.parentId, "parent id");
    const created = await request({
      origin: driveApiOrigin,
      resource: "/drive/v3/files",
      query: { supportsAllDrives: true, fields: fileFields },
      method: "POST",
      json: {
        name: boundedString(args.name, "name", 1, 255),
        mimeType: googleMimeTypes.folder,
        ...(parentId === undefined ? {} : { parents: [parentId] }),
      },
    });
    return { created: parseFile(created) };
  };

  return async (name, input) => {
    assertBoundedJson(input);
    if (name === "search_files") {
      const { args, search } = parseSearchInput(input, ["kind", "folderId"]);
      const kind = oneOf(args.kind, "kind", kinds, undefined);
      return searchDrive(request, {
        ...search,
        mimeType:
          kind === undefined ? undefined : kind === "image" ? "image/" : googleMimeTypes[kind],
        folderId:
          args.folderId === undefined ? undefined : parseGoogleFileId(args.folderId, "folder id"),
      });
    }
    if (name === "list_folder") {
      const args = assertExactKeys(input, ["folderId", "pageSize", "pageToken"]);
      const folderId =
        args.folderId === undefined ? "root" : parseGoogleFileId(args.folderId, "folder id");
      return request({
        origin: driveApiOrigin,
        resource: "/drive/v3/files",
        query: {
          q: `${driveLiteral(folderId)} in parents and trashed = false`,
          pageSize: optionalInteger(args.pageSize, "pageSize", 1, 100, 50),
          pageToken: optionalString(args.pageToken, "pageToken", 1, 2_048),
          orderBy: "folder,name",
          fields: `nextPageToken,files(${fileFields})`,
          includeItemsFromAllDrives: true,
          supportsAllDrives: true,
        },
      }).then(parseFileList);
    }
    if (name === "get_file") {
      const args = assertExactKeys(input, ["fileId"], ["fileId"]);
      return { file: await getFile(parseGoogleFileId(args.fileId)) };
    }
    if (name === "read_file") {
      const args = assertExactKeys(input, ["fileId"], ["fileId"]);
      return readFile(parseGoogleFileId(args.fileId));
    }
    if (name === "create_text_file") return createTextFile(input);
    if (name === "create_folder") return createFolder(input);
    throw new Error("Google Drive adapter tool unavailable");
  };
};

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  startMcpServer({
    serverName: "supernala-google-drive",
    version: "1.0.0",
    catalog: driveToolCatalog,
    createHandler: createDriveToolHandler,
  });
}
