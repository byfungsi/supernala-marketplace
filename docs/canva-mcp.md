# Canva MCP publication

The declaration targets `https://api.canva.com/connect/v1/mcp`, the current official Developer
Portal MCP surface. The Owner authorized the captured source and waived independent review (not passed). Platform
registration, application deployment and trusted publication remain required.

## Captured evidence

On 2026-10-28 the Owner consented through the Developer Portal client. The final authorization
granted all 16 requested scopes, including design, asset, folder, brand, comment and help access.
`fixtures/mcp/captures/canva-20261028.json` preserves all 49 exact tool declarations. The source
catalog preserves their exact input schemas and supplies bounded curated descriptions and policies.
All writes require approval; editing operations and merge/cancel operations are classified
conservatively, and the internal `track-event-lifecycle` tool is blocked.

`get-logged-in-account-details` returned structured `id`, `team_id` and `name` fields. The reviewed
identity combines team and user IDs, with the returned name as display label. The real application
bootstrap transport resolved that declaration against the consented server. No design mutation was
performed to obtain this evidence.

Initial and refresh responses returned Bearer access tokens with a 14,400-second lifetime and
rotated refresh tokens. The refresh response omitted scope; the reviewed policy retains requested
scopes when omitted. `fixtures/mcp/captures/provider-evidence-20261028.json` contains only field
names, policy facts and redacted output shapes, never credential or account values. Remote token
revocation semantics remain unverified; the declaration explicitly uses local disconnect only.

## Registration and deployment

Create a Public app in [Your apps](https://www.canva.com/developers/apps), select Outside Canva,
Start integrating, and enable Canva MCP. Keep the client ID and secret in the private authoritative
application environment. Configure `https://app.supernala.com/v1/plugins/oauth/callback`, derived
from the authoritative production application origin. Temporary review callbacks are operator-owned
and are not production registration authority.

The app backend must bind the private client material to `canva-oauth-portal-v1`, the exact reviewed
provider-definition digest, `client_secret_basic` and a material version. The Alchemy deployment
loader accepts only explicitly declared client bindings, preserves secret redaction, and rejects
collisions with application bindings. Provider definition, registration and material-source admission
must match that deployed declaration before publication.

Deploy the coordinated application prerequisites, including migration
`0141_hosted_mcp_preregistered_oauth.sql`, before attesting the material source. Record
the verified deployment revision in the private receipt. The declaration, registration,
callback and material version must agree exactly; the registration retains a null
credential reference because the client secret comes from the declared Worker binding.
The publisher verifies that prior custody and never creates it from public plugin data.

The [protected-resource metadata](https://api.canva.com/.well-known/oauth-protected-resource/connect/v1/mcp)
binds the exact MCP URL to issuer `https://www.canva.com`. The provider's
[discovery document](https://www.canva.com/.well-known/openid-configuration) identifies authorization
at `https://www.canva.com/api/oauth/authorize` and token exchange at
`https://api.canva.com/auth/v1/oauth/token`. Basic client authentication and the actual token
exchange/refresh were verified through the consented client.

The historical `mcp.canva.com` CIMD surface uses a different resource and issuer. Its retained
CIMD template is historical material and is not the active registration.

## Remaining acceptance

The Owner waived independent source/authority review; it was not passed. Retain exact digest-bound
release approval and complete platform admission,
coordinated app deployment, trusted Marketplace publication and durable readback. Verify Store
visibility and normal per-user installation/connect/invocation/disconnect in production. Capture,
offline tests and local transport verification do not establish production publication.

Each user authorizes their own Canva account. Plan restrictions remain provider-enforced; do not
imply the Supernala developer's subscription is shared with users. See the
[official quickstart](https://www.canva.dev/docs/apps/quickstart/),
[access requirements](https://www.canva.dev/docs/apps/mcp/access/) and
[tool/plan availability](https://www.canva.dev/docs/apps/mcp/tools/).
