import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { HeadObjectCommand, PutObjectCommand, type S3Client } from "@aws-sdk/client-s3";
import { Redacted, Result, Schema } from "effect";
import { afterEach, describe, expect, it } from "vitest";
import type { D1BatchTransport, D1Statement } from "./cloudflare-adapters.js";
import { readSkillPublicationCredentials } from "./marketplace-skill-cli.js";
import {
  CloudflareR2SkillBundleStore,
  marketplaceSkillObjectKey,
  planSkillPublication,
  publishSkillPlan,
  type SkillBundleStore,
} from "./marketplace-skill-publication.js";
import {
  loadMarketplaceSkill,
  type MarketplaceSkillManifest,
  type MarketplaceSkillRelease,
} from "./marketplace-skill.js";

const compatibility = path.resolve(
  import.meta.dirname,
  "..",
  "compatibility",
  "marketplace-skills",
);
const scratchDirectories: Array<string> = [];

afterEach(async () => {
  await Promise.all(
    scratchDirectories
      .splice(0)
      .map((directory) => fs.rm(directory, { recursive: true, force: true })),
  );
});

/** Application D1 with the exact vendored Marketplace Skill schema and its immutability triggers. */
const applicationDatabase = async () => {
  const database = new DatabaseSync(":memory:");
  database.exec("PRAGMA foreign_keys = ON");
  // The application's table and its seeded `supernala-public` marketplace.
  database.exec(await fs.readFile(path.join(compatibility, "plugin_marketplaces.sql"), "utf8"));
  // Only the columns the Skill migration extends; the application owns the full table.
  database.exec(
    "CREATE TABLE workspace_skills (workspace_skill_id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL)",
  );
  database.exec(await fs.readFile(path.join(compatibility, "0163_marketplace_skills.sql"), "utf8"));

  return database;
};

/** D1 batches are transactions: every statement applies, or none does. */
class SQLiteD1Transport implements D1BatchTransport {
  readonly batches: Array<ReadonlyArray<D1Statement>> = [];
  constructor(readonly database: DatabaseSync) {}

  async batch(statements: ReadonlyArray<D1Statement>) {
    this.batches.push(statements);
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

/** Write-once content store that, like R2, keeps exactly the bytes first written under a key. */
class MemoryBundleStore implements SkillBundleStore {
  readonly objects = new Map<string, Uint8Array>();
  failNext = false;

  async putVerified(sha256: string, bytes: Uint8Array) {
    if (this.failNext) return Result.fail("skill-bundle-unavailable");
    if (createHash("sha256").update(bytes).digest("hex") !== sha256) {
      return Result.fail("skill-file-digest-mismatch");
    }
    if (this.objects.has(sha256)) return Result.succeed("already-present" as const);
    this.objects.set(sha256, bytes);

    return Result.succeed("uploaded" as const);
  }
}

const manifest = (overrides: Partial<MarketplaceSkillManifest> = {}): MarketplaceSkillManifest => ({
  schemaVersion: 1,
  marketplaceId: "supernala-public",
  publisher: { namespace: "acme", name: "Acme" },
  slug: "weekly-report",
  version: "1.0.0",
  name: "Weekly report",
  shortDescription: "Summarize a week of work.",
  longDescription: "",
  categories: ["Writing"],
  featuredRank: 0,
  license: "MIT",
  attribution: "Copyright (c) Acme. MIT.",
  source: {
    _tag: "github",
    repository: "acme/skills",
    commit: "b".repeat(40),
    path: "weekly-report",
  },
  addedFiles: [],
  ...overrides,
});

const release = async (
  overrides: Partial<MarketplaceSkillManifest> = {},
  body = "# Weekly report\n\nSummarize wins and blockers.",
): Promise<MarketplaceSkillRelease> => {
  const root = await fs.mkdtemp(path.join(tmpdir(), "skill-publish-"));
  scratchDirectories.push(root);
  const directory = path.join(root, "skills", "acme", "weekly-report");
  await fs.mkdir(path.join(directory, "files", "templates"), { recursive: true });
  await fs.writeFile(path.join(directory, "skill.json"), JSON.stringify(manifest(overrides)));
  await fs.writeFile(
    path.join(directory, "files", "SKILL.md"),
    `---\nname: weekly-report\ndescription: Turn a week into a report.\n---\n${body}\n`,
  );
  await fs.writeFile(path.join(directory, "files", "LICENSE"), "MIT License");
  await fs.writeFile(path.join(directory, "files", "templates", "report.md"), "## Wins");

  return Result.getOrThrow(await loadMarketplaceSkill(directory));
};

const publish = async (
  database: SQLiteD1Transport,
  store: SkillBundleStore,
  releases: ReadonlyArray<MarketplaceSkillRelease>,
) => {
  const plan = Result.getOrThrow(await planSkillPublication(database, releases));

  return {
    plan,
    outcome: await publishSkillPlan({ database, store, plan, now: () => 1_700_000_000_000 }),
  };
};

/** The application's catalog query: the newest published version of every active definition. */
const applicationCatalog = (database: DatabaseSync) =>
  database
    .prepare(
      `SELECT d.skill_definition_id AS id, d.name, d.categories_json AS categories,
              d.featured_rank AS featuredRank, v.skill_version_id AS versionId,
              v.version_ordinal AS versionOrdinal, v.files_json AS files, v.source_json AS source,
              v.license_spdx AS license
       FROM marketplace_skill_definitions d
       JOIN plugin_marketplaces m ON m.marketplace_id = d.marketplace_id AND m.status = 'active'
       JOIN marketplace_skill_versions v ON v.skill_version_id = (
         SELECT latest.skill_version_id FROM marketplace_skill_versions latest
         WHERE latest.skill_definition_id = d.skill_definition_id AND latest.status = 'published'
         ORDER BY latest.version_ordinal DESC LIMIT 1)
       WHERE d.status = 'active'`,
    )
    .all();

describe("Skill publication", () => {
  it("uploads every file, then writes rows the application's catalog query returns", async () => {
    const database = new SQLiteD1Transport(await applicationDatabase());
    const store = new MemoryBundleStore();
    const skill = await release();
    const { plan, outcome } = await publish(database, store, [skill]);
    expect(plan.map((entry) => entry.step)).toEqual([
      { kind: "publish-version", definition: "create" },
    ]);
    expect(Result.getOrThrow(outcome)).toEqual([
      {
        id: "acme/weekly-report",
        versionId: "acme/weekly-report@1.0.0",
        step: "publish-version",
        uploaded: 2,
        reused: 0,
      },
    ]);
    expect([...store.objects.keys()].toSorted()).toEqual(
      skill.files.map((file) => file.sha256).toSorted(),
    );
    const [row] = applicationCatalog(database.database);
    expect(row).toMatchObject({
      id: "acme/weekly-report",
      name: "Weekly report",
      featuredRank: 0,
      versionId: "acme/weekly-report@1.0.0",
      versionOrdinal: 1,
      license: "MIT",
    });
    expect(JSON.parse(String(row?.["files"]))).toEqual(skill.files);
    expect(JSON.parse(String(row?.["source"]))).toEqual({
      _tag: "github",
      commit: "b".repeat(40),
      path: "weekly-report",
      repository: "acme/skills",
    });
  });

  it("is idempotent: publishing the same release again writes nothing", async () => {
    const database = new SQLiteD1Transport(await applicationDatabase());
    const store = new MemoryBundleStore();
    await publish(database, store, [await release()]);
    const batches = database.batches.length;
    const { plan, outcome } = await publish(database, store, [await release()]);
    expect(plan.map((entry) => entry.step.kind)).toEqual(["unchanged"]);
    expect(Result.getOrThrow(outcome)[0]?.step).toBe("unchanged");
    expect(database.batches).toHaveLength(batches);
  });

  it("updates curated presentation without touching the published version", async () => {
    const database = new SQLiteD1Transport(await applicationDatabase());
    const store = new MemoryBundleStore();
    await publish(database, store, [await release()]);
    const { plan } = await publish(database, store, [
      await release({
        name: "Weekly status report",
        categories: ["Writing", "Productivity"],
        featuredRank: null,
      }),
    ]);
    expect(plan.map((entry) => entry.step.kind)).toEqual(["update-definition"]);
    expect(applicationCatalog(database.database)[0]).toMatchObject({
      name: "Weekly status report",
      categories: JSON.stringify(["Writing", "Productivity"]),
      featuredRank: null,
      versionOrdinal: 1,
    });
  });

  it("refuses to change the content of a published version", async () => {
    const database = new SQLiteD1Transport(await applicationDatabase());
    const store = new MemoryBundleStore();
    await publish(database, store, [await release()]);
    const { plan, outcome } = await publish(database, store, [
      await release({}, "Different instructions."),
    ]);
    expect(plan[0]?.step).toEqual({ kind: "blocked", reason: "skill-version-content-changed" });
    expect(outcome).toEqual(Result.fail("skill-publication-plan-blocked"));
  });

  it("publishes a newer version as current and refuses an older one", async () => {
    const database = new SQLiteD1Transport(await applicationDatabase());
    const store = new MemoryBundleStore();
    await publish(database, store, [await release()]);
    const newer = await publish(database, store, [
      await release({ version: "1.1.0" }, "Improved."),
    ]);
    expect(Result.getOrThrow(newer.outcome)[0]).toMatchObject({
      step: "publish-version",
      uploaded: 0,
      reused: 2,
    });
    expect(applicationCatalog(database.database)[0]).toMatchObject({
      versionId: "acme/weekly-report@1.1.0",
      versionOrdinal: 2,
    });
    const older = await publish(database, store, [await release({ version: "0.9.0" }, "Old.")]);
    expect(older.plan[0]?.step).toEqual({ kind: "blocked", reason: "skill-version-not-newer" });
  });

  it("writes no rows when a file cannot be stored, or when the marketplace is disabled", async () => {
    const database = new SQLiteD1Transport(await applicationDatabase());
    const store = new MemoryBundleStore();
    store.failNext = true;
    expect((await publish(database, store, [await release()])).outcome).toEqual(
      Result.fail("skill-bundle-unavailable"),
    );
    expect(database.batches).toHaveLength(0);

    store.failNext = false;
    database.database.exec("UPDATE plugin_marketplaces SET status = 'disabled'");
    expect((await publish(database, store, [await release()])).outcome).toEqual(
      Result.fail("sqlite-batch-failed"),
    );
    const definitions = database.database
      .prepare("SELECT COUNT(*) AS count FROM marketplace_skill_definitions")
      .get();
    expect(definitions?.["count"]).toBe(0);
  });

  it("leaves a withdrawn version withdrawn", async () => {
    const database = new SQLiteD1Transport(await applicationDatabase());
    const store = new MemoryBundleStore();
    await publish(database, store, [await release()]);
    database.database.exec("UPDATE marketplace_skill_versions SET status = 'withdrawn'");
    const { plan } = await publish(database, store, [await release()]);
    expect(plan[0]?.step).toEqual({ kind: "blocked", reason: "skill-version-withdrawn" });
  });
});

describe("CloudflareR2SkillBundleStore", () => {
  const bytes = new TextEncoder().encode("## Wins");
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  const checksum = createHash("sha256").update(bytes).digest("base64");

  /** Minimal S3 double: records commands and answers like R2 for one content key. */
  const s3 = (initial?: { readonly checksum: string; readonly size: number }) => {
    let stored: { checksum: string; size: number; body: Uint8Array } | undefined =
      initial === undefined ? undefined : { ...initial, body: bytes };
    const sent: Array<Record<string, unknown>> = [];
    const client = {
      send: async (command: { readonly input: Record<string, unknown> }) => {
        sent.push({ name: command.constructor.name, ...command.input });
        if (command instanceof HeadObjectCommand) {
          if (stored === undefined)
            throw Object.assign(new Error("NotFound"), { $metadata: { httpStatusCode: 404 } });
          return { ContentLength: stored.size, ChecksumSHA256: stored.checksum };
        }
        if (command instanceof PutObjectCommand) {
          const body = command.input.Body as Uint8Array;
          stored = { checksum: String(command.input.ChecksumSHA256), size: body.byteLength, body };
          return {};
        }
        return { Body: { transformToByteArray: async () => stored?.body ?? new Uint8Array() } };
      },
    } as unknown as S3Client;

    return { client, sent };
  };

  const store = (client: S3Client) =>
    new CloudflareR2SkillBundleStore(
      {
        accountId: "a".repeat(32),
        bucketName: "bundles",
        accessKeyId: "id",
        secretAccessKey: "secret",
      },
      client,
    );

  it("creates absent objects write-once with their SHA-256 checksum, then verifies them", async () => {
    const { client, sent } = s3();
    expect(await store(client).putVerified(sha256, bytes)).toEqual(Result.succeed("uploaded"));
    expect(sent.find((command) => command["name"] === "PutObjectCommand")).toMatchObject({
      Key: marketplaceSkillObjectKey(sha256),
      ChecksumSHA256: checksum,
      IfNoneMatch: "*",
    });
  });

  it("reuses an identical object and refuses one stored without the matching checksum", async () => {
    expect(
      await store(s3({ checksum, size: bytes.byteLength }).client).putVerified(sha256, bytes),
    ).toEqual(Result.succeed("already-present"));
    expect(
      await store(s3({ checksum: "other", size: bytes.byteLength }).client).putVerified(
        sha256,
        bytes,
      ),
    ).toEqual(Result.fail("skill-bundle-object-mismatch"));
    expect(await store(s3().client).putVerified("0".repeat(64), bytes)).toEqual(
      Result.fail("skill-file-digest-mismatch"),
    );
  });
});

describe("readSkillPublicationCredentials", () => {
  const topology = [
    `CLOUDFLARE_ACCOUNT_ID=${"a".repeat(32)}`,
    "APPLICATION_DATABASE_ID=6f1d2c3b-4a5e-4f60-8a7b-9c0d1e2f3a4b",
    "AGENT_SKILL_BUNDLE_BUCKET_NAME=supernala-agent-skill-bundles-production",
  ];
  const secrets = [
    "APPLICATION_SKILL_PUBLISH_TOKEN=d1-token-value",
    "AGENT_SKILL_BUNDLE_R2_ACCESS_KEY_ID=r2-access-key-value",
    "AGENT_SKILL_BUNDLE_R2_SECRET_ACCESS_KEY=r2-secret-value",
  ];
  const credentialFile = async (lines: ReadonlyArray<string>, mode = 0o600) => {
    const directory = await fs.mkdtemp(path.join(tmpdir(), "skill-credentials-"));
    scratchDirectories.push(directory);
    const file = path.join(directory, "production.skills.env");
    await fs.writeFile(file, `${lines.join("\n")}\n`, { mode });
    await fs.chmod(file, mode);

    return { file, repositoryRoot: path.resolve(import.meta.dirname, "..") };
  };

  it("reads an owner-only file with exactly the publication keys", async () => {
    const credentials = Result.getOrThrow(
      await readSkillPublicationCredentials(await credentialFile([...topology, ...secrets])),
    );
    expect(credentials.topology.AGENT_SKILL_BUNDLE_BUCKET_NAME).toBe(
      "supernala-agent-skill-bundles-production",
    );
    expect(Redacted.value(credentials.secrets.APPLICATION_SKILL_PUBLISH_TOKEN)).toBe(
      "d1-token-value",
    );
    // Secrets stay redacted when logged or serialized.
    const serialized = JSON.stringify(credentials);
    for (const value of ["d1-token-value", "r2-access-key-value", "r2-secret-value"]) {
      expect(serialized).not.toContain(value);
    }
  });

  it("refuses shared, incomplete or unexpected credential files", async () => {
    expect(
      await readSkillPublicationCredentials(await credentialFile([...topology, ...secrets], 0o644)),
    ).toEqual(Result.fail("skill-credentials-require-owner-only-file"));
    expect(
      await readSkillPublicationCredentials(
        await credentialFile([...topology, ...secrets.slice(1)]),
      ),
    ).toEqual(Result.fail("skill-credentials-incomplete"));
    expect(
      await readSkillPublicationCredentials(
        await credentialFile([...topology, ...secrets, "PLUGIN_PACKAGE_R2_ACCESS_KEY_ID=x"]),
      ),
    ).toEqual(Result.fail("skill-credentials-unexpected-key"));
  });
});
