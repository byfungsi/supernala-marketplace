import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";
import { expect, it } from "@effect/vitest";
import { Result, Schema } from "effect";
import type { D1BatchTransport } from "./cloudflare-adapters.js";
import {
  LocalReleaseCoordinator,
  ReleaseAttemptId,
  ReleaseCommit,
  ReleaseOrdinal,
} from "./local-release-coordinator.js";
import { PluginSha256 } from "./plugin-contract.js";

const commit = ReleaseCommit.make("a".repeat(40));
const digest = PluginSha256.make("b".repeat(64));
const id = () => ReleaseAttemptId.make(randomUUID());
const unwrap = <A, E>(value: Result.Result<A, E>) => {
  if (Result.isFailure(value)) throw new Error("test-result-failed");
  return value.success;
};

const setup = async () => {
  const database = new DatabaseSync(":memory:");
  database.exec(await readFile("tools/infra/migrations/0001_release_journal.sql", "utf8"));
  database.exec(await readFile("tools/infra/migrations/0002_local_release_attempts.sql", "utf8"));
  const transport: D1BatchTransport = {
    async batch(statements) {
      database.exec("BEGIN IMMEDIATE");
      try {
        const rows = statements.map((statement) => ({
          changes: Number(database.prepare(statement.sql).run(...statement.params).changes),
        }));
        database.exec("COMMIT");
        return Result.succeed(rows);
      } catch {
        database.exec("ROLLBACK");
        return Result.fail("sqlite-batch-failed");
      }
    },
    async query(statement) {
      return Result.succeed(
        database
          .prepare(statement.sql)
          .all(...statement.params)
          .map((row) => Schema.decodeUnknownSync(Schema.JsonObject)(row)),
      );
    },
  };
  return { database, transport, coordinator: new LocalReleaseCoordinator(transport) };
};

it("serializes operators, binds exact approval, and permits only one publication process", async () => {
  const { database, transport, coordinator } = await setup();
  try {
    const attemptId = id();
    const [first, second] = await Promise.all([
      coordinator.acquire({ attemptId, commit, createdAt: 1 }),
      new LocalReleaseCoordinator(transport).acquire({ attemptId: id(), commit, createdAt: 2 }),
    ]);
    expect(unwrap(first).release_ordinal).toBe(0);
    expect(Result.isFailure(second)).toBe(true);
    const input = { attemptId, commit, ordinal: ReleaseOrdinal.make(0), digest };
    expect(Result.isFailure(await coordinator.beginPublication(input))).toBe(true);
    unwrap(await coordinator.approve(attemptId, digest));
    for (const invalid of [
      { ...input, commit: ReleaseCommit.make("c".repeat(40)) },
      { ...input, ordinal: ReleaseOrdinal.make(1) },
      { ...input, digest: PluginSha256.make("d".repeat(64)) },
    ])
      expect(Result.isFailure(await coordinator.beginPublication(invalid))).toBe(true);
    unwrap(await coordinator.beginPublication(input));
    expect(Result.isFailure(await coordinator.beginPublication(input))).toBe(true);
    expect(Result.isFailure(await coordinator.finish(attemptId, "cancelled"))).toBe(true);
    unwrap(await coordinator.finish(attemptId, "completed"));
    const next = unwrap(await coordinator.acquire({ attemptId: id(), commit, createdAt: 0 }));
    expect(next.release_ordinal).toBe(1);
  } finally {
    database.close();
  }
});

it("retains an uncertain acquisition and requires explicit stopped-attempt recovery", async () => {
  const { database, transport, coordinator } = await setup();
  try {
    const attemptId = id();
    const uncertain = new LocalReleaseCoordinator({
      ...transport,
      batch: async (statements) => {
        await transport.batch(statements);
        return Result.fail("simulated-lost-response");
      },
    });
    expect(Result.isFailure(await uncertain.acquire({ attemptId, commit, createdAt: 1 }))).toBe(
      true,
    );
    expect(unwrap(await coordinator.active()).map((row) => row.attempt_id)).toEqual([attemptId]);
    expect(
      Result.isFailure(
        await coordinator.acquire({ attemptId: id(), commit, createdAt: Number.MAX_SAFE_INTEGER }),
      ),
    ).toBe(true);
    expect(Result.isFailure(await coordinator.abandonStoppedAttempt(id()))).toBe(true);
    unwrap(await coordinator.abandonStoppedAttempt(attemptId));
    expect(unwrap(await coordinator.read(attemptId)).status).toBe("abandoned");
    expect(Result.isFailure(await coordinator.approve(attemptId, digest))).toBe(true);
    expect(
      unwrap(await coordinator.acquire({ attemptId: id(), commit, createdAt: 1 })).release_ordinal,
    ).toBe(1);
  } finally {
    database.close();
  }
});

it("allocates above historical workflow ordinals and preserves completed attempts", async () => {
  const { database, coordinator } = await setup();
  try {
    // Valid legacy SQL row: content is immaterial to ordinal allocation, never used for publication.
    const hash = "a".repeat(64);
    database
      .prepare(`INSERT INTO marketplace_release_journal VALUES (
      'fixture', 'public', 'fixture', 'fixture', '1.0.0', 'fixture', 'managed-package', '{}',
      ?, ?, ?, ?, '{}', ?, ?, ?, ?, NULL, NULL, ?, 400, 'review', 'reviewer', 1,
      'failed', 1, NULL, 1, 1, 1)`)
      .run(hash, hash, hash, hash, hash, hash, hash, hash, commit);
    const first = unwrap(await coordinator.acquire({ attemptId: id(), commit, createdAt: 1 }));
    expect(first.release_ordinal).toBe(401);
    unwrap(await coordinator.finish(first.attempt_id, "cancelled"));
    expect(
      unwrap(await coordinator.acquire({ attemptId: id(), commit, createdAt: 1 })).release_ordinal,
    ).toBe(402);
  } finally {
    database.close();
  }
});

it("does not release a partially published attempt on failure or elapsed wall time", async () => {
  const { database, coordinator } = await setup();
  try {
    const attemptId = id();
    unwrap(await coordinator.acquire({ attemptId, commit, createdAt: 0 }));
    unwrap(await coordinator.approve(attemptId, digest));
    unwrap(
      await coordinator.beginPublication({
        attemptId,
        commit,
        ordinal: ReleaseOrdinal.make(0),
        digest,
      }),
    );
    expect(unwrap(await coordinator.active())[0]?.status).toBe("publishing");
    expect(
      Result.isFailure(
        await coordinator.acquire({ attemptId: id(), commit, createdAt: Date.now() }),
      ),
    ).toBe(true);
    unwrap(await coordinator.abandonStoppedAttempt(attemptId));
    expect(Result.isFailure(await coordinator.finish(attemptId, "completed"))).toBe(true);
  } finally {
    database.close();
  }
});
