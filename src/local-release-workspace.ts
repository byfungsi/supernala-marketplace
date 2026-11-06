import { spawn } from "node:child_process";
import { Result, Schema } from "effect";
import { LocalReleaseFailure, ReleaseCommit } from "./local-release-coordinator.js";

/** Credential-free subprocess environment; ambient tokens, NODE_OPTIONS and npm hooks are not inherited. */
export const releaseProcessEnvironment = (
  home: string,
  temporaryDirectory = home,
): Readonly<Record<string, string>> => ({
  PATH: process.env.PATH ?? "/usr/bin:/bin",
  HOME: home,
  TMPDIR: temporaryDirectory,
  CI: "true",
  GIT_TERMINAL_PROMPT: "0",
  GIT_CONFIG_NOSYSTEM: "1",
  GIT_CONFIG_GLOBAL: "/dev/null",
});

/** Only code-shaped reasons from the release tools' own failure lines leave a failed child. */
const childFailureReason = (stderr: string): string | null => {
  const reasons = [
    ...stderr.matchAll(
      /^(?:Release failed|Marketplace [a-z-]+ failed): ([a-z0-9][a-z0-9:-]{0,159})(?:[.\s]|$)/gmu,
    ),
  ];
  return reasons.at(-1)?.[1] ?? null;
};

/** Runs one local release phase with bounded captured output; child failures never expose secret-bearing text. */
export function runReleaseProcess(input: {
  readonly executable: string;
  readonly arguments: ReadonlyArray<string>;
  readonly cwd: string;
  readonly environment: Readonly<Record<string, string>>;
}): Promise<Result.Result<string, LocalReleaseFailure>> {
  return new Promise((resolve) => {
    const child = spawn(input.executable, input.arguments, {
      cwd: input.cwd,
      env: input.environment,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let output = "";
    let oversized = false;
    let stderr = "";
    child.stdout.setEncoding("utf8").on("data", (chunk: string) => {
      if (output.length + chunk.length > 4 * 1_048_576) {
        oversized = true;
        return;
      }
      output += chunk;
    });
    // Retain a bounded tail only to extract a code-shaped failure reason; never surface it raw.
    child.stderr.setEncoding("utf8").on("data", (chunk: string) => {
      stderr = (stderr + chunk).slice(-65_536);
    });
    child.once("error", () =>
      resolve(
        Result.fail(new LocalReleaseFailure({ reason: "local-release-process-start-failed" })),
      ),
    );
    child.once("close", (code) => {
      if (code === 0 && !oversized) return resolve(Result.succeed(output.trim()));
      const reason = childFailureReason(stderr);
      resolve(
        Result.fail(
          new LocalReleaseFailure({
            reason:
              reason === null
                ? "local-release-phase-failed"
                : `local-release-phase-failed:${reason}`,
          }),
        ),
      );
    });
  });
}

/** Fetches origin/main without merging; dirty, shallow, divergent, and local-only checkouts fail closed. */
export async function verifyLocalReleaseCheckout(input: {
  readonly cwd: string;
  readonly environment: Readonly<Record<string, string>>;
  readonly expectedCommit?: typeof ReleaseCommit.Type;
}): Promise<Result.Result<typeof ReleaseCommit.Type, LocalReleaseFailure>> {
  const git = (args: ReadonlyArray<string>) =>
    runReleaseProcess({
      executable: "git",
      arguments: ["-c", "core.hooksPath=/dev/null", ...args],
      cwd: input.cwd,
      environment: input.environment,
    });
  for (const [args, expected] of [
    [["status", "--porcelain=v1", "--untracked-files=all"], ""],
    [["symbolic-ref", "--short", "HEAD"], "main"],
    [["rev-parse", "--is-shallow-repository"], "false"],
  ] as const) {
    const result = await git(args);
    if (Result.isFailure(result)) return Result.fail(result.failure);
    if (result.success !== expected)
      return Result.fail(
        new LocalReleaseFailure({ reason: "release-requires-clean-complete-main-checkout" }),
      );
  }
  const fetched = await git([
    "fetch",
    "--no-tags",
    "origin",
    "+refs/heads/main:refs/remotes/origin/main",
  ]);
  if (Result.isFailure(fetched)) return Result.fail(fetched.failure);
  const head = await git(["rev-parse", "HEAD"]);
  const remote = await git(["rev-parse", "refs/remotes/origin/main"]);
  if (Result.isFailure(head)) return Result.fail(head.failure);
  if (Result.isFailure(remote)) return Result.fail(remote.failure);
  const commit = Schema.decodeUnknownResult(ReleaseCommit)(head.success);
  if (
    Result.isFailure(commit) ||
    head.success !== remote.success ||
    (input.expectedCommit !== undefined && input.expectedCommit !== head.success)
  ) {
    return Result.fail(new LocalReleaseFailure({ reason: "release-head-must-match-fetched-main" }));
  }
  return Result.succeed(commit.success);
}
