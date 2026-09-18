# Supernala Marketplace

Public, curated source and offline tooling for Supernala Plugin releases. This repository owns reviewed authoring source, deterministic build recipes, authority review records, and publication history. Private R2 owns executable bytes; application D1 alone controls Store visibility and installability.

## Commands

```sh
pnpm install --frozen-lockfile
pnpm marketplace validate plugins/offline-fixture
pnpm marketplace prepare plugins/offline-fixture artifacts/offline-fixture.plugin
pnpm marketplace inspect artifacts/offline-fixture.plugin
pnpm marketplace diff-authority plugins/offline-fixture plugins/github
pnpm marketplace conformance fixtures/mcp/stdio.jsonl
pnpm marketplace plan-publication plugins/offline-fixture artifacts/offline-fixture.plugin artifacts/publication-plan.json REVIEW-ID REVIEWER AUTHORITY_DIFF_SHA256 REVIEWED_AT_EPOCH_MS
pnpm marketplace public-safety
pnpm marketplace export-schemas
pnpm release baseline <baseline.json> <merge-sha>
pnpm release build <baseline.json> <output-directory> <merge-sha> <reserved-release-ordinal>
pnpm release publish <output-directory> --dry-run
pnpm check
```

The legacy publication-plan command remains useful for contract inspection. The merge release machinery reads a durable journal baseline, independently verifies published rows against exact application D1 state and complete R2 bytes, builds only selected Plugin versions, and uses verified R2/D1 publication adapters. Dry-run never writes. A published row without current durable-state evidence fails closed rather than being silently skipped. Production publication requires explicit configuration and has not been enabled or called.

`plugins/offline-fixture/dist/server.mjs` is checked-in fixture source despite the general `dist/` ignore rule. Its exact bytes are bound by `fixtures/golden/offline-package.json`; do not regenerate or reformat it. Clean-clone checks require this file without a build step.

See `docs/release-operations.md` and `docs/infra-ownership.md` for trust boundaries, recovery behavior, Alchemy ownership, and required operator configuration.

## Local production releases

After the one-time infrastructure and private credential setup in [release operations](docs/release-operations.md):

```sh
git switch main
git pull --ff-only
pnpm marketplace deploy --environment production
```

The command verifies fetched `origin/main`, checks an isolated exact-commit checkout, reserves durable release authority, builds with no inherited credentials, displays the release and authority diffs, and asks for the exact digest before publishing. It never enables ineligible Plugins or upgrades existing installations. GitHub Actions runs checks only; merges do not publish automatically.

```sh
pnpm marketplace deploy --environment production --status
# Only after ALL old publishers and their in-flight requests have stopped:
pnpm marketplace deploy --environment production --recover-attempt ATTEMPT_UUID
```

Failed/uncertain attempts retain a non-expiring lock. Explicit recovery abandons only the attempt, not Plugin records or artifacts; the next deployment reconciles the durable baseline.

Supernala-authored repository source is licensed under the [MIT License](LICENSE), copyright 2026 Supernala contributors. See [NOTICE](NOTICE) for scope. This does not relicense third-party dependencies, copied upstream material, provider services, trademarks, or remote-provider content; their respective licenses and terms continue to apply.

## Status

The repository supports offline authoring and acceptance. Live publication, Store visibility, Owner OAuth/install/invocation, outage independence, and revocation evidence remain human-controlled acceptance gates.
