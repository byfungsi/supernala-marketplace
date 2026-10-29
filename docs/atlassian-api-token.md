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

`plugins/remotes/atlassian-api-token.json` is staged and excluded from publication.
Its provisional 117-tool schemas come from the existing OAuth capture; that is not
proof of the API-token tool set. Before publication:

1. Capture `tools/list` using an Owner-authorized scoped personal token. Replace the
   provisional catalog with the exact available API-token tools and digest.
2. Validate the real identity result shape and a read on the entered site without retaining
   account payloads in the public repository.
3. Keep write and destructive tools behind approval, and pin the selected-site bindings.
4. Deploy the application with the additive Basic credential-delivery contract.
5. Review the exact source, catalog and authority digests; publish through the existing
   trusted release workflow; verify Marketplace visibility, connection and invocation.

Service-account Bearer keys use a different credential form. This component deliberately
requests a personal token plus email and does not mislabel those credentials as a
service-account key.

References:

- https://developer.atlassian.com/cloud/rovo-mcp/guides/configuring-authentication-via-api-token/
- https://developer.atlassian.com/cloud/rovo-mcp/guides/supported-tools/
