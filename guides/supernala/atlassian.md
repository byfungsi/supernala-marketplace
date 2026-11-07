---
plugin: supernala-public:supernala:atlassian
revision: 1
---

# Set up Atlassian (Jira and Confluence)

Atlassian lets your Bots search and read Jira issues and Confluence pages, and create or update them after you approve. This method signs in with your Atlassian account, so there are no keys to create. Use **Atlassian (API token)** instead if your organization prefers personal tokens.

## In Supernala

1. Open **Marketplace → Apps → Atlassian** and click **Install**.
2. Click **Connect account**, sign in to Atlassian and choose the site to allow.
3. Choose which Bots can use Atlassian and click **Save changes**. Changes still ask for your approval.

## If something goes wrong

- **Your site is missing or access is denied**: an Atlassian organization admin may need to allow the Rovo MCP app for your site.
- **A project or space is missing**: Bots see only what your Atlassian account can see.
- **Asked to reconnect**: Atlassian ended the sign-in. Connect again.
