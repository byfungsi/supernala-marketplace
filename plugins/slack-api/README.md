# Supernala Slack Web API MCP

This is Supernala's own dependency-free MCP stdio server, backed by Slack's public Web API. It runs privately in the existing managed-package Host. There is no new public MCP endpoint or shared workspace token. The Connection Actor retains OAuth client and refresh credentials; only its current access token reaches the isolated package as `PLUGIN_ACCESS_TOKEN`. Installation, activation, user OAuth and agent grants remain separate controls. All tools default to approval; message deletion is blocked by default.

The 32 tools cover channel discovery and membership, message and file search, channel history and threads, profiles, custom emoji, messages and scheduling, reactions, file upload reservation/completion, canvases, and lists. Public API contracts are deliberately explicit: search uses Slack query syntax; channel and user name filters examine one page; list writes use column IDs. This package does not impersonate the official MCP server's semantic search, create Slack UI drafts, download arbitrary file URLs, or claim byte-for-byte tool compatibility. File upload reservation returns a temporary private URL; the caller must upload bytes before completion. No file bytes are uploaded by this package.

`catalog.json` is the immutable review projection of `source/slack-tool-catalog.mjs`. The runtime `tools/list` must equal it exactly before the Host can dispatch. No generic API method, URL, authorization header or credential field is accepted from a tool caller. All requests target `https://slack.com/api/` and refuse redirects. Raw provider failures never become errors/logs; the caller receives fixed reasons, optional HTTP status and bounded `retryAfterSeconds`. Successful data is private, bounded, untrusted Slack content. Oversized output fails explicitly instead of silently presenting partial data as complete.

History and thread tools fetch at most 15 messages per page. Slack currently limits each method to one request per minute per workspace for new installations of unapproved commercial apps. Pagination is explicit, and this package never retries a provider call. A write failure marked `dispatch: unknown` may have succeeded and must be reconciled before retrying. `reauthorization-required`, `missing-scope`, `access-denied`, `plan-restricted` and `rate-limited` have distinct meanings. MCP reports expected tool failures with `isError: true` and safe structured data.

## OAuth and rollout

`oauth-provider.json` declares Slack's user-only authorization-code flow with PKCE and rotating refresh tokens. Public `platform-bindings.json` names the existing platform client environment bindings; it contains no credentials and does not itself admit any authority. `slack-app-manifest.json.template` declares the 24 user scopes actually used by these tools, including the Web API's `search:read`. Keep bot scopes empty and token rotation enabled. The existing production callback remains `https://app.supernala.com/v1/plugins/oauth/callback`.

The candidate is version `supernala/slack@1.1.4`, under the existing Slack definition, with a distinct `slack-web-api-oauth-v1` provider registration. Publishing it must not mutate or revoke the old hosted-MCP version, silently copy credentials, rebind existing connections or grant new tools to agents. Users select the new version, complete fresh OAuth and configure agent access through existing product controls. Slack OAuth scopes are additive: users with an older broader grant may need to revoke that grant and authorize again to meet the exact reviewed scope set. Do not uninstall or revoke other users' workspace grants automatically.

The shared listing name and description intentionally match the published hosted-MCP version. The Phase 1 publisher verifies that metadata for every historical version, so changing it would invalidate the old baseline. Version 1.1.0 failed its atomic staging guard before publication because its description differed; its immutable failed journal record is retained. Version 1.1.2 preserves that metadata while keeping the same API tools and OAuth authority. Its exact artifact review and stopped-attempt recovery approval are separate publication gates.

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

## Read-parameter compatibility patch

Version 1.1.2 uses URL-encoded form bodies for the 13 classic scalar read methods, matching the official Slack Node SDK's wire format. Structured canvas/list methods and writes retain their existing encoding. The catalog, OAuth definition, scopes, provider registration and network authority are unchanged.

Production 1.1.1 authenticated the expected user but returned only public channels, rejected message searches and could not look up that same user's profile. A form-decoding regression fixture reproduces that missing-parameter pattern; the patch passes it. Slack documents JSON as well as form support, so this fixture does not prove JSON is unsupported. Live acceptance of 1.1.2 remains required before claiming the reported channel can be read.

## Search result size patch

Version 1.1.4 keeps search results inside the MCP frame (1.1.3 had the same code but reused catalog snapshot `slack-web-api-catalog-v1` for a changed catalog, so application staging rejected it before publication; its failed journal record is retained). Production 1.1.2 failed `slack_search_messages` with `count: 50` whenever the matches' rich-text blocks and attachments made the result exceed the 262144-byte frame: the server sends a result twice (text and `structuredContent`), so anything over about half the frame was replaced by a protocol error the client could not act on. Search matches now keep their identifying and display fields (`text`, `user`, `channel`, `ts`, `permalink`, file names and an attachment count) and drop blocks and attachments. Result frames may now be 1048576 bytes, matching the Supernala Plugin Host's per-message limit and each tool's declared `maximumOutputBytes`; the projected result is capped at 480000 bytes so both copies fit, and Slack's raw answer may be 2 MiB before projection. A result that still cannot fit becomes a standard tool error (`response-too-large`) asking for fewer results instead of a JSON-RPC error. Request frames stay limited to 262144 bytes. The OAuth definition, scopes, provider registration and network authority are unchanged; the catalog changes only in each tool's `maximumOutputBytes`, under the new snapshot `slack-web-api-catalog-v2`.
