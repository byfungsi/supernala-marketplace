# Plugin behaviour declarations

A behaviour declaration tells Supernala what an app's tools mean over time, beyond the tools
themselves:

- **`followUps`**: after one of the app's writes succeeds, which of its reads watches the outcome,
  when, which typed questions judge it, and when a Bot should hear about it.
- **`failures`**: how the app's failures map to typed kinds, and who fixes each kind.
- **`observe`**: which read results become Workspace observations, and which fields are kept.

A declaration **grants no authority**. Every tool it names must already be in the Plugin's
reviewed catalog with the right classification; every call it causes still goes through the
Owner's grants and tool policies; follow-ups contain only reads. Its short strings are app
guidance shown to the model as such, never Owner instructions.

The application contract (exact parsing and runtime semantics) is
[proactive-manifest-app-contract.md](proactive-manifest-app-contract.md). The per-Plugin analysis
behind the shipped declarations is [proactive-manifest-research.md](proactive-manifest-research.md).

## Layout and digests

```text
behaviors/<publisher>/<slug>.json   one declaration per Plugin definition
```

Declarations live outside Plugin source roots and release inputs, exactly like
[setup guides](plugin-setup-guides.md). This is deliberate:

- **No existing digest changes.** A key in `plugin.json` or `catalog.json` would change the
  manifest, artifact and catalog digests and is rejected today by the application's strict
  decoders (`onExcessProperty: "error"`). A new file inside the package archive would change the
  artifact digest and needs a version. Remote MCP releases have no archive at all, and OpenAPI
  bundles are decoded strictly. A sidecar works the same way for all three runtimes and leaves
  every published version byte-identical.
- **It is still digest-bound.** The application stores each revision with the SHA-256 of its
  canonical JSON (sorted keys, no whitespace), and revisions are immutable.
- **Behaviour can improve without a version.** Since a declaration grants nothing, attaching a
  reviewed revision to already-published versions is safe; the host re-checks every tool reference
  against the installed version's catalog and ignores entries that do not resolve.

`plugin` must match the path: `behaviors/supernala/gmail.json` is
`supernala-public:supernala:gmail` (same definition IDs as guides). Bump `revision` to change a
published declaration; the highest revision is current.

```sh
pnpm marketplace behaviors validate   # schema, bounds and catalog checks; prints revision digests
pnpm check                            # runs the same checks in the test suite
```

The JSON Schema is `schemas/plugin-behavior.schema.json`, generated from `src/plugin-behavior.ts`.

## Shape

```json
{
  "schemaVersion": 1,
  "plugin": "supernala-public:supernala:supernala-social",
  "revision": 1,
  "followUps": [
    {
      "id": "post-performance",
      "after": { "tool": "supernala-social.publish_post", "outcome": "succeeded" },
      "watch": {
        "tool": "supernala-social.get_analytics",
        "args": {
          "workspace_id": "$args.workspace_id",
          "account_id": "$args.account_ids[0]",
          "days": 7
        },
        "checkAt": ["+1h", "+6h", "+24h", "+72h"],
        "stopAfter": "+7d"
      },
      "judge": {
        "classify": {
          "name": "status",
          "options": ["normal", "taking off", "underperforming", "removed"]
        },
        "yesNo": {
          "name": "owner_should_know",
          "question": "Would the Owner want to hear about this now?"
        }
      },
      "wakeWhen": "owner_should_know = yes",
      "instruction": "Summarise how the new post is doing compared with recent posts and suggest one action.",
      "remember": ["best posting time by platform"]
    }
  ],
  "failures": {
    "signals": { "providerCodePaths": ["$.error.reason"] },
    "rules": [{ "kind": "rate_limited", "httpStatus": [429] }],
    "kinds": { "rate_limited": { "fix": "auto", "action": "backoff" } }
  },
  "observe": [
    {
      "from": "supernala-social.list_comments",
      "entity": "social-comment",
      "items": "$.comments[*]",
      "key": "$.id",
      "time": "$.created_at",
      "keep": ["account_id", "platform", "author", "text", "status"],
      "describe": {
        "classify": {
          "name": "kind",
          "options": ["question", "praise", "complaint", "spam", "other"]
        },
        "yesNo": { "name": "needs_reply", "question": "Should the account reply to this comment?" }
      }
    }
  ]
}
```

At least one of `followUps`, `failures` and `observe` is required. Unknown keys are rejected.

### Typed questions

`judge` (follow-ups) and `describe` (observations) hold one to three typed Jev questions, at most
one of each type. They map one-to-one to the application's Jev step (`choice`, `noul`, `score`).

| Key        | Fields                       | Bounds                                                   |
| ---------- | ---------------------------- | -------------------------------------------------------- |
| `classify` | `name`, `options`            | 2–10 options, each ≤ 60 characters, unique ignoring case |
| `yesNo`    | `name`, `question`           | question ≤ 200 characters                                |
| `score`    | `name`, `question`, `levels` | 2–10 levels, lowest first, each ≤ 60 characters          |

`name` is the answer's name: `^[a-z][a-z0-9_]{0,39}$`, unique within the questions, and not
`model` or `usage` (Jev reserves them).

### `followUps`

| Field             | Rule                                                                        |
| ----------------- | --------------------------------------------------------------------------- |
| `id`              | kebab-case, ≤ 64, unique in the declaration                                 |
| `after.tool`      | a `write` tool of this Plugin (not `read`, `destructive` or `unknown`)      |
| `after.outcome`   | `succeeded` (the only outcome in version 1)                                 |
| `watch.tool`      | a `read` tool of this Plugin                                                |
| `watch.args`      | JSON template for the watch tool's input (below)                            |
| `watch.checkAt`   | 1–8 offsets `+<n>m`, `+<n>h` or `+<n>d`, strictly increasing, first ≥ `+5m` |
| `watch.stopAfter` | offset ≥ the last check and ≤ `+30d`                                        |
| `judge`           | typed questions about each check's result                                   |
| `wakeWhen`        | when to wake the Bot (below)                                                |
| `instruction`     | ≤ 280 characters, one line, no `<`, `>`, `{`, `}` or control characters     |
| `remember`        | optional, ≤ 5 entries of ≤ 80 characters: topics worth learning across runs |

At most 8 follow-ups per declaration.

**Argument templates.** Objects and arrays (depth ≤ 3, ≤ 16 leaves) whose leaves are strings,
numbers or booleans. A string starting with `$` must be a reference: `$result.<path>` into the
write's result, or `$args.<path>` into the write's arguments, where `<path>` is dot-separated
names with optional `[n]` indices (`$args.account_ids[0]`). Strings are never interpolated.
Where the watch tool's input schema declares `properties`, every key must be one of them, and its
`required` keys must be present. OpenAPI tools group inputs as `path`, `query` and `body`:
`{ "path": { "idOrUrl": "$result.id" } }`.

Prefer `$args` when the write's result is minimal or undocumented: arguments are known exactly.

**`wakeWhen`.** One to four clauses joined by `or`. A clause is `<answer> <op> <value>`:

- classify: `=` or `!=` with one of its options (`status = taking off`);
- yesNo: `=` or `!=` with `yes` or `no`;
- score: `=`, `!=`, `>=` or `<=` with one of its levels, compared by position (`reach >= high`).

An option must not contain `or <name> <op>`, which would read as a new clause.

### `failures`

```json
{
  "signals": {
    "messageTemplates": ["Gmail adapter request failed with status {status}"],
    "providerCodePaths": ["$.error.reason"],
    "httpStatusPaths": ["$.error.httpStatus"],
    "retryAfterPaths": ["$.error.retryAfterSeconds"]
  },
  "rules": [
    { "kind": "auth_expired", "httpStatus": [401] },
    {
      "kind": "permission_denied",
      "providerCode": ["access-denied"],
      "fix": "owner",
      "action": "report"
    },
    { "kind": "transient", "messagePrefix": ["Google Drive could not reach Google"] }
  ],
  "kinds": {
    "auth_expired": { "fix": "auto", "action": "refresh_token" },
    "permission_denied": { "fix": "owner", "action": "reconnect" },
    "transient": { "fix": "auto", "action": "retry" }
  }
}
```

**Signals** tell the host where the facts are, so it never guesses from prose:

- the HTTP status comes from the host's own HTTP call (OpenAPI, remote transport), then
  `httpStatusPaths` into the error payload, then `messageTemplates`;
- the provider code comes from `providerCodePaths` into the error payload (the first string found);
- `retryAfterPaths` give seconds to wait for `backoff`.

A message template contains exactly one `{status}`; it matches a message that starts with the
text before `{status}`, then three digits, then the text after it (anything may follow).

**Rules** are checked in order and the first match wins. A rule needs at least one of
`httpStatus` (400–599), `providerCode` (exact) and `messagePrefix` (exact prefix of the error
message); every condition present must hold. `tools` limits a rule to some of the Plugin's tools.
A rule may override its kind's handling with both `fix` and `action`. At most 32 rules.

**Kinds** and handling:

| Kind                | Meaning                                                                    |
| ------------------- | -------------------------------------------------------------------------- |
| `auth_expired`      | the credential expired and may be refreshable                              |
| `auth_revoked`      | the credential no longer works; the Owner must reconnect                   |
| `rate_limited`      | too many requests; wait                                                    |
| `transient`         | the provider failed temporarily                                            |
| `watch_expired`     | a provider subscription or watch lapsed                                    |
| `not_found`         | the object no longer exists; a fact, not an error                          |
| `permission_denied` | the account or credential lacks access                                     |
| `schema_changed`    | the provider's answer no longer matches the app; the publisher must fix it |
| `quota_exceeded`    | a plan or credit limit was reached                                         |

| `fix`       | Allowed `action`                                                                                                                                   |
| ----------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| `auto`      | `retry` (transient, watch_expired), `backoff` (rate_limited, quota_exceeded, transient), `rewatch` (watch_expired), `refresh_token` (auth_expired) |
| `owner`     | `reconnect` (auth_expired, auth_revoked, permission_denied), `report`                                                                              |
| `publisher` | `report`                                                                                                                                           |
| `none`      | `none`                                                                                                                                             |

Every rule's kind needs handling, from `kinds` or the rule's own override. Kinds that never match
a rule may still be declared; the host also uses `kinds` for failures it classifies itself (for
example a refresh that returns `invalid_grant`). Whatever a declaration says, the host never
re-invokes a write automatically: `retry` and `backoff` apply to reads and watch checks only.

Do not classify messages that say an outcome is ambiguous ("outcome unknown", "do not retry").
Leave them unmatched so the host reports them.

### `observe`

| Field      | Rule                                                                                             |
| ---------- | ------------------------------------------------------------------------------------------------ |
| `from`     | a `read` tool of this Plugin                                                                     |
| `entity`   | kebab-case noun, ≤ 64 (`email`, `issue`, `sent-email`); unique with `from`                       |
| `items`    | `$` for a single-object result, or `$.<path>[*]` for a collection (`$[*]` for a top-level array) |
| `key`      | `$.<path>` inside each item: the provider's stable external identity                             |
| `time`     | optional `$.<path>` to when the item happened (ISO 8601, RFC 2822, or Unix seconds/milliseconds) |
| `keep`     | 1–16 unique dotted field paths inside each item (`headers.subject`), stored under the same path  |
| `describe` | optional typed questions about each new or changed item                                          |

At most 8 observations. There are no ignore lists: relevance is decided per Workspace by each
Bot's interests. Keep only what helps a Bot decide whether an item matters; never keep message
bodies, file contents or other bulk text (the host bounds kept fields to 2 KB per item).

## Writing a declaration

- Start from what an Owner would want to hear about unprompted. Declare a follow-up only when a
  read of the same Plugin can show the write's outcome, and an observation only when a list result
  carries enough fields to judge an item without another call.
- Choose a `key` that is stable and unique for the connection: a URL or provider id, not a
  position or a per-channel timestamp.
- Read the package source or a live capture for every `$result.`, `items`, `key`, `time` and
  `keep` path. Catalogs have no output schemas, so the validator cannot check them; a wrong path
  silently produces nothing.
- Keep `instruction` to one sentence about what to summarise and what to suggest. Never address
  the Owner, never ask for credentials, never mention other apps' data.
- `remember` names a topic ("best posting time by platform"), never a value.

## Review checklist

Add this to the authority review of any change under `behaviors/`:

1. `pnpm marketplace behaviors validate` and `pnpm check` pass.
2. Every `after.tool` is a write whose success is a real event for the Owner, and the watch tool
   can observe its outcome with the mapped arguments.
3. Every `$result.` path matches the tool's actual result (package source or live capture); prefer
   `$args.` where the result is minimal.
4. The schedule is proportionate: checks only as often as the outcome can change, `stopAfter` no
   longer than the outcome stays interesting.
5. `wakeWhen` wakes for what the Owner would want to hear, not for every check.
6. Text fields are short neutral app guidance: no instructions to the Owner or the Bot to do
   anything beyond summarising and suggesting, no URLs, no secrets, no other apps.
7. `failures` rules use structured signals or exact messages from the reviewed package version;
   ambiguous write outcomes stay unmatched; Owner-facing fixes are honest (reconnecting does not
   fix "not in channel").
8. `observe` keys are stable and unique; `keep` excludes bodies, file contents and secrets.
9. The revision is bumped if the published text changed.

## What needs republishing

Nothing in this change alters a Plugin version, package, release, catalog or guide. The
declarations reach the application only after it ships the behaviour table and publication path
described in the app contract; publishing them is a separate step like guide publication.
