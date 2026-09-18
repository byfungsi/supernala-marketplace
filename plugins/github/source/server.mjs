// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Supernala contributors

import readline from "node:readline";

const apiBaseUrl = process.env.GITHUB_API_URL ?? "https://api.github.com";
const accessToken = process.env.PLUGIN_ACCESS_TOKEN;

const toolCatalog = [
  {
    name: "search_issues",
    description: "Search installation-visible GitHub issues",
    inputSchema: {
      type: "object",
      properties: { query: { type: "string", maxLength: 500 } },
      required: ["query"],
      additionalProperties: false,
    },
  },
  {
    name: "get_issue",
    description: "Read one installation-visible GitHub issue",
    inputSchema: {
      type: "object",
      properties: {
        owner: { type: "string", maxLength: 100 },
        repo: { type: "string", maxLength: 100 },
        number: { type: "integer", minimum: 1, maximum: 2147483647 },
      },
      required: ["owner", "repo", "number"],
      additionalProperties: false,
    },
  },
  {
    name: "create_issue",
    description: "Create one GitHub issue after trusted approval",
    inputSchema: {
      type: "object",
      properties: {
        owner: { type: "string", maxLength: 100 },
        repo: { type: "string", maxLength: 100 },
        title: { type: "string", maxLength: 256 },
        body: { type: "string", maxLength: 10000 },
      },
      required: ["owner", "repo", "title"],
      additionalProperties: false,
    },
  },
];

const respond = (id, result) =>
  process.stdout.write(`${JSON.stringify({ jsonrpc: "2.0", id, result })}\n`);
const fail = (id, message) =>
  process.stdout.write(
    `${JSON.stringify({ jsonrpc: "2.0", id, error: { code: -32000, message } })}\n`,
  );

const githubRequest = async (method, resource, body) => {
  if (!accessToken) throw new Error("GitHub adapter credential unavailable");
  const request = {
    method,
    redirect: "error",
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${accessToken}`,
      "X-GitHub-Api-Version": "2022-11-28",
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
    },
  };
  const response = await fetch(
    new URL(resource, apiBaseUrl),
    body === undefined ? request : { ...request, body: JSON.stringify(body) },
  );
  if (!response.ok) throw new Error(`GitHub adapter request failed with status ${response.status}`);
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.byteLength > 262144) throw new Error("GitHub adapter response exceeded output bound");
  return JSON.parse(new TextDecoder().decode(bytes));
};

readline.createInterface({ input: process.stdin, crlfDelay: Infinity }).on("line", async (line) => {
  const request = JSON.parse(line);
  try {
    if (request.method === "initialize")
      return respond(request.id, {
        protocolVersion: "2025-03-26",
        capabilities: { tools: {} },
        serverInfo: { name: "supernala-github", version: "1.0.0-candidate" },
      });
    if (request.method === "tools/list") return respond(request.id, { tools: toolCatalog });
    if (request.method !== "tools/call")
      return fail(request.id, "GitHub adapter method unavailable");
    const args = request.params?.arguments ?? {};
    if (request.params?.name === "search_issues")
      return respond(
        request.id,
        await githubRequest("GET", `/search/issues?q=${encodeURIComponent(args.query)}`),
      );
    if (request.params?.name === "get_issue")
      return respond(
        request.id,
        await githubRequest(
          "GET",
          `/repos/${encodeURIComponent(args.owner)}/${encodeURIComponent(args.repo)}/issues/${args.number}`,
        ),
      );
    if (request.params?.name === "create_issue")
      return respond(
        request.id,
        await githubRequest(
          "POST",
          `/repos/${encodeURIComponent(args.owner)}/${encodeURIComponent(args.repo)}/issues`,
          { title: args.title, ...(args.body === undefined ? {} : { body: args.body }) },
        ),
      );
    return fail(request.id, "GitHub adapter tool unavailable");
  } catch (error) {
    fail(request.id, error instanceof Error ? error.message : "GitHub adapter failed");
  }
});
