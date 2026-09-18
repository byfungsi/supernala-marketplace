import { spawn } from "node:child_process";
import path from "node:path";
import { expect, it } from "@effect/vitest";

const run = (
  args: ReadonlyArray<string>,
): Promise<{ readonly code: number; readonly stdout: string; readonly stderr: string }> =>
  new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      [
        path.resolve("node_modules/tsx/dist/cli.mjs"),
        path.resolve("src/cli.ts"),
        "deploy",
        ...args,
      ],
      {
        env: { PATH: process.env.PATH ?? "" },
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8").on("data", (chunk: string) => {
      stdout += chunk;
    });
    child.stderr.setEncoding("utf8").on("data", (chunk: string) => {
      stderr += chunk;
    });
    child.once("error", reject);
    child.once("close", (code) => resolve({ code: code ?? -1, stdout, stderr }));
  });

it("exposes local deploy help without loading credentials or calling providers", async () => {
  const result = await run(["--help"]);
  expect(result.code).toBe(0);
  expect(result.stdout).toContain("pnpm marketplace deploy --environment production");
  expect(result.stdout).toContain("--recover-attempt UUID");
  expect(result.stderr).toBe("");
});

it("rejects unsupported environments, noninteractive publication and unknown bypass flags safely", async () => {
  const environment = await run(["--environment", "staging"]);
  expect(environment.code).toBe(1);
  expect(environment.stderr).toContain("local-release-requires-production-environment");
  const unattended = await run(["--environment", "production"]);
  expect(unattended.code).toBe(1);
  expect(unattended.stderr).toContain("local-release-requires-interactive-terminal");
  const bypass = await run(["--environment", "production", "--yes"]);
  expect(bypass.code).toBe(1);
  expect(bypass.stderr).toContain("local-release-command-failed");
  for (const result of [environment, unattended, bypass]) {
    expect(result.stderr).not.toContain(process.cwd());
    expect(result.stderr).not.toContain("node:");
  }
});
