import { Result, Schema } from "effect";
import type { D1BatchTransport } from "./cloudflare-adapters.js";
import type { PluginSetupGuide } from "./plugin-setup-guide.js";

/*
 * Publishes setup guides into the application's `plugin_setup_guides` table (vendored under
 * `compatibility/plugin-setup-guides`). Revisions are immutable and keyed by Plugin definition
 * and revision; the highest revision is current. Publishing the same guides again changes
 * nothing, so an interrupted run is retried by running it again.
 */

/** What publishing one guide would do. */
export type GuidePublicationStep =
  | { readonly kind: "publish-revision" }
  | { readonly kind: "unchanged" }
  /** The Plugin is not in the application yet; its guide publishes after the Plugin does. */
  | { readonly kind: "skipped"; readonly reason: "plugin-not-published" }
  | { readonly kind: "blocked"; readonly reason: string };

export interface GuidePublicationPlanEntry {
  readonly guide: PluginSetupGuide;
  readonly step: GuidePublicationStep;
}

const DefinitionRow = Schema.Struct({ plugin_definition_id: Schema.String });

const GuideRow = Schema.Struct({
  plugin_definition_id: Schema.String,
  revision: Schema.Number,
  content_sha256: Schema.String,
});

const placeholders = (count: number) => Array.from({ length: count }, () => "?").join(", ");

/** Reads current application rows and decides, per guide, what publishing would change. */
export const planGuidePublication = async (
  database: D1BatchTransport,
  guides: ReadonlyArray<PluginSetupGuide>,
): Promise<Result.Result<ReadonlyArray<GuidePublicationPlanEntry>, string>> => {
  if (guides.length === 0) return Result.succeed([]);
  const ids = guides.map((guide) => guide.definitionId);
  const definitions = await database.query({
    sql: `SELECT plugin_definition_id FROM plugin_definitions
          WHERE plugin_definition_id IN (${placeholders(ids.length)})`,
    params: ids,
  });
  if (Result.isFailure(definitions)) return Result.fail(definitions.failure);
  const published = await database.query({
    sql: `SELECT plugin_definition_id, revision, content_sha256 FROM plugin_setup_guides
          WHERE plugin_definition_id IN (${placeholders(ids.length)})`,
    params: ids,
  });
  if (Result.isFailure(published)) return Result.fail(published.failure);
  const definitionRows = Schema.decodeUnknownResult(Schema.Array(DefinitionRow))(
    definitions.success,
  );
  const guideRows = Schema.decodeUnknownResult(Schema.Array(GuideRow))(published.success);
  if (Result.isFailure(definitionRows) || Result.isFailure(guideRows)) {
    return Result.fail("guide-rows-invalid");
  }

  return Result.succeed(
    guides.map((guide): GuidePublicationPlanEntry => {
      if (!definitionRows.success.some((row) => row.plugin_definition_id === guide.definitionId)) {
        return { guide, step: { kind: "skipped", reason: "plugin-not-published" } };
      }
      const existing = guideRows.success.filter(
        (row) => row.plugin_definition_id === guide.definitionId,
      );
      const same = existing.find((row) => row.revision === guide.revision);
      if (same !== undefined) {
        // A published revision is immutable; changed text needs a new revision number.
        return same.content_sha256 === guide.contentSha256
          ? { guide, step: { kind: "unchanged" } }
          : { guide, step: { kind: "blocked", reason: "guide-revision-content-changed" } };
      }
      if (existing.some((row) => row.revision > guide.revision)) {
        return { guide, step: { kind: "blocked", reason: "guide-revision-not-newer" } };
      }

      return { guide, step: { kind: "publish-revision" } };
    }),
  );
};

export interface GuidePublicationOutcome {
  readonly definitionId: string;
  readonly revision: number;
  readonly step: GuidePublicationStep["kind"];
}

/** Applies a plan, writing and reading back each new revision; blocked plans publish nothing. */
export const publishGuidePlan = async (input: {
  readonly database: D1BatchTransport;
  readonly plan: ReadonlyArray<GuidePublicationPlanEntry>;
  readonly now: () => number;
}): Promise<Result.Result<ReadonlyArray<GuidePublicationOutcome>, string>> => {
  if (input.plan.some((entry) => entry.step.kind === "blocked")) {
    return Result.fail("guide-publication-plan-blocked");
  }
  const outcomes: Array<GuidePublicationOutcome> = [];
  for (const { guide, step } of input.plan) {
    if (step.kind === "publish-revision") {
      // oxlint-disable-next-line no-await-in-loop -- One write per guide, applied in order.
      const written = await input.database.batch([
        {
          sql: `INSERT INTO plugin_setup_guides
                  (plugin_definition_id, revision, markdown, content_sha256, published_at)
                VALUES (?, ?, ?, ?, ?)`,
          params: [
            guide.definitionId,
            guide.revision,
            guide.markdown,
            guide.contentSha256,
            input.now(),
          ],
        },
      ]);
      if (Result.isFailure(written)) return Result.fail(written.failure);
      // oxlint-disable-next-line no-await-in-loop -- Readback confirms this guide before the next.
      const readback = await input.database.query({
        sql: `SELECT content_sha256 FROM plugin_setup_guides
              WHERE plugin_definition_id = ? AND revision = ?`,
        params: [guide.definitionId, guide.revision],
      });
      if (
        Result.isFailure(readback) ||
        readback.success[0]?.["content_sha256"] !== guide.contentSha256
      ) {
        return Result.fail("guide-publication-readback-mismatch");
      }
    }
    outcomes.push({ definitionId: guide.definitionId, revision: guide.revision, step: step.kind });
  }

  return Result.succeed(outcomes);
};
