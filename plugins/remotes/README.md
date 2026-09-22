# Managed remote candidates

These records preserve fixed provider endpoints, OAuth definitions, registration modes, bounded scopes, and documentation-derived candidate catalogs from primary provider evidence. `reviewed-publishable` admits reviewed source and authority for publication; it does not claim live OAuth, a consented catalog capture, privacy acceptance, or application acceptance. A nonzero catalog digest means only that the documented candidate bytes are pinned; it is not a consented `tools/list` capture. A zero digest and empty list remain an explicit fail-closed sentinel. Each candidate is registered separately in `releases/index.json`; eligibility can never accidentally enable this whole directory.

| Provider              | Offline declaration                                                | Candidate tools                   | Live promotion blockers                                        |
| --------------------- | ------------------------------------------------------------------ | --------------------------------- | -------------------------------------------------------------- |
| Gmail                 | Preserved Workspace-owned OAuth behavior                           | Existing package catalog          | Developer Preview eligibility and OAuth verification           |
| Atlassian Rovo / Jira | Dynamic OAuth; staged-unverified                                   | Awaiting exact public schemas     | Exact schemas and MCP identity/resource output paths           |
| Linear                | Dynamic OAuth, PKCE S256, read/write scopes; reviewed subset       | 65 authenticated tools            | Live catalog equality, workspace identity, privacy, acceptance |
| Notion                | Dynamic OAuth, PKCE, rotated refresh, `notion-fetch` self identity | Four documentation-derived tools  | Live catalog equality, per-plan access, privacy, acceptance    |
| Resend                | Deployed public CIMD OAuth; `emails:send` only                     | `send-email` from official source | Live catalog equality, team identity, privacy, acceptance      |

Notion's MCP token is never sent to REST `/v1/users/me`. Resend OAuth is the default; API-key bearer
provisioning remains an alternative outside this candidate. Slack was deferred by the Owner and has
no v0 declaration or release entry in this expansion. Rovo remains staged until its exact authority
can be represented without inventing schemas or token-audience assumptions.

Render `resend-cimd.json.template` by replacing every `{{PUBLIC_ORIGIN}}` with the approved public
HTTPS origin. The resulting document is served at
`$PUBLIC_ORIGIN/.well-known/oauth-client/resend.json`; its redirect URI must remain exactly
`$PUBLIC_ORIGIN/v1/plugins/oauth/callback`. The approved production origin is `https://supernala.com`;
the declaration and deployed document must be updated together if that origin changes.

## Minimal Rovo promotion evidence

The Owner must privately capture and review the authenticated v2 `tools/list` declarations for
`atlassianUserInfo`, `getAccessibleAtlassianResources`, and every tool proposed for the public
catalog. The retained public evidence needs only exact tool names, descriptions, and input schemas,
plus redacted output **shapes** from the two bootstrap tools that establish stable user subject and
display-label paths, the resources array path, site `cloudId` path, and site display-label path. It
must not retain tokens, headers, protocol captures, account IDs, cloud IDs, tenant names, site names,
or other provider payload values. Token response fields and refresh behavior must also be reviewed
before defining lifecycle policy; public metadata alone does not establish those facts. This evidence
must preserve Owner site selection and `cloudId` binding rather than replacing them with an opaque
connection identity. An app-native prepublication capture path remains outside the authorized scope.
