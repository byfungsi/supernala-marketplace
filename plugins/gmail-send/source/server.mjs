// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Supernala contributors

import { pathToFileURL } from "node:url";

const maximumInputLineBytes = 131_072;
const maximumResponseBytes = 16_384;
const maximumOutputBytes = 16_384;
const maximumBodyBytes = 65_536;
const supportedVersions = new Set(["2025-03-26", "2025-06-18"]);
const mailboxPattern =
  /^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)+$/u;

/** Send-only Gmail tool catalog; a separate OAuth connection is required. */
export const gmailSendToolCatalog = [
  {
    name: "send_message",
    description:
      "Send one plain-text email from the connected Gmail account; failed dispatch may be ambiguous",
    inputSchema: {
      type: "object",
      properties: {
        from: { type: "string", minLength: 3, maxLength: 254 },
        to: { type: "string", minLength: 3, maxLength: 254 },
        subject: { type: "string", minLength: 1, maxLength: 998 },
        bodyText: { type: "string", minLength: 1, maxLength: maximumBodyBytes },
      },
      required: ["from", "to", "subject", "bodyText"],
      additionalProperties: false,
    },
  },
];

const isRecord = (value) => typeof value === "object" && value !== null && !Array.isArray(value);

const parseSendInput = (value) => {
  if (
    !isRecord(value) ||
    Object.keys(value).some((key) => !["from", "to", "subject", "bodyText"].includes(key))
  ) {
    throw new Error("Gmail send arguments invalid");
  }
  const { from, to, subject, bodyText } = value;
  if (typeof from !== "string" || from.length > 254 || !mailboxPattern.test(from)) {
    throw new Error("Gmail send sender invalid");
  }
  if (typeof to !== "string" || to.length > 254 || !mailboxPattern.test(to)) {
    throw new Error("Gmail send recipient invalid");
  }
  if (typeof subject !== "string" || subject.length < 1 || subject.length > 998) {
    throw new Error("Gmail send subject invalid");
  }
  for (const character of subject) {
    if (character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127) {
      throw new Error("Gmail send subject invalid");
    }
  }
  if (
    typeof bodyText !== "string" ||
    bodyText.length < 1 ||
    Buffer.byteLength(bodyText, "utf8") > maximumBodyBytes ||
    bodyText.includes(String.fromCharCode(0))
  ) {
    throw new Error("Gmail send body invalid");
  }
  return { from, to, subject, bodyText };
};

const foldBase64 = (value) => value.match(/.{1,76}/gu)?.join("\r\n") ?? "";

/** Construct bounded, header-safe MIME with no attachments or active HTML. */
export const encodeGmailSendMime = (input) => {
  const { from, to, subject, bodyText } = parseSendInput(input);
  const subjectWords = [];
  let word = "";
  for (const character of subject) {
    if (Buffer.byteLength(word + character, "utf8") > 36) {
      subjectWords.push(word);
      word = "";
    }
    word += character;
  }
  if (word) subjectWords.push(word);
  const encodedWords = subjectWords
    .map((chunk) => `=?UTF-8?B?${Buffer.from(chunk, "utf8").toString("base64")}?=`)
    .join("\r\n ");
  const normalizedBody = bodyText.replace(/\r\n|\r|\n/gu, "\r\n");
  const body = foldBase64(Buffer.from(normalizedBody, "utf8").toString("base64"));
  const mime = `From: ${from}\r\nTo: ${to}\r\nSubject: ${encodedWords}\r\nMIME-Version: 1.0\r\nContent-Type: text/plain; charset=UTF-8\r\nContent-Transfer-Encoding: base64\r\n\r\n${body}\r\n`;
  if (Buffer.byteLength(mime, "utf8") > 100_000) throw new Error("Gmail send MIME bound exceeded");
  return Buffer.from(mime, "utf8").toString("base64url");
};

const readBoundedJson = async (response) => {
  const length = response.headers.get("Content-Length");
  if (
    length !== null &&
    (!Number.isSafeInteger(Number(length)) ||
      Number(length) > maximumResponseBytes ||
      Number(length) < 0)
  ) {
    throw new Error("Gmail send response bound exceeded");
  }
  if (response.body === null) throw new Error("Gmail send response unavailable");
  const reader = response.body.getReader();
  const chunks = [];
  let total = 0;
  while (true) {
    const next = await reader.read();
    if (next.done) break;
    total += next.value.byteLength;
    if (total > maximumResponseBytes) {
      await reader.cancel();
      throw new Error("Gmail send response bound exceeded");
    }
    chunks.push(next.value);
  }
  let value;
  try {
    value = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks)));
  } catch {
    throw new Error("Gmail send response JSON invalid");
  }
  if (
    !isRecord(value) ||
    typeof value.id !== "string" ||
    !/^[A-Za-z0-9_-]{1,256}$/u.test(value.id)
  ) {
    throw new Error("Gmail send message identity invalid");
  }
  return { messageId: value.id };
};

/** Send exactly one Gmail API request; ambiguous outcomes are never retried. */
export const createGmailSendToolHandler =
  ({ accessToken, fetch: fetchImplementation = fetch }) =>
  async (name, input) => {
    if (name !== "send_message") throw new Error("Gmail send tool unavailable");
    const raw = encodeGmailSendMime(input);
    if (typeof accessToken !== "string" || accessToken.length === 0)
      throw new Error("Gmail send credential unavailable");
    let response;
    try {
      response = await fetchImplementation(
        "https://gmail.googleapis.com/gmail/v1/users/me/messages/send",
        {
          method: "POST",
          redirect: "error",
          signal: AbortSignal.timeout(15_000),
          headers: {
            Accept: "application/json",
            "Content-Type": "application/json",
            Authorization: `Bearer ${accessToken}`,
          },
          body: JSON.stringify({ raw }),
        },
      );
    } catch {
      throw new Error("Gmail send outcome ambiguous; do not retry automatically");
    }
    if (!response.ok)
      throw new Error("Gmail send provider rejected request; do not retry automatically");
    try {
      return await readBoundedJson(response);
    } catch {
      throw new Error("Gmail send outcome ambiguous; do not retry automatically");
    }
  };

const startGmailSendMcpServer = () => {
  const callTool = createGmailSendToolHandler({ accessToken: process.env.PLUGIN_ACCESS_TOKEN });
  const writeResponse = (value) => {
    const encoded = JSON.stringify(value);
    if (Buffer.byteLength(encoded, "utf8") > maximumOutputBytes)
      throw new Error("Gmail send output bound exceeded");
    process.stdout.write(`${encoded}\n`);
  };
  const respond = (id, result) => writeResponse({ jsonrpc: "2.0", id, result });
  const fail = (id, message) =>
    writeResponse({ jsonrpc: "2.0", id, error: { code: -32000, message } });
  const handleLine = async (bytes) => {
    let request;
    try {
      try {
        request = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
      } catch {
        throw new Error("Gmail send request JSON invalid");
      }
      if (!isRecord(request)) throw new Error("Gmail send request invalid");
      if (!Object.hasOwn(request, "id")) return;
      if (
        typeof request.id !== "string" &&
        (!Number.isSafeInteger(request.id) || typeof request.id !== "number")
      )
        throw new Error("Gmail send request id invalid");
      if (typeof request.id === "string" && Buffer.byteLength(request.id, "utf8") > 128)
        throw new Error("Gmail send request id invalid");
      if (request.method === "initialize") {
        const version = request.params?.protocolVersion;
        if (!supportedVersions.has(version))
          throw new Error("Gmail send protocol version unsupported");
        respond(request.id, {
          protocolVersion: version,
          capabilities: { tools: {} },
          serverInfo: { name: "supernala-gmail-send", version: "0.1.0" },
        });
      } else if (request.method === "tools/list") {
        respond(request.id, { tools: gmailSendToolCatalog });
      } else if (request.method === "tools/call") {
        if (!isRecord(request.params) || typeof request.params.name !== "string")
          throw new Error("Gmail send call invalid");
        respond(request.id, await callTool(request.params.name, request.params.arguments ?? {}));
      } else throw new Error("Gmail send method unavailable");
    } catch (error) {
      fail(
        isRecord(request) &&
          ((typeof request.id === "string" && Buffer.byteLength(request.id, "utf8") <= 128) ||
            (typeof request.id === "number" && Number.isSafeInteger(request.id)))
          ? request.id
          : null,
        error instanceof Error && error.message.startsWith("Gmail send ")
          ? error.message
          : "Gmail send failed",
      );
    }
  };
  let pending = [];
  let exceeded = false;
  let requests = Promise.resolve();
  process.stdin.on("data", (input) => {
    for (const byte of input) {
      if (byte === 10) {
        if (exceeded) fail(null, "Gmail send request exceeded input bound");
        else {
          const bytes = Buffer.from(pending);
          requests = requests.then(() =>
            handleLine(bytes.at(-1) === 13 ? bytes.subarray(0, -1) : bytes),
          );
        }
        pending = [];
        exceeded = false;
      } else if (!exceeded) {
        if (pending.length === maximumInputLineBytes) {
          pending = [];
          exceeded = true;
        } else pending.push(byte);
      }
    }
  });
  process.stdin.on("end", () => {
    if (pending.length || exceeded) {
      if (exceeded) fail(null, "Gmail send request exceeded input bound");
      else requests = requests.then(() => handleLine(Buffer.from(pending)));
    }
  });
};

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href)
  startGmailSendMcpServer();
