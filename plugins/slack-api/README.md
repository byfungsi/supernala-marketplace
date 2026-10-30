# Supernala Slack Web API MCP

This is Supernala's own dependency-free MCP stdio server, backed by Slack's public Web API. It runs privately in the existing managed-package Host. There is no new public MCP endpoint or shared workspace token. The Connection Actor retains OAuth client and refresh credentials; only its current access token reaches the isolated package as `PLUGIN_ACCESS_TOKEN`. Installation, activation, user OAuth and agent grants remain separate controls. All tools default to approval; message deletion is blocked by default.

The 32 tools cover channel discovery and membership, message and file search, channel history and threads, profiles, custom emoji, messages and scheduling, reactions, file upload reservation/completion, canvases, and lists. Public API contracts are deliberately explicit: search uses Slack query syntax; channel and user name filters examine one page; list writes use column IDs. This package does not impersonate the official MCP server's semantic search, create Slack UI drafts, download arbitrary file URLs, or claim byte-for-byte tool compatibility. File upload reservation returns a temporary private URL; the caller must upload bytes before completion. No file bytes are uploaded by this package.

`catalog.json` is the immutable review projection of `source/slack-tool-catalog.mjs`. The runtime `tools/list` must equal it exactly before the Host can dispatch. No generic API method, URL, authorization header or credential field is accepted from a tool caller. All requests target `https://slack.com/api/` and refuse redirects. Raw provider failures never become errors/logs; the caller receives fixed reasons, optional HTTP status and bounded `retryAfterSeconds`. Successful data is private, bounded, untrusted Slack content. Oversized output fails explicitly instead of silently presenting partial data as complete.

History and thread tools fetch at most 15 messages per page. Slack currently limits each method to one request per minute per workspace for new installations of unapproved commercial apps. Pagination is explicit, and this package never retries a provider call. A write failure marked `dispatch: unknown` may have succeeded and must be reconciled before retrying. `reauthorization-required`, `missing-scope`, `access-denied`, `plan-restricted` and `rate-limited` have distinct meanings. MCP reports expected tool failures with `isError: true` and safe structured data.

## OAuth and rollout

`oauth-provider.json` declares Slack's user-only authorization-code flow with PKCE and rotating refresh tokens. Public `platform-bindings.json` names the existing platform client environment bindings; it contains no credentials and does not itself admit any authority. `slack-app-manifest.json.template` declares the 24 user scopes actually used by these tools, including the Web API's `search:read`. Keep bot scopes empty and token rotation enabled. The existing production callback remains `https://app.supernala.com/v1/plugins/oauth/callback`.

The candidate is version `supernala/slack@1.1.0`, under the existing Slack definition, with a distinct `slack-web-api-oauth-v1` provider registration. Publishing it must not mutate or revoke the old hosted-MCP version, silently copy credentials, rebind existing connections or grant new tools to agents. Users select the new version, complete fresh OAuth and configure agent access through existing product controls. Slack OAuth scopes are additive: users with an older broader grant may need to revoke that grant and authorize again to meet the exact reviewed scope set. Do not uninstall or revoke other users' workspace grants automatically.

This remains a pilot candidate. Slack permits unlisted pilot installations, while commercial distribution still needs Marketplace approval. Our adapter removes the dependency on the official MCP initialization endpoint; it does not remove Slack app approval, administrator policy, plan restrictions or API rate limits. Live acceptance must demonstrate a user OAuth connection, exact installed version, admitted agent tool discovery and an actual read of authorized Slack data. Offline tests alone do not prove those steps.

## Reproduce offline verification

```sh
node tools/prepare-slack-api-package.mjs
pnpm marketplace validate plugins/slack-api
pnpm exec vitest run src/slack-api-package.test.ts
pnpm typecheck
```

The authoring command only regenerates public declarations and SHA-256 bindings; it performs no network requests, credential reads or publication. `build-recipe.json` copies the three first-party modules and reviewed JSON/license files directly. Runtime dependency installation and lifecycle scripts remain forbidden. The package uses raw `fetch` at this dependency-free Node boundary; introducing an application Effect runtime or a new Worker endpoint would duplicate the Host's credential and lifecycle authority.

Official contracts: [OAuth](https://docs.slack.dev/authentication/installing-with-oauth/), [distribution](https://docs.slack.dev/app-management/distribution/), [history limits](https://docs.slack.dev/changelog/2025/05/29/rate-limit-changes-for-non-marketplace-apps/), [API methods](https://docs.slack.dev/reference/methods/), [MCP](https://modelcontextprotocol.io/specification/2025-06-18/server/tools).
