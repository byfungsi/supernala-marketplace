import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";

const repositoryRoot = resolve(import.meta.dirname, "..");
const vendorDirectory = resolve(repositoryRoot, "vendor/supernala-application-schema");
const schemaPath = resolve(vendorDirectory, "schema.sql");
const manifestPath = resolve(vendorDirectory, "manifest.json");
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");

// FTS5 recreates its shadow tables from the virtual table declaration.
const ftsShadowTable = /_(?:data|idx|content|docsize|config)$/u;

/** Applies every Supernala application migration in order and returns the resulting schema. */
const renderSchema = async (checkout) => {
  const migrationsDirectory = resolve(checkout, "apps/api/application-migrations");
  const migrations = (await readdir(migrationsDirectory))
    .filter((entry) => entry.endsWith(".sql"))
    .toSorted();
  if (migrations.length === 0) throw new Error("application migrations are missing");
  const database = new DatabaseSync(":memory:");
  try {
    for (const migration of migrations) {
      database.exec(await readFile(resolve(migrationsDirectory, migration), "utf8"));
    }
    const virtualTables = new Set(
      database
        .prepare("SELECT name FROM sqlite_master WHERE sql LIKE 'CREATE VIRTUAL TABLE%'")
        .all()
        .map((row) => String(row.name)),
    );
    const rows = database
      .prepare(
        `SELECT type, name, tbl_name, sql FROM sqlite_master
         WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%'
         ORDER BY CASE type WHEN 'table' THEN 0 WHEN 'index' THEN 1 WHEN 'view' THEN 2 ELSE 3 END,
                  name`,
      )
      .all()
      .filter(
        (row) =>
          !(
            row.type === "table" &&
            ftsShadowTable.test(String(row.name)) &&
            [...virtualTables].some((name) => String(row.name).startsWith(`${name}_`))
          ),
      );
    const statements = rows.map((row) => `${String(row.sql).trim()};`).join("\n\n");
    return { schema: `${statements}\n`, latestMigration: migrations.at(-1) };
  } finally {
    database.close();
  }
};

const vendor = async (checkout) => {
  if (checkout === undefined) throw new Error("usage: vendor <supernala-checkout>");
  const sourceCommit = execFileSync("git", ["-C", checkout, "rev-parse", "HEAD"], {
    encoding: "utf8",
  }).trim();
  const { schema, latestMigration } = await renderSchema(checkout);
  await mkdir(vendorDirectory, { recursive: true });
  await writeFile(schemaPath, schema);
  await writeFile(
    manifestPath,
    `${JSON.stringify(
      { owner: "@supernala/api", sourceCommit, latestMigration, schemaSha256: sha256(schema) },
      null,
      2,
    )}\n`,
  );
  process.stdout.write(`${JSON.stringify({ sourceCommit, latestMigration })}\n`);
};

const check = async () => {
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  if (sha256(await readFile(schemaPath)) !== manifest.schemaSha256) {
    throw new Error("vendored application schema digest mismatch");
  }
  process.stdout.write(`${JSON.stringify({ latestMigration: manifest.latestMigration })}\n`);
};

const [command, checkout] = process.argv.slice(2);
if (command === "vendor") await vendor(checkout);
else if (command === "check") await check();
else throw new Error("usage: vendor-application-schema.mjs vendor <supernala-checkout> | check");
