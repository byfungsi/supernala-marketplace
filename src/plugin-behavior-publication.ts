import { createHash } from "node:crypto";
import { Option, Result, Schema } from "effect";
import type { D1BatchTransport } from "./cloudflare-adapters.js";
import { canonicalPluginJson } from "./plugin-contract.js";
import type { PluginBehavior } from "./plugin-behavior.js";

/*
 * Publishes behaviour declarations into the application's `plugin_behavior_declarations` table
 * (vendored under `compatibility/plugin-behaviors`). One immutable row per
 * `(plugin_definition_id, revision)`; the highest revision is current. `declaration_json` is the
 * declaration's canonical JSON and `content_sha256` its SHA-256, which the application recomputes
 * on every read (`decodeStoredPluginBehavior`). Publishing the same declarations again changes
 * nothing, so an interrupted run is retried by running it again. Rows are only ever inserted.
 */

/**
 * The application migration this publisher writes into. A test pins these bytes to
 * `compatibility/plugin-behaviors/manifest.json`; re-vendor and update both together.
 */
export const PLUGIN_BEHAVIOR_MIGRATION = {
  file: "0262_plugin_behavior_declarations.sql",
  sha256: "c36972fc73dd34646e49903d1bcdb69f2f65501de2bb8eed03d00edf26203666",
} as const;

/** What publishing one declaration would do. */
export type BehaviorPublicationStep =
  | { readonly kind: "publish-revision" }
  | { readonly kind: "unchanged" }
  /** The Plugin is not in the application yet; its declaration publishes after the Plugin does. */
  | { readonly kind: "skipped"; readonly reason: "plugin-not-published" }
  | {
      readonly kind: "blocked";
      readonly reason: "behavior-revision-content-changed" | "behavior-revision-not-newer";
    };

export interface BehaviorPublicationPlanEntry {
  readonly behavior: PluginBehavior;
  readonly step: BehaviorPublicationStep;
}

const DefinitionRow = Schema.Struct({ plugin_definition_id: Schema.String });

const DeclarationRow = Schema.Struct({
  plugin_definition_id: Schema.String,
  revision: Schema.Number,
  content_sha256: Schema.String,
});

const StoredRow = Schema.Struct({ declaration_json: Schema.String, content_sha256: Schema.String });

const placeholders = (count: number) => Array.from({ length: count }, () => "?").join(", ");

/**
 * Whether the application would accept a stored row's digest: it parses `declaration_json`,
 * recomputes the canonical JSON and compares its SHA-256 with `content_sha256`.
 */
export const storedBehaviorDigestMatches = (row: {
  readonly declarationJson: string;
  readonly contentSha256: string;
}): boolean => {
  try {
    const parsed = Schema.decodeUnknownSync(Schema.Json)(JSON.parse(row.declarationJson));
    return (
      createHash("sha256").update(canonicalPluginJson(parsed)).digest("hex") === row.contentSha256
    );
  } catch {
    return false;
  }
};

/** Reads current application rows and decides, per declaration, what publishing would change. */
export const planBehaviorPublication = async (
  database: D1BatchTransport,
  behaviors: ReadonlyArray<PluginBehavior>,
): Promise<Result.Result<ReadonlyArray<BehaviorPublicationPlanEntry>, string>> => {
  if (behaviors.length === 0) return Result.succeed([]);
  const ids = behaviors.map((behavior) => behavior.definitionId);
  const definitions = await database.query({
    sql: `SELECT plugin_definition_id FROM plugin_definitions
          WHERE plugin_definition_id IN (${placeholders(ids.length)})`,
    params: ids,
  });
  if (Result.isFailure(definitions)) return Result.fail(definitions.failure);
  const published = await database.query({
    sql: `SELECT plugin_definition_id, revision, content_sha256 FROM plugin_behavior_declarations
          WHERE plugin_definition_id IN (${placeholders(ids.length)})`,
    params: ids,
  });
  if (Result.isFailure(published)) return Result.fail(published.failure);
  const definitionRows = Schema.decodeUnknownResult(Schema.Array(DefinitionRow))(
    definitions.success,
  );
  const declarationRows = Schema.decodeUnknownResult(Schema.Array(DeclarationRow))(
    published.success,
  );
  if (Result.isFailure(definitionRows) || Result.isFailure(declarationRows)) {
    return Result.fail("behavior-rows-invalid");
  }

  return Result.succeed(
    behaviors.map((behavior): BehaviorPublicationPlanEntry => {
      if (
        !definitionRows.success.some((row) => row.plugin_definition_id === behavior.definitionId)
      ) {
        return { behavior, step: { kind: "skipped", reason: "plugin-not-published" } };
      }
      const existing = declarationRows.success.filter(
        (row) => row.plugin_definition_id === behavior.definitionId,
      );
      const same = existing.find((row) => row.revision === behavior.revision);
      if (same !== undefined) {
        // A published revision is immutable; changed content needs a new revision number.
        return same.content_sha256 === behavior.contentSha256
          ? { behavior, step: { kind: "unchanged" } }
          : { behavior, step: { kind: "blocked", reason: "behavior-revision-content-changed" } };
      }
      if (existing.some((row) => row.revision > behavior.revision)) {
        return { behavior, step: { kind: "blocked", reason: "behavior-revision-not-newer" } };
      }

      return { behavior, step: { kind: "publish-revision" } };
    }),
  );
};

export interface BehaviorPublicationOutcome {
  readonly definitionId: string;
  readonly revision: number;
  readonly contentSha256: string;
  readonly step: BehaviorPublicationStep["kind"];
}

/** The plan as plain data, for dry-run output and the published report. */
export const describeBehaviorPlan = (plan: ReadonlyArray<BehaviorPublicationPlanEntry>) =>
  plan.map(({ behavior, step }) => ({
    definitionId: behavior.definitionId,
    revision: behavior.revision,
    contentSha256: behavior.contentSha256,
    step: step.kind,
    ...(step.kind === "skipped" || step.kind === "blocked" ? { reason: step.reason } : {}),
  }));

/** Applies a plan, inserting and reading back each new revision; blocked plans publish nothing. */
export const publishBehaviorPlan = async (input: {
  readonly database: D1BatchTransport;
  readonly plan: ReadonlyArray<BehaviorPublicationPlanEntry>;
  readonly now: () => number;
}): Promise<Result.Result<ReadonlyArray<BehaviorPublicationOutcome>, string>> => {
  if (input.plan.some((entry) => entry.step.kind === "blocked")) {
    return Result.fail("behavior-publication-plan-blocked");
  }
  const outcomes: Array<BehaviorPublicationOutcome> = [];
  for (const { behavior, step } of input.plan) {
    if (step.kind === "publish-revision") {
      // oxlint-disable-next-line no-await-in-loop -- One insert per declaration, applied in order.
      const written = await input.database.batch([
        {
          sql: `INSERT INTO plugin_behavior_declarations
                  (plugin_definition_id, revision, declaration_json, content_sha256, published_at)
                VALUES (?, ?, ?, ?, ?)`,
          params: [
            behavior.definitionId,
            behavior.revision,
            behavior.canonicalJson,
            behavior.contentSha256,
            input.now(),
          ],
        },
      ]);
      if (Result.isFailure(written)) return Result.fail(written.failure);
      // oxlint-disable-next-line no-await-in-loop -- Readback confirms this row before the next.
      const readback = await input.database.query({
        sql: `SELECT declaration_json, content_sha256 FROM plugin_behavior_declarations
              WHERE plugin_definition_id = ? AND revision = ?`,
        params: [behavior.definitionId, behavior.revision],
      });
      const stored = Result.isSuccess(readback)
        ? Schema.decodeUnknownOption(StoredRow)(readback.success[0])
        : Option.none();
      if (
        Option.isNone(stored) ||
        stored.value.declaration_json !== behavior.canonicalJson ||
        stored.value.content_sha256 !== behavior.contentSha256 ||
        !storedBehaviorDigestMatches({
          declarationJson: stored.value.declaration_json,
          contentSha256: stored.value.content_sha256,
        })
      ) {
        return Result.fail("behavior-publication-readback-mismatch");
      }
    }
    outcomes.push({
      definitionId: behavior.definitionId,
      revision: behavior.revision,
      contentSha256: behavior.contentSha256,
      step: step.kind,
    });
  }

  return Result.succeed(outcomes);
};
