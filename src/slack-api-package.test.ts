import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import { PassThrough } from "node:stream";
import { expect, it } from "@effect/vitest";
import { Result, Schema } from "effect";
import * as FastCheck from "fast-check";
import { createSlackApiToolHandler } from "../plugins/slack-api/source/slack-web-api.mjs";
import {
  slackApiToolCatalog,
  slackApiToolDefinitions,
} from "../plugins/slack-api/source/slack-tool-catalog.mjs";
import { startSlackApiMcpServer } from "../plugins/slack-api/source/server.mjs";
import { preparePluginPackage, validatePluginSource } from "./authoring-validation.js";
import { PackageCatalog } from "./package-archive.js";
import { PluginMarketplaceId, PluginVersionId } from "./plugin-contract.js";
import {
  decodePluginOAuthProviderDefinition,
  digestPluginOAuthProviderDefinition,
} from "./oauth-provider-definition.js";

const jsonResponse = (value: unknown, status = 200): Response =>
  new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json" },
  });
const recordingTransport = (response: () => Response | Promise<Response>) => {
  const requests: Array<{ url: string; init: RequestInit | undefined }> = [];
  const fetchImplementation: typeof fetch = async (input, init) => {
    requests.push({ url: input instanceof Request ? input.url : input.toString(), init });
    return response();
  };
  return { requests, fetch: fetchImplementation };
};
const message = { type: "message", ts: "1793340000.000001", text: "Review the PR", user: "U123" };

it("creates a validated 32-tool package with exact MCP catalog, OAuth and host allowlist", async () => {
  const source = await validatePluginSource("plugins/slack-api");
  if (Result.isFailure(source)) throw source.failure;
  expect(source.success.manifest).toMatchObject({
    id: "slack",
    version: "1.1.0",
    network: { allowedHosts: ["slack.com"] },
  });
  expect(source.success.catalog.tools).toHaveLength(32);
  expect(slackApiToolCatalog).toEqual(
    source.success.catalog.tools.map((tool) => ({
      name: tool.mcpName,
      description: tool.description,
      inputSchema: tool.inputSchema,
    })),
  );
  expect(
    source.success.catalog.tools.find((tool) => tool.mcpName === "slack_delete_message")
      ?.defaultPolicy,
  ).toBe("block");
  expect(
    source.success.catalog.tools
      .filter((tool) => tool.classification !== "destructive")
      .every((tool) => tool.defaultPolicy === "require-approval"),
  ).toBe(true);
  const definition = decodePluginOAuthProviderDefinition(
    Schema.decodeUnknownSync(Schema.Json)(
      JSON.parse(await readFile("plugins/slack-api/oauth-provider.json", "utf8")),
    ),
  );
  if (Result.isFailure(definition)) throw definition.failure;
  expect(definition.success.scopes).toContain("search:read");
  expect(definition.success.scopes.some((scope) => scope.startsWith("search:read."))).toBe(false);
  const authentication = source.success.manifest.authentication;
  if (authentication.kind !== "oauth") throw new Error("Slack OAuth required");
  expect(await digestPluginOAuthProviderDefinition(definition.success)).toBe(
    authentication.providerDefinitionDigest,
  );
  expect(authentication.requestedScopes).toEqual(
    [...new Set(slackApiToolDefinitions.flatMap((tool) => tool.scopes))].sort(),
  );
  const prepared = await preparePluginPackage({
    source: source.success,
    marketplaceId: PluginMarketplaceId.make("supernala-public"),
    versionId: PluginVersionId.make("supernala-public:supernala:slack@1.1.0"),
    publishedAt: 1793340000000,
  });
  if (Result.isFailure(prepared)) throw prepared.failure;
  expect(prepared.success.parsed.version.runtime.kind).toBe("managed-package");
  expect(prepared.success.archiveBytes.byteLength).toBeLessThan(100000);
  const catalog = Schema.decodeUnknownSync(PackageCatalog)(
    JSON.parse(await readFile("plugins/slack-api/catalog.json", "utf8")),
  );
  expect(catalog.tools.map((tool) => tool.id)).toContain("slack.slack_read_channel");
});

it("reads channel history with a user token, bounded time window and one page", async () => {
  const transport = recordingTransport(() =>
    jsonResponse({
      ok: true,
      messages: [message],
      has_more: true,
      response_metadata: { next_cursor: "next-page" },
      secret_top_level: "never-return",
    }),
  );
  const call = createSlackApiToolHandler({
    accessToken: "fixture",
    fetch: transport.fetch,
  });
  expect(
    await call("slack_read_channel", {
      channel_id: "C123",
      oldest: "1793300000.000000",
      latest: "1793386400.000000",
    }),
  ).toEqual({
    _tag: "Success",
    value: {
      contentTrust: "untrusted-slack-content",
      messages: [message],
      has_more: true,
      response_metadata: { next_cursor: "next-page" },
    },
  });
  expect(transport.requests).toHaveLength(1);
  const request = transport.requests[0];
  expect(request?.url).toBe("https://slack.com/api/conversations.history");
  expect(new Headers(request?.init?.headers).get("authorization")).toBe("Bearer fixture");
  expect(request?.init?.redirect).toBe("error");
  expect(request?.init?.signal).toBeInstanceOf(AbortSignal);
  expect(JSON.parse(Schema.decodeUnknownSync(Schema.String)(request?.init?.body))).toEqual({
    channel: "C123",
    limit: 15,
    oldest: "1793300000.000000",
    latest: "1793386400.000000",
  });
});

it("retains pagination after local filtering, including an empty matching page", async () => {
  const transport = recordingTransport(() =>
    jsonResponse({
      ok: true,
      channels: [{ id: "C123", name: "general" }],
      response_metadata: { next_cursor: "more" },
    }),
  );
  const result = await createSlackApiToolHandler({
    accessToken: "synthetic",
    fetch: transport.fetch,
  })("slack_search_channels", { keywords: "fe-pr-review", cursor: "previous" });
  expect(result).toEqual({
    _tag: "Success",
    value: {
      contentTrust: "untrusted-slack-content",
      channels: [],
      response_metadata: { next_cursor: "more" },
    },
  });
  expect(
    JSON.parse(Schema.decodeUnknownSync(Schema.String)(transport.requests[0]?.init?.body)),
  ).toEqual({
    limit: 100,
    exclude_archived: true,
    cursor: "previous",
  });
});

it("filters user names without dropping the provider's next cursor", async () => {
  const transport = recordingTransport(() =>
    jsonResponse({
      ok: true,
      members: [
        { id: "U123", profile: { display_name: "Hana" } },
        { id: "U456", name: "Other" },
      ],
      response_metadata: { next_cursor: "more-users" },
    }),
  );
  const result = await createSlackApiToolHandler({
    accessToken: "fixture",
    fetch: transport.fetch,
  })("slack_search_users", { keywords: "HANA" });
  expect(result).toEqual({
    _tag: "Success",
    value: {
      contentTrust: "untrusted-slack-content",
      members: [{ id: "U123", profile: { display_name: "Hana" } }],
      response_metadata: { next_cursor: "more-users" },
    },
  });
  expect(transport.requests[0]?.url).toBe("https://slack.com/api/users.list");
});

it("filters custom emoji aliases without fetching image URLs", async () => {
  const transport = recordingTransport(() =>
    jsonResponse({
      ok: true,
      emoji: { happy_cat: "alias:smile", sad_cat: "https://emoji.invalid/sad" },
    }),
  );
  expect(
    await createSlackApiToolHandler({ accessToken: "fixture", fetch: transport.fetch })(
      "slack_search_emojis",
      { query: "HAPPY" },
    ),
  ).toEqual({
    _tag: "Success",
    value: {
      contentTrust: "untrusted-slack-content",
      emoji: { happy_cat: "alias:smile" },
      truncated: false,
    },
  });
  expect(transport.requests).toHaveLength(1);
  expect(transport.requests[0]?.url).toBe("https://slack.com/api/emoji.list");
});

it("translates list text to rich text and preserves explicit column IDs", async () => {
  const transport = recordingTransport(() => jsonResponse({ ok: true, item: { id: "Rec123" } }));
  await createSlackApiToolHandler({ accessToken: "fixture", fetch: transport.fetch })(
    "slack_add_list_record",
    { list_id: "F123", fields: [{ column_id: "Col123", text: "Ship it" }] },
  );
  expect(
    JSON.parse(Schema.decodeUnknownSync(Schema.String)(transport.requests[0]?.init?.body)),
  ).toEqual({
    list_id: "F123",
    initial_fields: [
      {
        column_id: "Col123",
        rich_text: [
          {
            type: "rich_text",
            elements: [
              { type: "rich_text_section", elements: [{ type: "text", text: "Ship it" }] },
            ],
          },
        ],
      },
    ],
  });
});

const apiCases = [
  {
    tool: "slack_read_thread",
    args: { channel_id: "C123", message_ts: message.ts, cursor: "next" },
    method: "conversations.replies",
    body: { channel: "C123", ts: message.ts, limit: 15, cursor: "next" },
    response: { messages: [message] },
  },
  {
    tool: "slack_list_user_channels",
    args: { types: "public_channel,private_channel" },
    method: "users.conversations",
    body: { limit: 100, exclude_archived: true, types: "public_channel,private_channel" },
    response: { channels: [] },
  },
  {
    tool: "slack_read_channel_info",
    args: { channel_id: "C123" },
    method: "conversations.info",
    body: { channel: "C123" },
    response: { channel: { id: "C123" } },
  },
  {
    tool: "slack_list_channel_members",
    args: { channel_id: "C123", limit: 2 },
    method: "conversations.members",
    body: { channel: "C123", limit: 2 },
    response: { members: ["U123"] },
  },
  {
    tool: "slack_search_messages",
    args: { query: "in:fe-pr-review after:2026-10-29" },
    method: "search.messages",
    body: { query: "in:fe-pr-review after:2026-10-29", count: 20, highlight: false },
    response: { messages: { matches: [message], paging: { pages: 1 } } },
  },
  {
    tool: "slack_search_files",
    args: { query: "quarterly", page: 2 },
    method: "search.files",
    body: { query: "quarterly", page: 2, count: 20, highlight: false },
    response: { files: { matches: [] } },
  },
  {
    tool: "slack_read_user_profile",
    args: { user_id: "U123" },
    method: "users.info",
    body: { user: "U123" },
    response: { user: { id: "U123", profile: { display_name: "Test user" } } },
  },
  {
    tool: "slack_send_message",
    args: { channel_id: "C123", message: "Approved test", thread_ts: message.ts },
    method: "chat.postMessage",
    body: {
      channel: "C123",
      text: "Approved test",
      thread_ts: message.ts,
      unfurl_links: false,
      unfurl_media: false,
    },
    response: { channel: "C123", ts: message.ts },
  },
  {
    tool: "slack_schedule_message",
    args: { channel_id: "C123", message: "Follow up", post_at: 1793500000 },
    method: "chat.scheduleMessage",
    body: { channel: "C123", text: "Follow up", post_at: 1793500000 },
    response: { channel: "C123", scheduled_message_id: "Q123" },
  },
  {
    tool: "slack_update_message",
    args: { channel_id: "C123", message_ts: message.ts, message: "Changed" },
    method: "chat.update",
    body: { channel: "C123", ts: message.ts, text: "Changed" },
    response: { channel: "C123", ts: message.ts },
  },
  {
    tool: "slack_delete_message",
    args: { channel_id: "C123", message_ts: message.ts },
    method: "chat.delete",
    body: { channel: "C123", ts: message.ts },
    response: { channel: "C123", ts: message.ts },
  },
  {
    tool: "slack_create_channel",
    args: { name: "test-channel", is_private: true },
    method: "conversations.create",
    body: { name: "test-channel", is_private: true },
    response: { channel: { id: "C999" } },
  },
  {
    tool: "slack_open_conversation",
    args: { users: ["U123", "U456"] },
    method: "conversations.open",
    body: { users: "U123,U456" },
    response: { channel: { id: "G123" } },
  },
  {
    tool: "slack_add_reaction",
    args: { channel_id: "C123", message_ts: message.ts, emoji: "eyes" },
    method: "reactions.add",
    body: { channel: "C123", timestamp: message.ts, name: "eyes" },
    response: {},
  },
  {
    tool: "slack_remove_reaction",
    args: { channel_id: "C123", message_ts: message.ts, emoji: "eyes" },
    method: "reactions.remove",
    body: { channel: "C123", timestamp: message.ts, name: "eyes" },
    response: {},
  },
  {
    tool: "slack_get_reactions",
    args: { channel_id: "C123", message_ts: message.ts },
    method: "reactions.get",
    body: { channel: "C123", timestamp: message.ts },
    response: { message: { reactions: [] } },
  },
  {
    tool: "slack_read_file",
    args: { file_id: "F123" },
    method: "files.info",
    body: { file: "F123" },
    response: { file: { id: "F123", title: "Document" } },
  },
  {
    tool: "slack_complete_file_upload",
    args: { file_id: "F123", title: "Report", channel_id: "C123" },
    method: "files.completeUploadExternal",
    body: { files: [{ id: "F123", title: "Report" }], channel_id: "C123" },
    response: { files: [{ id: "F123" }] },
  },
  {
    tool: "slack_read_canvas",
    args: { canvas_id: "F123" },
    method: "canvases.getContent",
    body: { canvas_id: "F123" },
    response: { content: "# Plan" },
  },
  {
    tool: "slack_create_canvas",
    args: { title: "Plan", content: "# Draft" },
    method: "canvases.create",
    body: { title: "Plan", document_content: { type: "markdown", markdown: "# Draft" } },
    response: { canvas_id: "F123" },
  },
  {
    tool: "slack_find_canvas_sections",
    args: { canvas_id: "F123", contains_text: "Plan" },
    method: "canvases.sections.lookup",
    body: { canvas_id: "F123", criteria: { contains_text: "Plan" } },
    response: { sections: [{ id: "temp:C:123" }] },
  },
  {
    tool: "slack_update_canvas",
    args: {
      canvas_id: "F123",
      operation: "insert_after",
      section_id: "temp:C:123",
      content: "Next",
    },
    method: "canvases.edit",
    body: {
      canvas_id: "F123",
      changes: [
        {
          operation: "insert_after",
          section_id: "temp:C:123",
          document_content: { type: "markdown", markdown: "Next" },
        },
      ],
    },
    response: {},
  },
  {
    tool: "slack_read_list",
    args: { list_id: "F123", limit: 10 },
    method: "slackLists.items.list",
    body: { list_id: "F123", limit: 10, include_list: true },
    response: { items: [], list: { id: "F123", schema: [] } },
  },
  {
    tool: "slack_create_list",
    args: { name: "Tasks", todo_mode: true },
    method: "slackLists.create",
    body: { name: "Tasks", todo_mode: true },
    response: { list: { id: "F123" } },
  },
  {
    tool: "slack_update_list",
    args: { list_id: "F123", name: "Done" },
    method: "slackLists.update",
    body: { id: "F123", name: "Done" },
    response: {},
  },
  {
    tool: "slack_add_list_record",
    args: { list_id: "F123", fields: [{ column_id: "Col123", number: 5 }] },
    method: "slackLists.items.create",
    body: { list_id: "F123", initial_fields: [{ column_id: "Col123", number: 5 }] },
    response: { item: { id: "Rec123" } },
  },
  {
    tool: "slack_update_list_record",
    args: {
      list_id: "F123",
      record_id: "Rec123",
      fields: [{ column_id: "Col123", checkbox: true }],
    },
    method: "slackLists.items.update",
    body: { list_id: "F123", cells: [{ column_id: "Col123", row_id: "Rec123", checkbox: true }] },
    response: {},
  },
] as const;

it.each(apiCases)(
  "maps $tool to the public Slack API without a caller-selected method",
  async ({ tool, args, method, body, response }) => {
    const transport = recordingTransport(() => jsonResponse({ ok: true, ...response }));
    const result = await createSlackApiToolHandler({
      accessToken: "synthetic",
      fetch: transport.fetch,
    })(tool, args);
    expect(result._tag).toBe("Success");
    expect(transport.requests).toHaveLength(1);
    expect(transport.requests[0]?.url).toBe(`https://slack.com/api/${method}`);
    expect(transport.requests[0]?.init?.method).toBe("POST");
    expect(
      JSON.parse(Schema.decodeUnknownSync(Schema.String)(transport.requests[0]?.init?.body)),
    ).toEqual(body);
  },
);

it("uses Slack's timestamp parameter for reactions (not chat's ts)", async () => {
  const transport = recordingTransport(() => jsonResponse({ ok: true }));
  await createSlackApiToolHandler({ accessToken: "synthetic", fetch: transport.fetch })(
    "slack_add_reaction",
    { channel_id: "C123", message_ts: message.ts, emoji: "eyes" },
  );
  expect(
    JSON.parse(Schema.decodeUnknownSync(Schema.String)(transport.requests[0]?.init?.body)),
  ).toEqual({
    channel: "C123",
    timestamp: message.ts,
    name: "eyes",
  });
});

it("encodes the upload reservation as form data and returns its private upload handle", async () => {
  const transport = recordingTransport(() =>
    jsonResponse({
      ok: true,
      upload_url: "https://files.slack.com/upload/v1/synthetic",
      file_id: "F123",
    }),
  );
  const result = await createSlackApiToolHandler({
    accessToken: "synthetic",
    fetch: transport.fetch,
  })("slack_get_file_upload_url", { filename: "report.txt", content_length: 50 });
  expect(result).toMatchObject({ _tag: "Success", value: { file_id: "F123" } });
  expect(new Headers(transport.requests[0]?.init?.headers).get("content-type")).toBe(
    "application/x-www-form-urlencoded",
  );
  expect(
    new URLSearchParams(
      Schema.decodeUnknownSync(Schema.String)(transport.requests[0]?.init?.body),
    ).get("length"),
  ).toBe("50");
});

it.each([
  ["slack_read_channel", { channel_id: "#general" }],
  ["slack_read_channel", { channel_id: "C123", limit: 16 }],
  ["slack_read_channel", { channel_id: "C123", token: "caller-token" }],
  ["slack_read_channel", { channel_id: "C123", url: "https://attacker.invalid" }],
  ["slack_read_channel", { channel_id: "C123", oldest: "2.0", latest: "1.0" }],
  ["slack_send_message", { channel_id: "C123", message: "" }],
  ["slack_update_canvas", { canvas_id: "F123", operation: "insert_after", content: "x" }],
  [
    "slack_add_list_record",
    { list_id: "F123", fields: [{ column_id: "Col123", text: "x", number: 1 }] },
  ],
  ["slack_add_list_record", { list_id: "F123", fields: [{ column_id: "Col123" }] }],
  ["slack_list_user_channels", { types: "unknown" }],
  ["slack_update_list", { list_id: "F123" }],
] as const)("rejects invalid arguments for %s before transport", async (tool, args) => {
  const transport = recordingTransport(() => jsonResponse({ ok: true }));
  expect(
    await createSlackApiToolHandler({ accessToken: "synthetic", fetch: transport.fetch })(
      tool,
      args,
    ),
  ).toMatchObject({ _tag: "Failure", reason: "invalid-arguments", dispatch: "not-dispatched" });
  expect(transport.requests).toHaveLength(0);
});

it("rejects arbitrary methods and missing credentials without provider calls", async () => {
  const transport = recordingTransport(() => jsonResponse({ ok: true }));
  const call = createSlackApiToolHandler({ fetch: transport.fetch });
  expect(await call("https://attacker.invalid", {})).toMatchObject({ reason: "unknown-tool" });
  expect(await call("slack_read_channel", { channel_id: "C123" })).toMatchObject({
    reason: "reauthorization-required",
    dispatch: "not-dispatched",
  });
  expect(transport.requests).toHaveLength(0);
});

it.each([
  ["token_revoked", "reauthorization-required"],
  ["token_expired", "reauthorization-required"],
  ["missing_scope", "missing-scope"],
  ["not_in_channel", "access-denied"],
  ["channel_not_found", "not-found"],
  ["paid_teams_only", "plan-restricted"],
  ["unexpected-provider-private-data", "provider-rejected"],
])("translates HTTP 200 Slack error %s without leaking its body", async (providerError, reason) => {
  const transport = recordingTransport(() =>
    jsonResponse({
      ok: false,
      error: providerError,
      access_token: "fixture",
      response_metadata: { messages: ["private-details"] },
    }),
  );
  expect(
    await createSlackApiToolHandler({ accessToken: "synthetic", fetch: transport.fetch })(
      "slack_read_channel",
      { channel_id: "C123" },
    ),
  ).toEqual({ _tag: "Failure", reason, httpStatus: 200, dispatch: "response-received" });
});

it("returns Retry-After without waiting or retrying", async () => {
  const transport = recordingTransport(
    () => new Response("private", { status: 429, headers: { "retry-after": "60" } }),
  );
  expect(
    await createSlackApiToolHandler({ accessToken: "synthetic", fetch: transport.fetch })(
      "slack_read_channel",
      { channel_id: "C123" },
    ),
  ).toEqual({
    _tag: "Failure",
    reason: "rate-limited",
    httpStatus: 429,
    dispatch: "response-received",
    retryAfterSeconds: 60,
  });
  expect(transport.requests).toHaveLength(1);
});

it("never repeats an uncertain write after a transport failure", async () => {
  const transport = recordingTransport(() => Promise.reject(new Error("private network details")));
  expect(
    await createSlackApiToolHandler({ accessToken: "synthetic", fetch: transport.fetch })(
      "slack_send_message",
      { channel_id: "C123", message: "Send once" },
    ),
  ).toEqual({ _tag: "Failure", reason: "network-failed", dispatch: "unknown" });
  expect(transport.requests).toHaveLength(1);
});

it.each([
  () =>
    new Response("redirect", { status: 302, headers: { location: "https://attacker.invalid" } }),
  () => new Response("not JSON", { headers: { "content-type": "application/json" } }),
  () => jsonResponse({ ok: "true", messages: [] }),
  () => jsonResponse({ ok: true }),
  () =>
    new Response("{}", {
      headers: { "content-type": "application/json", "content-length": "9999999" },
    }),
  () => jsonResponse({ ok: true, messages: [{ text: "x".repeat(524288) }] }),
])("fails closed on redirects, malformed and oversized provider responses", async (response) => {
  const transport = recordingTransport(response);
  const result = await createSlackApiToolHandler({
    accessToken: "synthetic",
    fetch: transport.fetch,
  })("slack_read_channel", { channel_id: "C123" });
  expect(result._tag).toBe("Failure");
  expect(transport.requests).toHaveLength(1);
});

const runMcpFrames = async (frames: ReadonlyArray<string>, fetchImplementation?: typeof fetch) => {
  const input = new PassThrough();
  const output = new PassThrough();
  const chunks: Buffer[] = [];
  output.on("data", (chunk: Buffer) => chunks.push(chunk));
  const serving = startSlackApiMcpServer({
    input,
    output,
    accessToken: "synthetic",
    ...(fetchImplementation === undefined ? {} : { fetch: fetchImplementation }),
  });
  for (const frame of frames) input.write(frame);
  input.end();
  await serving;
  return Buffer.concat(chunks)
    .toString("utf8")
    .trim()
    .split("\n")
    .map((line) => Schema.decodeUnknownSync(Schema.JsonObject)(JSON.parse(line)));
};
const initialize = `${JSON.stringify({ jsonrpc: "2.0", id: "init", method: "initialize", params: { protocolVersion: "2025-06-18" } })}\n`;

it("runs MCP initialize, list and a real API-backed tool through the stdio entrypoint", async () => {
  const transport = recordingTransport(() => jsonResponse({ ok: true, messages: [message] }));
  const frames = await runMcpFrames(
    [
      initialize.slice(0, 11),
      initialize.slice(11),
      '{"jsonrpc":"2.0","method":"notifications/initialized"}\n',
      '{"jsonrpc":"2.0","id":"catalog","method":"tools/list","params":{}}\n',
      '{"jsonrpc":"2.0","id":"read","method":"tools/call","params":{"name":"slack_read_channel","arguments":{"channel_id":"C123"}}}\n',
    ],
    transport.fetch,
  );
  expect(frames).toHaveLength(3);
  expect(frames[1]).toMatchObject({ id: "catalog", result: { tools: slackApiToolCatalog } });
  expect(frames[2]).toMatchObject({
    id: "read",
    result: { structuredContent: { messages: [message], contentTrust: "untrusted-slack-content" } },
  });
  expect(transport.requests).toHaveLength(1);
});

it("reports an expired token and retry delay as standard MCP tool errors", async () => {
  const transport = recordingTransport(
    () => new Response(null, { status: 429, headers: { "retry-after": "60" } }),
  );
  const frames = await runMcpFrames(
    [
      initialize,
      '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"slack_read_channel","arguments":{"channel_id":"C123"}}}\n',
    ],
    transport.fetch,
  );
  expect(frames[1]).toMatchObject({
    result: {
      isError: true,
      structuredContent: { error: { reason: "rate-limited", retryAfterSeconds: 60 } },
    },
  });
});

it("recovers frame boundaries after oversized or malformed requests without dispatch", async () => {
  const transport = recordingTransport(() => jsonResponse({ ok: true }));
  const frames = await runMcpFrames(
    [
      "x".repeat(300000),
      "\n{bad}\n",
      initialize,
      '{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"chat.postMessage","arguments":{}}}\n',
      '{"jsonrpc":"2.0","id":4,"method":"ping"}\n',
    ],
    transport.fetch,
  );
  expect(frames.map((frame) => frame.id)).toEqual([null, null, "init", 3, 4]);
  expect(frames[4]).toMatchObject({ result: {} });
  expect(transport.requests).toHaveLength(0);
});

it("keeps generated excess argument keys out of transport", async () => {
  await FastCheck.assert(
    FastCheck.asyncProperty(
      FastCheck.string({ minLength: 1, maxLength: 30 }).filter(
        (key) => !["channel_id", "limit", "cursor", "oldest", "latest", "inclusive"].includes(key),
      ),
      async (key) => {
        const transport = recordingTransport(() => jsonResponse({ ok: true, messages: [] }));
        const args = JSON.parse(JSON.stringify({ channel_id: "C123", [key]: "injected" }));
        const result = await createSlackApiToolHandler({
          accessToken: "synthetic",
          fetch: transport.fetch,
        })("slack_read_channel", args);
        expect(result._tag).toBe("Failure");
        expect(transport.requests).toHaveLength(0);
      },
    ),
    { numRuns: 100 },
  );
});

it("starts the actual dependency-free Node process and serves the reviewed catalog", async () => {
  const child = spawn(process.execPath, ["plugins/slack-api/source/server.mjs"], {
    env: {},
    stdio: ["pipe", "pipe", "pipe"],
  });
  let output = "";
  let error = "";
  child.stdout.setEncoding("utf8").on("data", (chunk: string) => {
    output += chunk;
  });
  child.stderr.setEncoding("utf8").on("data", (chunk: string) => {
    error += chunk;
  });
  const completion = new Promise<number | null>((resolve, reject) => {
    child.once("close", resolve);
    child.once("error", reject);
  });
  child.stdin.end(`${initialize}{"jsonrpc":"2.0","id":"catalog","method":"tools/list"}\n`);
  expect(await completion).toBe(0);
  expect(error).toBe("");
  const frames = output
    .trim()
    .split("\n")
    .map((line) => Schema.decodeUnknownSync(Schema.JsonObject)(JSON.parse(line)));
  expect(frames[1]).toMatchObject({ result: { tools: slackApiToolCatalog } });
});
