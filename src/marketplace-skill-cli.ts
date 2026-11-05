import { constants, promises as fs } from "node:fs";
import { mkdtemp, open, realpath, rm } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import path from "node:path";
import { createInterface } from "node:readline/promises";
import { parseEnv } from "node:util";
import { Redacted, Result, Schema } from "effect";
import { CloudflareD1RestTransport } from "./cloudflare-adapters.js";
import {
  releaseProcessEnvironment,
  runReleaseProcess,
  verifyLocalReleaseCheckout,
} from "./local-release-workspace.js";
import {
  listMarketplaceSkillDirectories,
  loadMarketplaceSkill,
  type MarketplaceSkillLicense,
  type MarketplaceSkillManifest,
  type MarketplaceSkillRelease,
  MarketplaceSkillReleaseIndex,
  clipSkillDescription,
  parseSkillMarkdown,
  readMarketplaceSkillReleaseIndex,
  SKILL_INSTRUCTIONS_FILE,
} from "./marketplace-skill.js";
import {
  CloudflareR2SkillBundleStore,
  planSkillPublication,
  publishSkillPlan,
  type SkillPublicationPlanEntry,
} from "./marketplace-skill-publication.js";

class SkillCommandFailure extends Error {}

const fail = (reason: string): never => {
  throw new SkillCommandFailure(reason);
};

const unwrap = <A>(result: Result.Result<A, string>): A =>
  Result.isSuccess(result) ? result.success : fail(result.failure);

const option = (arguments_: ReadonlyArray<string>, name: string): string | undefined => {
  const index = arguments_.indexOf(name);
  if (index === -1) return undefined;
  const value = arguments_[index + 1];

  return value === undefined || value.startsWith("--") ? fail(`missing-value-for-${name}`) : value;
};

const repeated = (arguments_: ReadonlyArray<string>, name: string): ReadonlyArray<string> =>
  arguments_.flatMap((argument, index) => {
    if (argument !== name) return [];
    const value = arguments_[index + 1];

    return value === undefined || value.startsWith("--")
      ? fail(`missing-value-for-${name}`)
      : [value];
  });

const write = (value: unknown) => process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);

/** Every curated Skill, validated, with its publication gate from `releases/skills.json`. */
export const loadCuratedSkills = async (
  repositoryRoot: string,
): Promise<
  Result.Result<
    ReadonlyArray<{ readonly release: MarketplaceSkillRelease; readonly eligible: boolean }>,
    string
  >
> => {
  const index = await readMarketplaceSkillReleaseIndex(repositoryRoot);
  if (Result.isFailure(index)) return Result.fail(index.failure);
  const directories = await listMarketplaceSkillDirectories(repositoryRoot);
  const loaded: Array<{ readonly release: MarketplaceSkillRelease; readonly eligible: boolean }> =
    [];
  for (const directory of directories) {
    // oxlint-disable-next-line no-await-in-loop -- Skills load in identity order so failures name the first bad one.
    const release = await loadMarketplaceSkill(directory);
    if (Result.isFailure(release)) {
      return Result.fail(`${release.failure}: ${path.relative(repositoryRoot, directory)}`);
    }
    const entry = index.success.skills.find((skill) => skill.id === release.success.id);
    if (entry === undefined)
      return Result.fail(`skill-release-entry-missing: ${release.success.id}`);
    loaded.push({ release: release.success, eligible: entry.publicationEligible });
  }
  const known = new Set(loaded.map(({ release }) => release.id));
  const orphan = index.success.skills.find((skill) => !known.has(skill.id));
  if (orphan !== undefined) return Result.fail(`skill-release-entry-without-source: ${orphan.id}`);
  if (new Set(index.success.skills.map((skill) => skill.id)).size !== index.success.skills.length) {
    return Result.fail("skill-release-entry-duplicated");
  }

  return Result.succeed(loaded);
};

const validateCommand = async (repositoryRoot: string) => {
  const skills = unwrap(await loadCuratedSkills(repositoryRoot));
  write({
    skills: skills.map(({ release, eligible }) => ({
      id: release.versionId,
      license: release.manifest.license,
      files: release.files.length,
      byteSize: release.byteSize,
      publicationEligible: eligible,
      releaseDigest: release.releaseDigest,
    })),
  });
};

/* Import ------------------------------------------------------------------------------------ */

const LICENSE_FILE = /^(?:licen[cs]e|copying)(?:\.(?:md|txt))?$/iu;

/** Recognizes a permissive license text; anything unrecognized is refused, never guessed. */
export const detectLicenseText = (text: string): MarketplaceSkillLicense | undefined => {
  const normalized = text.replaceAll(/\s+/gu, " ");
  if (/Apache License,? Version 2\.0/iu.test(normalized)) return "Apache-2.0";
  if (
    /Permission is hereby granted, free of charge, to any person obtaining a copy/iu.test(
      normalized,
    )
  ) {
    return "MIT";
  }
  if (
    /Permission to use, copy, modify, and\/or distribute this software for any purpose with or without fee is hereby granted/iu.test(
      normalized,
    )
  ) {
    return /provided that the above copyright notice/iu.test(normalized) ? "ISC" : "0BSD";
  }
  if (/Redistribution and use in source and binary forms/iu.test(normalized)) {
    return /Neither the name/iu.test(normalized) ? "BSD-3-Clause" : "BSD-2-Clause";
  }

  return undefined;
};

const mitNotice = (holder: string, year: number) => `MIT License

Copyright (c) ${year} ${holder}

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
`;

const GithubTree = /^https:\/\/github\.com\/([\w.-]+)\/([\w.-]+)\/tree\/([^/]+)\/(.+?)\/?$/u;

const titleCase = (slug: string) =>
  slug.replaceAll("-", " ").replace(/^./u, (first) => first.toUpperCase());

/**
 * Copies one Skill folder from a GitHub repository at a pinned commit into
 * `skills/<publisher>/<slug>/`, and records it as not yet eligible for publication.
 */
const addCommand = async (repositoryRoot: string, arguments_: ReadonlyArray<string>) => {
  const url = arguments_[0] ?? fail("expected-github-tree-url");
  const match = GithubTree.exec(url) ?? fail("expected-https-github-tree-url");
  const [, owner, repository, reference, folder] = match;
  if (
    owner === undefined ||
    repository === undefined ||
    reference === undefined ||
    folder === undefined
  ) {
    return fail("expected-https-github-tree-url");
  }
  const publisherNamespace = option(arguments_, "--publisher") ?? fail("missing---publisher");
  const publisherName = option(arguments_, "--publisher-name") ?? fail("missing---publisher-name");
  const slug = option(arguments_, "--slug") ?? path.posix.basename(folder);
  const copyright = option(arguments_, "--copyright") ?? publisherName;

  const scratch = await mkdtemp(path.join(tmpdir(), "marketplace-skill-"));
  try {
    const environment = releaseProcessEnvironment(scratch);
    const git = async (args: ReadonlyArray<string>) =>
      unwrap(
        Result.mapError(
          await runReleaseProcess({
            executable: "git",
            arguments: ["-c", "core.hooksPath=/dev/null", ...args],
            cwd: scratch,
            environment,
          }),
          (failure) => failure.reason,
        ),
      );
    await git(["init", "--quiet"]);
    await git(["remote", "add", "origin", `https://github.com/${owner}/${repository}.git`]);
    await git(["fetch", "--quiet", "--depth", "1", "origin", reference]);
    const commit = await git(["rev-parse", "FETCH_HEAD"]);
    await git(["checkout", "--quiet", "FETCH_HEAD"]);

    const upstream = path.join(scratch, folder);
    const markdown = await fs.readFile(path.join(upstream, SKILL_INSTRUCTIONS_FILE), "utf8");
    const parsed = unwrap(parseSkillMarkdown(markdown));
    const frontmatterLicense = /^license:\s*["']?([\w.-]+)["']?\s*$/mu.exec(markdown)?.[1];

    const folderLicense = (await fs.readdir(upstream)).find((name) => LICENSE_FILE.test(name));
    const rootLicense = (await fs.readdir(scratch)).find((name) => LICENSE_FILE.test(name));
    const licenseText = async (file: string | undefined, directory: string) =>
      file === undefined ? undefined : fs.readFile(path.join(directory, file), "utf8");
    const detected =
      detectLicenseText((await licenseText(folderLicense, upstream)) ?? "") ??
      detectLicenseText((await licenseText(rootLicense, scratch)) ?? "");
    const declared =
      frontmatterLicense === "MIT" || frontmatterLicense === "Apache-2.0"
        ? frontmatterLicense
        : undefined;
    const license = detected ?? declared ?? fail("skill-license-not-admitted");

    const target = path.join(repositoryRoot, "skills", publisherNamespace, slug);
    await fs.rm(target, { recursive: true, force: true });
    await fs.cp(upstream, path.join(target, "files"), { recursive: true });
    const addedFiles: Array<string> = [];
    // A license declared only in frontmatter still needs its notice shipped with every copy.
    if (folderLicense === undefined && detected === undefined && license === "MIT") {
      await fs.writeFile(
        path.join(target, "files", "LICENSE"),
        mitNotice(copyright, new Date().getUTCFullYear()),
      );
      addedFiles.push("LICENSE");
    }
    const manifest: MarketplaceSkillManifest = {
      schemaVersion: 1,
      marketplaceId: "supernala-public",
      publisher: { namespace: publisherNamespace, name: publisherName },
      slug,
      version: "1.0.0",
      name: titleCase(slug),
      shortDescription: clipSkillDescription(parsed.description),
      longDescription: "",
      categories: [],
      featuredRank: null,
      license,
      attribution: `Copyright ${copyright}. Licensed under ${license}. From ${owner}/${repository} at ${commit.slice(0, 12)}.`,
      source: { _tag: "github", repository: `${owner}/${repository}`, commit, path: folder },
      addedFiles,
    };
    await fs.writeFile(path.join(target, "skill.json"), `${JSON.stringify(manifest, null, 2)}\n`);

    const indexFile = path.join(repositoryRoot, "releases", "skills.json");
    const index = Result.getOrElse(await readMarketplaceSkillReleaseIndex(repositoryRoot), () =>
      MarketplaceSkillReleaseIndex.make({ schemaVersion: 1, skills: [] }),
    );
    const id = `${publisherNamespace}/${slug}`;
    const skills = [
      ...index.skills.filter((skill) => skill.id !== id),
      { id, publicationEligible: false, reason: "Imported; awaiting license and content review." },
    ].toSorted((left, right) => (left.id < right.id ? -1 : 1));
    await fs.writeFile(indexFile, `${JSON.stringify({ schemaVersion: 1, skills }, null, 2)}\n`);
    unwrap(Result.mapError(await loadMarketplaceSkill(target), (problem) => problem));
    write({ added: id, license, commit, files: path.relative(repositoryRoot, target) });
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }
};

/* Publication ------------------------------------------------------------------------------- */

const SkillTopology = Schema.Struct({
  CLOUDFLARE_ACCOUNT_ID: Schema.String.pipe(Schema.check(Schema.isPattern(/^[a-f0-9]{32}$/u))),
  APPLICATION_DATABASE_ID: Schema.String.pipe(Schema.check(Schema.isUUID())),
  AGENT_SKILL_BUNDLE_BUCKET_NAME: Schema.String.pipe(
    Schema.check(Schema.isPattern(/^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/u)),
  ),
});
const skillSecretKeys = [
  "APPLICATION_SKILL_PUBLISH_TOKEN",
  "AGENT_SKILL_BUNDLE_R2_ACCESS_KEY_ID",
  "AGENT_SKILL_BUNDLE_R2_SECRET_ACCESS_KEY",
] as const;

/** Skill publication credentials: an owner-only file outside the checkout with exactly these keys. */
export const readSkillPublicationCredentials = async (input: {
  readonly file: string;
  readonly repositoryRoot: string;
}): Promise<
  Result.Result<
    {
      readonly topology: typeof SkillTopology.Type;
      readonly secrets: Readonly<
        Record<(typeof skillSecretKeys)[number], Redacted.Redacted<string>>
      >;
    },
    string
  >
> => {
  try {
    const resolved = await realpath(input.file);
    const root = await realpath(input.repositoryRoot);
    if (resolved === root || resolved.startsWith(`${root}${path.sep}`)) {
      return Result.fail("skill-credentials-must-be-outside-repository");
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
        return Result.fail("skill-credentials-require-owner-only-file");
      }
      const values = parseEnv(await file.readFile("utf8"));
      const topology = Schema.decodeUnknownResult(SkillTopology)(values);
      if (Result.isFailure(topology)) return Result.fail("skill-topology-invalid");
      const allowed = new Set<string>([...Object.keys(SkillTopology.fields), ...skillSecretKeys]);
      if (Object.keys(values).some((key) => !allowed.has(key))) {
        return Result.fail("skill-credentials-unexpected-key");
      }
      const secret = (key: (typeof skillSecretKeys)[number]) => {
        const value = values[key];

        return value === undefined || value.trim() === "" ? undefined : Redacted.make(value);
      };
      const token = secret("APPLICATION_SKILL_PUBLISH_TOKEN");
      const accessKeyId = secret("AGENT_SKILL_BUNDLE_R2_ACCESS_KEY_ID");
      const secretAccessKey = secret("AGENT_SKILL_BUNDLE_R2_SECRET_ACCESS_KEY");
      if (token === undefined || accessKeyId === undefined || secretAccessKey === undefined) {
        return Result.fail("skill-credentials-incomplete");
      }

      return Result.succeed({
        topology: topology.success,
        secrets: {
          APPLICATION_SKILL_PUBLISH_TOKEN: token,
          AGENT_SKILL_BUNDLE_R2_ACCESS_KEY_ID: accessKeyId,
          AGENT_SKILL_BUNDLE_R2_SECRET_ACCESS_KEY: secretAccessKey,
        },
      });
    } finally {
      await file.close();
    }
  } catch {
    return Result.fail("skill-credentials-read-failed");
  }
};

const describeStep = (entry: SkillPublicationPlanEntry) =>
  entry.step.kind === "publish-version"
    ? `publish ${entry.release.versionId} (${entry.release.files.length} files, ${entry.release.byteSize} bytes, ${entry.release.manifest.license}; definition ${entry.step.definition})`
    : entry.step.kind === "update-definition"
      ? `update catalog presentation of ${entry.release.id}`
      : entry.step.kind === "unchanged"
        ? `unchanged ${entry.release.versionId}`
        : `BLOCKED ${entry.release.versionId}: ${entry.step.reason}`;

/**
 * Publishes eligible curated Skills from a clean checkout of fetched `origin/main`: shows the
 * exact plan, asks for confirmation (or `--yes`), uploads verified bytes, then writes rows.
 */
const publishCommand = async (repositoryRoot: string, arguments_: ReadonlyArray<string>) => {
  if (option(arguments_, "--environment") !== "production")
    fail("expected---environment-production");
  const selected = repeated(arguments_, "--skill");
  const credentialsFile =
    option(arguments_, "--credentials") ??
    path.join(homedir(), ".config/supernala-marketplace/production.skills.env");

  // Same Git authority as Plugin deploys: the operator's Git config and SSH agent, nothing else.
  const gitEnvironment = {
    ...releaseProcessEnvironment(homedir()),
    HOME: homedir(),
    GIT_CONFIG_GLOBAL: path.join(homedir(), ".gitconfig"),
    ...(process.env["SSH_AUTH_SOCK"] === undefined
      ? {}
      : { SSH_AUTH_SOCK: process.env["SSH_AUTH_SOCK"] }),
  };
  const checkout = await verifyLocalReleaseCheckout({
    cwd: repositoryRoot,
    environment: gitEnvironment,
  });
  const commit = Result.isSuccess(checkout)
    ? checkout.success
    : fail(`skill-publication-checkout-rejected: ${checkout.failure.reason}`);

  const curated = unwrap(await loadCuratedSkills(repositoryRoot));
  const unknown = selected.find((id) => !curated.some(({ release }) => release.id === id));
  if (unknown !== undefined) fail(`skill-not-found: ${unknown}`);
  const releases = curated
    .filter(({ eligible }) => eligible)
    .filter(({ release }) => selected.length === 0 || selected.includes(release.id))
    .map(({ release }) => release);
  if (selected.some((id) => !releases.some((release) => release.id === id))) {
    fail("skill-not-publication-eligible");
  }

  const credentials = unwrap(
    await readSkillPublicationCredentials({ file: credentialsFile, repositoryRoot }),
  );
  const database = new CloudflareD1RestTransport({
    accountId: credentials.topology.CLOUDFLARE_ACCOUNT_ID,
    databaseId: credentials.topology.APPLICATION_DATABASE_ID,
    apiToken: Redacted.value(credentials.secrets.APPLICATION_SKILL_PUBLISH_TOKEN),
  });
  const plan = unwrap(await planSkillPublication(database, releases));
  process.stdout.write(
    [
      `Skill publication from ${commit} to ${credentials.topology.AGENT_SKILL_BUNDLE_BUCKET_NAME} and application database ${credentials.topology.APPLICATION_DATABASE_ID}:`,
      ...plan.map((entry) => `  ${describeStep(entry)}`),
      "",
    ].join("\n"),
  );
  if (plan.some((entry) => entry.step.kind === "blocked")) fail("skill-publication-plan-blocked");
  if (plan.every((entry) => entry.step.kind === "unchanged")) {
    write({ published: [], commit });
    return;
  }
  if (!arguments_.includes("--yes")) {
    const terminal = createInterface({ input: process.stdin, output: process.stdout });
    const answer = await terminal
      .question("Publish these Skills? [y/N] ")
      .finally(() => terminal.close());
    if (!["y", "yes"].includes(answer.trim().toLowerCase()))
      fail("skill-publication-not-confirmed");
  }

  const store = new CloudflareR2SkillBundleStore({
    accountId: credentials.topology.CLOUDFLARE_ACCOUNT_ID,
    bucketName: credentials.topology.AGENT_SKILL_BUNDLE_BUCKET_NAME,
    accessKeyId: Redacted.value(credentials.secrets.AGENT_SKILL_BUNDLE_R2_ACCESS_KEY_ID),
    secretAccessKey: Redacted.value(credentials.secrets.AGENT_SKILL_BUNDLE_R2_SECRET_ACCESS_KEY),
  });
  const outcomes = unwrap(await publishSkillPlan({ database, store, plan, now: Date.now }));
  write({ commit, published: outcomes });
};

/** `pnpm marketplace skills <validate|add|publish>`. */
export const runSkillCommand = async (arguments_: ReadonlyArray<string>): Promise<void> => {
  const repositoryRoot = process.cwd();
  const [subcommand, ...rest] = arguments_;
  try {
    switch (subcommand) {
      case "validate":
        return await validateCommand(repositoryRoot);
      case "add":
        return await addCommand(repositoryRoot, rest);
      case "publish":
        return await publishCommand(repositoryRoot, rest);
      default:
        return fail("expected skills validate|add|publish");
    }
  } catch (error) {
    if (!(error instanceof SkillCommandFailure)) throw error;
    process.stderr.write(`Marketplace skills command failed: ${error.message}\n`);
    process.exitCode = 1;
  }
};
