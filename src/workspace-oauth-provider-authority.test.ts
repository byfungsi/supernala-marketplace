import { readFile } from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";
import { expect, it } from "@effect/vitest";
import { Result, Schema } from "effect";
import type { D1BatchTransport, D1Statement } from "./cloudflare-adapters.js";
import { PackagedPluginAuthentication } from "./package-archive.js";
import {
  loadReviewedWorkspaceOAuthProviderAuthority,
  WorkspaceOAuthProviderAuthorityAdmission,
} from "./workspace-oauth-provider-authority.js";

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
    try {
      const rows = this.database.prepare(statement.sql).all(...statement.params);
      return Result.succeed(Schema.decodeUnknownSync(Schema.Array(Schema.JsonObject))(rows));
    } catch {
      return Result.fail("sqlite-query-failed");
    }
  }
}

const applicationDatabase = async (): Promise<DatabaseSync> => {
  const database = new DatabaseSync(":memory:");
  database.exec("PRAGMA foreign_keys = ON");
  database.exec(await readFile("fixtures/sql/phase1-0042-plugin-control-plane.sql", "utf8"));
  database.exec(
    await readFile("fixtures/sql/phase1-0044-plugin-oauth-publication-authority.sql", "utf8"),
  );
  database.exec(
    `CREATE TABLE workspace_memberships
      (workspace_id TEXT NOT NULL, user_id TEXT NOT NULL, role TEXT NOT NULL, status TEXT NOT NULL)`,
  );
  database.exec(
    await readFile(
      "fixtures/sql/phase1-0047-plugin-oauth-environment-registration-authority.sql",
      "utf8",
    ),
  );
  database.exec(
    await readFile("fixtures/sql/phase1-0048-plugin-oauth-runtime-lifecycle.sql", "utf8"),
  );
  database.exec(await readFile("fixtures/sql/phase1-0050-workspace-oauth-apps.sql", "utf8"));
  database.exec(
    await readFile("fixtures/sql/phase1-0051-workspace-owned-oauth-authority.sql", "utf8"),
  );
  return database;
};

it("admits Gmail as exact credential-free Workspace OAuth authority", async () => {
  const authentication = Schema.decodeUnknownSync(PackagedPluginAuthentication)({
    kind: "oauth",
    providerRegistration: "google-gmail-rest-v1",
    providerDefinitionDigest: "3136b19f7d4b6f3b6597f75c42895bec8b41ab46bd5a984b39f4497ca6a6bc07",
    requestedScopes: ["https://www.googleapis.com/auth/gmail.readonly"],
    credentialDelivery: "short-lived-access-token-only",
  });
  if (authentication.kind !== "oauth") throw new Error("test-oauth-authentication-invalid");
  const authority = await loadReviewedWorkspaceOAuthProviderAuthority({
    sourceDirectory: "plugins/gmail",
    authentication,
  });
  expect(Result.isSuccess(authority)).toBe(true);
  if (Result.isFailure(authority)) throw new Error(authority.failure);
  const database = await applicationDatabase();
  const admission = new WorkspaceOAuthProviderAuthorityAdmission(
    new SQLiteD1Transport(database),
    "https://api.supernala.example/v1/plugins/oauth/callback",
  );
  const input = {
    authority: authority.success,
    sourceRepository: "supernala/marketplace",
    sourceRevision: "a".repeat(40),
    reviewId: "gmail-0.1.0-owner-authorized-waiver-v1",
    reviewer: "supernala-owner (formal reviews waived, not passed)",
    reviewedAt: 1,
  };

  expect(await admission.admit(input)).toEqual(Result.succeed(undefined));
  expect(await admission.admit(input)).toEqual(Result.succeed(undefined));
  expect(await admission.admit({ ...input, sourceRevision: "b".repeat(40) })).toEqual(
    Result.succeed(undefined),
  );
  expect(await admission.admit({ ...input, sourceRepository: "other/marketplace" })).toEqual(
    Result.fail("workspace-oauth-provider-admission-failed"),
  );
  expect(
    database
      .prepare(
        `SELECT source_repository, source_revision
         FROM plugin_oauth_provider_definitions WHERE provider_definition_digest = ?`,
      )
      .get(authority.success.providerDefinitionDigest),
  ).toEqual({
    source_repository: "supernala/marketplace",
    source_revision: "a".repeat(40),
  });
  expect(
    database
      .prepare(
        `SELECT registration_mode, approved_scopes_json, client_credential_reference
         FROM provider_registrations WHERE provider_registration_id = ?`,
      )
      .get("google-gmail-rest-v1"),
  ).toEqual({
    registration_mode: "workspace-oauth-app",
    approved_scopes_json: '["https://www.googleapis.com/auth/gmail.readonly"]',
    client_credential_reference: null,
  });
  expect(
    database
      .prepare(
        `SELECT name FROM sqlite_schema WHERE type = 'table'
         AND name = 'plugin_oauth_registration_material_sources'`,
      )
      .get(),
  ).toBeUndefined();
  database.close();
});
