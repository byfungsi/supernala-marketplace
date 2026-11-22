import { homedir } from "node:os";
import path from "node:path";
import { createInterface } from "node:readline/promises";
import { Redacted, Result } from "effect";
import {
  readApplicationPublicationCredentials,
  verifyApplicationPublicationCheckout,
} from "./application-publication-credentials.js";
import { CloudflareD1RestTransport } from "./cloudflare-adapters.js";
import {
  eligiblePluginDefinitionIds,
  loadPluginSetupGuides,
  pluginsMissingSetupGuides,
} from "./plugin-setup-guide.js";
import {
  type GuidePublicationPlanEntry,
  planGuidePublication,
  publishGuidePlan,
} from "./plugin-setup-guide-publication.js";

class GuideCommandFailure extends Error {}

const fail = (reason: string): never => {
  throw new GuideCommandFailure(reason);
};

const unwrap = <A>(result: Result.Result<A, string>): A =>
  Result.isSuccess(result) ? result.success : fail(result.failure);

const option = (arguments_: ReadonlyArray<string>, name: string): string | undefined => {
  const index = arguments_.indexOf(name);
  if (index === -1) return undefined;
  const value = arguments_[index + 1];

  return value === undefined || value.startsWith("--") ? fail(`missing-value-for-${name}`) : value;
};

/** Every guide valid, and every publication-eligible Plugin covered by one. */
const loadCheckedGuides = async (repositoryRoot: string) => {
  const guides = unwrap(await loadPluginSetupGuides(repositoryRoot));
  const missing = pluginsMissingSetupGuides(
    unwrap(await eligiblePluginDefinitionIds(repositoryRoot)),
    guides,
  );
  if (missing.length > 0) fail(`guide-missing: ${missing.join(", ")}`);

  return guides;
};

/** Guide publication credentials: an owner-only file outside the checkout with exactly these keys. */
export const readGuidePublicationCredentials = (input: {
  readonly file: string;
  readonly repositoryRoot: string;
}) =>
  readApplicationPublicationCredentials({
    ...input,
    tokenKey: "APPLICATION_GUIDE_PUBLISH_TOKEN",
    label: "guide",
  });

const describeStep = ({ guide, step }: GuidePublicationPlanEntry) =>
  step.kind === "publish-revision"
    ? `publish ${guide.definitionId} revision ${guide.revision}`
    : step.kind === "unchanged"
      ? `unchanged ${guide.definitionId} revision ${guide.revision}`
      : step.kind === "skipped"
        ? `skip ${guide.definitionId}: Plugin not published yet`
        : `BLOCKED ${guide.definitionId} revision ${guide.revision}: ${step.reason}`;

/**
 * Publishes guides from a clean checkout of fetched `origin/main`: shows the exact plan, asks
 * for confirmation (or `--yes`), then writes and reads back each new revision.
 */
const publishCommand = async (repositoryRoot: string, arguments_: ReadonlyArray<string>) => {
  if (option(arguments_, "--environment") !== "production") {
    fail("expected---environment-production");
  }
  const credentialsFile =
    option(arguments_, "--credentials") ??
    path.join(homedir(), ".config/supernala-marketplace/production.guides.env");

  const checkout = await verifyApplicationPublicationCheckout(repositoryRoot);
  const commit = Result.isSuccess(checkout)
    ? checkout.success
    : fail(`guide-publication-checkout-rejected: ${checkout.failure.reason}`);

  const guides = await loadCheckedGuides(repositoryRoot);
  const credentials = unwrap(
    await readGuidePublicationCredentials({ file: credentialsFile, repositoryRoot }),
  );
  const database = new CloudflareD1RestTransport({
    accountId: credentials.topology.CLOUDFLARE_ACCOUNT_ID,
    databaseId: credentials.topology.APPLICATION_DATABASE_ID,
    apiToken: Redacted.value(credentials.token),
  });
  const plan = unwrap(await planGuidePublication(database, guides));
  process.stdout.write(
    [
      `Guide publication from ${commit} to application database ${credentials.topology.APPLICATION_DATABASE_ID}:`,
      ...plan.map((entry) => `  ${describeStep(entry)}`),
      "",
    ].join("\n"),
  );
  if (plan.some((entry) => entry.step.kind === "blocked")) fail("guide-publication-plan-blocked");
  if (!plan.some((entry) => entry.step.kind === "publish-revision")) {
    process.stdout.write(`${JSON.stringify({ commit, published: [] }, null, 2)}\n`);
    return;
  }
  if (!arguments_.includes("--yes")) {
    const terminal = createInterface({ input: process.stdin, output: process.stdout });
    const answer = await terminal
      .question("Publish these guides? [y/N] ")
      .finally(() => terminal.close());
    if (!["y", "yes"].includes(answer.trim().toLowerCase()))
      fail("guide-publication-not-confirmed");
  }
  const outcomes = unwrap(await publishGuidePlan({ database, plan, now: Date.now }));
  process.stdout.write(`${JSON.stringify({ commit, published: outcomes }, null, 2)}\n`);
};

/** `pnpm marketplace guides <validate|publish>`. */
export const runGuideCommand = async (arguments_: ReadonlyArray<string>): Promise<void> => {
  const repositoryRoot = process.cwd();
  const [subcommand, ...rest] = arguments_;
  try {
    switch (subcommand) {
      case "validate": {
        const guides = await loadCheckedGuides(repositoryRoot);
        process.stdout.write(
          `${JSON.stringify({ guides: guides.map(({ definitionId, revision }) => ({ definitionId, revision })) }, null, 2)}\n`,
        );
        return;
      }
      case "publish":
        return await publishCommand(repositoryRoot, rest);
      default:
        return fail("expected guides validate|publish");
    }
  } catch (error) {
    if (!(error instanceof GuideCommandFailure)) throw error;
    process.stderr.write(`Marketplace guides command failed: ${error.message}\n`);
    process.exitCode = 1;
  }
};
