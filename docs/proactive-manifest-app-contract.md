# Behaviour declarations: application contract

This is what the Supernala application must parse and do for Plugin behaviour declarations. The
publisher-facing spec is [proactive-manifest.md](proactive-manifest.md); the source of truth for
shapes and bounds is `src/plugin-behavior.ts` (Effect schema `PluginBehaviorDeclaration`, bounds
`PLUGIN_BEHAVIOR_LIMITS`), exported as `schemas/plugin-behavior.schema.json`. Vendor
`fixtures/behaviors/conformance.json`: the application decoder must accept every `accepted`
case and reject every `rejected` case (the `problem` names the Marketplace reason; the
application may use its own reason codes).

## 1. Where declarations come from

Declarations are **not** in `plugin.json`, `catalog.json`, OpenAPI bundles or remote releases.
Nothing in the existing package, catalog or version decoders changes, and every published digest
stays byte-identical. They are published separately, like setup guides, one row per
`(plugin_definition_id, revision)`.

Application migration `0262_plugin_behavior_declarations.sql` (vendored byte-for-byte under
`compatibility/plugin-behaviors/` and written by `pnpm marketplace behaviors publish`, mirroring
guides; see [Publishing](proactive-manifest.md#publishing)):

```sql
CREATE TABLE plugin_behavior_declarations (
  plugin_definition_id TEXT NOT NULL REFERENCES plugin_definitions(plugin_definition_id),
  revision INTEGER NOT NULL CHECK (revision >= 1),
  declaration_json TEXT NOT NULL CHECK (length(declaration_json) BETWEEN 2 AND 65536),
  content_sha256 TEXT NOT NULL CHECK (length(content_sha256) = 64),
  published_at INTEGER NOT NULL,
  PRIMARY KEY (plugin_definition_id, revision)
) WITHOUT ROWID;
-- plus BEFORE UPDATE / BEFORE DELETE triggers that RAISE(ABORT, ...): revisions are immutable.
```

- `declaration_json` is the canonical JSON of the file: keys sorted recursively by
  `String.prototype.localeCompare`, no whitespace (`canonicalPluginJson`).
  `content_sha256 = sha256(declaration_json)` as lowercase hex. The application must recompute
  and compare on read.
- The current declaration for a definition is its highest revision.
- `plugin_definition_id` is `<marketplaceId>:<publisherNamespace>:<slug>`, e.g.
  `supernala-public:supernala:gmail`, the same IDs as `plugin_setup_guides`.

## 2. Types

```ts
type ToolId = string; // ^[a-z0-9]+(?:[._-][a-z0-9]+)*$, 1..160
type Slug = string; // ^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$, 1..64
type AnswerName = string; // ^[a-z][a-z0-9_]{0,39}$, never "model" or "usage"
type ShortText<N> = string; // 1..N chars, no leading/trailing whitespace, no control chars, no < > { }
type Offset = string; // ^\+[1-9][0-9]{0,4}[mhd]$  (minutes, hours, days after the trigger)

interface PluginBehaviorDeclaration {
  schemaVersion: 1;
  plugin: string; // ^[a-z0-9-]+:[a-z0-9-]+:[a-z0-9-]+$
  revision: number; // integer >= 1
  followUps?: FollowUp[]; // <= 8
  failures?: Failures;
  observe?: Observation[]; // <= 8
} // at least one of followUps, failures, observe; unknown keys rejected everywhere

interface Questions {
  classify?: { name: AnswerName; options: ShortText<60>[] }; // 2..10, unique ignoring case
  yesNo?: { name: AnswerName; question: ShortText<200> };
  score?: { name: AnswerName; question: ShortText<200>; levels: ShortText<60>[] }; // 2..10, lowest first, unique ignoring case
} // at least one; names unique

interface FollowUp {
  id: Slug; // unique in the declaration
  after: { tool: ToolId; outcome: "succeeded" }; // tool classification must be "write"
  watch: {
    tool: ToolId; // classification must be "read"
    args: Record<string, Json>; // template, see 4.1
    checkAt: Offset[]; // 1..8, strictly increasing, first >= 5 minutes
    stopAfter: Offset; // >= last checkAt, <= 30 days
  };
  judge: Questions;
  wakeWhen: string; // 1..300, see 4.2
  instruction: ShortText<280>;
  remember?: ShortText<80>[]; // <= 5
}

type FailureKind =
  | "auth_expired"
  | "auth_revoked"
  | "rate_limited"
  | "transient"
  | "watch_expired"
  | "not_found"
  | "permission_denied"
  | "schema_changed"
  | "quota_exceeded";
type Fix = "auto" | "owner" | "publisher" | "none";
type Action = "retry" | "backoff" | "rewatch" | "refresh_token" | "reconnect" | "report" | "none";

interface Failures {
  signals?: {
    messageTemplates?: string[]; // 1..4; 9..200 chars; exactly one "{status}"; no other { }
    providerCodePaths?: ItemPath[]; // 1..4
    httpStatusPaths?: ItemPath[]; // 1..4
    retryAfterPaths?: ItemPath[]; // 1..4
  };
  rules: FailureRule[]; // <= 32, ordered
  kinds: Partial<Record<FailureKind, { fix: Fix; action: Action }>>;
}

interface FailureRule {
  kind: FailureKind;
  httpStatus?: number[]; // 1..16 integers in 400..599
  providerCode?: string[]; // 1..16, ^[A-Za-z0-9_.:-]{1,100}$
  messagePrefix?: ShortText<200>[]; // 1..16
  tools?: ToolId[]; // 1..16, tools of this Plugin
  fix?: Fix; // override; both fix and action, or neither
  action?: Action;
} // at least one of httpStatus, providerCode, messagePrefix

interface Observation {
  from: ToolId; // classification must be "read"
  entity: Slug; // (from, entity) unique
  items: ItemsPath; // "$" | "$.a.b" | "$.a.b[*]" | "$[*]"
  key: ItemPath; // "$.a.b" (at least one segment)
  time?: ItemPath;
  keep: FieldPath[]; // 1..16, unique, "a.b.c"
  describe?: Questions;
}
// Path segment: [A-Za-z_][A-Za-z0-9_]{0,63}; at most 8 segments.
```

Coherent `fix`/`action` pairs (checked for `kinds` entries and rule overrides):

| fix       | action        | allowed kinds                                 |
| --------- | ------------- | --------------------------------------------- |
| auto      | retry         | transient, watch_expired                      |
| auto      | backoff       | rate_limited, quota_exceeded, transient       |
| auto      | rewatch       | watch_expired                                 |
| auto      | refresh_token | auth_expired                                  |
| owner     | reconnect     | auth_expired, auth_revoked, permission_denied |
| owner     | report        | any                                           |
| publisher | report        | any                                           |
| none      | none          | any                                           |

Every rule's kind must have handling in `kinds` unless the rule carries its own override.

## 3. Binding to an installed version

One declaration serves every version of a definition. When the application loads it for a
connection, it checks each `followUps`, `observe` and `failures.rules` entry against **the
installed version's catalog snapshot**:

- every referenced tool exists, with `after.tool` = `write`, `watch.tool` and `observe.from` =
  `read`;
- watch argument keys exist in the watch tool's input schema where it declares `properties`, and
  its `required` keys are present (recursively, as in `checkPluginBehaviorDeclaration`).

An entry that fails is **ignored for that version** (log a safe reason with the definition,
revision and entry index); the rest of the declaration still applies. A rule whose `tools` do not
all resolve is ignored. The whole declaration is rejected only when it fails decoding or its
digest. Effective tool policy is unchanged: a declaration never makes a blocked tool callable,
and a watch check runs only if the Bot that owns the follow-up may call the watch tool on that
connection (the service-workflow rule for read tools applies).

## 4. Follow-ups

When a call to `after.tool` **succeeds** (definite success, not an uncertain outcome), the host
creates one read-only monitoring Workflow per matching follow-up:
schedule → `watch.tool` with resolved args → Jev with `judge` → stop unless `wakeWhen` →
Wake Agent with `instruction`. Offsets are measured from the write's completion time. The
Workflow archives itself at `stopAfter` or after its last check.

### 4.1 Argument templates

`args` is copied with every leaf resolved:

- a string starting with `$result.` or `$args.` is a reference; other leaves are literal;
- `$args` is the write's input exactly as dispatched (after Owner approval and edits);
- `$result` is the write's result object: for a managed package, the JSON-RPC `result`; for an
  MCP result, `structuredContent` when it is an object, otherwise the first `text` content parsed
  as JSON when it parses to an object; for OpenAPI, the parsed JSON response body;
- the path walks object keys, and `[n]` indexes arrays;
- a reference that does not resolve, or resolves to `null`, an object or an array, **removes its
  key** (in an array: removes the element). Scalars keep their JSON type;
- the template is resolved once, when the follow-up is created. If a key the watch tool requires
  is then missing, no Workflow is created (safe reason `follow-up-args-unresolved`).

Grammar: `^\$(?:result|args)(?:\.[A-Za-z_][A-Za-z0-9_]{0,63}(?:\[[0-9]{1,2}\])?){1,8}$`.
Strings are never interpolated.

### 4.2 `wakeWhen`

Split on `/ or (?=[a-z][a-z0-9_]* (?:=|!=|>=|<=) )/u` into 1–4 clauses. Each clause is
`^([a-z][a-z0-9_]*) (=|!=|>=|<=) (\S(?:.*\S)?)$` and must name a `judge` answer:

- classify: `=`/`!=` with an option (exact string);
- yesNo: `=`/`!=` with `yes`/`no` (map Jev's yes/no probability with the host's usual threshold);
- score: any operator with a level; compare 1-based level positions.

The check wakes the Bot when **any** clause holds. Invalid conditions are rejected at
decode time (`parseBehaviorWakeWhen`).

### 4.3 Jev mapping

`judge` and `describe` become one Jev call each, with the read result (bounded) as the subject:

| Declaration                        | Jev step question                                                                                 |
| ---------------------------------- | ------------------------------------------------------------------------------------------------- |
| `classify { name, options }`       | `{ name, type: "choice", instruction: <host wording>, options: options.map(name => ({ name })) }` |
| `yesNo { name, question }`         | `{ name, type: "noul", instruction: question }`                                                   |
| `score { name, question, levels }` | `{ name, type: "score", instruction: question, levels }`                                          |

Answer names already satisfy the Jev question-name pattern and reserved names.

### 4.4 Text

`instruction`, `remember`, `question`, options and levels are reviewed app guidance. Render them
to the model inside an app-guidance frame naming the Plugin, never as Owner or system
instructions. `remember` entries are topics the Bot may learn across runs (memory hints), never
values to store verbatim.

## 5. Failures

### 5.1 Inputs

For one failed call the host derives:

- `message`: the JSON-RPC `error.message`, or for an MCP `isError` result the first `text`
  content; for OpenAPI, none;
- `payload`: the JSON-RPC `error.data` when it is an object; for an MCP `isError` result,
  `structuredContent` when it is an object; for OpenAPI, the parsed JSON error body;
- `httpStatus`: first defined of (a) the status of the host's own HTTP request (OpenAPI; remote
  MCP transport), (b) the first integer 400–599 at `httpStatusPaths` in `payload`, (c) the first
  `messageTemplates` match on `message`: the text before `{status}` is a prefix of the message,
  followed by exactly three digits, followed by the text after `{status}`;
- `providerCode`: the first string (or number, as a string) at `providerCodePaths` in `payload`;
  if the value is an array, its first string element;
- `retryAfterSeconds`: the first positive number at `retryAfterPaths`, else the HTTP
  `Retry-After` header when the host made the request.

### 5.2 Classification

```ts
for (const rule of failures.rules) {
  if (rule.tools && !rule.tools.includes(toolId)) continue;
  if (rule.httpStatus && (httpStatus === undefined || !rule.httpStatus.includes(httpStatus)))
    continue;
  if (
    rule.providerCode &&
    (providerCode === undefined || !rule.providerCode.includes(providerCode))
  )
    continue;
  if (
    rule.messagePrefix &&
    (message === undefined || !rule.messagePrefix.some((p) => message.startsWith(p)))
  )
    continue;
  return {
    kind: rule.kind,
    handling: rule.fix ? { fix: rule.fix, action: rule.action } : failures.kinds[rule.kind],
  };
}
return undefined; // unclassified: the host's existing dispatch-failure handling applies
```

String comparisons are exact and case-sensitive. The host's own facts take precedence over the
declaration: a refresh that ends in `invalid_grant` is `auth_revoked`, a connection already in
`reauthorization-required` is `auth_revoked`, whatever the rules say. `failures.kinds` supplies
handling for these host-classified kinds when declared; otherwise use the defaults below.

### 5.3 Host defaults and invariants

Defaults for a kind with no handling:

| Kind              | Default              |
| ----------------- | -------------------- |
| auth_expired      | auto / refresh_token |
| auth_revoked      | owner / reconnect    |
| permission_denied | owner / report       |
| rate_limited      | auto / backoff       |
| transient         | auto / retry         |
| quota_exceeded    | owner / report       |
| watch_expired     | auto / rewatch       |
| not_found         | none / none          |
| schema_changed    | publisher / report   |

Invariants, regardless of the declaration:

1. **Writes are never re-invoked automatically.** `retry` and `backoff` apply to read calls and
   watch checks only. A write failure is reported with its kind.
2. `refresh_token` is the host's existing OAuth refresh; one attempt, then `auth_revoked`.
3. `reconnect` wakes the owning Bot and pauses monitors on that connection until the Owner
   reconnects; a Bot never reconnects or requests new scopes itself.
4. "Fixed" is reported only after a later call of the same tool succeeds.
5. `schema_changed` stops retries and tells the Owner it is the app's side.
6. `not_found` on a watch check ends that follow-up as a fact (the object is gone).
7. Bounded backoff: honour `retryAfterSeconds` up to the host maximum; give up and report after
   the host's retry budget.

## 6. Observations

After every successful call of a `read` tool named in an `observe` entry (from a Bot, a Service or
a Workflow), without a model:

1. Take the result object (as `$result` in 4.1). Select items with `items`: `$` is the result
   itself; `$.a.b[*]` is each element of the array at `a.b` (`$[*]` when the result is a
   top-level array). Non-object elements are skipped. At most **50** items per result.
2. `key`: walk the path inside the item. A string or finite number (as its decimal string) is the
   external key; otherwise skip the item.
3. `keep`: copy each field path that resolves (any JSON value) into the observation under the same
   dotted path; missing paths are omitted. Kept fields are bounded to **2 KB** of canonical JSON
   per item (drop the longest values first and mark the item truncated).
4. `time`: an ISO 8601 or RFC 2822 string, or Unix time as a number or digit string (with an
   optional fraction, as Slack `ts`); values above `1e11` are milliseconds. Unparseable → absent.
5. Upsert by `(connectionId, entity, key)`; a changed fingerprint of kept fields is a change
   signal. New or changed items get one Jev call for `describe` (when present), stored on the row.

Multiple entries may name the same tool with different entities; each is applied independently.

## 7. Example

`behaviors/supernala/slack.json` (abridged):

```json
{
  "schemaVersion": 1,
  "plugin": "supernala-public:supernala:slack",
  "revision": 1,
  "followUps": [
    {
      "id": "message-replies",
      "after": { "tool": "slack.slack_send_message", "outcome": "succeeded" },
      "watch": {
        "tool": "slack.slack_read_thread",
        "args": { "channel_id": "$result.channel", "message_ts": "$result.ts" },
        "checkAt": ["+1h", "+4h", "+24h"],
        "stopAfter": "+2d"
      },
      "judge": {
        "classify": {
          "name": "thread",
          "options": ["no replies", "acknowledged", "question asked", "disagreement", "resolved"]
        },
        "yesNo": {
          "name": "owner_should_know",
          "question": "Would the Owner want to hear about this now?"
        }
      },
      "wakeWhen": "owner_should_know = yes",
      "instruction": "Summarise new replies since the last check and say whether anyone is waiting on the Owner."
    }
  ],
  "failures": {
    "signals": {
      "providerCodePaths": ["$.error.reason"],
      "httpStatusPaths": ["$.error.httpStatus"],
      "retryAfterPaths": ["$.error.retryAfterSeconds"]
    },
    "rules": [
      { "kind": "auth_revoked", "providerCode": ["reauthorization-required"] },
      {
        "kind": "permission_denied",
        "providerCode": ["access-denied"],
        "fix": "owner",
        "action": "report"
      },
      { "kind": "rate_limited", "providerCode": ["rate-limited"] }
    ],
    "kinds": {
      "auth_revoked": { "fix": "owner", "action": "reconnect" },
      "rate_limited": { "fix": "auto", "action": "backoff" }
    }
  },
  "observe": [
    {
      "from": "slack.slack_search_messages",
      "entity": "message",
      "items": "$.messages.matches[*]",
      "key": "$.permalink",
      "time": "$.ts",
      "keep": ["text", "user", "channel.id", "channel.name", "permalink"]
    }
  ]
}
```

Shipped declarations (revision 1): atlassian-api, github, gmail, google-docs, google-drive,
google-sheets, jev, jev-openrouter, resend-api, slack, supernala-social, vercel-api,
wordpress-self-hosted.
