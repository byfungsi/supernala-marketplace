---
plugin: supernala-public:supernala:wordpress-com
revision: 1
---

# Set up WordPress.com

WordPress.com connects your Bots to your WordPress.com account through WordPress.com's own MCP server. One connection reaches every site on your account, plus self-hosted sites you connected with Jetpack. Bots can read your sites, posts, pages, comments, media, stats and settings, and, when you approve, write and publish posts and pages, upload or generate images, moderate comments, and change design and settings.

Bots with access also get the **WordPress publishing playbook** Skill, which teaches them to draft first, edit your current text, and publish only when you say so.

If your site runs on your own hosting without Jetpack, use the **WordPress Self-Hosted** app instead.

You connect by signing in to WordPress.com. There is nothing to create or copy, and it takes about 2 minutes.

## What you need

- A WordPress.com account with at least one site. WordPress.com includes MCP on all **paid plans**; **free** sites have access until 30 November 2026. Self-hosted sites connected with **Jetpack** need a Jetpack AI or Jetpack Complete plan after that date.
- **MCP access turned on** in your WordPress.com account (step 1).

## 1. Turn on MCP access in WordPress.com

1. Sign in at [wordpress.com](https://wordpress.com) and open **Account → Preferences → AI and MCP** ([direct link](https://wordpress.com/me/mcp)).
2. If it says **MCP access is off**, click **Turn on MCP access**.
3. Under **External AI agent access**, check what agents may do:
   - **Read**: lets Bots look at your sites, content and stats.
   - **Write**: lets Bots change things. Turn it off if you want WordPress.com to refuse every change, whatever happens in Supernala.
   - **Site exceptions**: limit or block MCP for particular sites.

These settings apply to every AI agent you connect, including your Bots.

## In Supernala

1. Open **Marketplace → Apps → WordPress.com** and click **Install**.
2. Click **Connect account**. Sign in to WordPress.com if asked, check the account and sites shown, and click **Allow**.
3. Under **Bot access**, choose which Bots can use WordPress.com and click **Save changes**.

Try asking a Bot: "List my WordPress.com sites", or "Draft a post on my blog about our new menu and show me before publishing".

## How approvals work

WordPress.com gives Bots four tools:

- **search**, **describe** and **docs** look up what WordPress.com can do. They run without asking.
- **execute** runs one action, such as listing posts, creating a draft or publishing it. Because one tool can do anything from reading to deleting, Supernala asks you before every **execute** by default, including reads.

Approving an **execute** request is also WordPress.com's own confirmation. WordPress.com refuses changes unless the request says you confirmed it, so the Bot marks only requests you approve, or asked for in exactly those words.

If the approvals feel like too many:

1. In WordPress.com **AI and MCP** settings, turn **Write** off for your sites, so WordPress.com refuses every change.
2. In Supernala, set **Run a WordPress.com ability** to **Allow** for that Bot.

Bots can then read freely and can't change anything. Turn **Write** back on, and **Run a WordPress.com ability** back to **Ask**, when you want them to write again.

## Keep your sites safe

- Keep **Ask** on for **Run a WordPress.com ability** while Bots can write. Each request shows the action, the site and a one-line summary before it runs.
- Domains, DNS, plans, plugins, themes and invitations can cost money or take a site offline. Bots are told to do these only when you ask; you can also block them per site under **Site exceptions**.
- Disconnect any time in Supernala, or in WordPress.com under **Account → Security → Connected applications**.

## If something goes wrong

- **A Bot says MCP access is off, or finds no sites:** turn on MCP access in **Account → Preferences → AI and MCP**, and check that the site isn't blocked under **Site exceptions**.
- **A Bot says an ability is disabled:** it is turned off in your **AI and MCP** settings, for example **Write**. Turn it on there if Bots should use it.
- **"Approval required" from WordPress.com:** the change wasn't confirmed. Approve the Bot's next request in Supernala, or tell it plainly in chat that you want that exact change.
- **A plan or feature error:** your site's plan doesn't include that feature. Upgrade in WordPress.com if you want it; Bots don't buy anything unless you ask.
- **Free site stopped working after 30 November 2026:** MCP needs a paid WordPress.com plan from then on.
- **The connection stopped working:** open **Marketplace → Apps → WordPress.com** and click **Reconnect**. This happens after you change your WordPress.com password or remove Supernala from connected applications.
