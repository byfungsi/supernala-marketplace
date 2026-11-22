import { createHash } from "node:crypto";
import { Result, Schema } from "effect";
import { canonicalPluginJson } from "./plugin-contract.js";

/*
 * Plugin behaviour declarations tell the host what an app's tools mean over time, beyond the
 * tools themselves: which read tool watches the outcome of a write (`followUps`), how a failure
 * is classified and who fixes it (`failures`), which read results become Workspace
 * observations (`observe`), and how new items reach the host without anyone asking
 * (`sources`: a provider watch, a webhook, or a bounded poll), which named read queries a Watch may
 * run (`watchables`), and what the host learns about the account at connect and which Owner-scoped
 * Watches it creates by default (`profile`). A declaration grants no authority. Every tool it names must already
 * be in the Plugin's reviewed catalog, every invocation still goes through the Owner's grants and
 * policies, and its short strings are app guidance, never Owner instructions.
 *
 * Declarations live outside Plugin source roots at `behaviors/<publisher>/<slug>.json`, like
 * setup guides, so adding or improving one never changes a package, release or catalog digest.
 * Revisions are immutable and the highest revision is current. Because one declaration serves
 * every version of a definition, the host re-checks its tool references against the installed
 * version's catalog and ignores an entry whose references do not resolve.
 */

/** Behaviour directory, one JSON file per Plugin definition: `behaviors/<publisher>/<slug>.json`. */
export const PLUGIN_BEHAVIORS_DIRECTORY = "behaviors";

/** Bounds shared by the Marketplace validator and the application decoder. */
export const PLUGIN_BEHAVIOR_LIMITS = {
  maximumFileBytes: 65_536,
  maximumFollowUps: 8,
  maximumWatchArgLeaves: 16,
  maximumWatchArgDepth: 3,
  maximumChecks: 8,
  minimumFirstCheckMinutes: 5,
  maximumStopAfterMinutes: 30 * 24 * 60,
  maximumInstructionCharacters: 280,
  maximumRememberEntries: 5,
  maximumRememberCharacters: 80,
  maximumObserve: 8,
  maximumKeepFields: 16,
  maximumPathSegments: 8,
  maximumFailureRules: 32,
  maximumRuleValues: 16,
  maximumMessageTemplates: 4,
  maximumProviderCodePaths: 4,
  minimumOptions: 2,
  maximumOptions: 10,
  maximumOptionCharacters: 60,
  maximumQuestionCharacters: 200,
  minimumScoreLevels: 2,
  maximumScoreLevels: 10,
  maximumWakeClauses: 4,
  maximumSources: 4,
  maximumSourceEvents: 8,
  minimumPollIntervalMinutes: 15,
  maximumPollIntervalMinutes: 24 * 60,
  maximumWatchables: 12,
  maximumWatchableParams: 6,
  maximumWatchableFields: 12,
  maximumEnumValues: 16,
  maximumLabelCharacters: 80,
  maximumProfileSteps: 4,
  maximumProfileValues: 8,
  maximumDefaultWatches: 6,
  maximumNotifyCharacters: 200,
  maximumConditionClauses: 8,
  maximumConditionAlternatives: 10,
} as const;

const L = PLUGIN_BEHAVIOR_LIMITS;

const PluginDefinitionId = Schema.String.pipe(
  Schema.check(Schema.isPattern(/^[a-z0-9-]+:[a-z0-9-]+:[a-z0-9-]+$/u)),
);

const ToolReference = Schema.String.pipe(
  Schema.check(Schema.isPattern(/^[a-z0-9]+(?:[._-][a-z0-9]+)*$/u)),
  Schema.check(Schema.isLengthBetween(1, 160)),
);

/** Lowercase kebab-case identifier for follow-ups, entities and question names' values. */
const Slug = Schema.String.pipe(
  Schema.check(Schema.isPattern(/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/u)),
  Schema.check(Schema.isLengthBetween(1, 64)),
);

/** Names a Jev step reserves for its own output, so an answer cannot take them. */
export const BEHAVIOR_RESERVED_ANSWER_NAMES: ReadonlySet<string> = new Set(["model", "usage"]);

/**
 * An answer's name, in the application's Jev question-name form; `wakeWhen` and stored
 * observations refer to the answer by it.
 */
const AnswerName = Schema.String.pipe(
  Schema.check(Schema.isPattern(/^[a-z][a-z0-9_]{0,39}$/u)),
  Schema.check(Schema.isLengthBetween(1, 40)),
);

/** One line of plain text: trimmed, no control characters, no template braces, no markup. */
const shortText = (maximum: number) =>
  Schema.String.pipe(
    Schema.check(Schema.isLengthBetween(1, maximum)),
    Schema.check(Schema.isPattern(/^[^\s](?:[^\p{Cc}<>{}]*[^\s])?$/u)),
  );

/** Relative offset from the triggering event: `+<n>m`, `+<n>h` or `+<n>d`. */
const Offset = Schema.String.pipe(Schema.check(Schema.isPattern(/^\+[1-9][0-9]{0,4}[mhd]$/u)));

/** `$` or `$.a.b`, optionally ending in one `[*]` (only where a collection is expected). */
const PATH_SEGMENT = "[A-Za-z_][A-Za-z0-9_]{0,63}";
const ITEMS_PATH = new RegExp(`^\\$(?:\\.${PATH_SEGMENT})*(?:\\[\\*\\])?$`, "u");
const ITEM_PATH = new RegExp(`^\\$(?:\\.${PATH_SEGMENT})+$`, "u");
const FIELD_PATH = new RegExp(`^${PATH_SEGMENT}(?:\\.${PATH_SEGMENT})*$`, "u");
const REFERENCE = new RegExp(
  `^\\$(?:result|args)(?:\\.${PATH_SEGMENT}(?:\\[[0-9]{1,2}\\])?){1,8}$`,
  "u",
);

const ItemsPath = Schema.String.pipe(
  Schema.check(Schema.isPattern(ITEMS_PATH)),
  Schema.check(Schema.isMaxLength(300)),
);
const ItemPath = Schema.String.pipe(
  Schema.check(Schema.isPattern(ITEM_PATH)),
  Schema.check(Schema.isMaxLength(300)),
);
const FieldPath = Schema.String.pipe(
  Schema.check(Schema.isPattern(FIELD_PATH)),
  Schema.check(Schema.isMaxLength(300)),
);

/** Choose one option. */
export const BehaviorClassifyQuestion = Schema.Struct({
  name: AnswerName,
  options: Schema.Array(shortText(L.maximumOptionCharacters)).pipe(
    Schema.check(Schema.isLengthBetween(L.minimumOptions, L.maximumOptions)),
  ),
});

/** Answer yes or no. */
export const BehaviorYesNoQuestion = Schema.Struct({
  name: AnswerName,
  question: shortText(L.maximumQuestionCharacters),
});

/** Rate against ordered levels, lowest first; a level's position is its score. */
export const BehaviorScoreQuestion = Schema.Struct({
  name: AnswerName,
  question: shortText(L.maximumQuestionCharacters),
  levels: Schema.Array(shortText(L.maximumOptionCharacters)).pipe(
    Schema.check(Schema.isLengthBetween(L.minimumScoreLevels, L.maximumScoreLevels)),
  ),
});

/** Typed Jev questions about one result; at least one is required. */
export const BehaviorQuestions = Schema.Struct({
  classify: Schema.optionalKey(BehaviorClassifyQuestion),
  yesNo: Schema.optionalKey(BehaviorYesNoQuestion),
  score: Schema.optionalKey(BehaviorScoreQuestion),
});
/** Typed Jev questions about one result; at least one is required. */
export interface BehaviorQuestions extends Schema.Schema.Type<typeof BehaviorQuestions> {}

/** After a write of this Plugin succeeds, watch its outcome with a read of this Plugin. */
export const BehaviorFollowUp = Schema.Struct({
  id: Slug,
  after: Schema.Struct({
    tool: ToolReference,
    outcome: Schema.Literal("succeeded"),
  }),
  watch: Schema.Struct({
    tool: ToolReference,
    /**
     * The watch tool's arguments as a JSON template: objects and arrays whose leaves are
     * scalars, or `$result.` / `$args.` references into the write's result or arguments.
     */
    args: Schema.Record(Schema.String, Schema.Json),
    checkAt: Schema.Array(Offset).pipe(Schema.check(Schema.isLengthBetween(1, L.maximumChecks))),
    stopAfter: Offset,
  }),
  judge: BehaviorQuestions,
  wakeWhen: Schema.String.pipe(Schema.check(Schema.isLengthBetween(1, 300))),
  instruction: shortText(L.maximumInstructionCharacters),
  remember: Schema.optionalKey(
    Schema.Array(shortText(L.maximumRememberCharacters)).pipe(
      Schema.check(Schema.isMaxLength(L.maximumRememberEntries)),
    ),
  ),
});
/** After a write of this Plugin succeeds, watch its outcome with a read of this Plugin. */
export interface BehaviorFollowUp extends Schema.Schema.Type<typeof BehaviorFollowUp> {}

/** Typed failure kinds the host understands. */
export const BehaviorFailureKind = Schema.Literals([
  "auth_expired",
  "auth_revoked",
  "rate_limited",
  "transient",
  "watch_expired",
  "not_found",
  "permission_denied",
  "schema_changed",
  "quota_exceeded",
]);
/** Typed failure kinds the host understands. */
export type BehaviorFailureKind = typeof BehaviorFailureKind.Type;

/** Who fixes a failure. */
export const BehaviorFailureFix = Schema.Literals(["auto", "owner", "publisher", "none"]);
/** Who fixes a failure. */
export type BehaviorFailureFix = typeof BehaviorFailureFix.Type;

/** What the host does about a failure. */
export const BehaviorFailureAction = Schema.Literals([
  "retry",
  "backoff",
  "rewatch",
  "refresh_token",
  "reconnect",
  "report",
  "none",
]);
/** What the host does about a failure. */
export type BehaviorFailureAction = typeof BehaviorFailureAction.Type;

const HttpStatus = Schema.Int.pipe(
  Schema.check(Schema.isGreaterThanOrEqualTo(400)),
  Schema.check(Schema.isLessThanOrEqualTo(599)),
);

const ProviderCode = Schema.String.pipe(
  Schema.check(Schema.isPattern(/^[A-Za-z0-9_.:-]{1,100}$/u)),
);

/** An error message with exactly one `{status}` where the HTTP status appears. */
const MessageTemplate = Schema.String.pipe(
  Schema.check(Schema.isLengthBetween(9, 200)),
  Schema.check(Schema.isPattern(/^[^\s{}\p{Cc}<>][^{}\p{Cc}<>]*\{status\}[^{}\p{Cc}<>]*$/u)),
);

/** One classification rule; every present condition must hold, and the first match wins. */
export const BehaviorFailureRule = Schema.Struct({
  kind: BehaviorFailureKind,
  httpStatus: Schema.optionalKey(
    Schema.Array(HttpStatus).pipe(Schema.check(Schema.isLengthBetween(1, L.maximumRuleValues))),
  ),
  providerCode: Schema.optionalKey(
    Schema.Array(ProviderCode).pipe(Schema.check(Schema.isLengthBetween(1, L.maximumRuleValues))),
  ),
  messagePrefix: Schema.optionalKey(
    Schema.Array(shortText(200)).pipe(Schema.check(Schema.isLengthBetween(1, L.maximumRuleValues))),
  ),
  tools: Schema.optionalKey(
    Schema.Array(ToolReference).pipe(Schema.check(Schema.isLengthBetween(1, L.maximumRuleValues))),
  ),
  /** Overrides `kinds[kind]` for failures this rule matches; give both or neither. */
  fix: Schema.optionalKey(BehaviorFailureFix),
  action: Schema.optionalKey(BehaviorFailureAction),
});
/** One classification rule; every present condition must hold, and the first match wins. */
export interface BehaviorFailureRule extends Schema.Schema.Type<typeof BehaviorFailureRule> {}

/** Who fixes one failure kind, and how. */
export const BehaviorFailureHandling = Schema.Struct({
  fix: BehaviorFailureFix,
  action: BehaviorFailureAction,
});

/** How this Plugin's failures are classified, and who fixes each kind. */
export const BehaviorFailures = Schema.Struct({
  signals: Schema.optionalKey(
    Schema.Struct({
      messageTemplates: Schema.optionalKey(
        Schema.Array(MessageTemplate).pipe(
          Schema.check(Schema.isLengthBetween(1, L.maximumMessageTemplates)),
        ),
      ),
      providerCodePaths: Schema.optionalKey(
        Schema.Array(ItemPath).pipe(
          Schema.check(Schema.isLengthBetween(1, L.maximumProviderCodePaths)),
        ),
      ),
      httpStatusPaths: Schema.optionalKey(
        Schema.Array(ItemPath).pipe(
          Schema.check(Schema.isLengthBetween(1, L.maximumProviderCodePaths)),
        ),
      ),
      retryAfterPaths: Schema.optionalKey(
        Schema.Array(ItemPath).pipe(
          Schema.check(Schema.isLengthBetween(1, L.maximumProviderCodePaths)),
        ),
      ),
    }),
  ),
  rules: Schema.Array(BehaviorFailureRule).pipe(
    Schema.check(Schema.isMaxLength(L.maximumFailureRules)),
  ),
  kinds: Schema.Struct({
    auth_expired: Schema.optionalKey(BehaviorFailureHandling),
    auth_revoked: Schema.optionalKey(BehaviorFailureHandling),
    rate_limited: Schema.optionalKey(BehaviorFailureHandling),
    transient: Schema.optionalKey(BehaviorFailureHandling),
    watch_expired: Schema.optionalKey(BehaviorFailureHandling),
    not_found: Schema.optionalKey(BehaviorFailureHandling),
    permission_denied: Schema.optionalKey(BehaviorFailureHandling),
    schema_changed: Schema.optionalKey(BehaviorFailureHandling),
    quota_exceeded: Schema.optionalKey(BehaviorFailureHandling),
  }),
});
/** How this Plugin's failures are classified, and who fixes each kind. */
export interface BehaviorFailures extends Schema.Schema.Type<typeof BehaviorFailures> {}

/** Which read results become Workspace observations. */
export const BehaviorObservation = Schema.Struct({
  from: ToolReference,
  entity: Slug,
  items: ItemsPath,
  key: ItemPath,
  time: Schema.optionalKey(ItemPath),
  keep: Schema.Array(FieldPath).pipe(Schema.check(Schema.isLengthBetween(1, L.maximumKeepFields))),
  describe: Schema.optionalKey(BehaviorQuestions),
});
/** Which read results become Workspace observations. */
export interface BehaviorObservation extends Schema.Schema.Type<typeof BehaviorObservation> {}

/**
 * Host-owned event adapters a source may name, with the event fields its fetch arguments may
 * reference as `$event.<field>`. Adapters are reviewed platform code: a declaration only chooses
 * one, it never describes a provider API. An adapter the host does not know is ignored at binding.
 */
export const BEHAVIOR_SOURCE_ADAPTERS = {
  "provider-watch": {
    /** Gmail `users.watch` to Pub/Sub, then `history.list`; one event per added message. */
    gmail: { events: [], fields: ["messageId", "threadId"] },
  },
  webhook: {
    /** GitHub App webhook deliveries for the connection's installation. */
    github: {
      events: [
        "issues",
        "issue_comment",
        "pull_request",
        "pull_request_review",
        "pull_request_review_comment",
      ],
      fields: ["owner", "repo", "number", "event", "action", "url"],
    },
  },
} as const satisfies Record<
  "provider-watch" | "webhook",
  Record<string, { readonly events: ReadonlyArray<string>; readonly fields: ReadonlyArray<string> }>
>;

/** Kinds of event source. */
export type BehaviorSourceKind = "provider-watch" | "webhook" | "poll";

const SOURCE_EVENT_REFERENCE = new RegExp(`^\\$event\\.(${PATH_SEGMENT})$`, "u");

const SourceArgs = Schema.Record(Schema.String, Schema.Json);

/** How the host reads one new item an event names: a `read` tool and its argument template. */
export const BehaviorSourceFetch = Schema.Struct({
  tool: ToolReference,
  /** Scalars, or `$event.<field>` references to the adapter's event fields. */
  args: SourceArgs,
});
/** How the host reads one new item an event names. */
export interface BehaviorSourceFetch extends Schema.Schema.Type<typeof BehaviorSourceFetch> {}

/** A provider push watch the host registers at connect (for example Gmail Pub/Sub). */
export const BehaviorProviderWatchSource = Schema.Struct({
  id: Slug,
  kind: Schema.Literal("provider-watch"),
  adapter: Slug,
  fetch: BehaviorSourceFetch,
});

/** A provider webhook subscription the host owns (for example the GitHub App's deliveries). */
export const BehaviorWebhookSource = Schema.Struct({
  id: Slug,
  kind: Schema.Literal("webhook"),
  adapter: Slug,
  events: Schema.Array(
    Schema.String.pipe(Schema.check(Schema.isPattern(/^[a-z][a-z0-9_]{0,63}$/u))),
  ).pipe(Schema.check(Schema.isLengthBetween(1, L.maximumSourceEvents))),
  fetch: BehaviorSourceFetch,
});

/** A bounded poll of one `read` tool, for apps that cannot push. */
export const BehaviorPollSource = Schema.Struct({
  id: Slug,
  kind: Schema.Literal("poll"),
  tool: ToolReference,
  /** Literal arguments only (no references). */
  args: SourceArgs,
  intervalMinutes: Schema.Int,
  items: ItemsPath,
  key: ItemPath,
  /**
   * Optional high-water mark: the greatest value at `path` across a result's items is stored and
   * passed back as argument `arg` on the next poll (strings compared as text, numbers as numbers).
   */
  cursor: Schema.optionalKey(
    Schema.Struct({
      path: ItemPath,
      arg: Schema.String.pipe(Schema.check(Schema.isPattern(/^[A-Za-z_][A-Za-z0-9_-]{0,63}$/u))),
    }),
  ),
});

/** One event source: how new items reach the host without anyone asking. */
export const BehaviorSource = Schema.Union([
  BehaviorProviderWatchSource,
  BehaviorWebhookSource,
  BehaviorPollSource,
]);
/** One event source: how new items reach the host without anyone asking. */
export type BehaviorSource = typeof BehaviorSource.Type;
/** A provider push watch source. */
export type BehaviorProviderWatchSource = typeof BehaviorProviderWatchSource.Type;
/** A webhook source. */
export type BehaviorWebhookSource = typeof BehaviorWebhookSource.Type;
/** A bounded poll source. */
export type BehaviorPollSource = typeof BehaviorPollSource.Type;

/** A named value of a watchable or profile: lowercase, digits and underscores. */
const VALUE_NAME = /^[a-z][a-z0-9_]{0,39}$/u;

/** Value types a watchable parameter or field declares. */
export const BehaviorWatchValueType = Schema.Literals(["string", "number", "enum", "boolean"]);
/** Value types a watchable parameter or field declares. */
export type BehaviorWatchValueType = typeof BehaviorWatchValueType.Type;

const EnumValues = Schema.Array(shortText(L.maximumOptionCharacters)).pipe(
  Schema.check(Schema.isLengthBetween(1, L.maximumEnumValues)),
);

/** One parameter a Watch supplies to a watchable; `values` is required for (and only for) enums. */
export const BehaviorWatchableParam = Schema.Struct({
  type: BehaviorWatchValueType,
  values: Schema.optionalKey(EnumValues),
  required: Schema.optionalKey(Schema.Boolean),
  label: Schema.optionalKey(shortText(L.maximumLabelCharacters)),
});
/** One parameter a Watch supplies to a watchable. */
export interface BehaviorWatchableParam extends Schema.Schema.Type<typeof BehaviorWatchableParam> {}

/** One typed field read from each result item; conditions compare these, never raw JSON. */
export const BehaviorWatchableField = Schema.Struct({
  path: ItemPath,
  type: BehaviorWatchValueType,
  values: Schema.optionalKey(EnumValues),
});
/** One typed field read from each result item. */
export interface BehaviorWatchableField extends Schema.Schema.Type<typeof BehaviorWatchableField> {}

/**
 * A named, read-only query a Watch may run on a connection: a `read` tool with an argument
 * template whose strings may use `$param.<name>` (the Watch's own arguments) and
 * `$profile.<name>` (values the app profile recorded for the connection), either as the whole
 * string (the typed value) or inside a longer string (its text). Items are selected like
 * `observe`, keyed, and reduced to typed fields. An optional `fetch` reads each new item in full
 * with `$item.key` / `$item.<field>` references (for example a search followed by get-message).
 */
export const BehaviorWatchable = Schema.Struct({
  id: Slug,
  label: shortText(L.maximumLabelCharacters),
  tool: ToolReference,
  params: Schema.optionalKey(Schema.Record(Schema.String, BehaviorWatchableParam)),
  args: Schema.Record(Schema.String, Schema.Json),
  items: ItemsPath,
  key: ItemPath,
  fields: Schema.Record(Schema.String, BehaviorWatchableField),
  fetch: Schema.optionalKey(
    Schema.Struct({ tool: ToolReference, args: Schema.Record(Schema.String, Schema.Json) }),
  ),
});
/** A named, read-only query a Watch may run on a connection. */
export interface BehaviorWatchable extends Schema.Schema.Type<typeof BehaviorWatchable> {}

const ConditionScalar = Schema.Union([
  shortText(L.maximumOptionCharacters),
  Schema.Finite,
  Schema.Boolean,
]);
/** A literal a condition compares a field with. */
export type BehaviorConditionScalar = typeof ConditionScalar.Type;

/** Field filters: every clause must hold; a clause holds when the field equals one alternative. */
const ConditionWhere = Schema.Record(
  Schema.String,
  Schema.Union([
    ConditionScalar,
    Schema.Array(ConditionScalar).pipe(
      Schema.check(Schema.isLengthBetween(1, L.maximumConditionAlternatives)),
    ),
  ]),
);

const ComparisonOperator = Schema.Literals([">=", "<="]);

/** A new item (by key) whose fields match `where`; the first read only records a baseline. */
export const BehaviorNewItemCondition = Schema.Struct({
  kind: Schema.Literal("new-item"),
  where: Schema.optionalKey(ConditionWhere),
});

/** A field of a known item changed, optionally from one value and to one of several. */
export const BehaviorFieldChangedCondition = Schema.Struct({
  kind: Schema.Literal("field-changed"),
  field: Schema.String,
  from: Schema.optionalKey(ConditionScalar),
  to: Schema.optionalKey(
    Schema.Union([
      ConditionScalar,
      Schema.Array(ConditionScalar).pipe(
        Schema.check(Schema.isLengthBetween(1, L.maximumConditionAlternatives)),
      ),
    ]),
  ),
  where: Schema.optionalKey(ConditionWhere),
});

/**
 * A number field crossed a threshold. Fires once per item while it stays across; with `rearm`
 * it may fire again after the value falls back, otherwise the Watch ends after firing.
 */
export const BehaviorThresholdCondition = Schema.Struct({
  kind: Schema.Literal("threshold"),
  field: Schema.String,
  op: ComparisonOperator,
  value: Schema.Finite,
  rearm: Schema.optionalKey(Schema.Boolean),
  where: Schema.optionalKey(ConditionWhere),
});

/** The number of matching items crossed a threshold. */
export const BehaviorCountCondition = Schema.Struct({
  kind: Schema.Literal("count"),
  op: ComparisonOperator,
  value: Schema.Int.pipe(Schema.check(Schema.isGreaterThanOrEqualTo(0))),
  rearm: Schema.optionalKey(Schema.Boolean),
  where: Schema.optionalKey(ConditionWhere),
});

/** A fuzzy question about new or changed items, answered by one billed Jev call. */
export const BehaviorAskCondition = Schema.Struct({
  kind: Schema.Literal("ask"),
  question: shortText(L.maximumQuestionCharacters),
  where: Schema.optionalKey(ConditionWhere),
});

/** A typed Watch condition (ADR 0045); `ask` is the only one that uses a model. */
export const BehaviorWatchCondition = Schema.Union([
  BehaviorNewItemCondition,
  BehaviorFieldChangedCondition,
  BehaviorThresholdCondition,
  BehaviorCountCondition,
  BehaviorAskCondition,
]);
/** A typed Watch condition. */
export type BehaviorWatchCondition = typeof BehaviorWatchCondition.Type;

/**
 * A profile value the host provides without a step: the connection's verified provider account
 * subject (for Slack the user id from `auth.test`). Steps may not declare it.
 */
export const BEHAVIOR_ACCOUNT_SUBJECT = "account_subject";

/** `$.a.b` (a scalar, indices allowed) or `$.list[*].field` (a list of scalars). */
const PROFILE_PATH = new RegExp(
  `^\\$(?:(?:\\.${PATH_SEGMENT}(?:\\[[0-9]{1,2}\\])?)+|(?:\\.${PATH_SEGMENT})*\\[\\*\\](?:\\.${PATH_SEGMENT})+)$`,
  "u",
);

const ProfilePath = Schema.String.pipe(
  Schema.check(Schema.isPattern(PROFILE_PATH)),
  Schema.check(Schema.isMaxLength(300)),
);

/** Whether a profile path names a list (`[*]`) rather than one scalar. */
export const isProfileListPath = (path: string): boolean => path.includes("[*]");

/** One deterministic identity read at connect; each value is stored under its name. */
export const BehaviorProfileStep = Schema.Struct({
  tool: ToolReference,
  /** Literal arguments only. */
  args: Schema.Record(Schema.String, Schema.Json),
  values: Schema.Record(Schema.String, ProfilePath),
});
/** One deterministic identity read at connect. */
export interface BehaviorProfileStep extends Schema.Schema.Type<typeof BehaviorProfileStep> {}

/**
 * A Watch the host creates for the connection's default proactive Bot, scoped to the Owner (or
 * the connecting member), when the connection becomes ready. Arguments are literals or
 * `$profile.<name>`; conditions are deterministic (no `ask`). Without a condition the Watch only
 * feeds observation capture (triage, interests and the default commitments interest decide what
 * matters); `notify` is the line the Bot is woken with when the condition fires.
 */
export const BehaviorDefaultWatch = Schema.Struct({
  id: Slug,
  watchable: Slug,
  args: Schema.optionalKey(Schema.Record(Schema.String, Schema.Json)),
  condition: Schema.optionalKey(BehaviorWatchCondition),
  notify: Schema.optionalKey(shortText(L.maximumNotifyCharacters)),
});
/** A Watch the host creates by default. */
export interface BehaviorDefaultWatch extends Schema.Schema.Type<typeof BehaviorDefaultWatch> {}

/**
 * A Watch the host offers as a suggestion (one tap to accept) instead of creating it: the same
 * shape and checks as a default Watch, plus the label the Owner reads on the suggestion.
 */
export const BehaviorSuggestedWatch = Schema.Struct({
  ...BehaviorDefaultWatch.fields,
  label: shortText(L.maximumLabelCharacters),
});
/** A Watch the host offers as a suggestion. */
export interface BehaviorSuggestedWatch extends Schema.Schema.Type<typeof BehaviorSuggestedWatch> {}

/** What the host learns about the account at connect, and the default Watches it creates. */
export const BehaviorProfile = Schema.Struct({
  steps: Schema.Array(BehaviorProfileStep).pipe(
    Schema.check(Schema.isMaxLength(L.maximumProfileSteps)),
  ),
  defaultWatches: Schema.optionalKey(
    Schema.Array(BehaviorDefaultWatch).pipe(
      Schema.check(Schema.isMaxLength(L.maximumDefaultWatches)),
    ),
  ),
  suggestedWatches: Schema.optionalKey(
    Schema.Array(BehaviorSuggestedWatch).pipe(
      Schema.check(Schema.isMaxLength(L.maximumDefaultWatches)),
    ),
  ),
});
/** What the host learns about the account at connect, and the default Watches it creates. */
export interface BehaviorProfile extends Schema.Schema.Type<typeof BehaviorProfile> {}

/** One immutable behaviour declaration revision for one Plugin definition. */
export const PluginBehaviorDeclaration = Schema.Struct({
  schemaVersion: Schema.Literal(1),
  plugin: PluginDefinitionId,
  revision: Schema.Int.pipe(Schema.check(Schema.isGreaterThanOrEqualTo(1))),
  followUps: Schema.optionalKey(
    Schema.Array(BehaviorFollowUp).pipe(Schema.check(Schema.isMaxLength(L.maximumFollowUps))),
  ),
  failures: Schema.optionalKey(BehaviorFailures),
  observe: Schema.optionalKey(
    Schema.Array(BehaviorObservation).pipe(Schema.check(Schema.isMaxLength(L.maximumObserve))),
  ),
  sources: Schema.optionalKey(
    Schema.Array(BehaviorSource).pipe(Schema.check(Schema.isMaxLength(L.maximumSources))),
  ),
  watchables: Schema.optionalKey(
    Schema.Array(BehaviorWatchable).pipe(Schema.check(Schema.isMaxLength(L.maximumWatchables))),
  ),
  profile: Schema.optionalKey(BehaviorProfile),
});
/** One immutable behaviour declaration revision for one Plugin definition. */
export interface PluginBehaviorDeclaration extends Schema.Schema.Type<
  typeof PluginBehaviorDeclaration
> {}

/** The reviewed facts about one catalog tool that behaviour validation needs. */
export interface BehaviorCatalogTool {
  readonly id: string;
  readonly classification: string;
  /** The reviewed JSON Schema of the tool's input, when the catalog carries one. */
  readonly inputSchema?: Schema.JsonObject;
}

/** Problems that make a declaration unpublishable; each names one rule. */
export type PluginBehaviorProblem =
  | "behavior-json-invalid"
  | "behavior-too-large"
  | "behavior-shape-invalid"
  | "behavior-path-mismatch"
  | "behavior-empty"
  | "behavior-plugin-unknown"
  | "behavior-tool-unknown"
  | "behavior-duplicate-id"
  | "behavior-after-not-write"
  | "behavior-watch-not-read"
  | "behavior-watch-arg-unknown"
  | "behavior-watch-arg-missing"
  | "behavior-watch-arg-invalid"
  | "behavior-schedule-invalid"
  | "behavior-questions-empty"
  | "behavior-question-name-invalid"
  | "behavior-options-duplicate"
  | "behavior-option-invalid"
  | "behavior-wake-invalid"
  | "behavior-observe-not-read"
  | "behavior-observe-duplicate"
  | "behavior-keep-duplicate"
  | "behavior-rule-empty"
  | "behavior-rule-kind-unhandled"
  | "behavior-template-invalid"
  | "behavior-handling-invalid"
  | "behavior-source-duplicate-id"
  | "behavior-source-adapter-unknown"
  | "behavior-source-event-unknown"
  | "behavior-source-not-read"
  | "behavior-source-not-observed"
  | "behavior-source-arg-unknown"
  | "behavior-source-arg-missing"
  | "behavior-source-arg-invalid"
  | "behavior-source-interval-invalid"
  | "behavior-watchable-duplicate-id"
  | "behavior-watchable-not-read"
  | "behavior-watchable-name-invalid"
  | "behavior-watchable-field-invalid"
  | "behavior-watchable-reference-unknown"
  | "behavior-watchable-arg-unknown"
  | "behavior-watchable-arg-missing"
  | "behavior-watchable-arg-invalid"
  | "behavior-profile-not-read"
  | "behavior-profile-arg-unknown"
  | "behavior-profile-arg-missing"
  | "behavior-profile-arg-invalid"
  | "behavior-profile-value-duplicate"
  | "behavior-default-watch-duplicate-id"
  | "behavior-default-watch-watchable-unknown"
  | "behavior-default-watch-arg-invalid"
  | "behavior-condition-invalid";

/** A located problem: which rule failed and where in the declaration. */
export interface PluginBehaviorIssue {
  readonly problem: PluginBehaviorProblem;
  readonly at: string;
}

/** A checked declaration with the digest the application stores. */
export interface PluginBehavior {
  readonly definitionId: string;
  readonly revision: number;
  readonly declaration: PluginBehaviorDeclaration;
  /** Canonical JSON of the declaration (sorted keys, no whitespace). */
  readonly canonicalJson: string;
  /** SHA-256 of `canonicalJson`. */
  readonly contentSha256: string;
  readonly relativePath: string;
}

/** Offset in minutes; `undefined` when the text is not an offset. */
export const behaviorOffsetMinutes = (offset: string): number | undefined => {
  const match = /^\+([1-9][0-9]{0,4})([mhd])$/u.exec(offset);
  if (match === null) return undefined;
  const amount = Number(match[1]);
  return match[2] === "m" ? amount : match[2] === "h" ? amount * 60 : amount * 24 * 60;
};

/** One parsed `wakeWhen` clause; for a score, `level` is the 1-based position of `value`. */
export interface BehaviorWakeClause {
  readonly name: string;
  readonly operator: "=" | "!=" | ">=" | "<=";
  readonly value: string;
  readonly level?: number;
}

const WAKE_OPERATORS = ["=", "!=", ">=", "<="] as const;

/** ` or ` followed by the start of another clause, so an option may itself contain "or". */
const WAKE_CLAUSE_SEPARATOR = / or (?=[a-z][a-z0-9_]* (?:=|!=|>=|<=) )/u;

/**
 * Parses `wakeWhen`: up to four clauses joined by ` or `. A clause compares one judge answer:
 * `name = value` or `name != value` with a classify option or `yes`/`no`, or, for a score,
 * any of `=`, `!=`, `>=`, `<=` with one of its levels (compared by position).
 */
export const parseBehaviorWakeWhen = (
  text: string,
  judge: BehaviorQuestions,
): Result.Result<ReadonlyArray<BehaviorWakeClause>, "behavior-wake-invalid"> => {
  const parts = text.split(WAKE_CLAUSE_SEPARATOR);
  if (parts.length > L.maximumWakeClauses) return Result.fail("behavior-wake-invalid");
  const clauses: Array<BehaviorWakeClause> = [];
  for (const part of parts) {
    const match = /^([a-z][a-z0-9_]*) (=|!=|>=|<=) (\S(?:.*\S)?)$/u.exec(part);
    if (match === null) return Result.fail("behavior-wake-invalid");
    const [, name = "", rawOperator = "", value = ""] = match;
    const operator = WAKE_OPERATORS.find((candidate) => candidate === rawOperator);
    if (operator === undefined) return Result.fail("behavior-wake-invalid");
    if (judge.classify?.name === name) {
      if ((operator !== "=" && operator !== "!=") || !judge.classify.options.includes(value)) {
        return Result.fail("behavior-wake-invalid");
      }
      clauses.push({ name, operator, value });
    } else if (judge.yesNo?.name === name) {
      if ((operator !== "=" && operator !== "!=") || (value !== "yes" && value !== "no")) {
        return Result.fail("behavior-wake-invalid");
      }
      clauses.push({ name, operator, value });
    } else if (judge.score?.name === name) {
      const position = judge.score.levels.indexOf(value);
      if (position === -1) return Result.fail("behavior-wake-invalid");
      clauses.push({ name, operator, value, level: position + 1 });
    } else {
      return Result.fail("behavior-wake-invalid");
    }
  }
  return Result.succeed(clauses);
};

const ACTIONS_BY_FIX: Readonly<Record<BehaviorFailureFix, ReadonlyArray<BehaviorFailureAction>>> = {
  auto: ["retry", "backoff", "rewatch", "refresh_token"],
  owner: ["reconnect", "report"],
  publisher: ["report"],
  none: ["none"],
};

/** Actions that only make sense for one kind; any other action is valid for any kind. */
const KINDS_BY_ACTION: Partial<Record<BehaviorFailureAction, ReadonlyArray<BehaviorFailureKind>>> =
  {
    rewatch: ["watch_expired"],
    refresh_token: ["auth_expired"],
    reconnect: ["auth_expired", "auth_revoked", "permission_denied"],
    retry: ["transient", "watch_expired"],
    backoff: ["rate_limited", "quota_exceeded", "transient"],
  };

/** Whether one kind/fix/action combination is coherent. */
export const isCoherentFailureHandling = (
  kind: BehaviorFailureKind,
  fix: BehaviorFailureFix,
  action: BehaviorFailureAction,
): boolean =>
  ACTIONS_BY_FIX[fix].includes(action) && (KINDS_BY_ACTION[action]?.includes(kind) ?? true);

const ARGUMENT_KEY = /^[A-Za-z_][A-Za-z0-9_-]{0,63}$/u;

const asJsonObject = (value: Schema.Json | undefined): Schema.JsonObject | undefined =>
  value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Schema.JsonObject)
    : undefined;

/**
 * Checks a watch argument template: bounded depth and leaves, references in the reference
 * grammar, no nulls, and object keys known to (and required by) the tool's input schema where
 * the schema declares `properties`.
 */
const WATCH_ARGUMENT_PROBLEMS = {
  invalid: "behavior-watch-arg-invalid",
  unknown: "behavior-watch-arg-unknown",
  missing: "behavior-watch-arg-missing",
} as const;

const SOURCE_ARGUMENT_PROBLEMS = {
  invalid: "behavior-source-arg-invalid",
  unknown: "behavior-source-arg-unknown",
  missing: "behavior-source-arg-missing",
} as const;

const checkWatchArguments = (
  args: Readonly<Record<string, Schema.Json>>,
  inputSchema: Schema.JsonObject | undefined,
  at: string,
  issues: Array<PluginBehaviorIssue>,
  options: {
    readonly problems: {
      readonly invalid: PluginBehaviorProblem;
      readonly unknown: PluginBehaviorProblem;
      readonly missing: PluginBehaviorProblem;
    };
    /** Whether a `$` string is an acceptable reference; `undefined` refuses every reference. */
    readonly isReference: ((value: string) => boolean) | undefined;
    /** Keys the host fills itself (a poll cursor), so a required one need not be present. */
    readonly hostFilled?: ReadonlyArray<string>;
  } = { problems: WATCH_ARGUMENT_PROBLEMS, isReference: (value) => REFERENCE.test(value) },
): void => {
  const problems = options.problems;
  let leaves = 0;
  const visit = (
    value: Schema.Json,
    schema: Schema.JsonObject | undefined,
    path: string,
    depth: number,
  ): void => {
    if (depth > L.maximumWatchArgDepth) {
      issues.push({ problem: problems.invalid, at: path });
      return;
    }
    if (Array.isArray(value)) {
      const items = asJsonObject(schema?.["items"]);
      for (const [index, item] of value.entries())
        visit(item, items, `${path}[${index}]`, depth + 1);
      return;
    }
    const object = asJsonObject(value);
    if (object !== undefined) {
      visitObject(object, schema, path, depth);
      return;
    }
    leaves += 1;
    if (
      value === null ||
      (typeof value === "number" && !Number.isFinite(value)) ||
      (typeof value === "string" &&
        (value.length === 0 ||
          value.length > 300 ||
          (value.startsWith("$") && options.isReference?.(value) !== true)))
    ) {
      issues.push({ problem: problems.invalid, at: path });
    }
  };
  const visitObject = (
    object: Schema.JsonObject,
    schema: Schema.JsonObject | undefined,
    path: string,
    depth: number,
  ): void => {
    const properties = asJsonObject(schema?.["properties"]);
    for (const [key, entry] of Object.entries(object)) {
      const entryPath = `${path}.${key}`;
      if (!ARGUMENT_KEY.test(key)) issues.push({ problem: problems.invalid, at: entryPath });
      if (properties !== undefined && !Object.hasOwn(properties, key)) {
        issues.push({ problem: problems.unknown, at: entryPath });
      }
      visit(entry, asJsonObject(properties?.[key]), entryPath, depth + 1);
    }
    const required = schema?.["required"];
    if (Array.isArray(required)) {
      for (const name of required) {
        if (
          typeof name === "string" &&
          !Object.hasOwn(object, name) &&
          !(depth === 0 && options.hostFilled?.includes(name) === true)
        ) {
          issues.push({ problem: problems.missing, at: `${path}.${name}` });
        }
      }
    }
  };
  visitObject(args, inputSchema, at, 0);
  if (leaves > L.maximumWatchArgLeaves) issues.push({ problem: problems.invalid, at });
};

const questionNames = (questions: BehaviorQuestions): ReadonlyArray<string> =>
  [questions.classify?.name, questions.yesNo?.name, questions.score?.name].filter(
    (name): name is string => name !== undefined,
  );

const checkQuestions = (
  questions: BehaviorQuestions,
  at: string,
  issues: Array<PluginBehaviorIssue>,
): void => {
  const names = questionNames(questions);
  if (names.length === 0) issues.push({ problem: "behavior-questions-empty", at });
  if (
    new Set(names).size !== names.length ||
    names.some((name) => BEHAVIOR_RESERVED_ANSWER_NAMES.has(name))
  ) {
    issues.push({ problem: "behavior-question-name-invalid", at });
  }
  for (const [field, values] of [
    ["classify.options", questions.classify?.options ?? []],
    ["score.levels", questions.score?.levels ?? []],
  ] as const) {
    if (new Set(values.map((value) => value.toLowerCase())).size !== values.length) {
      issues.push({ problem: "behavior-options-duplicate", at: `${at}.${field}` });
    }
    // An option must not contain what `wakeWhen` reads as the start of another clause.
    if (values.some((value) => WAKE_CLAUSE_SEPARATOR.test(value))) {
      issues.push({ problem: "behavior-option-invalid", at: `${at}.${field}` });
    }
  }
};

const WATCHABLE_ARGUMENT_PROBLEMS = {
  invalid: "behavior-watchable-arg-invalid",
  unknown: "behavior-watchable-arg-unknown",
  missing: "behavior-watchable-arg-missing",
} as const;

const PROFILE_ARGUMENT_PROBLEMS = {
  invalid: "behavior-profile-arg-invalid",
  unknown: "behavior-profile-arg-unknown",
  missing: "behavior-profile-arg-missing",
} as const;

/** A whole-string watchable reference: `$param.<name>` or `$profile.<name>`. */
export const WATCHABLE_REFERENCE = /^\$(param|profile)\.([a-z][a-z0-9_]{0,39})$/u;
/** Any `$<namespace>.<name>` token inside a string. */
const REFERENCE_TOKEN = /\$([a-z]+)\.([A-Za-z_][A-Za-z0-9_]{0,63})/gu;
/** A whole-string fetch reference: `$item.key` or `$item.<field>`. */
export const WATCHABLE_ITEM_REFERENCE = /^\$item\.([a-z][a-z0-9_]{0,39})$/u;

const jsonStrings = (value: Schema.Json): ReadonlyArray<string> => {
  if (typeof value === "string") return [value];
  if (Array.isArray(value)) return value.flatMap(jsonStrings);
  const object = asJsonObject(value);
  return object === undefined ? [] : Object.values(object).flatMap(jsonStrings);
};

const literalMatchesType = (
  value: Schema.Json,
  type: BehaviorWatchValueType,
  values: ReadonlyArray<string> | undefined,
): boolean =>
  type === "number"
    ? typeof value === "number" && Number.isFinite(value)
    : type === "boolean"
      ? typeof value === "boolean"
      : type === "enum"
        ? typeof value === "string" && (values ?? []).includes(value)
        : typeof value === "string" && value.length > 0 && value.length <= 300;

/**
 * Whether a condition is well typed against a watchable's fields: every named field exists, a
 * threshold compares a number field, and every literal has its field's type (an enum literal is
 * one of its values). The host applies the same check to Owner-requested Watches.
 */
export const checkBehaviorWatchCondition = (
  condition: BehaviorWatchCondition,
  fields: Readonly<Record<string, BehaviorWatchableField>>,
): boolean => {
  const fieldOf = (name: string) => (Object.hasOwn(fields, name) ? fields[name] : undefined);

  const literalFits = (name: string, literal: BehaviorConditionScalar): boolean => {
    const field = fieldOf(name);

    return field !== undefined && literalMatchesType(literal, field.type, field.values);
  };

  const where = condition.where ?? {};
  if (Object.keys(where).length > L.maximumConditionClauses) return false;
  for (const [name, expected] of Object.entries(where)) {
    const alternatives = Array.isArray(expected) ? expected : [expected];
    if (!alternatives.every((literal) => literalFits(name, literal))) return false;
  }
  switch (condition.kind) {
    case "field-changed": {
      if (fieldOf(condition.field) === undefined) return false;
      if (condition.from === undefined && condition.to === undefined) return false;
      const to =
        condition.to === undefined
          ? []
          : Array.isArray(condition.to)
            ? condition.to
            : [condition.to];

      return (
        (condition.from === undefined || literalFits(condition.field, condition.from)) &&
        to.every((literal) => literalFits(condition.field, literal))
      );
    }
    case "threshold":
      return fieldOf(condition.field)?.type === "number";
    default:
      return true;
  }
};

const checkTypedEntries = (
  entries: Readonly<
    Record<
      string,
      { readonly type: BehaviorWatchValueType; readonly values?: ReadonlyArray<string> }
    >
  >,
  maximum: number,
  minimum: number,
  at: string,
  issues: Array<PluginBehaviorIssue>,
): void => {
  const names = Object.keys(entries);
  if (names.length > maximum || names.length < minimum) {
    issues.push({ problem: "behavior-shape-invalid", at });
  }
  for (const [name, entry] of Object.entries(entries)) {
    if (!VALUE_NAME.test(name)) {
      issues.push({ problem: "behavior-watchable-name-invalid", at: `${at}.${name}` });
    }
    const values = entry.values;
    if (
      (entry.type === "enum") !== (values !== undefined) ||
      (values !== undefined && new Set(values).size !== values.length)
    ) {
      issues.push({ problem: "behavior-watchable-field-invalid", at: `${at}.${name}` });
    }
  }
};

/** Checks `watchables` and `profile` (ADR 0045) against the catalog and each other. */
const checkWatchablesAndProfile = (
  declaration: PluginBehaviorDeclaration,
  requireTool: (id: string, at: string) => BehaviorCatalogTool | undefined,
  issues: Array<PluginBehaviorIssue>,
): void => {
  // The host always knows the connection's verified account subject (the provider account id the
  // reviewed account endpoint returned at connect), as the scalar profile value `account_subject`.
  const profileValues = new Map<string, boolean>([[BEHAVIOR_ACCOUNT_SUBJECT, false]]);
  for (const [index, step] of (declaration.profile?.steps ?? []).entries()) {
    for (const [name, path] of Object.entries(step.values)) {
      const at = `$.profile.steps[${index}].values.${name}`;
      if (!VALUE_NAME.test(name)) issues.push({ problem: "behavior-watchable-name-invalid", at });
      if (profileValues.has(name)) issues.push({ problem: "behavior-profile-value-duplicate", at });
      profileValues.set(name, isProfileListPath(path));
    }
  }

  const watchableIds = new Map<string, BehaviorWatchable>();
  for (const [index, watchable] of (declaration.watchables ?? []).entries()) {
    const at = `$.watchables[${index}]`;
    if (watchableIds.has(watchable.id)) {
      issues.push({ problem: "behavior-watchable-duplicate-id", at });
    }
    watchableIds.set(watchable.id, watchable);
    const tool = requireTool(watchable.tool, `${at}.tool`);
    if (tool !== undefined && tool.classification !== "read") {
      issues.push({ problem: "behavior-watchable-not-read", at: `${at}.tool` });
    }
    const params = watchable.params ?? {};
    checkTypedEntries(params, L.maximumWatchableParams, 0, `${at}.params`, issues);
    checkTypedEntries(watchable.fields, L.maximumWatchableFields, 1, `${at}.fields`, issues);
    for (const path of [
      watchable.key,
      ...Object.values(watchable.fields).map((field) => field.path),
    ]) {
      if (path.split(".").length - 1 > L.maximumPathSegments) {
        issues.push({ problem: "behavior-shape-invalid", at });
      }
    }
    const resolves = (namespace: string, name: string): boolean =>
      namespace === "param"
        ? Object.hasOwn(params, name)
        : namespace === "profile" && profileValues.get(name) === false;
    checkWatchArguments(watchable.args, tool?.inputSchema, `${at}.args`, issues, {
      problems: WATCHABLE_ARGUMENT_PROBLEMS,
      isReference: (value) => WATCHABLE_REFERENCE.test(value),
    });
    for (const text of jsonStrings(watchable.args)) {
      for (const match of text.matchAll(REFERENCE_TOKEN)) {
        if (!resolves(match[1] ?? "", match[2] ?? "")) {
          issues.push({ problem: "behavior-watchable-reference-unknown", at: `${at}.args` });
        }
      }
    }
    if (watchable.fetch !== undefined) {
      const fetchTool = requireTool(watchable.fetch.tool, `${at}.fetch.tool`);
      if (fetchTool !== undefined && fetchTool.classification !== "read") {
        issues.push({ problem: "behavior-watchable-not-read", at: `${at}.fetch.tool` });
      }
      const itemReference = (value: string): boolean => {
        const name = WATCHABLE_ITEM_REFERENCE.exec(value)?.[1];

        return name !== undefined && (name === "key" || Object.hasOwn(watchable.fields, name));
      };
      checkWatchArguments(
        watchable.fetch.args,
        fetchTool?.inputSchema,
        `${at}.fetch.args`,
        issues,
        {
          problems: WATCHABLE_ARGUMENT_PROBLEMS,
          isReference: itemReference,
        },
      );
      for (const text of jsonStrings(watchable.fetch.args)) {
        if (!itemReference(text) && REFERENCE_TOKEN.test(text)) {
          issues.push({ problem: "behavior-watchable-reference-unknown", at: `${at}.fetch.args` });
        }
        REFERENCE_TOKEN.lastIndex = 0;
      }
    }
  }

  const profile = declaration.profile;
  if (profile === undefined) return;
  for (const [index, step] of profile.steps.entries()) {
    const at = `$.profile.steps[${index}]`;
    const tool = requireTool(step.tool, `${at}.tool`);
    if (tool !== undefined && tool.classification !== "read") {
      issues.push({ problem: "behavior-profile-not-read", at: `${at}.tool` });
    }
    checkWatchArguments(step.args, tool?.inputSchema, `${at}.args`, issues, {
      problems: PROFILE_ARGUMENT_PROBLEMS,
      isReference: undefined,
    });
    const count = Object.keys(step.values).length;
    if (count === 0) issues.push({ problem: "behavior-shape-invalid", at: `${at}.values` });
  }
  if (profileValues.size - 1 > L.maximumProfileValues) {
    issues.push({ problem: "behavior-shape-invalid", at: "$.profile.steps" });
  }
  const defaultIds = new Set<string>();
  const entries = [
    ...(profile.defaultWatches ?? []).map(
      (entry, index) => [entry, `$.profile.defaultWatches[${index}]`] as const,
    ),
    ...(profile.suggestedWatches ?? []).map(
      (entry, index) => [entry, `$.profile.suggestedWatches[${index}]`] as const,
    ),
  ];
  for (const [entry, at] of entries) {
    if (defaultIds.has(entry.id)) {
      issues.push({ problem: "behavior-default-watch-duplicate-id", at });
    }
    defaultIds.add(entry.id);
    const watchable = watchableIds.get(entry.watchable);
    if (watchable === undefined) {
      issues.push({ problem: "behavior-default-watch-watchable-unknown", at: `${at}.watchable` });
      continue;
    }
    const params = watchable.params ?? {};
    const args = entry.args ?? {};
    for (const [name, value] of Object.entries(args)) {
      const param = Object.hasOwn(params, name) ? params[name] : undefined;
      const reference = typeof value === "string" ? WATCHABLE_REFERENCE.exec(value) : null;

      const fits =
        param !== undefined &&
        (reference !== null
          ? reference[1] === "profile" && profileValues.get(reference[2] ?? "") === false
          : literalMatchesType(value, param.type, param.values));
      if (!fits) {
        issues.push({ problem: "behavior-default-watch-arg-invalid", at: `${at}.args.${name}` });
      }
    }
    for (const [name, param] of Object.entries(params)) {
      if (param.required === true && !Object.hasOwn(args, name)) {
        issues.push({ problem: "behavior-default-watch-arg-invalid", at: `${at}.args.${name}` });
      }
    }
    const condition = entry.condition;
    if (
      condition !== undefined &&
      (condition.kind === "ask" || !checkBehaviorWatchCondition(condition, watchable.fields))
    ) {
      issues.push({ problem: "behavior-condition-invalid", at: `${at}.condition` });
    }
  }
};

/**
 * Checks a structurally valid declaration against the Plugin's reviewed catalog. The
 * application performs the same checks against each installed version's catalog.
 */
export const checkPluginBehaviorDeclaration = (
  declaration: PluginBehaviorDeclaration,
  tools: ReadonlyArray<BehaviorCatalogTool>,
): ReadonlyArray<PluginBehaviorIssue> => {
  const issues: Array<PluginBehaviorIssue> = [];
  const byId = new Map(tools.map((tool) => [tool.id, tool]));
  const requireTool = (id: string, at: string): BehaviorCatalogTool | undefined => {
    const tool = byId.get(id);
    if (tool === undefined) issues.push({ problem: "behavior-tool-unknown", at });
    return tool;
  };

  if (
    declaration.followUps === undefined &&
    declaration.failures === undefined &&
    declaration.observe === undefined &&
    declaration.sources === undefined &&
    declaration.watchables === undefined &&
    declaration.profile === undefined
  ) {
    issues.push({ problem: "behavior-empty", at: "$" });
  }

  const followUpIds = new Set<string>();
  for (const [index, followUp] of (declaration.followUps ?? []).entries()) {
    const at = `$.followUps[${index}]`;
    if (followUpIds.has(followUp.id)) issues.push({ problem: "behavior-duplicate-id", at });
    followUpIds.add(followUp.id);

    const after = requireTool(followUp.after.tool, `${at}.after.tool`);
    if (after !== undefined && after.classification !== "write") {
      issues.push({ problem: "behavior-after-not-write", at: `${at}.after.tool` });
    }
    const watch = requireTool(followUp.watch.tool, `${at}.watch.tool`);
    if (watch !== undefined && watch.classification !== "read") {
      issues.push({ problem: "behavior-watch-not-read", at: `${at}.watch.tool` });
    }

    checkWatchArguments(followUp.watch.args, watch?.inputSchema, `${at}.watch.args`, issues);

    const checks = followUp.watch.checkAt.map(behaviorOffsetMinutes);
    const stopAfter = behaviorOffsetMinutes(followUp.watch.stopAfter);
    const ascending = checks.every(
      (minutes, position) =>
        minutes !== undefined && (position === 0 || minutes > (checks[position - 1] ?? 0)),
    );
    if (
      !ascending ||
      stopAfter === undefined ||
      stopAfter > L.maximumStopAfterMinutes ||
      (checks[0] ?? 0) < L.minimumFirstCheckMinutes ||
      (checks.at(-1) ?? Infinity) > stopAfter
    ) {
      issues.push({ problem: "behavior-schedule-invalid", at: `${at}.watch` });
    }

    checkQuestions(followUp.judge, `${at}.judge`, issues);
    if (Result.isFailure(parseBehaviorWakeWhen(followUp.wakeWhen, followUp.judge))) {
      issues.push({ problem: "behavior-wake-invalid", at: `${at}.wakeWhen` });
    }
  }

  const observed = new Set<string>();
  for (const [index, observation] of (declaration.observe ?? []).entries()) {
    const at = `$.observe[${index}]`;
    const from = requireTool(observation.from, `${at}.from`);
    if (from !== undefined && from.classification !== "read") {
      issues.push({ problem: "behavior-observe-not-read", at: `${at}.from` });
    }
    const identity = `${observation.from} ${observation.entity}`;
    if (observed.has(identity)) issues.push({ problem: "behavior-observe-duplicate", at });
    observed.add(identity);
    if (new Set(observation.keep).size !== observation.keep.length) {
      issues.push({ problem: "behavior-keep-duplicate", at: `${at}.keep` });
    }
    for (const path of [observation.key, observation.time]) {
      if (path !== undefined && path.split(".").length - 1 > L.maximumPathSegments) {
        issues.push({ problem: "behavior-shape-invalid", at });
      }
    }
    if (observation.describe !== undefined) {
      checkQuestions(observation.describe, `${at}.describe`, issues);
    }
  }

  const observedTools = new Set((declaration.observe ?? []).map((entry) => entry.from));
  const sourceIds = new Set<string>();
  for (const [index, source] of (declaration.sources ?? []).entries()) {
    const at = `$.sources[${index}]`;
    if (sourceIds.has(source.id)) issues.push({ problem: "behavior-source-duplicate-id", at });
    sourceIds.add(source.id);

    const toolId = source.kind === "poll" ? source.tool : source.fetch.tool;
    const toolAt = source.kind === "poll" ? `${at}.tool` : `${at}.fetch.tool`;
    const tool = requireTool(toolId, toolAt);
    if (tool !== undefined && tool.classification !== "read") {
      issues.push({ problem: "behavior-source-not-read", at: toolAt });
    }
    // A source exists to feed observations; a tool nothing observes would fetch for nothing.
    if (!observedTools.has(toolId)) {
      issues.push({ problem: "behavior-source-not-observed", at: toolAt });
    }

    if (source.kind === "poll") {
      if (
        source.intervalMinutes < L.minimumPollIntervalMinutes ||
        source.intervalMinutes > L.maximumPollIntervalMinutes
      ) {
        issues.push({ problem: "behavior-source-interval-invalid", at: `${at}.intervalMinutes` });
      }
      const cursorArg = source.cursor?.arg;
      const properties = asJsonObject(tool?.inputSchema?.["properties"]);
      if (
        cursorArg !== undefined &&
        properties !== undefined &&
        !Object.hasOwn(properties, cursorArg)
      ) {
        issues.push({ problem: "behavior-source-arg-unknown", at: `${at}.cursor.arg` });
      }
      for (const path of [source.key, source.cursor?.path]) {
        if (path !== undefined && path.split(".").length - 1 > L.maximumPathSegments) {
          issues.push({ problem: "behavior-shape-invalid", at });
        }
      }
      checkWatchArguments(source.args, tool?.inputSchema, `${at}.args`, issues, {
        problems: SOURCE_ARGUMENT_PROBLEMS,
        isReference: undefined,
        hostFilled: cursorArg === undefined ? [] : [cursorArg],
      });
      continue;
    }

    const adapters: Readonly<
      Record<
        string,
        { readonly events: ReadonlyArray<string>; readonly fields: ReadonlyArray<string> }
      >
    > = BEHAVIOR_SOURCE_ADAPTERS[source.kind];

    const adapter = Object.hasOwn(adapters, source.adapter) ? adapters[source.adapter] : undefined;
    if (adapter === undefined) {
      issues.push({ problem: "behavior-source-adapter-unknown", at: `${at}.adapter` });
    } else if (source.kind === "webhook") {
      if (new Set(source.events).size !== source.events.length) {
        issues.push({ problem: "behavior-source-event-unknown", at: `${at}.events` });
      }
      for (const [position, event] of source.events.entries()) {
        if (!adapter.events.includes(event)) {
          issues.push({
            problem: "behavior-source-event-unknown",
            at: `${at}.events[${position}]`,
          });
        }
      }
    }
    checkWatchArguments(source.fetch.args, tool?.inputSchema, `${at}.fetch.args`, issues, {
      problems: SOURCE_ARGUMENT_PROBLEMS,
      isReference: (value) => {
        const field = SOURCE_EVENT_REFERENCE.exec(value)?.[1];

        return field !== undefined && adapter?.fields.includes(field) === true;
      },
    });
  }

  checkWatchablesAndProfile(declaration, requireTool, issues);

  const failures = declaration.failures;
  if (failures !== undefined) {
    for (const [index, template] of (failures.signals?.messageTemplates ?? []).entries()) {
      if (template.split("{status}").length !== 2) {
        issues.push({
          problem: "behavior-template-invalid",
          at: `$.failures.signals.messageTemplates[${index}]`,
        });
      }
    }
    for (const [index, rule] of failures.rules.entries()) {
      const at = `$.failures.rules[${index}]`;
      if (
        rule.httpStatus === undefined &&
        rule.providerCode === undefined &&
        rule.messagePrefix === undefined
      ) {
        issues.push({ problem: "behavior-rule-empty", at });
      }
      for (const [position, tool] of (rule.tools ?? []).entries()) {
        requireTool(tool, `${at}.tools[${position}]`);
      }
      if (rule.fix === undefined && rule.action === undefined) {
        if (failures.kinds[rule.kind] === undefined) {
          issues.push({ problem: "behavior-rule-kind-unhandled", at: `${at}.kind` });
        }
      } else if (
        rule.fix === undefined ||
        rule.action === undefined ||
        !isCoherentFailureHandling(rule.kind, rule.fix, rule.action)
      ) {
        issues.push({ problem: "behavior-handling-invalid", at });
      }
    }
    for (const kind of BehaviorFailureKind.literals) {
      const handling = failures.kinds[kind];
      if (
        handling !== undefined &&
        !isCoherentFailureHandling(kind, handling.fix, handling.action)
      ) {
        issues.push({ problem: "behavior-handling-invalid", at: `$.failures.kinds.${kind}` });
      }
    }
  }

  return issues;
};

/** Parses one behaviour file and checks its path; catalog checks are separate. */
export const parsePluginBehavior = (
  relativePath: string,
  source: string,
): Result.Result<PluginBehavior, PluginBehaviorIssue> => {
  if (Buffer.byteLength(source, "utf8") > L.maximumFileBytes) {
    return Result.fail({ problem: "behavior-too-large", at: "$" });
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(source);
  } catch {
    return Result.fail({ problem: "behavior-json-invalid", at: "$" });
  }
  const decoded = Schema.decodeUnknownResult(PluginBehaviorDeclaration, {
    onExcessProperty: "error",
  })(parsed);
  if (Result.isFailure(decoded)) return Result.fail({ problem: "behavior-shape-invalid", at: "$" });
  const declaration = decoded.success;
  const [marketplaceId, publisher, slug] = declaration.plugin.split(":");
  if (
    marketplaceId !== "supernala-public" ||
    relativePath.replaceAll("\\", "/") !== `${PLUGIN_BEHAVIORS_DIRECTORY}/${publisher}/${slug}.json`
  ) {
    return Result.fail({ problem: "behavior-path-mismatch", at: "$.plugin" });
  }
  const canonicalJson = canonicalPluginJson(parsed as Schema.Json);
  return Result.succeed({
    definitionId: declaration.plugin,
    revision: declaration.revision,
    declaration,
    canonicalJson,
    contentSha256: createHash("sha256").update(canonicalJson).digest("hex"),
    relativePath,
  });
};
