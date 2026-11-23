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
  sources?: Source[]; // <= 4
  watchables?: Watchable[]; // <= 12, see 8
  profile?: Profile; // see 8
} // at least one of followUps, failures, observe, sources, watchables, profile; unknown keys rejected everywhere

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

type Source = ProviderWatchSource | WebhookSource | PollSource; // ids (Slug) unique

interface SourceFetch {
  tool: ToolId; // classification "read", and named by an `observe` entry's `from`
  args: Record<string, Json>; // literals or "$event.<field>" (the adapter's fields), see 7
}

interface ProviderWatchSource {
  id: Slug;
  kind: "provider-watch";
  adapter: Slug; // known: "gmail" (fields messageId, threadId)
  fetch: SourceFetch;
}

interface WebhookSource {
  id: Slug;
  kind: "webhook";
  adapter: Slug; // known: "github" (fields owner, repo, number, event, action, url)
  events: string[]; // 1..8, unique, ^[a-z][a-z0-9_]{0,63}$, from the adapter's events
  fetch: SourceFetch;
}

interface PollSource {
  id: Slug;
  kind: "poll";
  tool: ToolId; // classification "read", and named by an `observe` entry's `from`
  args: Record<string, Json>; // literal only, no "$" references
  intervalMinutes: number; // integer 15..1440
  items: ItemsPath;
  key: ItemPath;
  cursor?: { path: ItemPath; arg: string }; // arg ^[A-Za-z_][A-Za-z0-9_-]{0,63}$, a top-level input property
}

type ValueName = string; // ^[a-z][a-z0-9_]{0,39}$  (parameters, fields, profile values)
type ValueType = "string" | "number" | "enum" | "boolean";
// profile.suggestedWatches?: (DefaultWatch & { label: string })[]  // offered, never created by the host
type EnumValues = ShortText<60>[]; // 1..16, unique; required for (and only for) "enum"

interface Watchable {
  id: Slug; // unique among watchables
  label: ShortText<80>;
  tool: ToolId; // classification "read"
  params?: Record<
    ValueName,
    { type: ValueType; values?: EnumValues; required?: boolean; label?: ShortText<80> }
  >; // <= 6
  args: Record<string, Json>; // template: literals, "$param.<name>", "$profile.<name>" (whole or embedded), see 8.1
  items: ItemsPath;
  key: ItemPath;
  fields: Record<ValueName, { path: ItemPath; type: ValueType; values?: EnumValues }>; // 1..12
  fetch?: { tool: ToolId; args: Record<string, Json> }; // "read"; literals or whole "$item.key" / "$item.<field>"
}

type Scalar = ShortText<60> | number; // finite
type Where = Record<string, Scalar | Scalar[]>; // <= 8 clauses, 1..10 alternatives

type WatchCondition =
  | { kind: "new-item"; where?: Where }
  | { kind: "field-changed"; field: string; from?: Scalar; to?: Scalar | Scalar[]; where?: Where } // from or to
  | {
      kind: "threshold";
      field: string;
      op: ">=" | "<=";
      value: number;
      rearm?: boolean;
      where?: Where;
    } // number field
  | { kind: "count"; op: ">=" | "<="; value: number; rearm?: boolean; where?: Where } // integer >= 0
  | { kind: "ask"; question: ShortText<200>; where?: Where }; // never in a default Watch

interface Profile {
  steps: {
    tool: ToolId; // classification "read"
    args: Record<string, Json>; // literal only
    values: Record<ValueName, ProfilePath>; // >= 1; <= 8 names across steps, unique
  }[]; // 1..4
  defaultWatches?: {
    id: Slug; // unique among default Watches
    watchable: Slug; // a declared watchable id
    args?: Record<ValueName, Json>; // the watchable's params: typed literal or whole "$profile.<scalar>"
    condition?: WatchCondition; // deterministic; absent = capture only
    notify?: ShortText<200>;
  }[]; // <= 6
}
// ProfilePath: "$.a.b" (scalar, "[n]" indices allowed) or "$.list[*].field" (list of scalars), <= 300 chars.
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
  its `required` keys are present (recursively, as in `checkPluginBehaviorDeclaration`);
- a source's fetch or poll tool exists, is `read`, and an `observe` entry names it; its adapter
  and events are known; its arguments pass the same key checks (a poll's `cursor.arg` counts as
  present). A source whose observe entry was ignored for the version is ignored too;
- a watchable's tool (and `fetch.tool`) exists and is `read`, and its argument templates pass the
  same key checks. A watchable that does not bind is ignored for that version: no Watch on that
  connection can use it;
- every profile step's tool exists and is `read` and its literal arguments pass the key checks.
  If any step does not bind, the **whole profile** is ignored for that version (no values are
  recorded and no default Watches are created). A default Watch that fails its own checks, or
  whose watchable was ignored, is dropped; the rest of the profile still applies.

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

## 7. Event sources

Problems: `behavior-source-duplicate-id`, `behavior-source-adapter-unknown`,
`behavior-source-event-unknown` (unknown or repeated webhook event), `behavior-source-not-read`,
`behavior-source-not-observed`, `behavior-source-arg-unknown`, `behavior-source-arg-missing`,
`behavior-source-arg-invalid` (a bad reference, a reference in a poll, nulls, depth or leaf
bounds as for watch arguments), `behavior-source-interval-invalid`.

The application (`packages/domain/src/plugin-behavior.ts` is the source of truth for this section):

1. **Registration.** When a connection is `ready` with an active installation and at least one
   active grant, the host registers each bound source (no further consent: install + connect).
   It removes the registration when the connection is disconnected, the installation leaves
   `active`, the last grant is revoked, or the Owner turns watching off (or Follow-ups Off).
2. **provider-watch `gmail`.** The host switches Gmail monitoring on for the connection. Each
   message the monitoring pipeline adds becomes one item `{ messageId, threadId }`; Workflow Gmail
   triggers keep receiving the same events. The shipped Gmail declaration (revision 4) no longer
   declares this source: proactive Gmail reading is the profile's capture-only `inbox` Watch on the
   hourly checkpoint (search, then get each new message), feeding the default commitments
   interest. The adapter stays available, and Gmail Pub/Sub keeps serving Workflow triggers.
3. **webhook `github`.** The GitHub App's webhook (one URL for the App, operator-configured secret)
   delivers events for installations; the host maps a delivery's installation to the connections
   that reach it and queues one item per delivery (`{ owner, repo, number, event, action, url }`)
   for registrations whose `events` include the delivery's event. Deliveries without an issue or
   pull request are ignored.
4. **Fetch.** Each item resolves `fetch.args` (`$event.` references as in 4.1, never interpolated)
   and runs `fetch.tool` as the Workspace's default proactive Bot (else the first Bot holding an
   `allow` grant for the tool) through the normal Plugin call path, so `observe` applies to the
   result. Items are idempotent per (source, event key); three attempts, then given up.
5. **Poll.** Due polls run on the minute schedule, bounded per pass and per Workspace, only while
   some Bot's interest covers the entity the poll's tool observes (or the entity is `email`, which
   the default commitments interest covers). `args` plus the stored cursor (as `cursor.arg`) are
   sent; the next cursor is the greatest `cursor.path` value seen (strings compared as text,
   numbers as numbers), else the previous one.

## 8. Watches and app profiles

Problems: `behavior-watchable-duplicate-id`, `behavior-watchable-not-read`,
`behavior-watchable-name-invalid` (a parameter, field or profile value name),
`behavior-watchable-field-invalid` (enum `values` missing, misplaced or repeated),
`behavior-watchable-reference-unknown`, `behavior-watchable-arg-unknown`,
`behavior-watchable-arg-missing`, `behavior-watchable-arg-invalid`, `behavior-profile-not-read`,
`behavior-profile-arg-unknown`, `behavior-profile-arg-missing`, `behavior-profile-arg-invalid` (any
reference in a step), `behavior-profile-value-duplicate`, `behavior-default-watch-duplicate-id`,
`behavior-default-watch-watchable-unknown`, `behavior-default-watch-arg-invalid`,
`behavior-condition-invalid`. Count and path bounds are `behavior-shape-invalid`. Checks run in
`checkWatchablesAndProfile`, after sources and before failures.

The application (ADR 0045; `packages/domain/src/plugin-behavior.ts` and
`packages/domain/src/watch.ts` are the source of truth for this section):

### 8.1 Arguments and items

- **Watchable arguments.** A whole string `$param.<name>` or `$profile.<name>` becomes the typed
  value; an absent optional parameter removes its key (in an array, the element). Inside a longer
  string each token becomes its text; an absent optional parameter becomes nothing and runs of
  whitespace collapse to one space (trimmed). A `$profile.` value that was not recorded fails the
  resolution, and the Watch does not run until the profile records it. Only scalar profile values
  resolve. The Watch's own arguments are checked against `params` (declared keys, typed values,
  required present) when it is created.
- **Default Watch arguments** are literals or whole `$profile.<name>` values, resolved when the
  default Watch is created.
- **Items.** `items` and `key` select as in 6 (at most 50 items per read; a string or finite number
  key, else the item is skipped). Each field walks its path: a `number` field takes a number or a
  numeric string; a `string` field a string or number, cut to 300 characters; an `enum` field only
  one of its values. Any other value leaves the field out of that item.
- **Fetch.** For each **new** item (by key), at most 10 per read, `fetch.args` is resolved
  (`$item.key` is the item key, `$item.<field>` its field; an unresolved reference removes its key)
  and `fetch.tool` runs through the normal Plugin call path, so `observe` applies to its result.

### 8.2 Conditions

Evaluated without a model against what the Watch remembered from its previous read (at most 200
item keys). The first read records a baseline and fires nothing, except a `threshold` or `count`
already across. `new-item` fires for keys not seen before that match `where`; `field-changed` for
known keys whose field moved (from `from`, to one of `to`); `threshold` once per item while across
(without `rearm` an item stays fired and the Watch ends after firing; with it, an item that fell
back may fire again); `count` once while the number of matching items is across (the same
end/re-arm rule). `ask` collects new or changed items matching `where` and asks one billed Jev
question (`observation-triage`). Without a condition nothing fires: reads only feed observation
capture. `checkBehaviorWatchCondition` is the typing check, shared with Owner-requested Watches.

### 8.3 Profiles and default Watches

1. **When.** Each time a connection becomes `ready` (created ready, reconnected or reauthorized),
   and once for every connection that was already ready when Watches shipped (a bounded backfill
   queue drained a few per minute), the host runs the bound profile.
2. **Who.** Steps run as the connection's default proactive Bot when it holds an active grant on
   the connection, else the earliest-granted active Bot, through the normal Plugin call path and
   grants. Default Watches belong to that Bot and are **scoped to the person they are about**: a
   personal connection's member; in a Team Workspace the member who connected the account; in a
   personal Workspace its Owner.
3. **Values.** Each step's values are read from its result with the profile paths (`[*]` paths
   yield lists); a value that does not resolve is left out. Values are stored in Account Knowledge
   for the connection (grant-scoped Workspace data, erased on disconnect), never in Bot memory.
4. **Defaults.** Each bound default Watch is created with origin `profile`, idempotent per
   (connection, default Watch id): a default the Owner ended is never created again. A default
   whose `$profile.` argument was not recorded is skipped. The Owner can end any default and ask
   for other Watches.

### 8.4 Hourly checkpoint

1. One scheduler per Workspace wakes at most hourly, selects due Watches (dream-origin Watches
   are due daily), groups them by connection and **deduplicates identical reads** (same
   connection, tool and resolved arguments) across Watches and Bots.
2. **Push first.** While a connection's push source (Gmail provider watch, GitHub webhook) is
   delivering, its read is skipped and Watches evaluate pushed items.
3. A connection with no active, unpaused Watch is never read. Each read runs as an owning Bot
   under its current grants (`read` tools with an `allow` policy).
4. **Bounds.** At most 20 connections and 60 reads per Workspace per checkpoint, 10 per-item
   fetches per read, 24 active Watches per Bot and 200 per Workspace.
5. Results go through observation capture (triage, interests and the Owner-wide nudge budget
   apply) and then each Watch's condition. A firing wakes the owning Bot (a default Watch's `notify` is the line it is
   woken with); a fire-once Watch ends after firing.
6. **Pauses.** Host-enforced pauses (one Watch, one app or connection, one Bot, or everything;
   for an hour, until local midnight, a week, or until resumed) stop checkpoint reads,
   event-source capture, triage and nudges for their scope. Dreams and default Watches never undo
   a pause.
7. Plugin calls are unmetered; only `ask` conditions spend (billed Jev).

## 9. Example

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

Shipped declarations: atlassian, atlassian-api, atlassian-api-token, buffer, cloudflare,
elevenlabs, github, gmail, google-docs, google-drive, google-maps, google-sheets, jev,
jev-openrouter, linear, maple, meta-ads-token, notion, posthog, repliz, resend, resend-api, slack,
supernala-social, tebar, vercel, vercel-api, wordpress-com, wordpress-self-hosted. Watchables:
atlassian, atlassian-api-token, buffer, github, gmail, linear, maple, meta-ads-token, repliz, slack,
supernala-social, tebar, vercel, vercel-api. Profiles with default Watches: atlassian,
atlassian-api-token, buffer, github, gmail (capture only), linear, maple, repliz, tebar, vercel,
vercel-api; meta-ads-token and slack have profiles with suggested Watches only. Failures only:
cloudflare, elevenlabs, google-maps, notion, posthog, resend, wordpress-com.
