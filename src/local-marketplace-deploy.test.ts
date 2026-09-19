import { spawn } from "node:child_process";
import path from "node:path";
import { expect, it } from "@effect/vitest";
import { isNormalPublicationConfirmation } from "./local-marketplace-deploy.js";

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
  expect(result.stdout).toContain("--yes");
  expect(result.stdout).toContain("--recover-attempt UUID");
  expect(result.stderr).toBe("");
});

it("accepts only y/yes as normal publication confirmation", () => {
  for (const answer of ["y", "Y", "yes", "YES", " Yes "]) {
    expect(isNormalPublicationConfirmation(answer)).toBe(true);
  }
  for (const answer of ["", "n", "no", "publish", "true", "1", "yes please"]) {
    expect(isNormalPublicationConfirmation(answer)).toBe(false);
  }
});

it("gates noninteractive publication and rejects --yes inspection or recovery conflicts", async () => {
  const environment = await run(["--environment", "staging"]);
  expect(environment.code).toBe(1);
  expect(environment.stderr).toContain("local-release-requires-production-environment");
  const unattended = await run(["--environment", "production"]);
  expect(unattended.code).toBe(1);
  expect(unattended.stderr).toContain("local-release-requires-interactive-terminal");
  const approved = await run([
    "--environment",
    "production",
    "--yes",
    "--control-env",
    path.join(process.cwd(), "definitely-missing-control.env"),
  ]);
  expect(approved.code).toBe(1);
  expect(approved.stderr).not.toContain("local-release-requires-interactive-terminal");
  const statusConflict = await run(["--environment", "production", "--status", "--yes"]);
  expect(statusConflict.code).toBe(1);
  expect(statusConflict.stderr).toContain("local-release-conflicting-options");
  const recoveryConflict = await run([
    "--environment",
    "production",
    "--recover-attempt",
    "470a4b99-c953-4b34-be3c-4532fea330e3",
    "--yes",
  ]);
  expect(recoveryConflict.code).toBe(1);
  expect(recoveryConflict.stderr).toContain("local-release-conflicting-options");
  for (const result of [environment, unattended, approved, statusConflict, recoveryConflict]) {
    expect(result.stderr).not.toContain(process.cwd());
    expect(result.stderr).not.toContain("node:");
  }
});
