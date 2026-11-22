# Plugin behaviour declarations

A behaviour declaration tells Supernala what an app's tools mean over time, beyond the tools
themselves:

- **`followUps`**: after one of the app's writes succeeds, which of its reads watches the outcome,
  when, which typed questions judge it, and when a Bot should hear about it.
- **`failures`**: how the app's failures map to typed kinds, and who fixes each kind.
- **`observe`**: which read results become Workspace observations, and which fields are kept.
- **`sources`**: how new items reach Supernala on their own: a provider watch, a webhook, or a
  bounded poll, registered when a connection is ready.
- **`watchables`**: named, read-only queries a Watch may run on a connection, with typed
  parameters and typed result fields that Watch conditions compare.
- **`profile`**: deterministic identity reads the host runs when a connection becomes ready, and
  the default Watches it then creates for the Owner (never about other people's activity).

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

At least one of `followUps`, `failures`, `observe`, `sources`, `watchables` and `profile` is
required. Unknown keys are rejected.

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

### `sources`

How new items reach Supernala without anyone asking (ADR 0044 in the application). When a
connection is ready the host registers each source without asking again: installing the app and
connecting the account is the Owner's consent. Disconnecting, uninstalling, revoking the last grant,
or turning **Watching for new items** off removes it. Every new item is read with a `read` tool of
this Plugin and goes through `observe`, so a source's tool **must** have an `observe` entry.

| Kind             | Fields                                                             | Meaning                                                                                                                                               |
| ---------------- | ------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| `provider-watch` | `id`, `adapter`, `fetch`                                           | A provider push watch the host owns (`gmail`: Gmail `users.watch` to Pub/Sub, one event per added message).                                           |
| `webhook`        | `id`, `adapter`, `events`, `fetch`                                 | A provider webhook the host owns (`github`: the GitHub App's deliveries for the installations the connection reaches); `events` picks which to fetch. |
| `poll`           | `id`, `tool`, `args`, `intervalMinutes`, `items`, `key`, `cursor?` | A bounded poll of a cheap list or search read, for apps that cannot push.                                                                             |

- `fetch` is `{ "tool": <read tool>, "args": <template> }`. Template leaves are literals or
  `$event.<field>` references to the adapter's event fields; a missing field removes its key, and
  strings are never interpolated. Fields: `gmail` — `messageId`, `threadId`; `github` — `owner`,
  `repo`, `number`, `event`, `action`, `url`. GitHub events: `issues`, `issue_comment`,
  `pull_request`, `pull_request_review`, `pull_request_review_comment`.
- A `poll`'s `args` are literal only. `intervalMinutes` is 15 to 1440. `items` and `key` use the
  `observe` path grammar. The optional `cursor` is `{ "path": <item path>, "arg": <top-level
argument> }`: the greatest value at `path` across a result's items (text or number) is stored and
  passed as `arg` on the next poll; `arg` must be a top-level property of the tool's input schema
  and may be one of its `required` keys.
- At most 4 sources, ids unique. Adapters are reviewed host code: a declaration chooses one, never
  describes a provider API. An adapter the application does not know is ignored at binding.
- The host polls only while some Bot has an interest in what the poll feeds (or the default
  commitments interest applies to `email`), reads as the Workspace's default proactive Bot (else
  the first Bot holding an `allow` grant for the tool), and bills each read as a plugin call.

```json
"sources": [
  {
    "id": "new-mail",
    "kind": "provider-watch",
    "adapter": "gmail",
    "fetch": { "tool": "gmail.get_message", "args": { "messageId": "$event.messageId" } }
  }
]
```

### `watchables`

A Watch (ADR 0045 in the application) is a standing, read-only check on one connection that the
host runs on an hourly checkpoint. A Bot never names a raw tool for a Watch: it picks one of the
app's **watchables**, supplies the watchable's parameters, and optionally adds a typed condition.
Default Watches in `profile` use watchables too.

```json
"watchables": [
  {
    "id": "my-open-prs",
    "label": "My open pull requests",
    "tool": "github.search_pull_requests",
    "params": {
      "qualifiers": { "type": "string", "label": "Extra GitHub search qualifiers" }
    },
    "args": {
      "query": "is:pr is:open author:$profile.login $param.qualifiers",
      "perPage": 50
    },
    "items": "$.items[*]",
    "key": "$.html_url",
    "fields": {
      "title": { "path": "$.title", "type": "string" },
      "state": { "path": "$.state", "type": "enum", "values": ["open", "closed"] },
      "number": { "path": "$.number", "type": "number" }
    }
  }
]
```

| Field    | Rule                                                                                    |
| -------- | --------------------------------------------------------------------------------------- |
| `id`     | kebab-case, ≤ 64, unique among watchables                                               |
| `label`  | ≤ 80 characters, one line: what the query reads, as a Bot would describe it             |
| `tool`   | a `read` tool of this Plugin                                                            |
| `params` | optional, ≤ 6 typed parameters the Watch supplies (below)                               |
| `args`   | JSON template for the tool's input: literals plus `$param.` and `$profile.` references  |
| `items`  | `observe` items grammar: `$`, `$.<path>[*]` or `$[*]`                                   |
| `key`    | `$.<path>` inside each item: the provider's stable identity (a string or number)        |
| `fields` | 1–12 typed fields read from each item; conditions compare only these                    |
| `fetch`  | optional `{ "tool": <read tool>, "args": <template> }` that reads each new item in full |

At most 12 watchables. Parameter and field names are `^[a-z][a-z0-9_]{0,39}$`.

**Suggested Watches.** `profile.suggestedWatches` (at most 6) has the shape and checks of
`defaultWatches` plus a required `label` the Owner reads. The host never creates them by itself:
it offers each as a one-tap suggestion on the Overnight card when the connection is profiled;
Accept creates the Watch exactly as declared (with a Cancel receipt), and two dismissals stop the
offer. Use them for useful but opt-in checks (a Meta Ads campaign that stops delivering). Ids are
unique across `defaultWatches` and `suggestedWatches`.

**Types.** A parameter or field is `string`, `number`, `boolean` or `enum`; conditions compare a `boolean` field with `true` or `false` (for example `field-changed` on `merged` to `true`). An `enum` lists 1–16 unique
`values` (each ≤ 60 characters); `values` is required for an enum and refused for any other type.
A parameter may be `required` and may carry a `label` (≤ 80 characters) the Bot reads when it fills
it in. A field's `path` is an item path (`$.a.b`, no indices, ≤ 8 segments). When an item is read,
a `number` field accepts a JSON number or a numeric string (`"1250.50"`), a `string` field a string
or number (cut to 300 characters), and an `enum` field only one of its values; a value of the wrong
type, a boolean, an object or a missing path leaves the field out of that item. There is no boolean
type: expose a boolean as the value it implies (a state enum, or a timestamp string).

**References.** Argument templates follow the follow-up rules (depth ≤ 3, ≤ 16 leaves, keys known
to and required by the input schema), with two reference namespaces:

- `$param.<name>`: the Watch's own value for a declared parameter;
- `$profile.<name>`: a value the app profile recorded for the connection. Only a scalar profile
  value (a path without `[*]`) may be referenced.

A whole string reference (`"pullNumber": "$param.number"`) becomes the typed value; an absent
optional parameter removes the key. A reference inside a longer string
(`"is:pr author:$profile.login $param.qualifiers"`) becomes its text; an absent optional
parameter becomes nothing and repeated spaces collapse. A string that starts with `$` must be a
whole reference, so put embedded references after some literal text. Every `$<namespace>.<name>`
token anywhere in `args` must name a declared parameter or a scalar profile value; any other token
(`$event.`, `$item.`, an unknown name) is refused. If a profile value the template needs was not
recorded, the host does not run the Watch.

**`fetch`.** When a list result carries only identities (a Gmail search returns message ids), the
host reads each **new** item with `fetch.tool`, at most 10 per read. `fetch.args` leaves are
literals or a whole `$item.key` / `$item.<field>` reference to the selected item; nothing is
interpolated. The fetch result goes through `observe` like any read, so give the fetch tool an
`observe` entry when its result should become an observation.

### Watch conditions

A condition is a typed predicate over a watchable's items, evaluated without a model. The host
uses the same grammar for Owner-requested Watches and for default Watches.

| `kind`          | Fields                                                              | Fires                                                                                                               |
| --------------- | ------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| `new-item`      | `where?`                                                            | for each item whose key was not seen before and that matches `where`                                                |
| `field-changed` | `field`, `from?`, `to?` (one or a list), `where?`                   | for a known item whose field moved (from `from`, to one of `to`)                                                    |
| `threshold`     | `field` (a `number`), `op` (`>=`/`<=`), `value`, `rearm?`, `where?` | once per item that crosses; without `rearm` the Watch then ends, with it an item may fire again after it falls back |
| `count`         | `op`, `value` (integer ≥ 0), `rearm?`, `where?`                     | once when the number of matching items crosses; ends or re-arms like `threshold`                                    |
| `ask`           | `question` (≤ 200 characters), `where?`                             | when one billed Jev call says a new or changed item answers the question                                            |

`where` holds up to 8 clauses `{ "<field>": literal | [literal, …] }` (1–10 alternatives); every
clause must hold, and a clause holds when the field equals one alternative. Every named field must
exist, a literal must have its field's type (an enum literal is one of its values), `field-changed`
needs `from` or `to`, and `threshold` compares a number field. The first read of a Watch records a
baseline and fires nothing, except a `threshold` or `count` that is already across. `ask` is only
for Owner-requested Watches; a default Watch must be deterministic.

### `profile`

What the host learns about the account when a connection becomes ready, and the Watches it
creates by default for the connection's default proactive Bot. Default Watches are about the
Owner (in a Team Workspace, the member who connected the account): my pull requests, pull requests
waiting for my review, my inbox. Never declare a default that reads other people's activity.

```json
"profile": {
  "steps": [{ "tool": "github.get_me", "args": {}, "values": { "login": "$.login" } }],
  "defaultWatches": [
    {
      "id": "pr-approved",
      "watchable": "my-open-prs",
      "args": { "qualifiers": "review:approved" },
      "condition": { "kind": "new-item" },
      "notify": "Your pull request was approved."
    }
  ]
}
```

| Field                        | Rule                                                                                                                          |
| ---------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `steps`                      | 1–4 deterministic reads                                                                                                       |
| `steps[].tool`               | a `read` tool of this Plugin; a cheap identity read where the app has one                                                     |
| `steps[].args`               | literal arguments only (no references), checked against the input schema                                                      |
| `steps[].values`             | 1 or more `{ "<name>": <path> }`; ≤ 8 names across all steps, unique, `^[a-z][a-z0-9_]{0,39}$`                                |
| `defaultWatches`             | optional, ≤ 6                                                                                                                 |
| `defaultWatches[].id`        | kebab-case, unique among default Watches                                                                                      |
| `defaultWatches[].watchable` | the `id` of a watchable in this declaration                                                                                   |
| `defaultWatches[].args`      | optional; keys are the watchable's parameters, values a literal of the parameter's type or a whole `$profile.<name>` (scalar) |
| `defaultWatches[].condition` | optional deterministic condition (any kind but `ask`), typed against the watchable's fields                                   |
| `defaultWatches[].notify`    | optional, ≤ 200 characters: the line the Bot is woken with when the condition fires                                           |

A profile value path is `$.a.b` (a scalar; `[n]` indices allowed) or `$.list[*].field` (a list of
scalars, such as every ad account id). List values are stored for the Bot to read but cannot be
referenced in arguments. A value whose path does not resolve is left out.

Every required parameter of the watchable must be supplied. A default Watch **without a
condition** only feeds observation capture: its reads become observations, and triage, Bot
interests and the default commitments interest decide what matters. Use that for high-volume reads
such as an inbox, where a nudge per item would be noise. A default Watch with a condition wakes the
Bot with `notify` when it fires.

Profiles exist to scope default Watches to the account. If an app has no identity read, a profile
step may record a harmless value (Gmail records the inbox size estimate) so the default Watches
can be declared; say so in the research notes.

Review state is not always a field. GitHub search results carry no review state, so the GitHub
defaults use the search's own `review:approved` and `review:changes_requested` qualifiers with
`new-item`: a pull request entering the approved set is the state change.

**Problems** `pnpm marketplace behaviors validate` reports for these sections:

| Problem                                                  | Meaning                                                                                                           |
| -------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `behavior-watchable-duplicate-id`                        | two watchables share an `id`                                                                                      |
| `behavior-watchable-not-read`                            | a watchable's `tool` or `fetch.tool` is not a `read` tool                                                         |
| `behavior-watchable-name-invalid`                        | a parameter, field or profile value name is not `^[a-z][a-z0-9_]{0,39}$`                                          |
| `behavior-watchable-field-invalid`                       | `values` missing on an enum, present on another type, or repeated                                                 |
| `behavior-watchable-reference-unknown`                   | a `$…` token in `args` or `fetch.args` names no parameter, scalar profile value or item field                     |
| `behavior-watchable-arg-unknown`                         | an argument key the tool's input schema does not declare                                                          |
| `behavior-watchable-arg-missing`                         | a key the tool's input schema requires is missing                                                                 |
| `behavior-watchable-arg-invalid`                         | a bad key, null, empty or over-long string, a `$` string that is not a whole reference, depth or leaf bounds      |
| `behavior-profile-not-read`                              | a profile step's tool is not a `read` tool                                                                        |
| `behavior-profile-arg-unknown` / `-missing` / `-invalid` | as for watchable arguments; any reference in a profile step is invalid                                            |
| `behavior-profile-value-duplicate`                       | two steps record the same value name                                                                              |
| `behavior-default-watch-duplicate-id`                    | two default Watches share an `id`                                                                                 |
| `behavior-default-watch-watchable-unknown`               | a default Watch names no declared watchable                                                                       |
| `behavior-default-watch-arg-invalid`                     | an unknown parameter, a value of the wrong type, a list or unknown profile value, or a missing required parameter |
| `behavior-condition-invalid`                             | an `ask` default, or a condition not typed against the watchable's fields                                         |

Bounds (too many watchables, parameters, fields, steps, values or default Watches; a path deeper
than 8 segments; a step without values) are `behavior-shape-invalid`.

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
- Declare a watchable for each question an Owner is likely to ask about the app ("tell me when my
  pull request is approved", "when my ad spend reaches X"), over the cheapest read that answers
  it. Expose only fields a condition can compare, never bodies or bulk text.
- Default Watches should be few, about the Owner, and quiet: prefer capture-only Watches for
  high-volume reads and conditions with `notify` only for events an Owner wants to hear about.

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
9. Every `sources` entry feeds an `observe` entry; a poll uses a cheap list or search read with
   an interval no shorter than the items change, and its `cursor.path` matches the actual result.
10. Every watchable's `items`, `key` and field paths match the actual result; field types match
    the provider's values (numbers may arrive as numeric strings); `fetch` reads only new items.
11. Profile steps are cheap identity reads with literal arguments; default Watches are about the
    Owner only, conditions are deterministic, capture-only defaults are used for noisy reads, and
    `notify` lines are short and neutral.
12. The revision is bumped if the published text changed.

## Publishing

Declarations reach the application through `pnpm marketplace behaviors publish`, which inserts one
row per `(plugin_definition_id, revision)` into the application's `plugin_behavior_declarations`
table: `declaration_json` is the canonical JSON and `content_sha256` its SHA-256, exactly what the
application recomputes on read. `compatibility/plugin-behaviors/` vendors the application's exact
migration (`0262_plugin_behavior_declarations.sql`) with its digest; tests apply it to SQLite and
publish into it, and fail if the vendored bytes drift from what the publisher assumes.

**Ordering.** Publish only after the application release that applies migration 0262 is deployed
to production. Before that, the plan fails because the table does not exist; nothing is written.

```sh
git switch main && git pull --ff-only
pnpm marketplace behaviors publish --environment production            # dry run: plan only
pnpm marketplace behaviors publish --environment production --confirm  # insert and read back
```

Both forms require a clean `main` equal to fetched `origin/main`, validate every declaration
against its definition's reviewed catalog (any invalid declaration stops the run), read the
application's current rows and print the plan:

- `insert`: a new revision for a definition the application has.
- `unchanged`: that revision is already stored with the same digest; nothing is written.
- `skip`: the definition is not in `plugin_definitions` yet. Others still publish; re-run after
  the Plugin is published.
- `REFUSED`: a stored revision has a different digest (`behavior-revision-content-changed`), or a
  higher revision is already stored (`behavior-revision-not-newer`). Revisions are immutable, so
  any refusal stops the whole run; bump `revision` instead.

Without `--confirm` the command writes nothing. With it, each new revision is inserted and read
back, and the stored text and digest must match. The publisher only ever issues `INSERT`; the
vendored triggers abort any `UPDATE` or `DELETE`. Running it again is a no-op, so an interrupted
run is retried by running it again.

Credentials come from outside the repository: an owner-only (`0600`) file, by default
`~/.config/supernala-marketplace/production.behaviors.env`, or `--credentials <file>`, holding
exactly `CLOUDFLARE_ACCOUNT_ID`, `APPLICATION_DATABASE_ID` and `APPLICATION_BEHAVIOR_PUBLISH_TOKEN`
(a Cloudflare API token with D1 edit on the application database). Nothing is read from the
process environment; the guide token is a separate file and is not accepted here.

A successful run does not establish that the application binds or acts on a declaration; check
the application's behaviour support route for the definition after publishing.

## What needs republishing

Nothing in this change alters a Plugin version, package, release, catalog or guide. Changing a
declaration needs a revision bump and a `behaviors publish`; nothing else is republished.
