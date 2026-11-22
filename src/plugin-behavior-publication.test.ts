import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { Redacted, Result, Schema } from "effect";
import { afterEach, describe, expect, it } from "vitest";
import type { D1BatchTransport, D1Statement } from "./cloudflare-adapters.js";
import { parsePluginBehavior, type PluginBehavior } from "./plugin-behavior.js";
import { validatePluginBehaviors } from "./plugin-behavior-catalog.js";
import { readBehaviorPublicationCredentials } from "./plugin-behavior-cli.js";
import {
  describeBehaviorPlan,
  planBehaviorPublication,
  PLUGIN_BEHAVIOR_MIGRATION,
  publishBehaviorPlan,
  storedBehaviorDigestMatches,
} from "./plugin-behavior-publication.js";
import { canonicalPluginJson } from "./plugin-contract.js";

const repositoryRoot = path.resolve(import.meta.dirname, "..");
const compatibility = path.join(repositoryRoot, "compatibility", "plugin-behaviors");
const scratchDirectories: Array<string> = [];

afterEach(async () => {
  await Promise.all(
    scratchDirectories
      .splice(0)
      .map((directory) => fs.rm(directory, { recursive: true, force: true })),
  );
});

/** Application D1 with the exact vendored behaviour migration; the application owns plugin_definitions. */
const applicationDatabase = async (definitions: ReadonlyArray<string>) => {
  const database = new DatabaseSync(":memory:");
  database.exec("PRAGMA foreign_keys = ON");
  database.exec("CREATE TABLE plugin_definitions (plugin_definition_id TEXT PRIMARY KEY)");
  const insert = database.prepare("INSERT INTO plugin_definitions VALUES (?)");
  for (const id of definitions) insert.run(id);
  database.exec(
    await fs.readFile(path.join(compatibility, PLUGIN_BEHAVIOR_MIGRATION.file), "utf8"),
  );

  return database;
};

/** D1 batches are transactions: every statement applies, or none does. Records every statement. */
class SQLiteD1Transport implements D1BatchTransport {
  readonly statements: Array<string> = [];

  constructor(readonly database: DatabaseSync) {}

  async batch(statements: ReadonlyArray<D1Statement>) {
    this.statements.push(...statements.map((statement) => statement.sql));
    this.database.exec("BEGIN IMMEDIATE");
    try {
      const results = statements.map((statement) => ({
        changes: Number(this.database.prepare(statement.sql).run(...statement.params).changes),
      }));
      this.database.exec("COMMIT");
      return Result.succeed(results);
    } catch {
      this.database.exec("ROLLBACK");
      return Result.fail("sqlite-batch-failed");
    }
  }

  async query(statement: D1Statement) {
    this.statements.push(statement.sql);
    const rows = this.database.prepare(statement.sql).all(...statement.params);
    return Result.succeed(rows.map((row) => Schema.decodeUnknownSync(Schema.JsonObject)(row)));
  }
}

/** A real declaration body re-homed to `supernala-public:acme:<slug>` at a revision. */
const behavior = async (
  slug: string,
  revision: number,
  body = "gmail",
): Promise<PluginBehavior> => {
  const source = JSON.parse(
    await fs.readFile(path.join(repositoryRoot, "behaviors", "supernala", `${body}.json`), "utf8"),
  ) as Record<string, Schema.Json>;
  const parsed = parsePluginBehavior(
    `behaviors/acme/${slug}.json`,
    JSON.stringify({ ...source, plugin: `supernala-public:acme:${slug}`, revision }, null, 2),
  );
  if (Result.isFailure(parsed)) throw new Error(parsed.failure.problem);

  return parsed.success;
};

const steps = async (database: D1BatchTransport, behaviors: ReadonlyArray<PluginBehavior>) => {
  const plan = await planBehaviorPublication(database, behaviors);
  if (Result.isFailure(plan)) throw new Error(plan.failure);

  return plan.success;
};

/** The application's read: highest revision, digest recomputed from the stored JSON. */
const applicationRead = (database: DatabaseSync, definitionId: string) => {
  const row = database
    .prepare(
      `SELECT plugin_definition_id, revision, declaration_json, content_sha256
       FROM plugin_behavior_declarations
       WHERE plugin_definition_id = ? ORDER BY revision DESC LIMIT 1`,
    )
    .get(definitionId) as
    | { revision: number; declaration_json: string; content_sha256: string }
    | undefined;
  if (row === undefined) return undefined;
  const parsed = JSON.parse(row.declaration_json) as { plugin: string; revision: number };

  return {
    revision: row.revision,
    digestMatches: storedBehaviorDigestMatches({
      declarationJson: row.declaration_json,
      contentSha256: row.content_sha256,
    }),
    plugin: parsed.plugin,
    declaredRevision: parsed.revision,
  };
};

describe("behaviour publication", () => {
  it("vendors the exact application migration it publishes into", async () => {
    const manifest = JSON.parse(
      await fs.readFile(path.join(compatibility, "manifest.json"), "utf8"),
    ) as { readonly files: Readonly<Record<string, { readonly sha256: string }>> };
    expect(manifest.files[PLUGIN_BEHAVIOR_MIGRATION.file]?.sha256).toBe(
      PLUGIN_BEHAVIOR_MIGRATION.sha256,
    );
    for (const [file, { sha256 }] of Object.entries(manifest.files)) {
      const bytes = await fs.readFile(path.join(compatibility, file));
      expect(createHash("sha256").update(bytes).digest("hex")).toBe(sha256);
    }
  });

  it("publishes new revisions once and skips Plugins the application does not have yet", async () => {
    const database = new SQLiteD1Transport(
      await applicationDatabase(["supernala-public:acme:mail"]),
    );
    const mail = await behavior("mail", 1);
    const first = await steps(database, [mail, await behavior("chat", 1)]);

    expect(first.map((entry) => entry.step)).toEqual([
      { kind: "publish-revision" },
      { kind: "skipped", reason: "plugin-not-published" },
    ]);
    expect(describeBehaviorPlan(first)).toEqual([
      {
        definitionId: "supernala-public:acme:mail",
        revision: 1,
        contentSha256: mail.contentSha256,
        step: "publish-revision",
      },
      {
        definitionId: "supernala-public:acme:chat",
        revision: 1,
        contentSha256: expect.any(String),
        step: "skipped",
        reason: "plugin-not-published",
      },
    ]);
    const published = await publishBehaviorPlan({ database, plan: first, now: () => 7 });
    expect(Result.isSuccess(published) && published.success.map((entry) => entry.step)).toEqual([
      "publish-revision",
      "skipped",
    ]);
    expect(
      database.database
        .prepare(
          "SELECT plugin_definition_id, revision, declaration_json, content_sha256, published_at FROM plugin_behavior_declarations",
        )
        .all(),
    ).toEqual([
      {
        plugin_definition_id: "supernala-public:acme:mail",
        revision: 1,
        declaration_json: mail.canonicalJson,
        content_sha256: createHash("sha256").update(mail.canonicalJson).digest("hex"),
        published_at: 7,
      },
    ]);
    // Canonical: re-canonicalising the stored text is a no-op, so the application's digest matches.
    expect(canonicalPluginJson(JSON.parse(mail.canonicalJson) as Schema.Json)).toBe(
      mail.canonicalJson,
    );
    expect(applicationRead(database.database, "supernala-public:acme:mail")).toEqual({
      revision: 1,
      digestMatches: true,
      plugin: "supernala-public:acme:mail",
      declaredRevision: 1,
    });

    const again = await steps(database, [await behavior("mail", 1)]);
    expect(again.map((entry) => entry.step)).toEqual([{ kind: "unchanged" }]);
    expect(
      database.statements.every((sql) =>
        /^\s*(SELECT|INSERT INTO plugin_behavior_declarations)/u.test(sql),
      ),
    ).toBe(true);
  });

  it("refuses changed content under a published revision and older revisions", async () => {
    const database = new SQLiteD1Transport(
      await applicationDatabase(["supernala-public:acme:mail"]),
    );
    await publishBehaviorPlan({
      database,
      plan: await steps(database, [await behavior("mail", 2)]),
      now: () => 1,
    });

    const changed = await steps(database, [await behavior("mail", 2, "github")]);
    expect(changed[0]?.step).toEqual({
      kind: "blocked",
      reason: "behavior-revision-content-changed",
    });
    expect(await publishBehaviorPlan({ database, plan: changed, now: () => 2 })).toEqual(
      Result.fail("behavior-publication-plan-blocked"),
    );
    const older = await steps(database, [await behavior("mail", 1, "github")]);
    expect(older[0]?.step).toEqual({ kind: "blocked", reason: "behavior-revision-not-newer" });

    const newer = await steps(database, [await behavior("mail", 3, "github")]);
    expect(newer[0]?.step).toEqual({ kind: "publish-revision" });
    expect(
      Result.isSuccess(await publishBehaviorPlan({ database, plan: newer, now: () => 3 })),
    ).toBe(true);
    expect(
      database.database
        .prepare("SELECT revision FROM plugin_behavior_declarations ORDER BY revision")
        .all(),
    ).toEqual([{ revision: 2 }, { revision: 3 }]);
    expect(applicationRead(database.database, "supernala-public:acme:mail")?.revision).toBe(3);
    // The vendored triggers keep published revisions immutable even outside this publisher.
    expect(() =>
      database.database.exec("UPDATE plugin_behavior_declarations SET published_at = 9"),
    ).toThrow(/immutable/u);
    expect(() => database.database.exec("DELETE FROM plugin_behavior_declarations")).toThrow(
      /immutable/u,
    );
  });

  it("publishes every repository declaration in bytes the application accepts", async () => {
    const behaviors = await validatePluginBehaviors(repositoryRoot);
    if (Result.isFailure(behaviors)) throw new Error(behaviors.failure.join("\n"));
    const [missing, ...present] = behaviors.success;
    if (missing === undefined) throw new Error("no behaviours");
    const database = new SQLiteD1Transport(
      await applicationDatabase(present.map((entry) => entry.definitionId)),
    );
    const plan = await steps(database, behaviors.success);
    expect(plan[0]?.step).toEqual({ kind: "skipped", reason: "plugin-not-published" });
    expect(plan.slice(1).every((entry) => entry.step.kind === "publish-revision")).toBe(true);
    expect(Result.isSuccess(await publishBehaviorPlan({ database, plan, now: () => 1 }))).toBe(
      true,
    );

    for (const entry of present) {
      expect(applicationRead(database.database, entry.definitionId)).toEqual({
        revision: entry.revision,
        digestMatches: true,
        plugin: entry.definitionId,
        declaredRevision: entry.revision,
      });
    }
    expect(applicationRead(database.database, missing.definitionId)).toBeUndefined();
    expect(
      (await steps(database, behaviors.success)).map((entry) => entry.step.kind).toSorted(),
    ).toEqual(["skipped", ...present.map(() => "unchanged")]);
  });

  it("reads credentials only from an owner-only file outside the checkout", async () => {
    const directory = await fs.mkdtemp(path.join(tmpdir(), "behavior-credentials-"));
    scratchDirectories.push(directory);
    const file = path.join(directory, "production.behaviors.env");
    const lines = [
      `CLOUDFLARE_ACCOUNT_ID=${"a".repeat(32)}`,
      "APPLICATION_DATABASE_ID=0b5d1e44-6b8e-4c2e-9b1a-3f5c6d7e8f90",
    ];
    await fs.writeFile(
      file,
      [...lines, "APPLICATION_BEHAVIOR_PUBLISH_TOKEN=token-value"].join("\n"),
      {
        mode: 0o600,
      },
    );

    const read = await readBehaviorPublicationCredentials({ file, repositoryRoot });
    expect(Result.isSuccess(read) && Redacted.value(read.success.token)).toBe("token-value");

    await fs.chmod(file, 0o644);
    expect(await readBehaviorPublicationCredentials({ file, repositoryRoot })).toEqual(
      Result.fail("behavior-credentials-require-owner-only-file"),
    );

    // The guide token is a different authority and is not accepted here.
    await fs.writeFile(file, [...lines, "APPLICATION_GUIDE_PUBLISH_TOKEN=token-value"].join("\n"), {
      mode: 0o600,
    });
    await fs.chmod(file, 0o600);
    expect(await readBehaviorPublicationCredentials({ file, repositoryRoot })).toEqual(
      Result.fail("behavior-credentials-unexpected-key"),
    );
  });
});
