# Buffer MCP publication

The candidate is `plugins/remotes/buffer.json`. Its fixed Streamable HTTP endpoint is
`https://mcp.buffer.com/mcp`. It remains staged until authenticated capture and review are complete.

## Verified public provider facts

Checked on 2026-10-28:

- [Official MCP guide](https://developers.buffer.com/guides/integrations/mcp.html).
- [Protected resource metadata](https://mcp.buffer.com/.well-known/oauth-protected-resource/mcp):
  resource `https://mcp.buffer.com/mcp`, authorization server `https://auth.buffer.com`.
- [Authorization server metadata](https://auth.buffer.com/.well-known/oauth-authorization-server):
  authorization endpoint `/auth`, token endpoint `/token`, dynamic registration `/reg`, PKCE S256,
  authorization code and refresh grants, token endpoint authentication `none`, and resource parameter
  support. `offline_access` appears in authorization metadata, not protected-resource scopes.
- An unauthenticated MCP initialize request returns 401 and the exact resource metadata URL above.

The proposed scopes cover named account, channel discovery, post, idea, analytics, and template
operations, including writes, with `offline_access` for durable connections. Their exact mapping must
be verified against the consented catalog. Account settings, channel administration and engagement
scopes are not added merely because metadata advertises them.

## Capture and review

1. Register the review client through the advertised DCR endpoint with PKCE S256. Keep registration
   material, callback state, authorization codes and tokens outside public source and diagnostics.
2. Have the Owner complete Buffer sign-in and consent. Capture every `tools/list` page; retain only
   tool names, descriptions and exact input schemas. The existing
   `marketplace capture-remote-catalog` command normalizes this credential-free evidence.
3. Review `get_account` and retain only its redacted output shape to establish a stable account
   subject and display label. Never infer account identity from email or organization names.
4. Review the token response policy, scope behavior, expiry bounds, refresh rotation and revocation.
   Public metadata advertises refresh support but does not establish these lifecycle details.
5. Classify each admitted tool. `create_post` can publish immediately; write tools require explicit
   policy review, and deletion tools need destructive classification. Review generic GraphQL query
   and mutation tools separately rather than treating them as bounded named operations.
6. Record exact source/catalog/provider/authority digests and the required independent approval.
   Only then promote the release entry and perform trusted publication and application readback.
7. Verify Store visibility, install, per-user OAuth, catalog compatibility, invocation, reconnect,
   and disconnect. A schema capture or offline gate does not prove these behaviors.

Buffer documents account-wide authorization across all accessible organizations and channels.
Do not imply OAuth isolates a connection to one organization. Decide any narrower runtime resource
binding from reviewed output shapes and tool inputs. The current opaque label is a staged placeholder.
No post, idea, template, or channel mutation is necessary for catalog capture.
