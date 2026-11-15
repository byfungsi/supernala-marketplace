# WordPress apps (`wordpress-self-hosted`, `wordpress-com`)

Two separate apps, named apart so Owners pick by where their site runs. Both use the WordPress logo and bring the **WordPress publishing playbook** companion Skill (`skills/supernala/wordpress`).

## WordPress Self-Hosted (`plugins/wordpress-self-hosted/`)

A managed OpenAPI app on the WordPress core REST API (`/wp-json/wp/v2`) of the Owner's own site.

- **Site connection.** The Owner enters the site address, a WordPress username and an application password (WordPress 5.6+, HTTPS only). The auth strategy declares `resources: { kind: "credential-site", field: "site" }`, and the OpenAPI server is the variable `https://{site}`, so the compiler binds every tool to `origin: "connection-site"`. The application parses the typed site (public HTTPS DNS name, optional base path such as `/blog`), verifies the password with HTTP Basic at `site + /wp-json/wp/v2/users/me` (`https-json-site`), stores the site as the connection's resource, and sends every call there. The version's `allowedHosts` is empty because there is no fixed destination.
- **Tools (25).** Reads, default **allow**: connected user, site settings (Administrators only), search, list and get posts and pages, categories, tags, comments, media, users. Writes, default **ask**: create and update posts and pages, create categories and tags, comment or reply, moderate a comment, edit media details. Destructive, default **ask**: trash a post, page or comment. Trash only: no tool exposes `force`, so nothing is deleted permanently. Uploading media is not available because the adapter sends JSON bodies only.
- **Source.** `openapi.json` is a reviewed local selection written from the WordPress REST API reference; list filters that take IDs use comma form (`explode: false`), which WordPress parses as an ID list.
- **Release prerequisites.** The application's site connections (`credential-site`, `connection-site`) must be deployed before publication, and a credential-free provider registration `wordpress-site-v1` must exist in production.

## WordPress.com (`plugins/remotes/wordpress-com.json`)

A managed remote MCP app on WordPress.com's official server, `https://public-api.wordpress.com/wpcom/v2/mcp/v1`.

- **Sign-in.** Dynamic client registration at `/oauth2-1/register` (public client), authorization code with PKCE S256, scope `auth`, rotating refresh tokens, refresh-token revocation at `/oauth2-1/revoke`. The authorization response has no `iss`. `userinfo` returns only a numeric `sub`, so the account is an opaque connection.
- **Tools (4).** WordPress.com serves its tool-search layout: `search`, `describe` and `docs` are read-only lookups (default **allow**); `execute` runs any ability, from reading posts to deleting menus, so it is destructive (default **ask**). WordPress.com itself refuses non-read-only abilities unless the call carries `user_confirmed: true`; the reviewed `execute` description and the playbook make a Supernala approval that confirmation. Its `describe` and `docs` schemas use `uniqueItems`, which the application's argument validator supports from the same release as site connections.
- **Owner prerequisites.** MCP access turned on in WordPress.com **Account → Preferences → AI and MCP**. WordPress.com MCP is on paid plans; free sites have access until 2026-11-30.
- **Release prerequisites.** A provider registration `wordpress-com-oauth-v1` in production with `registration_mode` `dynamic` and the authorization-server metadata URL.
