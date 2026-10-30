// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Supernala contributors

import { inspect } from "node:util";
import { slackApiToolDefinitions } from "./slack-tool-catalog.mjs";

const maximumResponseBytes = 524288;
const maximumOutputBytes = 220000;
const maximumRequestBytes = 100000;
const apiOrigin = "https://slack.com/api/";
const isRecord = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const success = (value) => ({ _tag: "Success", value });
const failure = (reason, extra = {}) => ({ _tag: "Failure", reason, ...extra });

// The package cannot import application dependencies. Keep a redacted wrapper until final HTTPS I/O.
const redactedCredential = (value) => ({
  unsafeRead: () => value,
  toJSON: () => "<redacted>",
  toString: () => "<redacted>",
  [inspect.custom]: () => "<redacted>",
});

const matchesSchema = (value, schema, depth = 0) => {
  if (depth > 12) return false;
  if (schema.enum !== undefined && !schema.enum.includes(value)) return false;
  if (schema.type === "string")
    return (
      typeof value === "string" &&
      value.length >= (schema.minLength ?? 0) &&
      (schema.maxLength === undefined || value.length <= schema.maxLength) &&
      (schema.pattern === undefined || new RegExp(schema.pattern, "u").test(value))
    );
  if (schema.type === "boolean") return typeof value === "boolean";
  if (schema.type === "number" || schema.type === "integer")
    return (
      typeof value === "number" &&
      Number.isFinite(value) &&
      (schema.type !== "integer" || Number.isSafeInteger(value)) &&
      (schema.minimum === undefined || value >= schema.minimum) &&
      (schema.maximum === undefined || value <= schema.maximum)
    );
  if (schema.type === "array")
    return (
      Array.isArray(value) &&
      value.length >= schema.minItems &&
      value.length <= schema.maxItems &&
      value.every((entry) => matchesSchema(entry, schema.items, depth + 1))
    );
  if (schema.type === "object")
    return (
      isRecord(value) &&
      Object.keys(value).every(
        (key) =>
          Object.hasOwn(schema.properties, key) &&
          matchesSchema(value[key], schema.properties[key], depth + 1),
      ) &&
      schema.required.every((key) => Object.hasOwn(value, key))
    );
  return false;
};

const richText = (text) => [
  {
    type: "rich_text",
    elements: [{ type: "rich_text_section", elements: [{ type: "text", text }] }],
  },
];
const documentContent = (markdown) => ({ type: "markdown", markdown });
const renameKeys = {
  channel_id: "channel",
  user_id: "user",
  message_ts: "ts",
  message: "text",
  emoji: "name",
  file_id: "file",
  content_length: "length",
};

const parseSlackArguments = (definition, args) => {
  if (
    !matchesSchema(args, definition.inputSchema) ||
    Buffer.byteLength(JSON.stringify(args)) > maximumRequestBytes
  ) {
    return failure("invalid-arguments", { dispatch: "not-dispatched" });
  }
  if (
    args.oldest !== undefined &&
    args.latest !== undefined &&
    Number(args.oldest) > Number(args.latest)
  ) {
    return failure("invalid-arguments", { dispatch: "not-dispatched" });
  }
  if (
    args.types !== undefined &&
    (!args.types
      .split(",")
      .every((value) => ["public_channel", "private_channel", "im", "mpim"].includes(value)) ||
      new Set(args.types.split(",")).size !== args.types.split(",").length)
  ) {
    return failure("invalid-arguments", { dispatch: "not-dispatched" });
  }
  if (
    definition.name === "slack_update_canvas" &&
    ["insert_before", "insert_after"].includes(args.operation) &&
    args.section_id === undefined
  ) {
    return failure("invalid-arguments", { dispatch: "not-dispatched" });
  }
  if (definition.name === "slack_update_list" && Object.keys(args).length === 1) {
    return failure("invalid-arguments", { dispatch: "not-dispatched" });
  }
  if (
    args.fields !== undefined &&
    (new Set(args.fields.map((field) => field.column_id)).size !== args.fields.length ||
      args.fields.some(
        (field) => Object.keys(field).filter((key) => key !== "column_id").length !== 1,
      ))
  ) {
    return failure("invalid-arguments", { dispatch: "not-dispatched" });
  }
  const body = { ...definition.defaults };
  for (const [key, value] of Object.entries(args)) {
    if (!definition.localFields?.includes(key)) body[renameKeys[key] ?? key] = value;
  }
  if (definition.method.startsWith("reactions.")) {
    body.timestamp = args.message_ts;
    delete body.ts;
  }
  if (definition.name === "slack_open_conversation") body.users = args.users.join(",");
  if (definition.name === "slack_complete_file_upload") {
    body.files = [{ id: args.file_id, ...(args.title === undefined ? {} : { title: args.title }) }];
    delete body.file;
    delete body.title;
    // This API uniquely uses channel_id, not channel.
    delete body.channel;
    if (args.channel_id !== undefined) body.channel_id = args.channel_id;
  }
  if (definition.name === "slack_create_canvas") {
    body.document_content = documentContent(args.content);
    delete body.content;
  }
  if (definition.name === "slack_find_canvas_sections") {
    body.criteria = { contains_text: args.contains_text };
    delete body.contains_text;
  }
  if (definition.name === "slack_update_canvas") {
    body.changes = [
      {
        operation: args.operation,
        document_content: documentContent(args.content),
        ...(args.section_id === undefined ? {} : { section_id: args.section_id }),
      },
    ];
    delete body.operation;
    delete body.content;
    delete body.section_id;
  }
  if (definition.name === "slack_create_list" || definition.name === "slack_update_list") {
    if (args.description !== undefined) body.description_blocks = richText(args.description);
    delete body.description;
    if (args.columns !== undefined) body.schema = args.columns;
    delete body.columns;
    if (definition.name === "slack_update_list") {
      body.id = args.list_id;
      delete body.list_id;
    }
  }
  if (args.fields !== undefined) {
    const cells = args.fields.map(({ text, ...field }) => ({
      ...field,
      ...(text === undefined ? {} : { rich_text: richText(text) }),
    }));
    if (definition.name === "slack_add_list_record") body.initial_fields = cells;
    else body.cells = cells.map((field) => ({ ...field, row_id: args.record_id }));
    delete body.fields;
    delete body.record_id;
  }
  return success(body);
};

const knownSlackErrors = new Map([
  ...["invalid_auth", "not_authed", "token_expired", "token_revoked", "account_inactive"].map(
    (code) => [code, "reauthorization-required"],
  ),
  ["missing_scope", "missing-scope"],
  ["not_allowed_token_type", "token-type-rejected"],
  ["no_permission", "access-denied"],
  ["access_denied", "access-denied"],
  ["not_in_channel", "access-denied"],
  ["channel_not_found", "not-found"],
  ["message_not_found", "not-found"],
  ["file_not_found", "not-found"],
  ["user_not_found", "not-found"],
  ["canvas_not_found", "not-found"],
  ["list_not_found", "not-found"],
  ["ratelimited", "rate-limited"],
  ["rate_limited", "rate-limited"],
  ["paid_teams_only", "plan-restricted"],
  ["feature_not_enabled", "plan-restricted"],
  ["canvas_disabled_user_team", "plan-restricted"],
  ["method_not_supported_for_channel_type", "unsupported-conversation"],
  ["invalid_arguments", "provider-rejected"],
  ["invalid_arg_name", "provider-rejected"],
  ["internal_error", "provider-unavailable"],
  ["fatal_error", "provider-unavailable"],
]);

const retryAfterSeconds = (headers) => {
  const value = headers.get("retry-after");
  if (value === null || !/^[0-9]{1,7}$/u.test(value)) return undefined;
  const parsed = Number(value);
  return parsed > 0 && parsed <= 604800 ? parsed : undefined;
};

const cancelSlackResponse = async (response) => {
  await response.body?.cancel().catch(() => {});
};

const readSlackJson = async (response) => {
  const length = response.headers.get("content-length");
  if (length !== null && (!/^[0-9]+$/u.test(length) || Number(length) > maximumResponseBytes)) {
    await cancelSlackResponse(response);
    return failure("response-too-large");
  }
  if (
    !response.headers.get("content-type")?.toLowerCase().startsWith("application/json") ||
    response.body === null
  ) {
    await cancelSlackResponse(response);
    return failure("invalid-response");
  }
  const reader = response.body.getReader();
  const chunks = [];
  let size = 0;
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      size += chunk.value.byteLength;
      if (size > maximumResponseBytes) {
        await reader.cancel();
        return failure("response-too-large");
      }
      chunks.push(chunk.value);
    }
    const bytes = Buffer.concat(chunks);
    const value = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
    let nodes = 0;
    const isBounded = (entry, depth = 0) => {
      if (++nodes > 20000 || depth > 20) return false;
      if (Array.isArray(entry))
        return entry.length <= 2000 && entry.every((item) => isBounded(item, depth + 1));
      if (isRecord(entry))
        return (
          Object.keys(entry).length <= 300 &&
          Object.values(entry).every((item) => isBounded(item, depth + 1))
        );
      return (
        entry === null ||
        typeof entry === "string" ||
        typeof entry === "boolean" ||
        (typeof entry === "number" && Number.isFinite(entry))
      );
    };
    return isRecord(value) && typeof value.ok === "boolean" && isBounded(value)
      ? success(value)
      : failure("invalid-response");
  } catch {
    await reader.cancel().catch(() => {});
    return failure("invalid-response");
  } finally {
    reader.releaseLock();
  }
};

const projectSlackResult = (definition, args, value) => {
  // Provider content remains private tool data. Never expose unselected top-level fields or errors.
  const data = Object.fromEntries(
    definition.resultKeys
      .filter((key) => Object.hasOwn(value, key))
      .map((key) => [key, value[key]]),
  );
  if (definition.resultKeys.length > 0 && !Object.hasOwn(data, definition.resultKeys[0]))
    return failure("invalid-response");
  if (definition.localFilter === "channels" || definition.localFilter === "members") {
    const key = definition.localFilter;
    if (!Array.isArray(data[key]) || !data[key].every(isRecord)) return failure("invalid-response");
    const query = args.keywords?.toLocaleLowerCase("en-US");
    if (query !== undefined)
      data[key] = data[key].filter((entry) => {
        const names =
          key === "channels"
            ? [entry.name]
            : [entry.name, entry.real_name, entry.profile?.display_name, entry.profile?.real_name];
        return names.some(
          (name) => typeof name === "string" && name.toLocaleLowerCase("en-US").includes(query),
        );
      });
  }
  if (definition.localFilter === "emoji") {
    if (!isRecord(data.emoji)) return failure("invalid-response");
    const query = args.query?.toLocaleLowerCase("en-US") ?? "";
    const entries = Object.entries(data.emoji).filter(([name]) =>
      name.toLocaleLowerCase("en-US").includes(query),
    );
    data.emoji = Object.fromEntries(entries.slice(0, 100));
    data.truncated = entries.length > 100;
  }
  if (Buffer.byteLength(JSON.stringify(data)) > maximumOutputBytes)
    return failure("response-too-large");
  return success({ contentTrust: "untrusted-slack-content", ...data });
};

/**
 * Build the Slack Web API adapter around an actor-owned user token and HTTPS transport.
 * Expected failures are tagged values; writes are never retried, including ambiguous network outcomes.
 */
export const createSlackApiToolHandler = ({
  accessToken,
  fetch: fetchImplementation = globalThis.fetch,
}) => {
  const credential =
    typeof accessToken === "string" && /^[A-Za-z0-9._~+/-]{1,16384}=*$/u.test(accessToken)
      ? redactedCredential(accessToken)
      : undefined;
  return async (name, args) => {
    const definition = slackApiToolDefinitions.find((candidate) => candidate.name === name);
    if (definition === undefined) return failure("unknown-tool", { dispatch: "not-dispatched" });
    const parsed = parseSlackArguments(definition, args);
    if (parsed._tag === "Failure") return parsed;
    if (credential === undefined)
      return failure("reauthorization-required", { dispatch: "not-dispatched" });
    const write = definition.classification !== "read";
    const uncertain = write ? "unknown" : "read-only";
    let response;
    try {
      response = await fetchImplementation(new URL(definition.method, apiOrigin), {
        method: "POST",
        redirect: "error",
        signal: AbortSignal.timeout(15000),
        headers: {
          Accept: "application/json",
          Authorization: `Bearer ${credential.unsafeRead()}`,
          "Content-Type":
            definition.encoding === "form"
              ? "application/x-www-form-urlencoded"
              : "application/json; charset=utf-8",
        },
        body:
          definition.encoding === "form"
            ? new URLSearchParams(
                Object.entries(parsed.value).map(([key, value]) => [key, String(value)]),
              ).toString()
            : JSON.stringify(parsed.value),
      });
    } catch {
      return failure("network-failed", { dispatch: uncertain });
    }
    const retryAfter = retryAfterSeconds(response.headers);
    const extra = {
      httpStatus: response.status,
      dispatch: "response-received",
      ...(retryAfter === undefined ? {} : { retryAfterSeconds: retryAfter }),
    };
    if (response.status === 429) {
      await cancelSlackResponse(response);
      return failure("rate-limited", extra);
    }
    if (!response.ok) {
      await cancelSlackResponse(response);
      return failure(
        response.status === 401
          ? "reauthorization-required"
          : response.status === 403
            ? "access-denied"
            : response.status >= 500
              ? "provider-unavailable"
              : "provider-rejected",
        { ...extra, dispatch: write && response.status >= 500 ? "unknown" : "response-received" },
      );
    }
    const parsedResponse = await readSlackJson(response);
    if (parsedResponse._tag === "Failure")
      return { ...parsedResponse, ...extra, dispatch: uncertain };
    if (!parsedResponse.value.ok) {
      const reason = knownSlackErrors.get(parsedResponse.value.error) ?? "provider-rejected";
      // An unknown server outcome must not encourage duplicate writes.
      return failure(reason, {
        ...extra,
        dispatch:
          write && ["internal_error", "fatal_error"].includes(parsedResponse.value.error)
            ? "unknown"
            : "response-received",
      });
    }
    const projected = projectSlackResult(definition, args, parsedResponse.value);
    return projected._tag === "Success"
      ? projected
      : { ...projected, ...extra, dispatch: uncertain };
  };
};
