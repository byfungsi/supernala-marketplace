import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import { expect, it } from "@effect/vitest";
import { Schema } from "effect";
import {
  createGmailToolHandler,
  gmailToolCatalog,
  parseGmailMessage,
} from "../plugins/gmail/source/server.mjs";
import { PackageCatalog, PackagedPluginLicenseEvidence } from "./package-archive.js";
import { digestPluginBytes, PluginSha256 } from "./plugin-contract.js";

const GmailBuildRecipe = Schema.Struct({
  license: Schema.Literal("MIT"),
  licenseFile: Schema.Literal("plugins/gmail/LICENSE"),
  noticeFile: Schema.Literal("plugins/gmail/NOTICE"),
  preservedThirdPartyNotices: Schema.Array(Schema.String),
  packageFiles: Schema.Array(
    Schema.Struct({
      source: Schema.NonEmptyString,
      destination: Schema.NonEmptyString,
      sha256: PluginSha256,
    }),
  ),
});

const jsonResponse = (value: unknown): Response =>
  new Response(JSON.stringify(value), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });

const makeRecordingFetch = (
  responses: ReadonlyArray<unknown>,
): {
  readonly fetch: typeof fetch;
  readonly requests: Array<{
    readonly url: string;
    readonly method: string | undefined;
    readonly authorization: string | null;
  }>;
} => {
  const requests: Array<{
    readonly url: string;
    readonly method: string | undefined;
    readonly authorization: string | null;
  }> = [];
  const remaining = [...responses];
  const fetchImplementation: typeof fetch = async (input, init) => {
    const url = input instanceof Request ? input.url : input.toString();
    const headers = new Headers(init?.headers);
    requests.push({ url, method: init?.method, authorization: headers.get("Authorization") });
    const response = remaining.shift();
    if (response === undefined) return new Response(null, { status: 500 });
    return jsonResponse(response);
  };
  return { fetch: fetchImplementation, requests };
};

const encodeBody = (value: string): string => Buffer.from(value).toString("base64url");

it("declares only the four reviewed read tools and sole readonly OAuth scope", async () => {
  expect(gmailToolCatalog.map((tool) => tool.name)).toEqual([
    "search_messages",
    "get_message",
    "list_drafts",
    "get_draft",
  ]);
  expect(gmailToolCatalog.map((tool) => tool.name)).not.toContain("send_message");

  const catalog = Schema.decodeUnknownSync(PackageCatalog, { onExcessProperty: "error" })(
    JSON.parse(await readFile("plugins/gmail/catalog.json", "utf8")),
  );
  expect(catalog.tools).toHaveLength(4);
  expect(
    catalog.tools.every(
      (tool) => tool.classification === "read" && tool.defaultPolicy === "require-approval",
    ),
  ).toBe(true);
  expect(gmailToolCatalog).toEqual(
    catalog.tools.map((tool) => ({
      name: tool.mcpName,
      description: tool.description,
      inputSchema: tool.inputSchema,
    })),
  );
});

it("searches and lists bounded identities without hidden message-body requests", async () => {
  const messages = Array.from({ length: 30 }, (_, index) => ({
    id: `message-${index}`,
    threadId: `thread-${index}`,
  }));
  const transport = makeRecordingFetch([
    { messages, nextPageToken: "next-message-page", resultSizeEstimate: 30 },
    {
      drafts: [{ id: "draft-1", message: { id: "draft-message-1", threadId: "thread-1" } }],
      nextPageToken: "next-draft-page",
    },
  ]);
  const callTool = createGmailToolHandler({
    accessToken: "test-token",
    fetch: transport.fetch,
  });

  await expect(
    callTool("search_messages", { query: "from:example@example.test", maxResults: 25 }),
  ).resolves.toMatchObject({
    messages: expect.arrayContaining([{ messageId: "message-0", threadId: "thread-0" }]),
    nextPageToken: "next-message-page",
    truncation: { messages: true, nextPageToken: false },
  });
  await expect(callTool("list_drafts", { maxResults: 10 })).resolves.toMatchObject({
    drafts: [{ draftId: "draft-1", messageId: "draft-message-1", threadId: "thread-1" }],
    nextPageToken: "next-draft-page",
  });

  expect(transport.requests).toHaveLength(2);
  expect(transport.requests.every((request) => request.method === "GET")).toBe(true);
  expect(transport.requests[0]?.url).toContain("/gmail/v1/users/me/messages?");
  expect(transport.requests[0]?.url).toContain("maxResults=25");
  expect(transport.requests[0]?.authorization).toBe("Bearer test-token");
  expect(transport.requests[1]?.url).toContain("/gmail/v1/users/me/drafts?");
});

it("normalizes message and draft MIME into bounded inert text and attachment metadata", async () => {
  const message = {
    id: "message-1",
    threadId: "thread-1",
    snippet: "A short snippet",
    labelIds: ["INBOX"],
    payload: {
      mimeType: "multipart/mixed",
      headers: [
        { name: "From", value: "sender@example.test" },
        { name: "To", value: "owner@example.test" },
        { name: "Subject", value: "Synthetic subject" },
      ],
      parts: [
        {
          mimeType: "text/html",
          body: {
            data: encodeBody(
              "<style>.secret{display:none}</style><p>Hello &amp; welcome</p><script>ignore()</script>",
            ),
          },
        },
        {
          mimeType: "application/pdf",
          filename: "report.pdf",
          body: { attachmentId: "attachment-1", size: 1234 },
        },
      ],
    },
  };
  const transport = makeRecordingFetch([message, { id: "draft-1", message }]);
  const callTool = createGmailToolHandler({
    accessToken: "test-token",
    fetch: transport.fetch,
  });

  await expect(callTool("get_message", { messageId: "message-1" })).resolves.toMatchObject({
    messageId: "message-1",
    headers: { from: "sender@example.test", subject: "Synthetic subject" },
    bodyText: "Hello & welcome",
    attachments: [
      {
        attachmentId: "attachment-1",
        filename: "report.pdf",
        mediaType: "application/pdf",
        sizeBytes: 1234,
      },
    ],
    contentTrust: "untrusted-email-content",
    truncation: { body: false, attachments: false },
  });
  await expect(callTool("get_draft", { draftId: "draft-1" })).resolves.toMatchObject({
    draftId: "draft-1",
    messageId: "message-1",
    bodyText: "Hello & welcome",
  });
  expect(transport.requests[0]?.url).toBe(
    "https://gmail.googleapis.com/gmail/v1/users/me/messages/message-1?format=full",
  );
  expect(transport.requests[1]?.url).toBe(
    "https://gmail.googleapis.com/gmail/v1/users/me/drafts/draft-1?format=full",
  );
  expect(JSON.stringify(parseGmailMessage(message))).not.toContain("ignore()");
});

it("removes oversized HTML tags and never fetches remote message content", async () => {
  const remoteImage = `https://remote-content.example.test/${"x".repeat(3_000)}`;
  const message = {
    id: "message-html",
    threadId: "thread-html",
    payload: {
      mimeType: "text/html",
      body: {
        data: encodeBody(`<p>Before</p><img src="${remoteImage}"><p>After &lt;safe&gt;</p>`),
      },
    },
  };
  const transport = makeRecordingFetch([message]);
  const callTool = createGmailToolHandler({ accessToken: "test-token", fetch: transport.fetch });
  const result = Schema.decodeUnknownSync(Schema.JsonObject)(
    await callTool("get_message", { messageId: "message-html" }),
  );
  expect(result.bodyText).toBe("Before\nAfter ‹safe›");
  expect(JSON.stringify(result)).not.toContain("<img");
  expect(transport.requests).toHaveLength(1);
  expect(transport.requests[0]?.url).toContain("gmail.googleapis.com");
});

it("keeps nested attached-message and text attachment bodies out of the main body", () => {
  const attachedMessageBody = "SYNTHETIC_ATTACHMENT_BODY_MUST_NOT_APPEAR";
  const attachedTextBody = "SYNTHETIC_TEXT_ATTACHMENT_BODY_MUST_NOT_APPEAR";
  const result = parseGmailMessage({
    id: "fixture-message",
    threadId: "fixture-thread",
    payload: {
      mimeType: "multipart/mixed",
      parts: [
        {
          mimeType: "text/plain",
          body: { data: encodeBody("Visible outer text") },
        },
        {
          mimeType: "message/rfc822",
          filename: "forwarded.eml",
          body: { attachmentId: "fixture-attached-message", size: 12 },
          parts: [
            {
              mimeType: "text/plain",
              body: { data: encodeBody(attachedMessageBody) },
            },
          ],
        },
        {
          mimeType: "text/plain",
          filename: "notes.txt",
          body: { data: encodeBody(attachedTextBody), size: 42 },
        },
      ],
    },
  });

  expect(result.bodyText).toBe("Visible outer text");
  expect(result.attachments).toEqual([
    {
      attachmentId: "fixture-attached-message",
      filename: "forwarded.eml",
      mediaType: "message/rfc822",
      sizeBytes: 12,
    },
    {
      filename: "notes.txt",
      mediaType: "text/plain",
      sizeBytes: 42,
    },
  ]);
  expect(JSON.stringify(result)).not.toContain(attachedMessageBody);
  expect(JSON.stringify(result)).not.toContain(attachedTextBody);
  expect(JSON.stringify(result)).not.toContain(encodeBody(attachedTextBody));
});

it("reports body truncation and rejects excess arguments before transport", async () => {
  const normalized = Schema.decodeUnknownSync(Schema.JsonObject)(
    parseGmailMessage({
      id: "message-1",
      threadId: "thread-1",
      payload: { mimeType: "text/plain", body: { data: encodeBody("x".repeat(140_000)) } },
    }),
  );
  expect(typeof normalized.bodyText === "string" && normalized.bodyText.length).toBe(131_072);
  expect(normalized.truncation).toMatchObject({ body: true });

  const transport = makeRecordingFetch([]);
  const callTool = createGmailToolHandler({
    accessToken: "test-token",
    fetch: transport.fetch,
  });
  await expect(
    callTool("search_messages", { query: "in:inbox", hiddenBodyRead: true }),
  ).rejects.toThrow("Gmail adapter arguments contain an excess field");
  await expect(callTool("get_message", { messageId: "" })).rejects.toThrow(
    "Gmail adapter message id invalid",
  );
  expect(transport.requests).toHaveLength(0);
});

it("stops reading an oversized provider response at the transport bound", async () => {
  const fetchImplementation: typeof fetch = async () =>
    new Response("x".repeat(1_048_577), { status: 200 });
  const callTool = createGmailToolHandler({
    accessToken: "test-token",
    fetch: fetchImplementation,
  });
  await expect(callTool("get_message", { messageId: "message-1" })).rejects.toThrow(
    "Gmail adapter response exceeded transport bound",
  );
});

it("rejects an oversized MCP line before accepting the next bounded request", async () => {
  const child = spawn(process.execPath, ["plugins/gmail/source/server.mjs"], {
    cwd: process.cwd(),
    env: {},
    stdio: ["pipe", "pipe", "pipe"],
  });
  const outputChunks: Array<Buffer> = [];
  child.stdout.on("data", (chunk) => outputChunks.push(Buffer.from(chunk)));
  const completed = new Promise<number | null>((resolve, reject) => {
    child.once("error", reject);
    child.once("close", resolve);
  });
  child.stdin.end(
    `${"x".repeat(131_073)}\n${JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/list" })}\n`,
  );
  await expect(completed).resolves.toBe(0);
  const responses = Buffer.concat(outputChunks)
    .toString("utf8")
    .trim()
    .split("\n")
    .map((line) => Schema.decodeUnknownSync(Schema.JsonObject)(JSON.parse(line)));
  expect(responses).toHaveLength(2);
  expect(responses[0]).toMatchObject({
    id: null,
    error: { message: "Gmail adapter request exceeded input bound" },
  });
  expect(responses[1]).toMatchObject({ id: 2, result: { tools: expect.any(Array) } });
});

it("completes the Host stdio handshake without responding to notifications", async () => {
  const child = spawn(process.execPath, ["plugins/gmail/source/server.mjs"], {
    cwd: process.cwd(),
    env: {},
    stdio: ["pipe", "pipe", "pipe"],
  });
  const outputChunks: Array<Buffer> = [];
  child.stdout.on("data", (chunk) => outputChunks.push(Buffer.from(chunk)));
  const completed = new Promise<number | null>((resolve, reject) => {
    child.once("error", reject);
    child.once("close", resolve);
  });
  const requests = [
    {
      jsonrpc: "2.0",
      id: "initialize",
      method: "initialize",
      params: {
        protocolVersion: "2025-06-18",
        capabilities: {},
        clientInfo: { name: "fixture-host", version: "1.0.0" },
      },
    },
    { jsonrpc: "2.0", method: "notifications/initialized" },
    { jsonrpc: "2.0", id: "catalog", method: "tools/list", params: {} },
    {
      jsonrpc: "2.0",
      id: "invocation",
      method: "tools/call",
      params: { name: "search_messages", arguments: { query: "" } },
    },
  ];
  child.stdin.end(`${requests.map((request) => JSON.stringify(request)).join("\n")}\n`);

  await expect(completed).resolves.toBe(0);
  const responses = Buffer.concat(outputChunks)
    .toString("utf8")
    .trim()
    .split("\n")
    .map((line) => Schema.decodeUnknownSync(Schema.JsonObject)(JSON.parse(line)));
  expect(responses).toHaveLength(3);
  expect(responses.map((response) => response.id)).toEqual(["initialize", "catalog", "invocation"]);
  expect(responses[0]).toMatchObject({
    result: { protocolVersion: "2025-06-18", capabilities: { tools: {} } },
  });
  expect(responses[1]).toMatchObject({ result: { tools: gmailToolCatalog } });
  expect(responses[2]).toMatchObject({
    error: { code: -32000, message: "Gmail adapter query invalid" },
  });
});

it("keeps public Gmail declarations free of credential values and write authority", async () => {
  const publicFiles = await Promise.all(
    [
      "plugins/gmail/package-manifest.json",
      "plugins/gmail/candidate.json",
      "plugins/gmail/platform-bindings.json",
      "plugins/gmail/catalog.json",
      "plugins/gmail/config.json",
      "plugins/gmail/README.md",
    ].map((file) => readFile(file, "utf8")),
  );
  const publicText = publicFiles.join("\n");
  expect(publicText).toContain("GOOGLE_GMAIL_OAUTH_CLIENT_SECRET");
  expect(publicText).toContain("https://www.googleapis.com/auth/gmail.readonly");
  expect(publicText).not.toContain("gmail.compose");
  expect(publicText).not.toContain("gmail.send");
  expect(publicText).not.toContain("gmail.modify");
  expect(publicText).not.toContain("https://mail.google.com/");
  expect(publicText).not.toContain("refresh_token");
  expect(publicText).not.toContain('client_secret":');
});

it("binds full MIT and notice evidence without relicensing Google services", async () => {
  const [rootLicense, gmailLicense, notice, manifestJson, recipeJson, releaseIndex] =
    await Promise.all([
      readFile("LICENSE", "utf8"),
      readFile("plugins/gmail/LICENSE", "utf8"),
      readFile("plugins/gmail/NOTICE", "utf8"),
      readFile("plugins/gmail/package-manifest.json", "utf8"),
      readFile("plugins/gmail/build-recipe.json", "utf8"),
      readFile("releases/index.json", "utf8"),
    ]);
  const manifest = Schema.decodeUnknownSync(
    Schema.Struct({ licenseEvidence: PackagedPluginLicenseEvidence }),
  )(JSON.parse(manifestJson));
  const recipe = Schema.decodeUnknownSync(GmailBuildRecipe)(JSON.parse(recipeJson));
  const releases = Schema.decodeUnknownSync(Schema.JsonObject)(JSON.parse(releaseIndex));

  expect(gmailLicense).toBe(rootLicense);
  expect(notice).toContain("Google's applicable terms and rights");
  expect(manifest.licenseEvidence).toEqual({
    kind: "spdx-mit-full-text",
    license: {
      path: "LICENSE",
      sha256: "21be23755fcecf50aec5729fe4a36db0e6600175e276716b55a61da91ac07091",
    },
    notice: {
      path: "NOTICE",
      sha256: "bf21a2ce4c597b4a02693c3461e005328c956c5aa7a78e3ff00c831964d98f09",
    },
  });
  expect(recipe.preservedThirdPartyNotices).toEqual([]);
  for (const packagedFile of recipe.packageFiles) {
    expect(await digestPluginBytes(new Uint8Array(await readFile(packagedFile.source)))).toBe(
      packagedFile.sha256,
    );
  }
  expect(releases.plugins).toContainEqual({
    sourceDirectory: "plugins/gmail",
    kind: "managed-package",
    publicationEligible: false,
    reason: expect.any(String),
  });
});
