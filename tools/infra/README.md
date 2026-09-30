# Marketplace release infrastructure

Alchemy `2.0.0-beta.77` is the only infrastructure definition for Marketplace release state. The stack provisions one Marketplace-owned D1 database, `MarketplaceReleaseJournal`, with `migrations/0001_release_journal.sql`, the additive `migrations/0002_local_release_attempts.sql` for local-operator exclusivity and ordering, and `migrations/0003_managed_openapi_release_journal.sql` for managed OpenAPI claims. Apply all three before using the local deploy command; do not modify applied migrations.

The application stack continues to own `ApplicationDatabase` and `PluginPackages`. `alchemy.run.ts` uses cross-stack `Database.ref`/`Bucket.ref` references to read their identifiers for trusted release configuration; it does **not** create, import, adopt, migrate, or destroy those resources.

## Environments

The infrastructure package pins Effect and `@effect/platform-node` to `4.0.0-rc.112`, matching the application deployment tooling. A parent-specific workspace override also pins its `@effect/platform-node-shared` dependency to rc.112. Alchemy beta.77 uses `Config.string`, which is absent from the publisher's Effect rc.115 runtime. Keep these dependency scopes separate; `src/marketplace-infrastructure.test.ts` checks actual credential-free CLI startup, not just TypeScript declarations.

Set only non-secret topology values when running an explicitly approved Alchemy operation:

- `MARKETPLACE_ENVIRONMENT=local|staging|production`
- `APPLICATION_ALCHEMY_STACK=supernala-api` (default)
- `APPLICATION_ALCHEMY_STAGE=<matching application stage>`

The Alchemy release stage names the journal database. Normally it matches the environment (`production`). After a full application reset, use a fresh release stage such as `production-20260921` while keeping the application stage `production`; this provisions a new journal and preserves the old stage's publication history. Refresh private publication topology and bucket-scoped credentials before publishing into the rebuilt application.

Provider credentials are supplied to Alchemy through its operator-approved secret mechanism and are never checked in. The stack outputs IDs/names only—never API tokens, S3 keys, or provider values. No deploy/plan/import/adopt operation is part of PR CI.

Deployment ordering is application stack first, then Marketplace release stack, then narrow trusted-release credentials referencing the three outputs. A release job needs write access to the Marketplace journal, the app Plugin tables in D1, and the private package bucket only. Build jobs receive none of those capabilities.

## Review the existing production journal migration

For an existing journal, determine its actual release stage from operator-owned Alchemy stack state and the known production journal topology. Verify that the stage's stack output identifies the same existing journal database used by the private release configuration. Do not infer the release stage from `MARKETPLACE_ENVIRONMENT`, the application stage, or an example date. Set `MARKETPLACE_RELEASE_STAGE` only after this verification; the application reference remains at stage `production`:

```sh
cd tools/infra
export MARKETPLACE_ENVIRONMENT=production
export APPLICATION_ALCHEMY_STACK=supernala-api
export APPLICATION_ALCHEMY_STAGE=production
: "${MARKETPLACE_RELEASE_STAGE:?Set to the verified existing Alchemy release stage}"
pnpm exec alchemy plan --stage "$MARKETPLACE_RELEASE_STAGE"
# After separate operator approval and review of the exact plan:
pnpm exec alchemy deploy --stage "$MARKETPLACE_RELEASE_STAGE"
```

Before approval, confirm the target is the _same existing_ journal database, that `0001` and `0002` are recorded as applied in `__alchemy_migrations`, and that the plan applies only `0003` to Marketplace-owned D1. Reject plans that create or replace a journal, select a different release stage, or touch application D1/R2. Capture a private pre-migration snapshot of journal, baselines, attempts, migration history and schema; after deploy, compare historical rows and checksums, inspect `PRAGMA foreign_key_check`, the runtime CHECK, indexes, and the `0003` bookkeeping row. Preserve the private snapshot outside the repository.

Pinned Alchemy reads ordered SQL files and skips applied names (`src/SQL/Migrations/AlchemyFormat.ts`); it sends each pending migration together with its bookkeeping INSERT via one multi-statement D1 HTTP query (`src/cloudflare/D1/ApplyMigrations.ts`). [Cloudflare documents](https://developers.cloudflare.com/d1/sql-api/foreign-keys/) that D1 runs every query in an implicit transaction with foreign keys enabled; this groups the rebuild and Alchemy bookkeeping without direct schema edits. The SQLite FK-on rehearsal exercises an explicit local transaction and rollback, but cannot prove remote production acceptance. If the D1 operation fails or leaves unexpected state, stop publication and investigate against the private snapshot; do not rerun blindly or edit applied migration history. The existing schema has no journal or baseline triggers to restore; `0003` recreates the journal index and baseline FK/constraints while leaving the attempts table and active-attempt index untouched.
