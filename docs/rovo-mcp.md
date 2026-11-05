# Atlassian Rovo MCP publication

The staged declaration is `plugins/remotes/atlassian.json`. The official flat-catalog endpoint is
`https://mcp.atlassian.com/v2/mcp?tools=all`; its protected resource is
`https://mcp.atlassian.com/v2/mcp`. The query selects discovery behavior without changing that
resource audience. Capture every page and review named tools individually; the generic discovery
and execute wrappers are not substitutes for exact tool authority.

## Public evidence checked on 2026-10-28

- [Official overview](https://developer.atlassian.com/cloud/rovo-mcp/).
- [Supported tools](https://developer.atlassian.com/cloud/rovo-mcp/guides/supported-tools/).
- [OAuth setup](https://developer.atlassian.com/cloud/rovo-mcp/guides/configuring-oauth-2-1/).
- [Protected-resource metadata](https://mcp.atlassian.com/.well-known/oauth-protected-resource/v2/mcp).
- [Authorization metadata](https://auth.atlassian.com/VCeDsk8ZHncYF1g234fKtc4lNipbBhu3/.well-known/oauth-authorization-server).

The protected resource advertises a tenant-scoped issuer, including its path. Authorization
metadata advertises DCR, PKCE S256, authorization code and refresh grants, and token endpoint
authentication `none` among its methods. The unauthenticated MCP endpoint returns 401 with the
exact resource metadata URL. These observations do not establish consent or token lifecycle facts.

## Application prerequisite

The previous app and Marketplace provider-definition parsers rejected every issuer path. The local
changes now preserve an exact HTTPS tenant issuer alongside existing slashless origin identifiers.
They continue rejecting query/fragment components, credentials, ports, case normalization, path
normalization and noncanonical percent encoding. Canonical digests retain the full issuer identity;
existing origin-only golden bytes remain unchanged. This follows
[RFC 8414 issuer identity](https://www.rfc-editor.org/rfc/rfc8414.html#section-2).

The app source and Marketplace mirror must be reviewed and released together before publishing
a definition using the tenant issuer. The historical Phase 1 source hashes remain historical
evidence; local tests do not establish deployment or independently reviewed compatibility.

## Consented evidence still required

Capture the flat `tools/list` declarations through OAuth and retain only exact tool names,
descriptions and input schemas. Availability varies with app access, scopes and administrator
permission groups. The existing Jira scope proposal is not evidence of all Atlassian capability;
review any Confluence or other product expansion explicitly with the final authority diff.

Use `atlassianUserInfo` and `getAccessibleAtlassianResources` to establish stable user identity and
site selection from redacted output shapes. Preserve Owner-selected `cloudId` binding for tools
that take that argument. The declaration's REST `/me` and accessible-resources projections are
unverified placeholders; MCP tokens must not be sent to those REST endpoints without audience
evidence. Do not replace site selection with an opaque connection label to bypass the missing data.

Review actual token response fields, scope policy, expiry, refresh rotation and revocation before
creating the provider definition. Then bind exact catalog and authority digests to the required
independent review, publish through the trusted operator flow, and verify durable application
readback and Store visibility. Installation, per-user consent, invocation, reconnect and disconnect
require separate live evidence. No Jira or Confluence content mutation is needed for schema capture.
