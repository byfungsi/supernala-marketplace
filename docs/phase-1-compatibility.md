# Phase 1 compatibility

The Marketplace contract is pinned to rebased Supernala `feat/atlassian-rovo` commit `e005e9d`
against checkpoint `1c695bd`. This compatibility reference does not claim deployment;
`compatibility/phase-1-sources.json` pins the exact reviewed files and bytes.

The portable implementation preserves the two runtime descriptors, branded identity constraints,
canonical JSON digesting, ZIP safety limits, package manifest/catalog/config semantics, private R2
object-key formula, and internal publication input shape. Managed-remote release bundles use null
artifact fields and carry declarations only. The reviewed protocol policy is persisted as immutable
version provenance and exact endpoint registration policy, then rechecked on readback. No absolute
import or file dependency points at the application repository.

The application currently exposes packaged publication functions only as internal functions. Immutable
migration `0051_workspace_owned_oauth_authority.sql` establishes Workspace-owned OAuth authority, and
`0052_workspace_file_usage_initialization.sql` initializes file usage independently. Additive migration
`0053_managed_remote_oauth_publication_authority.sql` admits reviewed OAuth authority for managed
remotes, including dynamic registration whose client material is created later during the first Owner
authorization. The shared Marketplace adapter handles package and remote persistence; ordinary Plugin
additions do not change SQL or adapter code. There is no authenticated production publication endpoint.
The adapter targets documented Cloudflare D1/R2 interfaces and remains disabled until credentials and
environments are explicitly approved; Cloudflare D1 tokens are not assumed to enforce table-level
authority. `plan-publication` remains a checked offline contract artifact.

Migration `0054_managed_remote_dynamic_oauth_runtime.sql` binds the published version's reviewed
provider definition to the platform dynamic registration after DCR, records the Vault-backed material
origin, and retains that exact client authority through callback, refresh, and disconnect.
Migration `0055_plugin_auth_strategies.sql` adds the reviewed Workspace OAuth, MCP OAuth, API-key, and
device OAuth strategy definitions without replacing Workspace-owned Gmail authority.

Pinned Phase 1 resolves Config schemas by exact digest, revision, and recursively strict canonical
fields, reuses the actual persisted identity (including legacy IDs), and assigns new rows
`config:sha256:<digest>`. Concurrent alternate-ID winners are accepted only after rollback and exact
bounded re-resolution. Marketplace fixtures pin exact application migration bytes through `0055`.

Authentication strategy contract version 1 is distributed from Supernala as
`packages/domain/schema/plugin-auth-strategy-definition.v1.schema.json`. Marketplace consumes the
byte-identical `schemas/plugin-auth-strategy-definition.schema.json`; the source manifest pins both
the authoritative schema and the owning Effect schema. The local Effect decoder is the runtime
projection of that versioned distribution, not an independently versioned contract.
