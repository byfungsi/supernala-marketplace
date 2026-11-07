import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { Redacted, Result, Schema } from "effect";
import { afterEach, describe, expect, it } from "vitest";
import type { D1BatchTransport, D1Statement } from "./cloudflare-adapters.js";
import { readGuidePublicationCredentials } from "./plugin-setup-guide-cli.js";
import { parsePluginSetupGuide, type PluginSetupGuide } from "./plugin-setup-guide.js";
import { planGuidePublication, publishGuidePlan } from "./plugin-setup-guide-publication.js";

const compatibility = path.resolve(
  import.meta.dirname,
  "..",
  "compatibility",
  "plugin-setup-guides",
);
const scratchDirectories: Array<string> = [];

afterEach(async () => {
  await Promise.all(
    scratchDirectories
      .splice(0)
      .map((directory) => fs.rm(directory, { recursive: true, force: true })),
  );
});

/** Application D1 with the exact vendored guide schema; the application owns plugin_definitions. */
const applicationDatabase = async () => {
  const database = new DatabaseSync(":memory:");
  database.exec("PRAGMA foreign_keys = ON");
  database.exec("CREATE TABLE plugin_definitions (plugin_definition_id TEXT PRIMARY KEY)");
  database.exec("INSERT INTO plugin_definitions VALUES ('supernala-public:acme:mail')");
  database.exec(
    await fs.readFile(path.join(compatibility, "0177_plugin_setup_guides.sql"), "utf8"),
  );

  return database;
};

/** D1 batches are transactions: every statement applies, or none does. */
class SQLiteD1Transport implements D1BatchTransport {
  constructor(readonly database: DatabaseSync) {}

  async batch(statements: ReadonlyArray<D1Statement>) {
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
    const rows = this.database.prepare(statement.sql).all(...statement.params);
    return Result.succeed(rows.map((row) => Schema.decodeUnknownSync(Schema.JsonObject)(row)));
  }
}

const guide = (slug: string, revision: number, body: string): PluginSetupGuide => {
  const parsed = parsePluginSetupGuide(
    path.join("guides", "acme", `${slug}.md`),
    `---\nplugin: supernala-public:acme:${slug}\nrevision: ${revision}\n---\n\n${body}\n\n## In Supernala\n\nInstall it.\n`,
  );
  if (Result.isFailure(parsed)) throw new Error(parsed.failure);

  return parsed.success;
};

const steps = async (database: D1BatchTransport, guides: ReadonlyArray<PluginSetupGuide>) => {
  const plan = await planGuidePublication(database, guides);
  if (Result.isFailure(plan)) throw new Error(plan.failure);

  return plan.success;
};

describe("guide publication", () => {
  it("publishes new revisions once and skips Plugins the application does not have yet", async () => {
    const database = new SQLiteD1Transport(await applicationDatabase());
    const first = await steps(database, [guide("mail", 1, "# Mail"), guide("chat", 1, "# Chat")]);

    expect(first.map((entry) => entry.step)).toEqual([
      { kind: "publish-revision" },
      { kind: "skipped", reason: "plugin-not-published" },
    ]);
    const published = await publishGuidePlan({ database, plan: first, now: () => 7 });
    expect(Result.isSuccess(published) && published.success.map((entry) => entry.step)).toEqual([
      "publish-revision",
      "skipped",
    ]);
    expect(
      database.database
        .prepare("SELECT revision, markdown, published_at FROM plugin_setup_guides")
        .all(),
    ).toEqual([
      { revision: 1, markdown: "# Mail\n\n## In Supernala\n\nInstall it.", published_at: 7 },
    ]);

    const again = await steps(database, [guide("mail", 1, "# Mail")]);
    expect(again.map((entry) => entry.step)).toEqual([{ kind: "unchanged" }]);
  });

  it("refuses changed text under a published revision and older revisions", async () => {
    const database = new SQLiteD1Transport(await applicationDatabase());
    await publishGuidePlan({
      database,
      plan: await steps(database, [guide("mail", 2, "# Mail")]),
      now: () => 1,
    });

    const changed = await steps(database, [guide("mail", 2, "# Mail, improved")]);
    expect(changed[0]?.step).toEqual({ kind: "blocked", reason: "guide-revision-content-changed" });
    expect(
      Result.isFailure(await publishGuidePlan({ database, plan: changed, now: () => 2 })),
    ).toBe(true);
    const older = await steps(database, [guide("mail", 1, "# Mail, older")]);
    expect(older[0]?.step).toEqual({ kind: "blocked", reason: "guide-revision-not-newer" });

    const newer = await steps(database, [guide("mail", 3, "# Mail, improved")]);
    expect(newer[0]?.step).toEqual({ kind: "publish-revision" });
    expect(Result.isSuccess(await publishGuidePlan({ database, plan: newer, now: () => 3 }))).toBe(
      true,
    );
    expect(
      database.database.prepare("SELECT revision FROM plugin_setup_guides ORDER BY revision").all(),
    ).toEqual([{ revision: 2 }, { revision: 3 }]);
  });

  it("reads credentials only from an owner-only file outside the checkout", async () => {
    const directory = await fs.mkdtemp(path.join(tmpdir(), "guide-credentials-"));
    scratchDirectories.push(directory);
    const file = path.join(directory, "production.guides.env");
    await fs.writeFile(
      file,
      [
        `CLOUDFLARE_ACCOUNT_ID=${"a".repeat(32)}`,
        "APPLICATION_DATABASE_ID=0b5d1e44-6b8e-4c2e-9b1a-3f5c6d7e8f90",
        "APPLICATION_GUIDE_PUBLISH_TOKEN=token-value",
      ].join("\n"),
      { mode: 0o600 },
    );
    const repositoryRoot = path.resolve(import.meta.dirname, "..");

    const read = await readGuidePublicationCredentials({ file, repositoryRoot });
    expect(Result.isSuccess(read) && Redacted.value(read.success.token)).toBe("token-value");

    await fs.chmod(file, 0o644);
    expect(await readGuidePublicationCredentials({ file, repositoryRoot })).toEqual(
      Result.fail("guide-credentials-require-owner-only-file"),
    );
  });
});
