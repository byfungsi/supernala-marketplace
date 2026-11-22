import { Result } from "effect";
import { validatePluginBehaviors } from "./plugin-behavior-catalog.js";

/*
 * `pnpm marketplace behaviors validate` checks every declaration under `behaviors/` against its
 * definition's reviewed catalog and prints the revision and digest the application would store.
 * Publication needs the application's behaviour table, which does not exist yet; see
 * docs/proactive-manifest-app-contract.md.
 */

/** Runs `behaviors <subcommand>`. */
export const runBehaviorCommand = async (arguments_: ReadonlyArray<string>): Promise<void> => {
  const [subcommand] = arguments_;
  if (subcommand !== "validate" || arguments_.length !== 1) {
    process.stderr.write("Marketplace behaviors command failed: expected behaviors validate\n");
    process.exitCode = 1;
    return;
  }
  const behaviors = await validatePluginBehaviors(process.cwd());
  if (Result.isFailure(behaviors)) {
    process.stderr.write(
      `Marketplace behaviors command failed:\n${behaviors.failure.map((line) => `  ${line}`).join("\n")}\n`,
    );
    process.exitCode = 1;
    return;
  }
  process.stdout.write(
    `${JSON.stringify(
      {
        behaviors: behaviors.success.map(({ definitionId, revision, contentSha256 }) => ({
          definitionId,
          revision,
          contentSha256,
        })),
      },
      null,
      2,
    )}\n`,
  );
};
