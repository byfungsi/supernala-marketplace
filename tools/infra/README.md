# Marketplace release infrastructure

Alchemy `2.0.0-beta.77` is the only infrastructure definition for Marketplace release state. The stack provisions one Marketplace-owned D1 database, `MarketplaceReleaseJournal`, with `migrations/0001_release_journal.sql` and the additive `migrations/0002_local_release_attempts.sql` for local-operator exclusivity and ordering. Apply both before using the local deploy command; do not modify applied migrations.

The application stack continues to own `ApplicationDatabase` and `PluginPackages`. `alchemy.run.ts` uses cross-stack `Database.ref`/`Bucket.ref` references to read their identifiers for trusted release configuration; it does **not** create, import, adopt, migrate, or destroy those resources.

## Environments

Set only non-secret topology values when running an explicitly approved Alchemy operation:

- `MARKETPLACE_ENVIRONMENT=local|staging|production`
- `APPLICATION_ALCHEMY_STACK=supernala-api` (default)
- `APPLICATION_ALCHEMY_STAGE=<matching application stage>`

Provider credentials are supplied to Alchemy through its operator-approved secret mechanism and are never checked in. The stack outputs IDs/names only—never API tokens, S3 keys, or provider values. No deploy/plan/import/adopt operation is part of PR CI.

Deployment ordering is application stack first, then Marketplace release stack, then narrow trusted-release credentials referencing the three outputs. A release job needs write access to the Marketplace journal, the app Plugin tables in D1, and the private package bucket only. Build jobs receive none of those capabilities.
