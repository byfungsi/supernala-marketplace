---
plugin: supernala-public:supernala:atlassian-api-token
revision: 1
---

# Set up Atlassian with an API token

This method connects Jira and Confluence with your Atlassian email, a personal API token and your site domain, instead of signing in. It reaches the same tools as the sign-in method.

## Before you start

- Your Atlassian organization must allow API-token access to Atlassian's Rovo MCP server. If it is turned off, ask an organization admin. See [Atlassian's API-token guide](https://developer.atlassian.com/cloud/rovo-mcp/guides/configuring-authentication-via-api-token/).

## Create your API token

1. Open [Atlassian API tokens](https://id.atlassian.com/manage-profile/security/api-tokens) and create an API token with scopes.
2. Choose Jira and Confluence scopes. To start read-only, choose the read and search `agent-interface` scopes; add write scopes only if Bots should make changes.
3. Give it an expiry and copy the token. Atlassian shows it only once.

## In Supernala

1. Open **Marketplace → Apps → Atlassian (API token)** and click **Install**.
2. Enter your **Atlassian email**, the **Personal API token** and your **Atlassian domain**, such as `yourteam.atlassian.net`, then click **Save API key**. The token is encrypted; Bots never see it.
3. Choose which Bots can use Atlassian and click **Save changes**.

## If something goes wrong

- **Connection failed**: check that the email is the one that owns the token, the domain ends in `atlassian.net`, and API-token access is allowed for your organization.
- **Fewer tools than expected**: the token's scopes limit what Bots can do. Create a token with more scopes, then add it as another API key.
- **It stopped working**: the token expired or was revoked. Create a new one and save it.
