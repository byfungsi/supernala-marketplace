---
plugin: supernala-public:supernala:vercel-api
revision: 1
---

# Set up Vercel with an access token

This connects your Vercel account with an access token, so Bots can look at your teams, projects and deployments, read build events and runtime logs, check domains, and deploy, promote, roll back, add domains and set environment variables. It takes about 2 minutes.

Bots can make changes without asking first. To have them ask, set the write tools to **Ask each time** under **Bot access** after setup.

## Create your token

1. Open [Vercel account tokens](https://vercel.com/account/tokens) and choose **Create Token**.
2. Name it `Supernala`.
3. Under **Scope**, choose the team Bots should work in, or your personal account.
4. Choose an expiration, then **Create** and copy the token. Vercel shows it only once.

## In Supernala

1. Open **Marketplace → Apps → Vercel** and click **Install**.
2. Paste the token and click **Save API key**. Supernala checks it with Vercel before saving. The token is encrypted; Bots never see it.
3. Under **Bot access**, choose which Bots can use Vercel and click **Save changes**.

When a token covers several teams, Bots pass the team in each request; ask them to list your teams first.

## What Bots can't do

Bots can't delete projects, deployments or domains, read the values of encrypted or sensitive environment variables, or pass Git credentials. Values of **plain** environment variables are visible to Bots, as they are in the Vercel dashboard.

## If something goes wrong

- **"The service didn't accept these details"**: the token is wrong, expired or revoked. Create a new one and save it.
- **A request is refused for a project you can see**: the token's scope doesn't include that team. Create a token scoped to it and add it as another API key.
