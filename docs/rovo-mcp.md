# Atlassian Rovo MCP publication

The Owner-authorized declaration is `plugins/remotes/atlassian.json`. The official flat-catalog endpoint is
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

## Consented evidence

The Owner completed consent on 2026-10-28 with exactly the reviewed Jira and Confluence read,
search and write scopes, account read scopes, and offline access. The flat endpoint returned 117
named tool declarations; `fixtures/mcp/captures/atlassian-20261028.json` preserves their exact
schemas. The public catalog retains all captured tools. Writes require approval; permission changes,
public-link enablement, destructive transitions and comparable operations are classified
conservatively and require approval.

`atlassianUserInfo` returned `data.accountId`; the reviewed identity uses that stable subject as
both account identity and truthful display label. `getAccessibleAtlassianResources` returned
`data.resources`, each with `cloudId` and `url`. The resource declaration preserves Owner selection
and binds `cloudId` arguments to the selected site. No MCP audience token is sent to REST identity
endpoints. The real app bootstrap transport resolved identity and selected-site authority against
the consented server; an earlier attempt returned a provider rejection before the successful check.

Initial and refresh responses returned Bearer tokens with a 28,800-second access lifetime, exact
reviewed scopes and rotated refresh tokens. Only policy facts and redacted output shapes appear in
`fixtures/mcp/captures/provider-evidence-20261028.json`. Remote revocation request semantics remain
unverified; the declaration explicitly uses local disconnect without claiming remote revocation.

## Remaining acceptance

The Owner waived independent source/authority review; it was not passed. Retain exact digest-bound
release approval, deploy the coordinated
app issuer change, and use trusted publication with durable readback and Store visibility checks.
Normal installation, per-user consent, invocation, refresh and disconnect need production evidence.
No Jira or Confluence content mutation was needed for catalog or identity capture.
