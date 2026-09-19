# Deploy from your machine

## One-time infrastructure setup

Use Node 22.20+ and pnpm 10.34.5. The checkout needs a configured `origin`, full Git history, and installed dependencies. First deploy the Marketplace Alchemy stack, including the additive `0002_local_release_attempts.sql` migration. It references the existing application stores and owns only its release journal. Do not edit applied migrations or create replacement app resources.

From `tools/infra`, with approved Alchemy authentication:

```sh
export MARKETPLACE_ENVIRONMENT=production
export APPLICATION_ALCHEMY_STACK=supernala-api
export APPLICATION_ALCHEMY_STAGE=production
pnpm exec alchemy plan --stage production
# Review the plan before applying:
pnpm exec alchemy deploy --stage production
```

Infrastructure deployment is separate from Plugin publication. Run it initially and when infrastructure changes, not for every Plugin update.

## Private credentials

Create `$HOME/.config/supernala-marketplace` with mode `700`. Securely provision two dotenv files, each mode `600`, owned by the current operator and outside every source checkout. Never put real values in this repository, command arguments, logs, or chat. The CLI rejects symlink files, group/world access, missing values, and unexpected keys.

Both files repeat this **non-secret topology**, populated from actual Alchemy outputs:

```text
CLOUDFLARE_ACCOUNT_ID
MARKETPLACE_JOURNAL_DATABASE_ID
APPLICATION_DATABASE_ID
PLUGIN_PACKAGE_BUCKET_NAME
```

`production.control.env` adds:

```text
MARKETPLACE_JOURNAL_WRITE_TOKEN
MARKETPLACE_JOURNAL_READ_TOKEN
APPLICATION_PLUGIN_READ_TOKEN
PLUGIN_PACKAGE_R2_READ_ACCESS_KEY_ID
PLUGIN_PACKAGE_R2_READ_SECRET_ACCESS_KEY
```

The journal write token provides ordering, locking, and journal updates—not app or package writes. Read credentials verify durable publication state. Restrict the read R2 credentials to object reads in the package bucket.

`production.publication.env` adds:

```text
APPLICATION_PLUGIN_PUBLISH_TOKEN
PLUGIN_PACKAGE_R2_ACCESS_KEY_ID
PLUGIN_PACKAGE_R2_SECRET_ACCESS_KEY
```

Restrict publication R2 credentials to the package bucket. D1 tokens are not table-scoped just because they have Plugin-specific names. These lists are an inventory, not ready-to-use file contents: each file must contain `NAME=value` entries. Custom external locations use `--control-env FILE` and `--publication-env FILE`.

Do not launch from a secret-bearing shell. Build subprocesses have a fresh HOME and explicit environment; publication credentials are loaded only after confirmation. This does not sandbox malicious same-user code: use a trusted operator workstation, reviewed source/dependencies, and trusted local tooling.

## Normal release

```sh
git switch main
git pull --ff-only
pnpm marketplace deploy --environment production
# Explicit noninteractive approval after all checks (for trusted operator automation only):
pnpm marketplace deploy --environment production --yes
```

The command:

1. Refuses dirty/untracked, shallow, detached, non-main, stale, or local-only checkouts. It fetches origin/main but never merges or changes your branch.
2. Creates an exact-commit clone, installs frozen dependencies without lifecycle scripts, runs offline checks, and scans its public inventory without publication credentials.
3. Reserves a journal-owned exclusive attempt and release ordinal.
4. Exports and verifies the durable baseline, builds only eligible selected Plugins, and performs a zero-write dry-run.
5. Displays target IDs, commit, versions, review identities, authority diffs, and exact release-set digest.
6. Displays `[y/N]` and accepts only case-insensitive `y` or `yes`. `--yes` skips only this normal publication prompt and permits a non-TTY invocation after every exact commit/build/review/release-set check. Independent source/permission review and public Git-history safety review must already be complete. Interactive or `--yes` operator confirmation does not replace them.
7. Rechecks fetched main and the snapshot, then loads matching publication credentials, records approval, publishes with one-shot durable admission, verifies readback, and completes the attempt.

`--yes` is explicit operator approval for the exact normal release set, not an independent review or a general safety bypass. It is rejected with `--status` and `--recover-attempt`, and it never bypasses the exact stopped-process recovery assertion. GitHub Actions runs PR/main checks only; remove any old automatic publisher and revoke its unused credentials before enabling local releases. Old publisher binaries do not participate in the lock protocol.

An empty/unchanged release set publishes nothing and releases its reservation. Ineligible candidates stay excluded. Publishing does not install, upgrade, connect accounts, activate Workspaces, or change Agent grants.

Receipts, baseline, release output, and isolated source are retained under `$HOME/.local/state/supernala-marketplace/releases/<attempt-id>`. Keep this directory private and remove obsolete attempts manually after investigation. Child failures are summarized to avoid exposing provider responses or private paths; the last printed phase identifies the failing stage.

## Interrupted releases and recovery

The journal permits only one active attempt across operators, and atomically allocates ordinals above all previous attempts and historical releases. Approval binds the exact set digest. Only one publisher can transition the matching approved attempt to publishing.

The lock has **no TTL**. A crash, interrupted preparation after reservation, ambiguous response, or failed publication retains it. Never infer that a timed-out process cannot still write.

```sh
pnpm marketplace deploy --environment production --status
# Stop every old publisher and confirm all in-flight requests have settled FIRST:
pnpm marketplace deploy --environment production --recover-attempt ATTEMPT_UUID
```

Recovery requires typing `stopped <exact attempt UUID>`. This is an operator assertion, not a process-termination mechanism or proof that Cloudflare has stopped processing requests. Never recover while an old publisher might still be alive.

Recovery abandons only the named attempt. It does not delete packages, roll back application state, or erase journal records. The next normal deploy gets a fresh ordinal, re-verifies durable state, and reconciles partial releases using existing immutable-content rules. Completed/abandoned authority cannot admit another publisher.

## Acceptance boundary

Offline tests cover real Git checks, private credential parsing, child environment isolation, SQLite transaction/lock transitions, and release CLI build/dry-run verification. Live D1/R2 local publication, process interruption, provider setup, and application install/connect/invoke acceptance must still be performed with separately approved credentials and live operations.
