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

The new **uncommitted OpenAPI draft** is additive to this historical two-runtime pin. Its application
worktree HEAD and byte hashes are recorded separately in `openApiDraftUncommitted` in
`compatibility/phase-1-sources.json`. `compatibility/openapi-v1/` vendors the application schema,
contract source, canonical-order source, golden fixture, and manifest. The broad OAuth comparator
source remains upstream; its hash is pinned in the manifest and checked by the vendor tool. The Marketplace
semantic implementation checks the same accepted/rejected golden inputs and uses unsigned UTF-8
key ordering only for OpenAPI catalog bytes; the packaged and remote canonicalizer is unchanged.
`fixtures/sql/phase1-0081-managed-openapi-plugins.sql` pins the additive application guard for
offline SQLite rehearsals. Neither the historical checkpoint nor this worktree identifies a deployed
application migration or a live publication authority.

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

The current hosted MCP OAuth changes are recorded separately in `hostedMcpOauthDraft`,
with status `owner-review-waiver-not-deployed`. The Owner waived independent review; it was not passed. The historical reviewed pins remain intact.
This draft distributes the optional `resultTextContentIndex` bootstrap field (0–19)
from the owning application contract. Without that field, multipart JSON text results
remain rejected; an explicit index selects only the reviewed text block. OAuth issuer
validation also admits canonical HTTPS tenant paths while retaining existing origin
bytes and digests. The draft preserves the upstream seven-day access-token lifetime
limit. Application deployment and exact trusted publication remain separate gates.

Additive application migration `0142_hosted_mcp_preregistered_oauth.sql` admits a
hosted MCP version with an exact pre-registered strategy, active provider definition,
platform registration and deployment-environment material receipt. The publication
adapter verifies existing custody for this mode; an inline definition never creates
client custody. The application runtime now retains that authority through initial
authorization, callback and refresh. Focused tests exercise the real connection setup,
identity, refresh, Actor invocation and disconnect interfaces with a local provider,
and reject refresh after the receipt is retired. This baseline is deployed at `a078ec28`; Atlassian, Canva and Buffer publication/readback completed on 2026-10-29.

The current draft adds digest-bound comma-separated grants and explicit implicit scopes
for Slack, plus scope-free registered app permission authority for GitHub Apps.
Migration `0143_registered_app_permission_oauth.sql` limits scope-free hosted MCP
publication to exact pre-registered authority and active deployed client custody.
Existing scoped provider canonical bytes are unchanged. The coordinated application
change is merged in PR #437; deployment and GitHub publication remain separate gates.
The Owner subsequently authorized a Slack preview listing for testing with the existing
authorized workspace before Slack Marketplace approval. The listing explicitly states
that approval is pending and availability may be restricted; this is not a Slack
directory approval or authorization to install the app in additional workspaces.

The historical Phase 1 golden ZIP digest was captured with UTC+7 civil timestamps.
Its compatibility tests explicitly reproduce that capture timezone: the legacy
packager's fixed instant is serialized by ZIP as host-local DOS time. This keeps
the exact historical golden and reviewed production bytes intact. Making the
production packager independent of host timezone would be a coordinated shared
source/review migration, rather than silently replacing those pinned digests.
