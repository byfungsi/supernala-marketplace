# Curated Marketplace Skills

Supernala's Marketplace has a **Skills** section beside Apps. Every Skill there is reviewed in this repository: its exact files are committed, its upstream commit is pinned and its license is checked. Installing one copies those reviewed bytes into a Workspace as an ordinary, editable Skill. No third-party service is contacted at install time.

## Layout

```text
skills/<publisher>/<slug>/
  skill.json   catalog presentation, version, license, attribution and pinned upstream source
  files/       the exact upstream Skill folder: SKILL.md plus every other file
releases/skills.json   which Skills may be published, and why
```

The directory is the identity: `skills/anthropic/frontend-design` is `anthropic/frontend-design` in the application. `files/` holds the upstream bytes unchanged. Formatting and lint ignore it, because any change would change file digests. The only files Supernala adds are listed in `skill.json` `addedFiles`, for example an MIT `LICENSE` notice that upstream declared only in frontmatter. Every installed copy must carry its license.

Publishing applies the application's Skill import rules, so a curated Skill installs exactly as an imported one would:

- `SKILL.md` frontmatter supplies the installed Skill's `name` and `description`; the body is its instructions.
- A description over 600 characters is clipped with an ellipsis.
- Instructions over 32,000 characters are split at a heading or paragraph. The rest becomes `references/SKILL.continued.md`, which the kept part points to.
- A Skill holds at most 200 files of at most 10 MB each, and 50 MB in total, with safe relative paths.

`compatibility/marketplace-skills/` vendors the application's exact schema (migration `0163`) with source digests. Tests publish into it with SQLite, including its immutability triggers and the application's own catalog query.

## Adding a Skill

```sh
pnpm marketplace skills add https://github.com/<owner>/<repo>/tree/<ref>/<path> \
  --publisher <namespace> --publisher-name "<Name>" [--slug <slug>] [--copyright "<holder>"]
```

The command fetches the commit, pins its full SHA and copies the folder. It recognizes Apache-2.0, MIT, BSD, ISC and 0BSD license texts in the folder or repository root, and accepts `license: MIT` or `license: Apache-2.0` declared in `SKILL.md`. Anything else, including proprietary or missing licenses, is refused. New Skills enter `releases/skills.json` with `publicationEligible: false`.

Then curate `skill.json` (`name`, `shortDescription`, `categories`, `featuredRank`, `attribution`), review the files and set the Skill eligible with an explicit reason. Run `pnpm marketplace skills validate` and `pnpm check`. Check `pnpm marketplace public-safety`. A placeholder that matches a secret pattern in vendored documentation can be recorded in `releases/public-safety-reviews.json`, pinned to that file's SHA-256. Any change to the file needs a new review.

## Versions

`version` is the catalog version, independent of upstream. A published version is immutable: changing its files, instructions, license, attribution or source under the same version is refused (`skill-version-content-changed`). Bump the version instead. The newest published version becomes current, and Workspaces that installed an earlier one see **Update available**. Presentation fields (`name`, descriptions, categories, featured rank, publisher name) can change without a new version.

## Publishing

```sh
git switch main && git pull --ff-only
pnpm marketplace skills publish --environment production [--skill <id>]... [--yes]
```

The command:

1. Requires a clean, complete `main` that equals freshly fetched `origin/main`.
2. Validates every curated Skill and selects the eligible ones (or only those named with `--skill`).
3. Reads current application rows and shows the exact plan: new versions, presentation updates, unchanged and blocked Skills. Any blocked Skill stops the release.
4. Asks `[y/N]`, unless `--yes` is given.
5. Uploads each file of each new version to the platform `AgentSkillBundles` bucket under `marketplace/sha256/<digest>`. Uploads are write-once (`If-None-Match: *`) with their SHA-256 checksum, and every object is read back and verified. The application refuses to serve an object whose stored checksum does not match.
6. Writes each Skill's rows in one guarded D1 transaction and reads them back.

Bytes always land before rows, so a visible version never points at a missing file. Publishing the same release again changes nothing, so an interrupted run is retried by running it again. Skills need no release journal: version rows are immutable and idempotent in the application itself. No third-party code runs to build a Skill, so no isolated build clone is needed. Withdrawing a version or disabling a Skill is an application operation; publishing never reverses it.

## Unpublishing

Publishing never hides or removes anything. To take a Skill out of the Marketplace, disable its definition in the application database: `UPDATE marketplace_skill_definitions SET status = 'disabled', updated_at = <now> WHERE skill_definition_id = '<id>' AND status = 'active'`. A disabled Skill disappears from the catalog, its detail page and installs. Workspaces that already installed it keep their editable copy, and its published version stays intact, so setting the status back to `active` restores it. Then remove the Skill's source and its `releases/skills.json` entry here, so the repository matches what is offered.

Fit matters as well as license: offer Skills that help Supernala's Owners and Bots. Leave out Skills for a different product's brand, developer tooling Supernala cannot run (such as mobile apps or local test runners) or another vendor's API.

## Credentials

Publication reads `$HOME/.config/supernala-marketplace/production.skills.env`, or another file passed with `--credentials FILE`. The file must be mode `600`, owned by the operator, outside the checkout, and contain exactly these keys:

```text
CLOUDFLARE_ACCOUNT_ID
APPLICATION_DATABASE_ID
AGENT_SKILL_BUNDLE_BUCKET_NAME
APPLICATION_SKILL_PUBLISH_TOKEN
AGENT_SKILL_BUNDLE_R2_ACCESS_KEY_ID
AGENT_SKILL_BUNDLE_R2_SECRET_ACCESS_KEY
```

The R2 credentials must be limited to object read and write in the `AgentSkillBundles` bucket. The D1 token writes the application database: Cloudflare D1 tokens are database-scoped, not table-scoped.
