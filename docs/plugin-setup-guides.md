# Plugin setup guides

Every publication-eligible app has a setup guide. It tells the Owner how to prepare what the app needs outside Supernala, such as a Google OAuth client or an API key, and then what to do in Supernala. The application shows the current guide on the app page and in Bot setup cards, and Bots read it with `get_plugin_guide` to explain setup without ever seeing credentials.

## Layout

```text
guides/<publisher>/<slug>.md   one guide per Plugin definition
```

Guides live outside Plugin source roots, so editing one never changes a package digest or requires a Plugin version. Each file starts with frontmatter naming the exact definition and revision:

```markdown
---
plugin: supernala-public:supernala:gmail
revision: 1
---
```

`plugin` must match the path: `guides/supernala/gmail.md` is `supernala-public:supernala:gmail`. Package definitions use `supernala-public:<manifest publisher>:<manifest id>`; remotes and OpenAPI sources use their declared `marketplaceId`, `publisherNamespace` and `pluginSlug`.

## Writing a guide

- Write for the Owner, in short numbered steps. Say what the app lets Bots do and what it cannot do.
- End with the steps in Supernala under exactly `## In Supernala`, using the app's real labels: **Install**, **Register app**, **Connect account**, **Save API key**, **Save changes**.
- Use `{{oauthCallbackUrl}}` for the OAuth redirect URI. The application fills it, so guides never hard-code a deployment URL. It is the only placeholder.
- Links must be `https://`. No images or HTML; inline code may show values such as scopes.
- Never include a key, token or secret, even an example one. Say where to create it and that Supernala encrypts it.
- At most 16,000 characters.

`pnpm marketplace guides validate` checks every guide and fails when a publication-eligible Plugin in `releases/index.json` has none. `pnpm check` runs the same check.

## Revisions

A published revision is immutable: changing its text under the same `revision` is refused (`guide-revision-content-changed`). Bump `revision` to publish a change. The highest revision is current.

## Publishing

```sh
git switch main && git pull --ff-only
pnpm marketplace guides publish --environment production [--yes]
```

The command requires a clean `main` equal to fetched `origin/main`, validates every guide, reads the application's current rows and shows the plan: new revisions, unchanged guides, skipped guides whose Plugin is not in the application yet, and blocked guides. Any blocked guide stops the release. After confirmation it writes each new revision and reads it back. Publishing the same guides again changes nothing.

`compatibility/plugin-setup-guides/` vendors the application's exact `plugin_setup_guides` migration with its digest; tests publish into it with SQLite.

## Credentials

Publication reads `$HOME/.config/supernala-marketplace/production.guides.env`, or another file passed with `--credentials FILE`. The file must be mode `600`, owned by the operator, outside the checkout, and contain exactly these keys:

```text
CLOUDFLARE_ACCOUNT_ID
APPLICATION_DATABASE_ID
APPLICATION_GUIDE_PUBLISH_TOKEN
```

The token writes the application database: Cloudflare D1 tokens are database-scoped, not table-scoped.
