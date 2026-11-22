import { createHash } from "node:crypto";
import { Result, Schema } from "effect";
import { canonicalPluginJson } from "./plugin-contract.js";

/*
 * Plugin behaviour declarations tell the host what an app's tools mean over time, beyond the
 * tools themselves: which read tool watches the outcome of a write (`followUps`), how a failure
 * is classified and who fixes it (`failures`), and which read results become Workspace
 * observations (`observe`). A declaration grants no authority. Every tool it names must already
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
  | "behavior-handling-invalid";

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
const checkWatchArguments = (
  args: Readonly<Record<string, Schema.Json>>,
  inputSchema: Schema.JsonObject | undefined,
  at: string,
  issues: Array<PluginBehaviorIssue>,
): void => {
  let leaves = 0;
  const visit = (
    value: Schema.Json,
    schema: Schema.JsonObject | undefined,
    path: string,
    depth: number,
  ): void => {
    if (depth > L.maximumWatchArgDepth) {
      issues.push({ problem: "behavior-watch-arg-invalid", at: path });
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
          (value.startsWith("$") && !REFERENCE.test(value))))
    ) {
      issues.push({ problem: "behavior-watch-arg-invalid", at: path });
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
      if (!ARGUMENT_KEY.test(key))
        issues.push({ problem: "behavior-watch-arg-invalid", at: entryPath });
      if (properties !== undefined && !Object.hasOwn(properties, key)) {
        issues.push({ problem: "behavior-watch-arg-unknown", at: entryPath });
      }
      visit(entry, asJsonObject(properties?.[key]), entryPath, depth + 1);
    }
    const required = schema?.["required"];
    if (Array.isArray(required)) {
      for (const name of required) {
        if (typeof name === "string" && !Object.hasOwn(object, name)) {
          issues.push({ problem: "behavior-watch-arg-missing", at: `${path}.${name}` });
        }
      }
    }
  };
  visitObject(args, inputSchema, at, 0);
  if (leaves > L.maximumWatchArgLeaves) issues.push({ problem: "behavior-watch-arg-invalid", at });
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
    declaration.observe === undefined
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
