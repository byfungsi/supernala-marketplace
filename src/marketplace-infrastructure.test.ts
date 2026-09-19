import { spawnSync } from "node:child_process";
import path from "node:path";
import { expect, it } from "@effect/vitest";

it("starts the pinned Marketplace Alchemy CLI without provider credentials", () => {
  const result = spawnSync(
    process.execPath,
    [path.resolve("tools/infra/node_modules/alchemy/bin/cli.js"), "--help"],
    {
      cwd: path.resolve("tools/infra"),
      env: { PATH: process.env.PATH ?? "", NO_COLOR: "1" },
      encoding: "utf8",
      timeout: 30_000,
    },
  );
  expect(result.error).toBeUndefined();
  expect(result.status, result.stderr).toBe(0);
  expect(result.stdout).toContain("deploy");
  expect(result.stdout).toContain("plan");
});
