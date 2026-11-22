# Proactive manifest research

Research behind [the behaviour declaration](proactive-manifest.md) (2026-11-22). It records, per
Plugin, which writes deserve a follow-up, which reads make useful observations, how failures can
be detected deterministically today, and the gaps. Everything here comes from the reviewed
catalogs and package sources in this repository. Remote MCP and OpenAPI result shapes are not in
the repository, so the shapes marked _inferred_ follow the provider's public API and must be
confirmed with a live capture before an Owner relies on them.

## What the host can see today

| Runtime                                   | Result the host receives                                                  | Error the host receives                                                                                          |
| ----------------------------------------- | ------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| `managed-package` (Gmail, GitHub, Google) | JSON-RPC `result` as a raw JSON object                                    | JSON-RPC `error: { code: -32000, message }`; the message is the only signal                                      |
| `managed-package` (Slack)                 | MCP `{ content, structuredContent }`                                      | `isError: true` with `structuredContent.error = { provider, reason, dispatch, httpStatus?, retryAfterSeconds? }` |
| `managed-openapi`                         | The provider's JSON response                                              | The host makes the HTTP call, so it sees the status and the JSON body directly                                   |
| `managed-remote-mcp`                      | Whatever the provider's MCP server returns; no output schemas in catalogs | Transport HTTP status (401/403/429/5xx) plus provider-specific `isError` text                                    |

No catalog in the Marketplace or the application has an output schema. `observe` and
`$result.` references therefore name paths that the reviewer must check against the package
source or a live capture.

Application side (read only, for reference): `apps/api/src/plugin-dispatch-failure.ts` already
splits failures into `provider-rejected`, `provider-unavailable`, `response-too-large` and
`destination-rejected`, with `effect: "none" | "applied"`; it only classifies definite failures of
read tools, and leaves write failures uncertain. Expired or revoked OAuth is a connection status
(`reauthorization-required`), not a tool error. The behaviour `failures` section adds the
provider-specific mapping on top of that; it does not replace the host's own refresh handling.

## Per Plugin

### gmail (`managed-package`, eligible, `gmail-catalog-v3`)

- Writes: `gmail.send_message` returns only `{ messageId }`.
- Follow-up: **none declared.** A useful follow-up is "did they reply?", which needs the thread id
  and a search of the thread. The send result lacks `threadId`, and argument templates have no
  string interpolation (`in:inbox rfc822msgid:…`). Gap: return `threadId` from `send_message` in a
  future package version, then watch `gmail.search_messages` by thread.
- Observe: `gmail.get_message` (single object, `items: "$"`, key `$.messageId`, time
  `$.internalDate`) with `headers.from/to/subject/date`, `labelIds`, `snippet`, `attachments`,
  `threadId`. `search_messages` and `list_drafts` return identities only, so they are not observed.
  Describe: kind (newsletter, receipt, ticket or booking, bill due, security alert, personal, work
  request) and `time_sensitive`.
- Failures: every read failure is `"Gmail adapter request failed with status <n>"`, so a
  `messageTemplates` entry recovers the status. Send failures are
  `"Gmail send outcome ambiguous; do not retry automatically"` and
  `"Gmail send provider rejected request; do not retry automatically"`; both are deliberately left
  unclassified (an ambiguous write must never be retried automatically).
- Risk: Gmail answers some per-user rate limits with 403 (`userRateLimitExceeded`). The message
  drops the reason, so those classify as `permission_denied`. Gap: emit structured error data.

### gmail-send (`managed-package`, eligible for history only)

Single write `gmail.send_message`. The application no longer offers it; no declaration.

### github

- `plugins/github` (package, **not eligible**): `search_issues` (raw GitHub search JSON, `items[*]`,
  key `id`/`html_url`), `get_issue`, `create_issue` (raw issue). Errors:
  `"GitHub adapter request failed with status <n>"`.
- `plugins/remotes/github.json` (remote MCP, eligible, 46 tools: 27 read, 15 write, 4 destructive)
  is what the definition resolves to.
  - Follow-up: `github.add_issue_comment` (write) → `github.issue_read` with
    `method: get_comments` and `owner`, `repo`, `issue_number` taken from **`$args`**. Using the
    write's arguments avoids depending on the server's minimal create responses.
    `create_pull_request` would be the better trigger, but the upstream server returns only
    `{ id, url }`, so the PR number is not available as a path. `issue_write` is classified
    `destructive` and cannot trigger a follow-up.
  - Observe: `github.search_issues`, `items[*]`, key `$.html_url` (unique across repositories,
    unlike `number`), fields `number`, `title`, `state`, `user.login`, `labels`, `comments`,
    `updated_at` (_inferred_ from the upstream server).
  - Failures: not declared. The remote's transport statuses are already handled by the host; the
    provider's `isError` texts are not stable enough to match.

### google-drive, google-docs, google-sheets (`managed-package`, eligible)

- Shared failure helper with fixed messages (`<App>` is Google Drive, Google Docs or Google
  Sheets): `"<App> rejected the connection (401); …"`, `"<API> is not enabled in the Google Cloud
project; …"`, `"<App> lacks permission for this; …"`, `"<App> found nothing with that id, …"`,
  `"<App> is rate limited by Google; …"`, `"<App> could not reach Google; try again"`, and
  `"<App> request failed with status <n>[: message]"`. Write network failures are
  `"<App> change outcome unknown; check before trying again"` and stay unclassified.
- Observe: the list result `{ files: [ { fileId, name, mimeType, modifiedTime, createdTime,
sizeBytes, url, parentIds, shared, owners } ] }` from `search_files`, `list_folder`,
  `search_documents`, `search_spreadsheets`; key `$.fileId`. No describe questions: the MIME type
  already says what a file is, and content is not in the list.
- Follow-ups: none. Creating a document or sheet has no outcome worth watching on its own.

### slack (`plugins/slack-api` package, eligible; supersedes `plugins/remotes/slack.json`)

- Follow-up: `slack.slack_send_message` returns `{ channel, ts, message }`, so
  `slack.slack_read_thread` with `channel_id: $result.channel`, `message_ts: $result.ts` watches
  replies (+1h, +4h, +24h, stop +2d).
- Observe: `slack.slack_search_messages`, `messages.matches[*]`, key `$.permalink` (stable and
  unique; `ts` is unique only within a channel). `slack_read_channel` is not observed because its
  items do not carry the channel id, so `ts` alone is not a safe key. Gap: composite keys.
- Failures: structured. `providerCodePaths: ["$.error.reason"]`,
  `httpStatusPaths: ["$.error.httpStatus"]`, `retryAfterPaths: ["$.error.retryAfterSeconds"]`.
  Reasons: `reauthorization-required` (invalid_auth, token_revoked, …) → `auth_revoked`;
  `missing-scope` → `permission_denied`/reconnect; `access-denied`, `plan-restricted`,
  `unsupported-conversation` → `permission_denied`/owner report (reconnecting does not fix "not in
  channel"); `token-type-rejected` → publisher report; `not-found`; `rate-limited`;
  `provider-unavailable`, `network-failed` → `transient`; `invalid-response` → `schema_changed`.
- Risk: a write that fails with `dispatch: "unknown"` may have been applied. The host must never
  retry writes automatically, whatever the kind says (contract rule).

### resend-api (`managed-openapi`, eligible, 59 tools)

- Follow-up: `http.post.emails` → `{ id }`; watch `http.get.emails.by.email.id` with
  `path.email_id: $result.id`; judge delivery from `last_event`.
- Observe: `http.get.emails`, `data[*]`, key `$.id`, keep `to`, `from`, `subject`, `created_at`,
  `last_event`. Entity `sent-email`: these are the Owner's own sends.
- Failures: Resend error body `{ statusCode, name, message }`; `name` is the provider code
  (`missing_api_key`, `invalid_api_key`, `restricted_api_key`, `rate_limit_exceeded`,
  `daily_quota_exceeded`, `monthly_quota_exceeded`, `not_found`, `validation_error`).
- Gap: broadcasts (`http.post.broadcasts.by.id.send`) also deserve a follow-up once a broadcast
  read exposes delivery statistics.

### vercel-api (`managed-openapi`, eligible, 26 tools)

- Follow-up: `vercel.create_deployment` → watch `vercel.get_deployment` with
  `path.idOrUrl: $result.id` (+5m, +15m, +1h, stop +6h); wake on `error`.
- Observe: `vercel.list_deployments`, `deployments[*]`, key `$.uid` (_inferred_), keep `name`,
  `url`, `state`, `target`, `created`, `creator.username`, commit message and ref.
- Failures: `{ error: { code, message } }`. Vercel answers an invalid or expired token with 403
  `forbidden` as well as 401, so `permission_denied` is mapped to Owner reconnect (a new token
  fixes both).
- `promote_deployment` and `rollback_deployment` return no stable identity in the reviewed spec.

### vercel (`managed-remote-mcp`, eligible, 246 tools)

Same provider as `vercel-api`; no declaration until a live capture shows result shapes.

### atlassian-api (`managed-openapi`, eligible, Jira REST)

- Follow-up: `jira.create_issue` → `{ id, key, self }`; watch `jira.get_issue` with
  `path.issueIdOrKey: $result.key` and a bounded `fields` list (+1d, +3d, +7d, stop +14d).
- Observe: `jira.search_issues`, `issues[*]`, key `$.key`, keep summary, status, type, priority,
  assignee, reporter, due date, updated (_inferred_; fields appear only when requested).
- Failures: Jira error body `{ errorMessages: [], errors: {} }` has no stable codes, so rules use
  HTTP status only.

### atlassian, atlassian-api-token (`managed-remote-mcp`, 117 tools)

Writes such as `create_jira_issue` and `create_confluence_content` exist, but result shapes are
unknown and the API-token variant is history. No declaration.

### wordpress-self-hosted (`managed-openapi`, eligible, 25 tools)

- Follow-up: `wordpress.create_post` → `{ id, … }`; watch `wordpress.list_comments` with
  `query.post: [$result.id]`.
- Observe: `wordpress.list_comments`, top-level array (`$[*]`), key `$.id`, keep `post`,
  `author_name`, `status`, `date_gmt`, `link`, `content.rendered`. Describe: kind and `needs_reply`.
- Failures: WordPress REST errors are `{ code, message, data: { status } }`; `code` is the provider
  code (`rest_forbidden`, `incorrect_password`, `rest_post_invalid_id`, …).

### supernala-social (`managed-remote-mcp`, eligible, 13 tools)

- The canonical example. `publish_post` (write) → two follow-ups using only `$args`:
  `get_analytics` for `account_ids[0]` (post performance, `remember` best posting time), and
  `list_comments` with `status: pending` (replies).
- Observe: `list_comments`, `comments[*]`, key `$.id` (_inferred_; confirm with the first-party
  server's response).
- Note: the brief's example used `tebar.publish_post`. Tebar has no such tool; its `create_post` is
  classified `destructive` and so cannot trigger a follow-up. Tebar `get_post_insights` would be
  the watch tool if `create_post` is reclassified.

### jev, jev-openrouter (`managed-openapi`, eligible)

Single read `jev.ask`. Failures only: 401 key revoked, 402 out of credits (OpenRouter) →
`quota_exceeded` Owner report, 403, 429, 5xx.

### Others (no declaration)

- `buffer` (remote, 17): `create_post` (write) → `get_post` / `get_aggregated_post_metrics` is a
  good future follow-up once result shapes are captured.
- `tebar` (33), `repliz` (73), `meta-ads-token` (108), `linear` (65), `elevenlabs` (20): writes and
  lists exist (`linear.save_issue`, `repliz.create_schedule`, `meta-ads.ads_create_campaign`), but
  result shapes are unknown. Linear `list_issues` and `get_notifications` are strong future
  observation sources.
- `notion` (3 reads), `maple` (24 reads), `google-maps` (6 reads): read-only. Maple
  `list_alert_incidents` and Notion search are good observation candidates after a capture.
- `cloudflare`, `posthog`, `wordpress-com`: code-mode `execute`/`exec` tools classified
  `destructive`; nothing typed to observe.
- `resend` (remote): one write, no read to watch with.
- `canva`: revoked. `remotes/gmail.json`: staged, no catalog. `openapi-inventory`,
  `offline-fixture`: fixtures.

## Gaps and risks

1. **No output schemas.** Paths into results are reviewed by reading code or captures, not
   checked by the validator. A wrong path only produces nothing (the host skips items without a
   key and follow-ups whose required references do not resolve), never a wrong action.
2. **Text-only package errors.** Gmail, GitHub and Google packages expose failures only as text.
   `messageTemplates` and `messagePrefix` are exact, reviewed and deterministic, but tied to the
   package's wording; a new package version that rewords a message silently stops matching. The
   durable fix is for packages to return `error.data = { httpStatus, providerCode,
retryAfterSeconds }` (or Slack's `structuredContent.error`), which needs new package versions.
3. **One declaration serves every version.** A definition's versions can come from different
   sources (Slack's hosted MCP 1.0.0 and package 1.1.x). The host re-checks each entry against the
   installed version's catalog and drops entries that do not resolve.
4. **Ambiguous writes.** Several writes report "outcome unknown". The contract forbids automatic
   re-invocation of any write regardless of kind; `retry`/`backoff` apply to reads and watches.
5. **Composite keys and string templates** are not supported (Slack channel history, Gmail
   thread search). Both were left out deliberately to keep the grammar small.
6. **Watch cost.** Each follow-up check is one read call plus one Jev call. Bounds: 8 checks,
   30 days, 8 follow-ups per Plugin.
