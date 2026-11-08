---
plugin: supernala-public:supernala:atlassian-api
revision: 1
---

# Set up Jira with an API token

This method connects Jira with your Atlassian email, an API token and your site, instead of signing in. It calls Jira's REST API through Atlassian's API gateway, so **no admin setting is needed**. Bots act as you and see only what your Atlassian account can see. It takes about 5 minutes.

Confluence isn't included: an Atlassian token with scopes covers one app. Use **Sign in with Atlassian** for Confluence.

## Create your API token

1. Open [Atlassian API tokens](https://id.atlassian.com/manage-profile/security/api-tokens) and choose **Create API token with scopes**.
2. Name it `Supernala` and choose an expiry (up to one year).
3. Choose **Jira** as the app.
4. Choose these scopes:
   - `read:jira-work` to search and read issues, projects and issue types
   - `read:jira-user` to find people and check the connection
   - `write:jira-work` only if Bots should create, edit, comment on, assign or move issues
5. Create the token and copy it. Atlassian shows it only once.

A token created **without** scopes won't work here: Atlassian accepts those only on your site's own address.

## In Supernala

1. Open **Marketplace → Apps → Atlassian**, choose **API token** under Ways to connect, and click **Install**.
2. Enter your **Atlassian email** (the account that owns the token), the **API token**, and your **Atlassian site**, such as `yourteam.atlassian.net`. Click **Save API key**. The token is encrypted; Bots never see it.
3. Under **Bot access**, choose which Bots can use Jira and click **Save changes**. Reading is allowed by default; changes ask you first.

## If something goes wrong

- **"The service didn't accept these details"**: check that the email owns the token, the token was created **with scopes** for **Jira**, it includes `read:jira-user`, and it hasn't expired.
- **"Check the details and try again"**: the site must look like `yourteam.atlassian.net`.
- **A Bot's change is refused**: the token lacks `write:jira-work`, or your account can't edit that project. Create a token with the scope and add it as another API key.
- **It stopped working**: the token expired or was revoked. Create a new one and save it.
