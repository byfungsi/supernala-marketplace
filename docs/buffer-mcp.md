# Buffer MCP publication

The declaration targets `https://mcp.buffer.com/mcp` using dynamic OAuth registration. It remains
staged while independent review, coordinated bootstrap transport deployment and publication are
prepared.

## Captured evidence

The Owner completed final consent on 2026-10-28. The server granted exactly eight resource scopes:
account read, idea read/write, insights read, post read/write and snippet read/write. The final
request omits `offline_access`; Buffer still issues a refresh token. Requesting that protocol scope
would produce a granted scope string excluding it, which conflicts with the existing exact-scope
policy. The final eight-scope request and refresh both returned the exact reviewed resource scopes.

`fixtures/mcp/captures/buffer-20261028.json` preserves 17 exact named tools covering accounts,
channels, posts, ideas, analytics and templates. Every captured schema is retained in the source
catalog. Writes require approval; delete operations are destructive and require approval. Generic
GraphQL execution tools are not in this consented catalog and are not invented from documentation.

`get_account` returned account `id` and `name` in JSON text content block 0, followed by a separate
rate-limit block. The reviewed bootstrap operation explicitly selects block 0 with
`resultTextContentIndex`; undeclared multipart responses continue failing closed. The application
transport resolved that identity against the live consented server. This is an account-wide
connection across accessible organizations and channels, not an organization-isolated OAuth grant.

Initial and refresh responses returned Bearer tokens with a 3,600-second access lifetime and
rotated refresh tokens. Credential-free policy facts and redacted identity shapes are retained in
`fixtures/mcp/captures/provider-evidence-20261028.json`. Public metadata advertises no revocation
endpoint; disconnect deactivates local access without claiming remote token revocation.

## Public metadata

Checked against the [official MCP guide](https://developers.buffer.com/guides/integrations/mcp.html),
[resource metadata](https://mcp.buffer.com/.well-known/oauth-protected-resource/mcp) and
[authorization metadata](https://auth.buffer.com/.well-known/oauth-authorization-server):

- Resource: `https://mcp.buffer.com/mcp`.
- Issuer: `https://auth.buffer.com`.
- Authorization `/auth`, token `/token`, DCR `/reg`, PKCE S256 and token authentication `none`.
- Authorization code and refresh grants; resource parameter support.

## Remaining acceptance

Complete independent source/authority review and exact digest approval. Deploy the app's explicit
bootstrap content-selection contract, publish through the trusted operator flow, and verify durable
readback and Store visibility. Then verify normal installation, per-user consent, invocation,
refresh/reconnect and disconnect in production. No post or template mutation was needed for capture.
