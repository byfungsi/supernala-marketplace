import { homedir } from "node:os";
import path from "node:path";
import { Redacted, Result } from "effect";
import {
  readApplicationPublicationCredentials,
  verifyApplicationPublicationCheckout,
} from "./application-publication-credentials.js";
import { CloudflareD1RestTransport } from "./cloudflare-adapters.js";
import { validatePluginBehaviors } from "./plugin-behavior-catalog.js";
import {
  type BehaviorPublicationPlanEntry,
  describeBehaviorPlan,
  planBehaviorPublication,
  publishBehaviorPlan,
} from "./plugin-behavior-publication.js";

/*
 * `pnpm marketplace behaviors validate` checks every declaration under `behaviors/` against its
 * definition's reviewed catalog and prints the revision and digest the application would store.
 *
 * `pnpm marketplace behaviors publish --environment production [--confirm]` plans, and with
 * `--confirm` inserts, those rows into the application's `plugin_behavior_declarations` table.
 * See docs/proactive-manifest.md ("Publishing").
 */

class BehaviorCommandFailure extends Error {}

const fail = (reason: string): never => {
  throw new BehaviorCommandFailure(reason);
};

const unwrap = <A>(result: Result.Result<A, string>): A =>
  Result.isSuccess(result) ? result.success : fail(result.failure);

const PUBLISH_FLAGS = new Set(["--environment", "--credentials"]);
const PUBLISH_SWITCHES = new Set(["--confirm", "--dry-run"]);

/** `--name value` options and bare switches; anything else is refused rather than ignored. */
const parsePublishArguments = (arguments_: ReadonlyArray<string>) => {
  const options = new Map<string, string>();
  const switches = new Set<string>();
  for (let index = 0; index < arguments_.length; index += 1) {
    const name = arguments_[index] ?? "";
    if (PUBLISH_SWITCHES.has(name)) {
      switches.add(name);
      continue;
    }
    if (!PUBLISH_FLAGS.has(name)) fail(`unexpected-argument: ${name}`);
    const value = arguments_[index + 1];
    if (value === undefined || value.startsWith("--")) fail(`missing-value-for-${name}`);
    options.set(name, value ?? "");
    index += 1;
  }
  if (switches.has("--confirm") && switches.has("--dry-run")) {
    fail("choose-one-of---confirm---dry-run");
  }

  return { options, confirm: switches.has("--confirm") };
};

/** Every declaration valid against its definition's reviewed catalog; any problem stops the run. */
const loadCheckedBehaviors = async (repositoryRoot: string) => {
  const behaviors = await validatePluginBehaviors(repositoryRoot);
  return Result.isSuccess(behaviors)
    ? behaviors.success
    : fail(`behavior-invalid:\n  ${behaviors.failure.join("\n  ")}`);
};

/** Behaviour publication credentials: an owner-only file outside the checkout with exactly these keys. */
export const readBehaviorPublicationCredentials = (input: {
  readonly file: string;
  readonly repositoryRoot: string;
}) =>
  readApplicationPublicationCredentials({
    ...input,
    tokenKey: "APPLICATION_BEHAVIOR_PUBLISH_TOKEN",
    label: "behavior",
  });

const describeStep = ({ behavior, step }: BehaviorPublicationPlanEntry) =>
  step.kind === "publish-revision"
    ? `insert ${behavior.definitionId} revision ${behavior.revision} sha256 ${behavior.contentSha256}`
    : step.kind === "unchanged"
      ? `unchanged ${behavior.definitionId} revision ${behavior.revision}`
      : step.kind === "skipped"
        ? `skip ${behavior.definitionId}: Plugin definition not in the application yet`
        : `REFUSED ${behavior.definitionId} revision ${behavior.revision}: ${step.reason}`;

/**
 * Publishes declarations from a clean checkout of fetched `origin/main`. Without `--confirm` it
 * is a dry run: it reads the application's rows and prints the plan, writing nothing. With
 * `--confirm` it inserts each new revision and reads it back. Rows are never updated or deleted.
 */
const publishCommand = async (repositoryRoot: string, arguments_: ReadonlyArray<string>) => {
  const { options, confirm } = parsePublishArguments(arguments_);
  if (options.get("--environment") !== "production") fail("expected---environment-production");
  const credentialsFile =
    options.get("--credentials") ??
    path.join(homedir(), ".config/supernala-marketplace/production.behaviors.env");

  const checkout = await verifyApplicationPublicationCheckout(repositoryRoot);
  const commit = Result.isSuccess(checkout)
    ? checkout.success
    : fail(`behavior-publication-checkout-rejected: ${checkout.failure.reason}`);

  const behaviors = await loadCheckedBehaviors(repositoryRoot);
  const credentials = unwrap(
    await readBehaviorPublicationCredentials({ file: credentialsFile, repositoryRoot }),
  );
  const database = new CloudflareD1RestTransport({
    accountId: credentials.topology.CLOUDFLARE_ACCOUNT_ID,
    databaseId: credentials.topology.APPLICATION_DATABASE_ID,
    apiToken: Redacted.value(credentials.token),
  });
  const plan = unwrap(await planBehaviorPublication(database, behaviors));
  process.stdout.write(
    [
      `Behaviour publication${confirm ? "" : " (dry run)"} from ${commit} to application database ${credentials.topology.APPLICATION_DATABASE_ID}:`,
      ...plan.map((entry) => `  ${describeStep(entry)}`),
      "",
    ].join("\n"),
  );
  const refused = plan.some((entry) => entry.step.kind === "blocked");
  const inserts = plan.some((entry) => entry.step.kind === "publish-revision");
  if (!confirm) {
    process.stdout.write(
      `${JSON.stringify({ commit, dryRun: true, plan: describeBehaviorPlan(plan) }, null, 2)}\n`,
    );
    if (refused) fail("behavior-publication-plan-blocked");
    process.stdout.write(
      inserts
        ? "Dry run: nothing written. Re-run with --confirm to insert these revisions.\n"
        : "Dry run: nothing to insert.\n",
    );
    return;
  }
  if (refused) fail("behavior-publication-plan-blocked");
  if (!inserts) {
    process.stdout.write(`${JSON.stringify({ commit, published: [] }, null, 2)}\n`);
    return;
  }
  const outcomes = unwrap(await publishBehaviorPlan({ database, plan, now: Date.now }));
  process.stdout.write(`${JSON.stringify({ commit, published: outcomes }, null, 2)}\n`);
};

/** `pnpm marketplace behaviors <validate|publish>`. */
export const runBehaviorCommand = async (arguments_: ReadonlyArray<string>): Promise<void> => {
  const repositoryRoot = process.cwd();
  const [subcommand, ...rest] = arguments_;
  try {
    switch (subcommand) {
      case "validate": {
        if (rest.length > 0) fail("expected behaviors validate");
        const behaviors = await loadCheckedBehaviors(repositoryRoot);
        process.stdout.write(
          `${JSON.stringify(
            {
              behaviors: behaviors.map(({ definitionId, revision, contentSha256 }) => ({
                definitionId,
                revision,
                contentSha256,
              })),
            },
            null,
            2,
          )}\n`,
        );
        return;
      }
      case "publish":
        return await publishCommand(repositoryRoot, rest);
      default:
        return fail("expected behaviors validate|publish");
    }
  } catch (error) {
    if (!(error instanceof BehaviorCommandFailure)) throw error;
    process.stderr.write(`Marketplace behaviors command failed: ${error.message}\n`);
    process.exitCode = 1;
  }
};
