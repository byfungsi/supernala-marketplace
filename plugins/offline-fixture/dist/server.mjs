import readline from "node:readline"

const tools = [
  {
    name: "echo",
    description: "Returns bounded synthetic text without network or credential access",
    inputSchema: {
      type: "object",
      properties: { text: { type: "string", maxLength: 200 } },
      required: ["text"],
      additionalProperties: false,
    },
  },
]

const respond = (id, result) => process.stdout.write(`${JSON.stringify({ jsonrpc: "2.0", id, result })}\n`)

readline.createInterface({ input: process.stdin, crlfDelay: Infinity }).on("line", (line) => {
  const request = JSON.parse(line)
  if (request.method === "initialize") {
    respond(request.id, { protocolVersion: "2025-03-26", capabilities: { tools: {} }, serverInfo: { name: "offline-fixture", version: "1.0.0" } })
  } else if (request.method === "tools/list") {
    respond(request.id, { tools })
  } else if (request.method === "tools/call" && request.params?.name === "echo") {
    const text = typeof request.params.arguments?.text === "string" ? request.params.arguments.text.slice(0, 200) : ""
    respond(request.id, { content: [{ type: "text", text }] })
  } else {
    process.stdout.write(`${JSON.stringify({ jsonrpc: "2.0", id: request.id, error: { code: -32601, message: "Synthetic fixture method unavailable" } })}\n`)
  }
})
