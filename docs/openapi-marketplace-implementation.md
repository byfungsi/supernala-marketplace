# OpenAPI Marketplace offline implementation handoff

Date: 2026-09-24. Both repository worktrees are uncommitted; this is offline compatibility evidence, not a deployment or live release.
Marketplace baseline HEAD: `d171af822a3111616fd3023881e1b89d718b9153`. Application checkout HEAD: `500d4fd3715ef2ed97f99a16bdc2dfba130fa367`; the new application contract and migration are **uncommitted** source bytes separately pinned in `compatibility/phase-1-sources.json`, not content available from that HEAD alone.

## Authoring profile

### Hosted JSON authoring (explicit network refresh)

Create a staged source and fetch it in one explicit authoring action:

```sh
pnpm marketplace create my-api --runtime managed-openapi --auth api-key --source-url https://docs.example.org/openapi.json
pnpm marketplace discover-openapi plugins/my-api --refresh-source
pnpm marketplace prepare plugins/my-api /path/to/output/first-bundle.json --refresh-source
pnpm marketplace validate plugins/my-api
pnpm marketplace prepare plugins/my-api /path/to/output/offline-bundle.json
```

`discover-openapi ... --refresh-source` fetches and reports supported security-scheme names, candidate operation IDs, method/path, effective authentication, stable proposed tool ID, safe unsupported reason, and removed/incompatible selected IDs **without changing the source tree**. Use this report when preparation fails. `prepare ... --refresh-source` pins exact SHA-256 source bytes as `openapi-<sha256>.json` and compiles selected operations. An initial import automatically chooses exactly one supported header-key or bearer scheme; with multiple schemes, inspect the report and set `credential.securityScheme` explicitly. A reviewed choice is never replaced. For example, a hosted document with `components.securitySchemes.BearerAuth: {"type":"http","scheme":"bearer"}` and `security: [{"BearerAuth":[]}]` works with the commands above and selects `BearerAuth` rather than the template placeholder. If it also declares `ResendApiKey`, choose the intended scheme in metadata before preparing. On first import, supported candidates are scaffolded with `classification: "unknown"` and `defaultPolicy: "block"`; inspect and curate `operations`, policy, title and output bounds. Subsequent refreshes preserve selected stable IDs; removed or incompatible selections fail without replacing the previous pin. Candidates are not published tools. `validate`, offline `prepare`, `inspect`, release build/publish and Agent discovery never fetch a source URL. Agent discovery uses only the published catalog.

Hosted sources must be public HTTPS JSON on a DNS name with no URL credentials, query or fragment; use no private/spec-token URLs. The authoring fetch validates all resolved addresses as public, pins the selected address for the TLS connection, rejects redirects, accepts JSON media types only, enforces a 10-second deadline and streamed 1 MiB limit, validates UTF-8 and structural bounds, and emits safe reason codes. No provider credential is sent. The locally pinned bytes and URL/hash/version lock participate in source review binding and provenance. A missing or modified pin fails offline validation and trusted release. Immutable pins are retained across refresh, and the metadata switch is atomic.

For changed upstream bytes, first increment `version` and its matching `pluginVersionId`, assign a new `catalogSnapshotId`, then run `prepare ... --refresh-source` with a new output filename. This helper does **not** bump identifiers automatically. Review the candidate delta and policy; set `status` to `reviewed-publishable` only after approval, then obtain a fresh exact release review and follow the existing release build/publish path. Editing the version alone never fetches. Published versions and existing installation/grant scopes remain immutable; installation updates are explicit. A refresh of unchanged bytes can be repeated without changing identifiers.

`managed-openapi` accepts a pinned JSON OpenAPI 3.0/3.1 source (local file or explicitly refreshed hosted source) and a separate credential-free `openapi-source.json` selection. A release chooses explicit operation IDs and stable tool IDs, with reviewed title, classification, default policy, and output limit. The compiler supports one fixed HTTPS origin, exactly one selected API-key security scheme (raw header key or HTTP bearer) and public operations via `security: []`. A selected operation with ambiguous AND/OR security, operation/path server override, external/cyclic reference, unsupported parameter serialization, unsupported request media, or unsupported input schema fails closed with a safe reason. Local JSON-pointer references resolve within bounded depth. Source declarations do not contain credential values. The selected API-key definition remains mandatory even if every operation is public. OAuth, mixed auth methods and full OpenAPI compatibility are outside this draft.

The authoring compiler limits the local source to **1 MiB UTF-8** and checks 64 levels / 100,000 JSON members before recursive decoding; the application and Marketplace bundle admission share the **10 MiB artifact** and the same structural bounds. Explicit malformed security, `required` or `explode` declarations are rejected rather than treated as defaults. Duplicate parameters within a path or operation list are rejected, while a single operation parameter may override a path parameter with the same name/location.

Two different synthetic APIs, inventory (public list GET, secured detail GET with path/query parameters, and approval-gated secured POST) and bearer-secured ledger (path parameter via a local reference), run through the same compiler. The inventory source under `plugins/openapi-inventory/` remains staged-unverified and ineligible for the release index. The joint offline test makes a temporary reviewed copy for the publisher; it does not approve the checked-in source.

From the Marketplace checkout:

```sh
pnpm marketplace create my-api --runtime managed-openapi --auth api-key
pnpm marketplace validate plugins/openapi-inventory
pnpm marketplace prepare plugins/openapi-inventory /path/to/output/bundle.json
pnpm marketplace inspect /path/to/output/bundle.json
node tools/vendor-plugin-openapi-contract.mjs check /path/to/application/packages/domain/schema
```

The create template is intentionally unreviewed. Fill the origin, scheme, and operation selection before validation. The normal `pnpm release build <verified-baseline.json> <output-directory> <merge-commit> <ordinal>` and `pnpm release publish <output-directory> --dry-run` vocabulary uses the same protected `releases/reviews/<identity>.json`, verified baseline, release set, source digest, authority diff, and trusted publication workflow as packages/remotes. No new publish service or public credential path was introduced. Publication requires the source to be `reviewed-publishable`, an eligible release-index entry, and an exact independently approved review.

## Application contract and publication

The application exported schema/contract-source/canonical-source/fixture/manifest are vendored byte-identically in `compatibility/openapi-v1/`. The broad OAuth comparator source remains upstream; its hash is pinned in the manifest and checked by the vendor command without publishing unrelated source here. Local semantic validation mirrors the application contract and verifies independent SHA-256 values for exact bundle bytes, source text, and UTF-8-key-ordered catalog JSON. The fixed golden accepted artifact is `7f9fdcd184bab697c6da00cd177059e4a052ae3f126b5c8c3fb3a7ce1802bba4`, source `de6e3c42db3a5d5ad42590062d2e8ac980f1affa796331a62eefa33f161a645f`, catalog `64a98955eac37466707955ee4de9afcb3e7515f424fe7f6469b1ac1dded6571f`. Those exact fixture bytes differ from a fresh compiler output with different reviewed tool descriptions, IDs or source formatting; each compiler output recomputes its own three digests.

For cross-repository offline verification, with the application checkout path supplied by the operator rather than embedded in production:

```sh
pnpm --dir /path/to/application/packages/domain openapi-contract:verify-golden /absolute/path/to/marketplace/compatibility/openapi-v1/plugin-openapi-golden.v1.json
pnpm --dir /path/to/application/apps/api openapi-candidate:verify /absolute/path/to/marketplace/compatibility/openapi-v1/plugin-openapi-golden.v1.json
```

The existing release machine claims a journal record, stages an immutable `publishing` D1 version with an intent, uploads to `openapi/<artifactDigest>` conditionally and verifies full R2 bytes, then atomically marks artifact/intention verified and transitions the version to `published` under the application's `0081` guard. A separate D1 readback checks the exact artifact, catalog, empty config, auth definition, provider, hosts and provenance projection. Retry reuses verified immutable bytes and the same journal claim; the published baseline independently verifies R2 bytes and D1 state. This does **not** establish Cloudflare production migration, public egress, live provider behavior, Store visibility, installation, invocation, or revocation acceptance. Production egress validation belongs to live rollout, not this offline compiler gate.

The reviewed `providerRegistrationId` is a prerequisite in the application’s existing provider registry, not a registration created by this publisher. Before a release, platform authority must create or approve an active generic provider-registration record whose ID matches both the reviewed source credential definition and the compiled auth strategy. The publisher stages neither provider-specific OAuth material nor a credential value; an absent or revoked registration makes D1 staging fail atomically. A separate provider-registration approval is required for a new real API, followed by the exact release review. The offline synthetic Inventory test creates a generic active registration and also proves missing registration fails without leaving a staged version.

Changing shared release code changes the shared-source digest. The existing protected Gmail review is therefore stale; the checked-in review was not rewritten. Its regression asserts that stale binding and separately uses a newly bound in-memory review for legacy publication rehearsal. Any real release needs an independently approved review for the new source and a verified baseline.

## Verification evidence

Focused compiler, vendor, release-bundle and SQLite migration/retry tests exercise the new path, including interrupted upload and finalization resumed through the same journal with one immutable PUT, exact catalog-tool readback, D1 interleaving rollback, a tampered artifact rejected on load, and actual `release build` / `publish --dry-run` CLI acceptance. The portable pinned fixture sequence exercises `0081` with placeholder unrelated installation triggers; stronger joint migration evidence uses the **actual application migration sequence** through `0081` by setting `MARKETPLACE_APPLICATION_MIGRATIONS_DIR=/path/to/application/apps/api/application-migrations` for the focused SQLite test. The approved full offline `pnpm check` with that variable passed format, zero-warning type-aware lint, Marketplace and infra typechecks, and **241 tests across 30 files**. `pnpm marketplace public-safety` passes after removing the unnecessary broader OAuth source snapshot from the public vendor directory. The vendor `check` passed against the configurable application checkout. Both application CLI verifiers accepted the vendored golden fixture, and the application candidate verifier independently admitted freshly compiled Inventory bytes (`7e1187c5ab65aadff5957aa778e94a3683956b30c56e605d7e41fa2ff8427bde`, catalog `cf12f08a31bcd93a572bd7a9b6bcccd9aadd5062450abb1d2988609729c08900`). Neither repository has been committed, pushed, deployed, or called a live provider/model for this handoff.

## Joint published-artifact offline acceptance

The focused Marketplace publication test compiles the checked-in Inventory selection, constructs an exact approved review over a temporary reviewed copy, builds the reviewed release bundle, and runs the existing `publishIncrementalRelease` / `Phase1D1PublicationAdapter` against the operator-selected **actual application migrations through `0081`**. After guarded finalization and D1/R2 readback, an optional export writes a SQLite backup, the exact immutable artifact bytes, and a digest/identity manifest. The application test copies that database (keeping the export immutable), admits the exported bytes against the published rows, then exercises Store discovery/detail, install, workspace activation, declared API-key setup through the vault, two distinct Connections and Agent grants, and the existing Code Mode evaluation bridge through the actual Connection actor and offline recording HTTPS transport. A trusted fixture JavaScript program executes in an **in-process Node VM test adapter**, not the deployed SES isolate; it branches, loops and makes dependent calls using `program.input` and the real bridge. Each Connection's run asserts public omission, exact credentialed destination/path/query/header, separate credentials and durable outcomes. A mutation on the same version has zero sends before approval and exactly one after approval, with an observed original-turn continuation callback signal (not a second program execution). No provider-name-specific runtime branch or direct version/connection SQL insertion is used in this bridge. The generic active provider-registration row is seeded by the existing offline publication fixture; real authority remains independently platform-approved.

Reproduce with absolute, operator-chosen paths (the export directory must be outside both repositories):

```sh
export MARKETPLACE_APPLICATION_MIGRATIONS_DIR=/path/to/application/apps/api/application-migrations
export MARKETPLACE_OPENAPI_JOINT_EXPORT_DIR=/path/to/temporary/openapi-joint
# In the Marketplace checkout:
pnpm exec vitest run src/plugin-openapi-publication.test.ts
# In the application apps/api checkout, with the same export directory:
pnpm exec vitest run src/plugin-openapi-marketplace-joint.test.ts
```

The application joint test requires the export variable and fails if absent. The export is a test-only offline fixture, not a deployable review or publisher credential. Live R2/D1 publication, Store visibility, installation, public egress, provider invocation and revocation acceptance remain separate rollout gates.

Final joint fixture readback: artifact `367b43dcc22f77e782b5f59f520117501f38d197d97c7ccea24bbde7e18017bc`, catalog `bb1ef95b08ecc1cc75b5eb91a85542cbbfe187c3ca9487d46a7c5a9dafc7e3ad`, release `82f5c604ad83c20b0a1307ccb98d0278f794e25ced6346f69f4fad0a835e3e94`. The focused Marketplace export and application joint test passed; focused application API typecheck and zero-warning autofix lint passed. The approved full Marketplace `pnpm check` with actual application migrations passed format, lint, both typechecks, and **241 tests across 30 files**; `pnpm marketplace public-safety` returned `safe: true`. These joint digests supersede the earlier two-operation Inventory compiler example above; the frozen application golden fixture remains unchanged.
