# Managed remote candidates

These records preserve fixed provider endpoints, OAuth definitions, registration modes, bounded scopes, and documentation-derived candidate catalogs from primary provider evidence. `reviewed-publishable` admits reviewed source and authority for publication; it does not claim live OAuth, a consented catalog capture, privacy acceptance, or application acceptance. A nonzero catalog digest means only that the documented candidate bytes are pinned; it is not a consented `tools/list` capture. A zero digest and empty list remain an explicit fail-closed sentinel. Each candidate is registered separately in `releases/index.json`; eligibility can never accidentally enable this whole directory.

| Provider                           | Offline declaration                                                 | Candidate tools                   | Live promotion blockers                                        |
| ---------------------------------- | ------------------------------------------------------------------- | --------------------------------- | -------------------------------------------------------------- |
| Cloudflare                         | Dynamic OAuth, PKCE S256, 62 bounded scopes; `whoami` identity      | 4 code-mode tools (approval exec) | Live catalog equality, privacy, acceptance                     |
| Canva                              | Developer Portal OAuth; Owner review waiver                         | 49 consented tools                | Private platform registration and app deployment               |
| Buffer                             | Dynamic OAuth; Owner review waiver                                  | 17 consented tools                | Explicit bootstrap content selection app release               |
| Gmail                              | Preserved Workspace-owned OAuth behavior                            | Existing package catalog          | Developer Preview eligibility and OAuth verification           |
| Atlassian Rovo / Jira / Confluence | Dynamic OAuth; Owner review waiver                                  | 117 consented tools               | Coordinated tenant-issuer app release and publication          |
| Linear                             | Dynamic OAuth, PKCE S256, read/write scopes; reviewed subset        | 65 authenticated tools            | Live catalog equality, workspace identity, privacy, acceptance |
| Maple                              | Dynamic OAuth, PKCE S256, `mcp:tools`; read-only reviewed subset    | 24 authenticated read tools       | Live catalog equality, org identity, privacy, acceptance       |
| Notion                             | Dynamic OAuth, PKCE, rotated refresh, `notion-fetch` self identity  | Four documentation-derived tools  | Live catalog equality, per-plan access, privacy, acceptance    |
| PostHog                            | Dynamic OAuth, PKCE S256, 42 bounded scopes; OIDC userinfo identity | 1 CLI-mode tool (approval exec)   | Live catalog equality, privacy, acceptance                     |
| Resend                             | Deployed public CIMD OAuth; `emails:send` only                      | `send-email` from official source | Live catalog equality, team identity, privacy, acceptance      |

Notion's MCP token is never sent to REST `/v1/users/me`. Resend OAuth is the default; API-key bearer
provisioning remains an alternative outside this candidate. GitHub and Slack are included in the current requested release scope; their hosted declarations await
completed consent capture. Rovo uses the exact captured schemas and MCP-audience bootstrap authority.

Render `resend-cimd.json.template` by replacing every `{{PUBLIC_ORIGIN}}` with the approved public
HTTPS origin. The resulting document is served at
`$PUBLIC_ORIGIN/.well-known/oauth-client/resend.json`; its redirect URI must remain exactly
`$PUBLIC_ORIGIN/v1/plugins/oauth/callback`. The approved production origin is `https://supernala.com`;
the declaration and deployed document must be updated together if that origin changes.

## New provider promotion evidence

The Owner-consented Atlassian, Canva and Buffer catalogs, exact final scope sets, rotating refresh
behavior and redacted identity output shapes were captured on 2026-10-28. Their source declarations
have Owner authorization with independent review waived (not passed). Coordinated app prerequisites
and trusted publication remain required. See [Rovo](../../docs/rovo-mcp.md), [Canva](../../docs/canva-mcp.md) and
[Buffer](../../docs/buffer-mcp.md) for exact evidence and remaining acceptance.

GitHub and Slack were subsequently added to the requested release scope. Slack's paste-ready app
manifest is `slack-app-manifest.json.template`; it enables MCP and token rotation with the 30
advertised user scopes. Its internal-app capture and public Marketplace eligibility remain separate
gates. GitHub's existing three-tool package candidate is distinct from the newly requested hosted
MCP user OAuth integration; no captured hosted GitHub catalog or release eligibility is asserted yet.
