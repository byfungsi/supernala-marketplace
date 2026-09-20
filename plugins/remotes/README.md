# Managed remote candidates

These records preserve fixed provider endpoints, OAuth definitions, registration modes, bounded scopes, and documentation-derived candidate catalogs from primary provider evidence. They are deliberately `staged-unverified`: no live OAuth, catalog capture, eligibility, provider-account, or conformance call was authorized. A nonzero catalog digest means only that the documented candidate bytes are pinned; it is not a consented `tools/list` capture. A zero digest and empty list remain an explicit fail-closed sentinel. Each candidate is registered separately in `releases/index.json`; eligibility can never accidentally enable this whole directory.

| Provider              | Offline declaration                                                | Candidate tools                   | Live promotion blockers                                            |
| --------------------- | ------------------------------------------------------------------ | --------------------------------- | ------------------------------------------------------------------ |
| Gmail                 | Preserved Workspace-owned OAuth behavior                           | Existing package catalog          | Developer Preview eligibility and OAuth verification               |
| Atlassian Rovo / Jira | Dynamic OAuth; staged-unverified                                   | Awaiting consented catalog        | Consent, MCP-audience identity compatibility, privacy, eligibility |
| Notion                | Dynamic OAuth, PKCE, rotated refresh, `notion-fetch` self identity | Four documentation-derived tools  | Consented exact schemas, per-plan access, privacy                  |
| Resend                | Public CIMD OAuth; `emails:send` only                              | `send-email` from official source | CIMD deployment, live team identity, consented catalog, privacy    |

Notion's MCP token is never sent to REST `/v1/users/me`. Resend OAuth is the default; API-key bearer
provisioning remains an alternative outside this candidate. Slack was deferred by the Owner and has
no v0 declaration or release entry in this expansion. Provider facts must be re-reviewed before
replacing `staged-unverified`.

Render `resend-cimd.json.template` by replacing every `{{PUBLIC_ORIGIN}}` with the approved public
HTTPS origin. The resulting document must be served at
`$PUBLIC_ORIGIN/.well-known/oauth-client/resend.json`; its redirect URI must remain exactly
`$PUBLIC_ORIGIN/v1/plugins/oauth/callback`. The checked-in `https://supernala.com` declaration is an
undeployed staging assumption and must be updated if the approved origin differs.
