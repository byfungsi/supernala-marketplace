# Local Marketplace release operations

## Trust boundary

Pull requests and pushes run `.github/workflows/pull-request.yml` without provider or publication secrets. There is no automatic publication workflow. A trusted local operator publishes an exact fetched `origin/main` commit with `pnpm marketplace deploy --environment production`. See [local deployment](local-deployment.md) for setup, normal operation, credential files, and recovery.

The operator CLI checks a separate exact-commit clone with its own dependencies, temporary HOME, and subprocess environment allowlist. Install/check/build/dry-run receive no Cloudflare/R2 credentials. Only Git fetch may use the operator's Git/SSH authentication. The baseline process gets read credentials only. The parent holds journal-control credentials; app/R2 write credentials are read from a separate owner-only file only after exact release-set confirmation. Every interactive confirmation accepts only `y`/`yes` at a `[y/N]` prompt. `--yes` is explicit operator approval that skips only the normal publication prompt after all exact checks, not independent review or recovery authority. The publisher reconstructs every candidate before one-shot durable admission.

This is environment separation on a trusted operator machine, not a sandbox against malicious same-user code. Trusted source, dependencies, Node/pnpm/Git, and secure workstation access are prerequisites. Cloudflare D1 token authority is database/account scoped rather than table scoped; a variable name does not imply app-table isolation.

Repository operators must configure—not assume—the following:

- protect `main`; require PRs, current PR checks, CODEOWNER review, conversation resolution, and no force pushes;
- protect `releases/`, Plugin sources, release tooling, workflows, and `tools/infra/` with the owners in `.github/CODEOWNERS` (replace placeholder teams with real organization teams before enabling);
- retain independent source/permission review on protected main; final operator confirmation does not replace it;
- scan the exact public inventory, artifacts, and Git history before approval; the CLI worktree scan does not scan every historical Git blob;
- provision the external owner-only credential files described in the local deployment guide, with matching Alchemy output topology;
- disable any previously configured automated publisher and revoke its unused credentials before switching release ownership. An older publisher binary does not know about the local release lock.

These controls are documentation requirements; this repository does not claim that GitHub or Cloudflare has been configured.

## Baseline and retry behavior

The authoritative baseline starts from the Marketplace-owned D1 journal, not the previous push SHA or a Git-authored ledger. Before export, every published row is checked through read-only interfaces against exact application D1 state and a complete R2 GET whose byte length and SHA-256 match the journal. The envelope is bound to the pinned commit and retained in the same private local attempt directory. Only then is `durableStateVerified: true` emitted. This boolean is not a signature: authority comes from the trusted operator process freshly exporting it, commit binding, and credential separation. Missing, stale, tampered, or unreadable durable state fails closed; never hand-author a production baseline.

Every candidate is keyed by `(marketplaceId, publisherNamespace, pluginSlug, semanticVersion)`. Same version with changed source, executable bytes, catalog, Config, provenance, or authority fails. Failed and interrupted rows are rebuilt from protected source and exact review data, then reconciled against application D1 and R2. A retry may originate from a later merge commit while preserving the original immutable approval/content identity. The monotonic baseline updates only after application post-publication readback and only for a greater release ordinal; older concurrent completion cannot regress it. Failed rows remain discoverable.

Authority review has explicit lineage. A first publication must use the derived bootstrap snapshot with no tools, hosts, Config, provider registration, or credential authority. A later publication must name the verified previous Plugin identity and release digest, and its `authorityBefore` digest must equal that durable row's reviewed authority digest. This lineage is included in the release digest; an arbitrary PR-local or bundle-local “before” snapshot is rejected.

The reviewed lineage stays frozen across retries, but the trusted publisher revalidates it against the current journal and exact application state before any publication write. The named predecessor must still be the latest prior published row for the same Marketplace/publisher/slug and must still be published, not revoked or mismatched. A concurrently published newer predecessor makes the attempt stale; the publisher never recomputes lineage from the retry candidate itself.

Source commit and release ordinal are attempt authority, not immutable Plugin content authority. Both are carried by the release-set envelope and its approved digest. The local wrapper passes `MARKETPLACE_RELEASE_ATTEMPT_ID`, `MARKETPLACE_RELEASE_COMMIT`, `MARKETPLACE_RELEASE_ORDINAL`, and `MARKETPLACE_APPROVED_RELEASE_SET_DIGEST`; environment values alone confer no authority. Every bundle must match, and the coordinator atomically admits only the matching durable approved attempt before application/R2 writes. Ordinals are reserved atomically above historical journal and attempt ordinals. A later-commit retry gets a new ordinal while existing immutable claims retain their original audit fields.

Selection skips an unchanged published Plugin only when its same-attempt exported row carries current `durableStateVerified: true` evidence. Outside that trusted export, operators must not treat the field as proof. A journal dump produced without application/R2 verification fails with `published-state-reverification-required`. Verified unchanged Plugins incur zero package builds and zero PUTs.

An exact application row reported as revoked is emitted as `durableStateRevoked: true` after immutable-row and R2 verification. It does not become installable or get republished. Selecting that exact source fails with `published-version-revoked`; unrelated Plugin releases continue normally. Re-enabling or superseding a revoked version is an explicit operator/application decision, not automatic baseline recovery.

Removing a source does not delete, revoke, or mutate anything. Managed remote records never create package archives.

## Publication adapter

`CloudflareR2S3ArtifactStore` uses the documented R2 S3 endpoint, exact Phase 1 content key, conditional `If-None-Match: *`, and complete GET hash verification. Before an OAuth package publication, the trusted workflow validates `oauth-provider.json` and `platform-bindings.json` against the reviewed package authentication digest, then atomically admits a credential-free Provider Definition and `workspace-oauth-app` Provider Registration. It never admits a client ID, client secret, material-source revision, or deployment declaration; each Workspace Owner supplies client credentials later through the encrypted Plugin Vault. `Phase1D1PublicationAdapter` uses the D1 query API's `{ batch: [{ sql, params }] }` request form and bounded fail-closed guards for version/intent/artifact, definition/Marketplace, catalog/Config, credential-free authentication authority, catalog count, and individual tools. Cloudflare documents D1 batches as transactions that roll back together on failure. Offline tests prove these exact SQL guards against SQLite with foreign keys enabled and prove REST encoding through an injected HTTP transport. Live Cloudflare rollback acceptance remains a separately authorized gate.

Primary contract evidence: [D1 query API request body (`{ sql, params }` or `{ batch }`)](https://developers.cloudflare.com/api/resources/d1/subresources/database/methods/query/) and [D1 `batch()` transaction/rollback guarantee](https://developers.cloudflare.com/d1/worker-api/d1-database/#batch).

Workflow action pins are recorded in `compatibility/github-action-pins.json`. The commits were resolved directly from each upstream tag with `git ls-remote`; the annotated `pnpm/action-setup@v4.1.0` tag is pinned to its peeled commit rather than its tag-object SHA. Tests require every workflow `uses:` entry to match that evidence.

`pnpm release publish <directory> --dry-run` needs no credentials and writes nothing. Production mode requires matching source commit, ordinal, artifact scans, full-identity reviews, release-set approval, and one-shot durable attempt admission. Use the local deploy wrapper, not manual environment-variable emulation. Failures retain the non-expiring lock; explicit stopped-process recovery is documented in the local deployment guide.

## Application compatibility and remaining gates

The pinned Phase 1 package and publication contracts now accept reviewed `github-app` metadata and require an explicit matching publication expectation. No credential value enters the archive, Config, or static platform bindings: the trusted Actor privately supplies `PLUGIN_ACCESS_TOKEN`. The candidate source is MIT-licensed, but Marketplace does not publish GitHub until provider registration, independent release review, and live acceptance are separately verified.

The pinned publisher now resolves Config by exact digest, revision, and recursively strict canonical fields; it reuses the actual persisted identity and uses `config:sha256:<digest>` only for a new schema. The portable adapter mirrors that behavior, including one bounded retry after a transactional unique-digest race. This closes the prior offline compatibility blocker without changing the SQL bytes now allocated to migration `0042`; live D1 transaction and concurrency acceptance remains pending.
