---
plugin: supernala-public:supernala:vercel
revision: 1
---

# Set up Vercel with sign-in

Sign in with your Vercel account so Bots can use Vercel's own tools: search Vercel docs, list teams and projects, inspect deployments, read runtime logs and errors, open protected preview URLs, query analytics, and manage domains, environment variables, routes, flags and more. It takes about a minute, and you don't need a token.

Bots can make most changes without asking. Deleting things, buying or transferring domains, replacing DNS records, revoking keys and accepting project transfers always ask you first. To have Bots ask before other changes too, set those tools to **Ask each time** under **Bot access**.

## In Supernala

1. Open **Marketplace → Apps → Vercel**, choose **Sign in with Vercel** under Ways to connect, and click **Install**.
2. Click **Connect** and sign in to Vercel in the window that opens.
3. Approve the connection and **choose the teams** Bots may work in. A team you don't grant here stays invisible to Bots.
4. Under **Bot access**, choose which Bots can use Vercel and click **Save changes**.

## Good to know

- Your Vercel permissions still apply: Bots can do only what your account can do in the teams you granted.
- To add a team later, disconnect and connect again, granting the extra team.
- Prefer a token instead, for automation or one team only? Use **Access token** under Ways to connect.

## If something goes wrong

- **A team or project is missing**: you didn't grant that team during sign-in. Connect again and include it.
- **"Reconnect needed"**: the sign-in expired or was revoked in Vercel. Click **Reconnect**.
