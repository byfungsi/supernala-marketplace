import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { expect, it } from "@effect/vitest";
import { Result, Schema } from "effect";
import {
  releaseProcessEnvironment,
  runReleaseProcess,
  verifyLocalReleaseCheckout,
} from "./local-release-workspace.js";

const unwrap = <A, E>(value: Result.Result<A, E>) => {
  if (Result.isFailure(value)) throw new Error("test-command-failed");
  return value.success;
};

it("checks real Git provenance, rejecting dirty, local-only, stale and detached checkouts", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "local-release-git-"));
  try {
    const source = path.join(root, "source");
    const home = path.join(root, "home");
    await mkdir(source);
    await mkdir(home);
    const environment = {
      ...releaseProcessEnvironment(home),
      GIT_AUTHOR_NAME: "Fixture",
      GIT_AUTHOR_EMAIL: "fixture@example.invalid",
      GIT_COMMITTER_NAME: "Fixture",
      GIT_COMMITTER_EMAIL: "fixture@example.invalid",
    };
    const git = async (args: ReadonlyArray<string>, cwd = source) =>
      unwrap(await runReleaseProcess({ executable: "git", arguments: args, cwd, environment }));
    await git(["init", "-b", "main"]);
    await writeFile(path.join(source, "file.txt"), "reviewed\n");
    await git(["add", "."]);
    await git(["commit", "-m", "fixture"]);
    await git(["init", "--bare", path.join(root, "remote.git")]);
    await git(["remote", "add", "origin", path.join(root, "remote.git")]);
    await git(["push", "-u", "origin", "main"]);
    const commit = unwrap(await verifyLocalReleaseCheckout({ cwd: source, environment }));
    await writeFile(path.join(source, "untracked"), "dirty");
    expect(Result.isFailure(await verifyLocalReleaseCheckout({ cwd: source, environment }))).toBe(
      true,
    );
    await rm(path.join(source, "untracked"));
    await writeFile(path.join(source, "file.txt"), "unreviewed\n");
    expect(Result.isFailure(await verifyLocalReleaseCheckout({ cwd: source, environment }))).toBe(
      true,
    );
    await git(["add", "."]);
    await git(["commit", "-m", "local-only"]);
    expect(Result.isFailure(await verifyLocalReleaseCheckout({ cwd: source, environment }))).toBe(
      true,
    );
    await git(["push", "origin", "main"]);
    expect(
      Result.isFailure(
        await verifyLocalReleaseCheckout({ cwd: source, environment, expectedCommit: commit }),
      ),
    ).toBe(true);
    expect(Result.isSuccess(await verifyLocalReleaseCheckout({ cwd: source, environment }))).toBe(
      true,
    );
    await git(["checkout", "--detach"]);
    expect(Result.isFailure(await verifyLocalReleaseCheckout({ cwd: source, environment }))).toBe(
      true,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

it("does not pass ambient secrets or Node injection into a real build child", async () => {
  const home = await mkdtemp(path.join(os.tmpdir(), "local-release-env-"));
  try {
    const result = unwrap(
      await runReleaseProcess({
        executable: process.execPath,
        arguments: ["-e", "console.log(JSON.stringify(Object.keys(process.env).sort()))"],
        cwd: home,
        environment: releaseProcessEnvironment(home),
      }),
    );
    // macOS may inject its own locale marker into an otherwise exact child environment.
    const keys = Schema.decodeUnknownSync(Schema.Array(Schema.String))(JSON.parse(result));
    expect(keys.filter((key) => key !== "__CF_USER_TEXT_ENCODING")).toEqual([
      "CI",
      "GIT_CONFIG_GLOBAL",
      "GIT_CONFIG_NOSYSTEM",
      "GIT_TERMINAL_PROMPT",
      "HOME",
      "PATH",
      "TMPDIR",
    ]);
    const failed = await runReleaseProcess({
      executable: process.execPath,
      arguments: ["-e", "console.error('private-provider-response');process.exit(1)"],
      cwd: home,
      environment: releaseProcessEnvironment(home),
    });
    expect(Result.isFailure(failed)).toBe(true);
    expect(JSON.stringify(failed)).not.toContain("private-provider-response");
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});
