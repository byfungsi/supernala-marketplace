# Buffer MCP publication

`buffer@1.1.1` connects to `https://mcp.buffer.com/mcp` with each user's own Buffer API key.
It replaces the dynamic OAuth method of `buffer@1.0.0`. The Owner authorized the change on
2026-11-06 and waived independent review (not passed).

## Why OAuth was replaced

On 2026-11-06 Buffer's registration endpoint (`https://auth.buffer.com/reg`) began rejecting
dynamic client registration for Supernala's callback with `400 invalid_client_metadata`
("Invalid public MCP client registration request"). The same request succeeds with a
`localhost` redirect, so Buffer limits public dynamic registration to local clients. Hosted
products need a registered app client, whose rate limits are shared by every user of that
client. A per-user API key instead counts against each user's own Buffer plan.

## API-key connection

Buffer documents Bearer API-key access for MCP clients that can set a request header
([Other AI tools](https://developers.buffer.com/guides/integrations/other-ai-tools.html)).
Users create a key in Buffer under Settings → API and paste it into the credential form. The
application keeps the key in the encrypted credential Vault and sends it only as
`Authorization: Bearer <key>` from the trusted adapter. Users never put keys in chat, Plugin
Config, Skill instructions or Files.

Identity resolves through the reviewed `get_account` bootstrap operation. It returns account
`id` and `name` in JSON text content block 0, followed by a separate rate-limit block;
`resultTextContentIndex` selects block 0 and undeclared multipart responses fail closed. A key
reaches every organization and channel in the account. Disconnecting deactivates local access;
users revoke the key itself in Buffer.

The version reuses the existing `buffer-mcp-v1` endpoint and `buffer-oauth-v1` provider
registration identities, because endpoint URLs have one durable identity. No OAuth client or
token is used for key connections. Requests share the user's plan limits with their other keys
and MCP connections.

## Release history

`buffer@1.1.0` staged but failed finalize with `immutable-version-conflict`: it changed the
description, which lives on the shared Plugin definition and is immutable across versions. Its
failed journal record and staged row are retained. `buffer@1.1.1` keeps the published definition
description and is otherwise identical.

## Catalog evidence

`fixtures/mcp/captures/buffer-20261028.json` preserves the 17 exact named tools from the
Owner-consented OAuth capture on 2026-10-28, covering accounts, channels, posts, ideas,
analytics and templates. The schemas are unchanged in 1.1.1. Writes require approval; delete
operations are destructive and require approval. No API-key `tools/list` capture is claimed;
runtime reviewed-subset reconciliation limits access to the tools actually available.

## Remaining acceptance

Publish through the trusted operator flow and verify durable readback and Store visibility.
Then verify, with a real user key: update from 1.0.0, connection and identity, a read
invocation, an approved write and disconnect.
