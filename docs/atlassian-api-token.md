# Atlassian personal API-token connection

The Atlassian API-token component is a second connection method in the Atlassian
Marketplace family. Existing OAuth connections retain their own provider registration,
credentials, grants and consent flow.

Users enter their Atlassian email, scoped personal API token and site domain in the credential form.
The application stores these values in the encrypted credential Vault and constructs the Basic
Authorization header only inside the trusted credential adapter. Users do not prepare a
Base64 string or put tokens in chat, Plugin Config, Skill instructions or ordinary Files.

The organization must enable MCP API-token authentication. OAuth redirect-domain rules
do not apply to token authentication; IP allowlists, account permissions and token scopes
still apply. For initial read-only validation, grant the required Jira and Confluence
read/search `agent-interface` scopes. Writes require corresponding token scopes and the
separate per-tool approval policy.

Identity is resolved through the reviewed MCP identity operation. The Owner enters a
domain such as `team.atlassian.net` or `https://team.atlassian.net`. Only canonical HTTPS
origins under `atlassian.net` are admitted; credentials, custom ports, paths, queries and
fragments are rejected. This is a retained invocation resource, never a model-selected
network endpoint. Calls requiring `cloudId` must use that exact origin. Non-site bootstrap
tools are not falsely required to accept a `cloudId` argument.

## Current acceptance status

The Owner approved publication of `atlassian-api-token@1.0.0` for user testing.
Independent review was waived, not passed. The 117 reviewed tool schemas come from
the existing OAuth capture at the same official endpoint, not an API-token capture.
Runtime reviewed-subset reconciliation limits access to matching tools actually available
to the connected account. Token scopes may expose fewer tools; some tools require OAuth.

The application tests cover credential submission, Vault-owned Basic authentication,
identity resolution and selected-site guards using controlled provider interfaces.
Production deployment and trusted digest-bound publication/readback are rollout gates.
A successful real personal-token identity check, selected-site read and invocation remain
unverified until an authorized user connects their own credentials. No operator-wide
Atlassian email or token is needed. Users should start with read/search scopes and keep
write/destructive tools behind the separate approval policy.

Service-account Bearer keys use a different credential form. This component deliberately
requests a personal token plus email and does not mislabel those credentials as a
service-account key.

References:

- https://developer.atlassian.com/cloud/rovo-mcp/guides/configuring-authentication-via-api-token/
- https://developer.atlassian.com/cloud/rovo-mcp/guides/supported-tools/
