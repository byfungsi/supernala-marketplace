import { constants } from "node:fs";
import { open, realpath } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { createInterface } from "node:readline/promises";
import { parseEnv } from "node:util";
import { Redacted, Result, Schema } from "effect";
import { CloudflareD1RestTransport } from "./cloudflare-adapters.js";
import {
  releaseProcessEnvironment,
  verifyLocalReleaseCheckout,
} from "./local-release-workspace.js";
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

const GuideTopology = Schema.Struct({
  CLOUDFLARE_ACCOUNT_ID: Schema.String.pipe(Schema.check(Schema.isPattern(/^[a-f0-9]{32}$/u))),
  APPLICATION_DATABASE_ID: Schema.String.pipe(Schema.check(Schema.isUUID())),
});

/** Guide publication credentials: an owner-only file outside the checkout with exactly these keys. */
export const readGuidePublicationCredentials = async (input: {
  readonly file: string;
  readonly repositoryRoot: string;
}): Promise<
  Result.Result<
    { readonly topology: typeof GuideTopology.Type; readonly token: Redacted.Redacted<string> },
    string
  >
> => {
  try {
    const resolved = await realpath(input.file);
    const root = await realpath(input.repositoryRoot);
    if (resolved === root || resolved.startsWith(`${root}${path.sep}`)) {
      return Result.fail("guide-credentials-must-be-outside-repository");
    }
    const file = await open(input.file, constants.O_RDONLY | constants.O_NOFOLLOW);
    try {
      const stat = await file.stat();
      if (
        !stat.isFile() ||
        stat.size > 65_536 ||
        (stat.mode & 0o077) !== 0 ||
        (process.getuid !== undefined && stat.uid !== process.getuid())
      ) {
        return Result.fail("guide-credentials-require-owner-only-file");
      }
      const values = parseEnv(await file.readFile("utf8"));
      const topology = Schema.decodeUnknownResult(GuideTopology)(values);
      if (Result.isFailure(topology)) return Result.fail("guide-topology-invalid");
      const allowed = new Set([
        ...Object.keys(GuideTopology.fields),
        "APPLICATION_GUIDE_PUBLISH_TOKEN",
      ]);
      if (Object.keys(values).some((key) => !allowed.has(key))) {
        return Result.fail("guide-credentials-unexpected-key");
      }
      const token = values["APPLICATION_GUIDE_PUBLISH_TOKEN"];
      if (token === undefined || token.trim() === "") {
        return Result.fail("guide-credentials-incomplete");
      }

      return Result.succeed({ topology: topology.success, token: Redacted.make(token) });
    } finally {
      await file.close();
    }
  } catch {
    return Result.fail("guide-credentials-read-failed");
  }
};

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

  // Same Git authority as Plugin deploys: the operator's Git config and SSH agent, nothing else.
  const checkout = await verifyLocalReleaseCheckout({
    cwd: repositoryRoot,
    environment: {
      ...releaseProcessEnvironment(homedir()),
      HOME: homedir(),
      GIT_CONFIG_GLOBAL: path.join(homedir(), ".gitconfig"),
      ...(process.env["SSH_AUTH_SOCK"] === undefined
        ? {}
        : { SSH_AUTH_SOCK: process.env["SSH_AUTH_SOCK"] }),
    },
  });
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
