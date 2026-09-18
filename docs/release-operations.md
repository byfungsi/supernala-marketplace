# Incremental merge release operations

## Trust boundary

Pull requests run `.github/workflows/pull-request.yml` without provider or publication secrets. `release-on-main.yml` runs only for the resulting protected `main` commit. The baseline job has a read-only Marketplace-journal token. The build job receives no Cloudflare/R2 credentials. Only the final `marketplace-production-publication` environment job receives write credentials, after downloading and re-verifying the artifact built for the exact `${{ github.sha }}`. Cloudflare D1 token authority is database/account scoped rather than table scoped; the environment variable name does not imply narrower app-table enforcement.

Repository operators must configure—not assume—the following:

- protect `main`; require PRs, current PR checks, CODEOWNER review, conversation resolution, and no force pushes;
- protect `releases/`, Plugin sources, release tooling, workflows, and `tools/infra/` with the owners in `.github/CODEOWNERS` (replace placeholder teams with real organization teams before enabling);
- require independent reviewers for `marketplace-production-publication`, disallow self-review, and restrict it to `main`;
- configure `marketplace-release-read` with Marketplace-journal read authority, application-D1 read authority, and an R2 key pair restricted to object reads for the package bucket; expose them as `MARKETPLACE_JOURNAL_READ_TOKEN`, `APPLICATION_PLUGIN_READ_TOKEN`, `PLUGIN_PACKAGE_R2_READ_ACCESS_KEY_ID`, and `PLUGIN_PACKAGE_R2_READ_SECRET_ACCESS_KEY`;
- populate Alchemy output variables and separately approved secret-store credentials named in the workflow;
- make `MARKETPLACE_APPROVED_RELEASE_SET_DIGEST` equal the independently approved exact identity/release/review set digest.

These controls are documentation requirements; this repository does not claim that GitHub or Cloudflare has been configured.

## Baseline and retry behavior

The authoritative baseline starts from the Marketplace-owned D1 journal. It is not the previous push SHA and not a Git-authored ledger. Before export, every row marked published is checked through read-only interfaces against exact application D1 state and a complete R2 GET whose byte length and SHA-256 match the journal. The envelope is bound to the current merge SHA and uploaded/downloaded inside the same authenticated workflow run. Only then is `durableStateVerified: true` emitted. The boolean is not a signature and is not intrinsically trustworthy in hand-authored JSON; its authority comes from same-run artifact provenance, merge binding, and the credential separation between baseline and build jobs. Missing, stale, tampered, or unreadable durable state fails the workflow closed.

Every candidate is keyed by `(marketplaceId, publisherNamespace, pluginSlug, semanticVersion)`. Same version with changed source, executable bytes, catalog, Config, provenance, or authority fails. Failed and interrupted rows are rebuilt from protected source and exact review data, then reconciled against application D1 and R2. A retry may originate from a later merge commit while preserving the original immutable approval/content identity. The monotonic baseline updates only after application post-publication readback and only for a greater release ordinal; older concurrent completion cannot regress it. Failed rows remain discoverable.

Authority review has explicit lineage. A first publication must use the derived bootstrap snapshot with no tools, hosts, Config, provider registration, or credential authority. A later publication must name the verified previous Plugin identity and release digest, and its `authorityBefore` digest must equal that durable row's reviewed authority digest. This lineage is included in the release digest; an arbitrary PR-local or bundle-local “before” snapshot is rejected.

The reviewed lineage stays frozen across retries, but the trusted publisher revalidates it against the current journal and exact application state before any publication write. The named predecessor must still be the latest prior published row for the same Marketplace/publisher/slug and must still be published, not revoked or mismatched. A concurrently published newer predecessor makes the attempt stale; the publisher never recomputes lineage from the retry candidate itself.

Merge commit and release ordinal are attempt authority, not immutable Plugin content authority. Both are carried by the release-set envelope and its approved digest. Trusted publication requires exact equality with `GITHUB_SHA` and the safely parsed `GITHUB_RUN_NUMBER`; each bundle must repeat those exact values. A later-merge retry receives a newly trusted ordinal while the journal retains the original successful claim's audit fields. Artifact-controlled ordinal tampering fails before journal or provider writes.

Selection skips an unchanged published Plugin only when its same-run exported row carries current `durableStateVerified: true` evidence. Outside that authenticated workflow provenance, operators must not treat the field as proof. A journal dump produced without application/R2 verification fails with `published-state-reverification-required`. Verified unchanged Plugins incur zero package builds and zero PUTs.

An exact application row reported as revoked is emitted as `durableStateRevoked: true` after immutable-row and R2 verification. It does not become installable or get republished. Selecting that exact source fails with `published-version-revoked`; unrelated Plugin releases continue normally. Re-enabling or superseding a revoked version is an explicit operator/application decision, not automatic baseline recovery.

Removing a source does not delete, revoke, or mutate anything. Managed remote records never create package archives.

## Publication adapter

`CloudflareR2S3ArtifactStore` uses the documented R2 S3 endpoint, exact Phase 1 content key, conditional `If-None-Match: *`, and complete GET hash verification. `Phase1D1PublicationAdapter` uses the D1 query API's `{ batch: [{ sql, params }] }` request form and Phase 1 rows. Its final statement deliberately violates a required app table constraint when prior conditional statements did not reach the expected state. Cloudflare documents D1 batches as transactions that roll back together on failure, while the REST reference documents the `{ batch }` request body. Offline tests prove the exact SQL guard rolls back against SQLite using the hash-pinned Phase 1 migration with foreign keys enabled and prove the REST request/response encoding through an injected HTTP transport. They do **not** claim that a live Cloudflare REST rollback acceptance test occurred; that remains a separately authorized live gate. The adapter never infers rollback from post-commit `meta.changes`.

Primary contract evidence: [D1 query API request body (`{ sql, params }` or `{ batch }`)](https://developers.cloudflare.com/api/resources/d1/subresources/database/methods/query/) and [D1 `batch()` transaction/rollback guarantee](https://developers.cloudflare.com/d1/worker-api/d1-database/#batch).

Workflow action pins are recorded in `compatibility/github-action-pins.json`. The commits were resolved directly from each upstream tag with `git ls-remote`; the annotated `pnpm/action-setup@v4.1.0` tag is pinned to its peeled commit rather than its tag-object SHA. Tests require every workflow `uses:` entry to match that evidence.

`pnpm release publish <directory> --dry-run` needs no credentials and writes nothing. Production mode fails closed unless every named configuration value is present, the workflow SHA equals the bundle merge commit, artifact scans pass, every protected full-identity review matches reconstructed archive/source authority, and the approved release-set digest matches.

## Application compatibility and remaining gates

The pinned Phase 1 package and publication contracts now accept reviewed `github-app` metadata and require an explicit matching publication expectation. No credential value enters the archive, Config, or static platform bindings: the trusted Actor privately supplies `PLUGIN_ACCESS_TOKEN`. The candidate source is MIT-licensed, but Marketplace does not publish GitHub until provider registration, independent release review, and live acceptance are separately verified.

The pinned publisher now resolves Config by exact digest, revision, and recursively strict canonical fields; it reuses the actual persisted identity and uses `config:sha256:<digest>` only for a new schema. The portable adapter mirrors that behavior, including one bounded retry after a transactional unique-digest race. This closes the prior offline compatibility blocker without changing the SQL bytes now allocated to migration `0042`; live D1 transaction and concurrency acceptance remains pending.
