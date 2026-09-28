import { readFile } from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";
import { expect, it } from "@effect/vitest";
import { Result, Schema } from "effect";
import type { D1BatchTransport, D1Statement } from "./cloudflare-adapters.js";
import { PackagedPluginAuthentication } from "./package-archive.js";
import { decodePluginOAuthProviderDefinition } from "./oauth-provider-definition.js";
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
  expect(
    await admission.admit({
      ...input,
      sourceRevision: "c".repeat(40),
      reviewId: "gmail-0.1.1-source-authority-v1",
      reviewer: "OpenCode independent supervising source and authority review",
      reviewedAt: 1790611618111,
    }),
  ).toEqual(Result.succeed(undefined));
  expect(await admission.admit({ ...input, sourceRepository: "other/marketplace" })).toEqual(
    Result.fail("workspace-oauth-provider-admission-failed"),
  );
  const changedScopes = decodePluginOAuthProviderDefinition({
    ...JSON.parse(authority.success.canonicalDefinitionJson),
    scopes: ["mail.write"],
  });
  if (Result.isFailure(changedScopes)) throw new Error("test-changed-scopes-invalid");
  for (const changedAuthority of [
    { ...authority.success, sourcePath: "plugins/other/oauth-provider.json" },
    { ...authority.success, sourceContentDigest: authority.success.providerDefinitionDigest },
    { ...authority.success, canonicalDefinitionJson: "{}" },
    { ...authority.success, definition: changedScopes.success },
  ]) {
    expect(await admission.admit({ ...input, authority: changedAuthority })).toEqual(
      Result.fail("workspace-oauth-provider-admission-failed"),
    );
  }
  expect(
    await new WorkspaceOAuthProviderAuthorityAdmission(
      new SQLiteD1Transport(database),
      "https://other.supernala.example/v1/plugins/oauth/callback",
    ).admit(input),
  ).toEqual(Result.fail("workspace-oauth-provider-admission-failed"));
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
        `SELECT admission_operation_id, admitted_by, reviewed_at
         FROM plugin_oauth_provider_definitions WHERE provider_definition_digest = ?`,
      )
      .get(authority.success.providerDefinitionDigest),
  ).toEqual({
    admission_operation_id: input.reviewId,
    admitted_by: input.reviewer,
    reviewed_at: input.reviewedAt,
  });
  expect(database.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
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
  expect(() =>
    database
      .prepare(
        `UPDATE provider_registrations SET client_credential_reference = ?
         WHERE provider_registration_id = ?`,
      )
      .run("synthetic-material-reference", "google-gmail-rest-v1"),
  ).toThrow("OAuth Provider Registration semantic authority is immutable");
  expect(
    await admission.admit({
      ...input,
      reviewId: "gmail-0.1.1-source-authority-v1",
      reviewedAt: 1790611618111,
    }),
  ).toEqual(Result.succeed(undefined));
  expect(
    database
      .prepare(
        `SELECT admission_operation_id FROM plugin_oauth_provider_definitions
         WHERE provider_definition_digest = ?`,
      )
      .get(authority.success.providerDefinitionDigest),
  ).toEqual({ admission_operation_id: input.reviewId });
  database.close();
});

it("rolls back successor admission if the provider authority is revoked after its read", async () => {
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
  if (Result.isFailure(authority)) throw new Error(authority.failure);
  const admittedAuthority = authority.success;
  const database = await applicationDatabase();
  const callback = "https://api.supernala.example/v1/plugins/oauth/callback";
  const first = {
    authority: admittedAuthority,
    sourceRepository: "supernala/marketplace",
    sourceRevision: "a".repeat(40),
    reviewId: "gmail-0.1.0-owner-authorized-waiver-v1",
    reviewer: "supernala-owner (formal reviews waived, not passed)",
    reviewedAt: 1,
  };
  expect(
    await new WorkspaceOAuthProviderAuthorityAdmission(
      new SQLiteD1Transport(database),
      callback,
    ).admit(first),
  ).toEqual(Result.succeed(undefined));
  class RevokingSQLiteD1Transport extends SQLiteD1Transport {
    override async batch(statements: ReadonlyArray<D1Statement>) {
      this.database
        .prepare(
          `UPDATE plugin_oauth_provider_definitions
           SET status = 'revoked', revision = 2, updated_at = 2, revoked_at = 2,
               revocation_operation_id = 'test-revocation', revoked_by = 'test-owner',
               revocation_reason = 'test-revocation'
           WHERE provider_definition_digest = ?`,
        )
        .run(admittedAuthority.providerDefinitionDigest);
      return super.batch(statements);
    }
  }
  const successor = new WorkspaceOAuthProviderAuthorityAdmission(
    new RevokingSQLiteD1Transport(database),
    callback,
  );
  expect(
    await successor.admit({
      ...first,
      sourceRevision: "b".repeat(40),
      reviewId: "gmail-0.1.1-source-authority-v1",
      reviewedAt: 2,
    }),
  ).toEqual(Result.fail("workspace-oauth-provider-admission-failed"));
  expect(
    database
      .prepare(
        `SELECT status, revision, admission_operation_id, reviewed_at
         FROM plugin_oauth_provider_definitions WHERE provider_definition_digest = ?`,
      )
      .get(admittedAuthority.providerDefinitionDigest),
  ).toEqual({
    status: "revoked",
    revision: 2,
    admission_operation_id: first.reviewId,
    reviewed_at: first.reviewedAt,
  });
  expect(database.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
  database.close();
});
