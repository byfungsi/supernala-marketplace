import { randomUUID } from "node:crypto";
import { mkdir, readFile, realpath, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { createInterface } from "node:readline/promises";
import { parseArgs } from "node:util";
import { Effect, Redacted, Result, Schema } from "effect";
import { CloudflareD1RestTransport } from "./cloudflare-adapters.js";
import {
  LocalReleaseCoordinator,
  LocalReleaseFailure,
  ReleaseAttemptId,
} from "./local-release-coordinator.js";
import {
  readLocalReleaseCredentials,
  releaseCredentialEnvironment,
} from "./local-release-credentials.js";
import {
  releaseProcessEnvironment,
  runReleaseProcess,
  verifyLocalReleaseCheckout,
} from "./local-release-workspace.js";
import { releaseReviewFile, ReleaseReview } from "./release-bundle.js";
import { ReleaseSet } from "./release-set.js";
import { canonicalPluginJson } from "./plugin-contract.js";
import { diffPluginAuthority } from "./authority-diff.js";

// This CLI boundary translates all Promise/Node failures into a safe typed Effect error.
const unwrap = <A>(result: Result.Result<A, LocalReleaseFailure>): A => {
  if (Result.isFailure(result)) throw result.failure;
  return result.success;
};
function reject(reason: string): never {
  throw new LocalReleaseFailure({ reason });
}
const emit = (value: Schema.Json) => process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
const confirm = async (message: string, expected: string): Promise<boolean> => {
  const terminal = createInterface({ input: process.stdin, output: process.stdout });
  try {
    return (await terminal.question(`${message}\nType ${expected}: `)).trim() === expected;
  } finally {
    terminal.close();
  }
};

/** Local operator release: clean fetched main, isolated build, durable exclusivity, exact digest confirmation. */
export function runLocalMarketplaceDeploy(
  arguments_: ReadonlyArray<string>,
): Effect.Effect<void, LocalReleaseFailure> {
  return Effect.tryPromise({
    try: async () => {
      const { values } = parseArgs({
        args: [...arguments_],
        strict: true,
        allowPositionals: false,
        options: {
          environment: { type: "string" },
          "control-env": { type: "string" },
          "publication-env": { type: "string" },
          status: { type: "boolean" },
          "recover-attempt": { type: "string" },
          help: { type: "boolean" },
        },
      });
      if (values.help) {
        process.stdout.write(
          "Usage: pnpm marketplace deploy --environment production [--control-env FILE] [--publication-env FILE]\nInspection: add --status\nRecovery: add --recover-attempt UUID (only after every old publisher and in-flight request has stopped)\n",
        );
        return;
      }
      if (values.environment !== "production")
        reject("local-release-requires-production-environment");
      if (values.status && values["recover-attempt"] !== undefined)
        reject("local-release-conflicting-options");
      if (!values.status && !process.stdin.isTTY)
        reject("local-release-requires-interactive-terminal");
      const repositoryRoot = await realpath(process.cwd());
      const configurationRoot = path.join(homedir(), ".config", "supernala-marketplace");
      const control = unwrap(
        await readLocalReleaseCredentials({
          file: values["control-env"] ?? path.join(configurationRoot, "production.control.env"),
          repositoryRoot,
          phase: "control",
        }),
      );
      const journalToken = control.secrets.MARKETPLACE_JOURNAL_WRITE_TOKEN;
      if (journalToken === undefined) reject("release-credentials-incomplete");
      const coordinator = new LocalReleaseCoordinator(
        new CloudflareD1RestTransport({
          accountId: control.topology.CLOUDFLARE_ACCOUNT_ID,
          databaseId: control.topology.MARKETPLACE_JOURNAL_DATABASE_ID,
          apiToken: Redacted.value(journalToken),
        }),
      );
      if (values.status) {
        emit({ activeAttempts: unwrap(await coordinator.active()) });
        return;
      }
      if (values["recover-attempt"] !== undefined) {
        const id = Schema.decodeUnknownSync(ReleaseAttemptId)(values["recover-attempt"]);
        emit({ attempt: unwrap(await coordinator.read(id)) });
        if (
          !(await confirm(
            "Recovery does not stop another process. Confirm ALL old publishers and in-flight requests have stopped. Partial releases will be reconciled on the next deployment.",
            `stopped ${id}`,
          ))
        )
          reject("release-recovery-not-confirmed");
        unwrap(await coordinator.abandonStoppedAttempt(id));
        emit({ recoveredAttempt: id });
        return;
      }

      const attemptId = ReleaseAttemptId.make(randomUUID());
      const directory = path.join(
        homedir(),
        ".local",
        "state",
        "supernala-marketplace",
        "releases",
        attemptId,
      );
      const buildHome = path.join(directory, "home");
      await mkdir(buildHome, { recursive: true, mode: 0o700 });
      const environment = releaseProcessEnvironment(buildHome);
      // Only git may use the operator's existing SSH/credential configuration; builds never do.
      const gitEnvironment = {
        ...environment,
        HOME: homedir(),
        GIT_CONFIG_GLOBAL: path.join(homedir(), ".gitconfig"),
        ...(process.env.SSH_AUTH_SOCK === undefined
          ? {}
          : { SSH_AUTH_SOCK: process.env.SSH_AUTH_SOCK }),
      };
      const commit = unwrap(
        await verifyLocalReleaseCheckout({ cwd: repositoryRoot, environment: gitEnvironment }),
      );
      const source = path.join(directory, "source");
      const run = async (
        executable: string,
        args: ReadonlyArray<string>,
        cwd: string,
        env = environment,
      ) => unwrap(await runReleaseProcess({ executable, arguments: args, cwd, environment: env }));
      emit({ phase: "prepare", commit, attemptId });
      await run(
        "git",
        [
          "-c",
          "core.hooksPath=/dev/null",
          "clone",
          "--no-hardlinks",
          "--no-checkout",
          "--",
          repositoryRoot,
          source,
        ],
        repositoryRoot,
      );
      await run("git", ["-c", "core.hooksPath=/dev/null", "checkout", "--detach", commit], source);
      const assertSnapshot = async () => {
        if (
          (await run("git", ["status", "--porcelain=v1", "--untracked-files=all"], source)) !==
            "" ||
          (await run("git", ["rev-parse", "HEAD"], source)) !== commit
        )
          reject("release-snapshot-changed");
      };
      emit({ phase: "install-dependencies" });
      await run("pnpm", ["install", "--frozen-lockfile", "--ignore-scripts"], source);
      emit({ phase: "offline-checks" });
      await run("pnpm", ["check"], source);
      emit({ phase: "public-safety" });
      await run("pnpm", ["marketplace", "public-safety"], source);
      await assertSnapshot();
      const attempt = unwrap(
        await coordinator.acquire({ attemptId, commit, createdAt: Date.now() }),
      );
      // From here every failure retains the durable lock. No catch/finally may silently free it.
      emit({ phase: "reserved", attemptId, commit, ordinal: attempt.release_ordinal });
      const baseline = path.join(directory, "baseline.json");
      const output = path.join(directory, "release-output");
      const baselineCredentials = releaseCredentialEnvironment(control);
      const { MARKETPLACE_JOURNAL_WRITE_TOKEN: _journalWrite, ...readCredentials } =
        baselineCredentials;
      emit({ phase: "verify-baseline" });
      await run("pnpm", ["release", "baseline", baseline, commit], source, {
        ...environment,
        ...readCredentials,
      });
      emit({ phase: "build-release" });
      await run(
        "pnpm",
        ["release", "build", baseline, output, commit, String(attempt.release_ordinal)],
        source,
      );
      await run("pnpm", ["release", "publish", output, "--dry-run"], source);
      const releaseSet = Schema.decodeUnknownSync(ReleaseSet, { onExcessProperty: "error" })(
        JSON.parse(await readFile(path.join(output, "release-set.json"), "utf8")),
      );
      if (
        releaseSet.mergeCommit !== commit ||
        releaseSet.releaseOrdinal !== attempt.release_ordinal
      )
        reject("release-set-attempt-mismatch");
      if (releaseSet.bundles.length === 0) {
        unwrap(await coordinator.finish(attemptId, "cancelled"));
        emit({ phase: "unchanged", commit, pluginsPublished: 0 });
        return;
      }
      const changes = [];
      for (const bundle of releaseSet.bundles) {
        const review = Schema.decodeUnknownSync(ReleaseReview, { onExcessProperty: "error" })(
          JSON.parse(await readFile(path.join(source, releaseReviewFile(bundle.identity)), "utf8")),
        );
        changes.push({
          identity: bundle.identity,
          releaseDigest: bundle.releaseDigest,
          reviewId: review.reviewId,
          reviewer: review.reviewer,
          authorityDiff: {
            ...(await diffPluginAuthority(review.authorityBefore, review.authorityAfter)),
          },
        });
      }
      emit({
        phase: "review",
        target: control.topology,
        commit,
        attemptId,
        ordinal: attempt.release_ordinal,
        setDigest: releaseSet.setDigest,
        changes,
      });
      await writeFile(
        path.join(directory, "operator-review.json"),
        JSON.stringify({ commit, attemptId, setDigest: releaseSet.setDigest, changes }),
        { mode: 0o600 },
      );
      if (
        !(await confirm(
          "Publish this exact release set? Independent source/permission review and public history safety review must already be complete.",
          `publish ${releaseSet.setDigest}`,
        ))
      ) {
        unwrap(await coordinator.finish(attemptId, "cancelled"));
        emit({ phase: "cancelled", attemptId });
        return;
      }
      unwrap(
        await verifyLocalReleaseCheckout({
          cwd: repositoryRoot,
          environment: gitEnvironment,
          expectedCommit: commit,
        }),
      );
      await assertSnapshot();
      const publication = unwrap(
        await readLocalReleaseCredentials({
          file:
            values["publication-env"] ?? path.join(configurationRoot, "production.publication.env"),
          repositoryRoot,
          phase: "publication",
        }),
      );
      if (canonicalPluginJson(publication.topology) !== canonicalPluginJson(control.topology))
        reject("release-publication-target-mismatch");
      unwrap(await coordinator.approve(attemptId, releaseSet.setDigest));
      await run("pnpm", ["release", "publish", output], source, {
        ...environment,
        ...releaseCredentialEnvironment(publication),
        MARKETPLACE_JOURNAL_WRITE_TOKEN: Redacted.value(journalToken),
        MARKETPLACE_RELEASE_ATTEMPT_ID: attemptId,
        MARKETPLACE_RELEASE_COMMIT: commit,
        MARKETPLACE_RELEASE_ORDINAL: String(attempt.release_ordinal),
        MARKETPLACE_APPROVED_RELEASE_SET_DIGEST: releaseSet.setDigest,
      });
      const finished = unwrap(await coordinator.read(attemptId));
      if (finished.status !== "completed") reject("release-completion-not-verified");
      emit({
        phase: "published",
        commit,
        attemptId,
        setDigest: releaseSet.setDigest,
        pluginsPublished: releaseSet.bundles.length,
      });
    },
    catch: (error) =>
      error instanceof LocalReleaseFailure
        ? error
        : new LocalReleaseFailure({ reason: "local-release-command-failed" }),
  });
}
