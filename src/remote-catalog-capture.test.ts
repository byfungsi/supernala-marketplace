import { expect, it } from "@effect/vitest";
import { Result } from "effect";
import { captureRemoteMcpCatalog } from "./remote-catalog-capture.js";

it("captures a deterministic sorted remote catalog without assigning authority", async () => {
  const captured = await captureRemoteMcpCatalog({
    tools: [
      { name: "zeta", inputSchema: { type: "object" } },
      { name: "alpha", description: "Alpha", inputSchema: { type: "object" } },
    ],
  });
  expect(Result.isSuccess(captured)).toBe(true);
  if (Result.isFailure(captured)) return;
  expect(captured.success.tools.map((tool) => tool.name)).toEqual(["alpha", "zeta"]);
  expect(captured.success.digest).toMatch(/^[a-f0-9]{64}$/u);
  expect(captured.success).not.toHaveProperty("classification");
});

it("rejects duplicate tool names and malformed schemas", async () => {
  expect(
    await captureRemoteMcpCatalog({
      tools: [
        { name: "same", inputSchema: {} },
        { name: "same", inputSchema: {} },
      ],
    }),
  ).toEqual(Result.fail("remote-catalog-capture-invalid"));
  expect(await captureRemoteMcpCatalog({ tools: [] })).toEqual(
    Result.fail("remote-catalog-capture-invalid"),
  );
});
