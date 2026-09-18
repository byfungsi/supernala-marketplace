import { Result, Schema } from "effect";
import type { D1BatchTransport } from "./cloudflare-adapters.js";
import { PluginSha256 } from "./plugin-contract.js";

/** Exact source commit pinned before a local release is prepared. */
export const ReleaseCommit = Schema.String.pipe(
  Schema.check(Schema.isPattern(/^[a-f0-9]{40}$/u)),
  Schema.brand("ReleaseCommit"),
);
/** Opaque local release attempt identity, distinct from immutable Plugin identities. */
export const ReleaseAttemptId = Schema.String.pipe(
  Schema.check(Schema.isUUID()),
  Schema.brand("ReleaseAttemptId"),
);
/** Safe durable ordering shared by every operator; never derived from a local clock. */
export const ReleaseOrdinal = Schema.Int.pipe(
  Schema.check(Schema.isGreaterThanOrEqualTo(0)),
  Schema.check(Schema.isLessThanOrEqualTo(Number.MAX_SAFE_INTEGER)),
  Schema.brand("ReleaseOrdinal"),
);
/** Safe errors deliberately omit SQL, provider responses, and credentials. */
export class LocalReleaseFailure extends Schema.TaggedError<LocalReleaseFailure>()(
  "LocalReleaseFailure",
  { reason: Schema.String },
) {}

const ReleaseAttempt = Schema.Struct({
  attempt_id: ReleaseAttemptId,
  merge_commit: ReleaseCommit,
  release_ordinal: ReleaseOrdinal,
  set_digest: Schema.NullOr(PluginSha256),
  status: Schema.Literals(["preparing", "approved", "publishing", "completed", "abandoned"]),
});

type ReleaseAttempt = typeof ReleaseAttempt.Type;
type CoordinatorResult<A> = Promise<Result.Result<A, LocalReleaseFailure>>;
const failure = (reason: string) => Result.fail(new LocalReleaseFailure({ reason }));

/** D1 owns publication exclusivity and ordinals; no lease timeout can authorize a second writer. */
export class LocalReleaseCoordinator {
  constructor(private readonly database: D1BatchTransport) {}

  /** Reserves one exclusive attempt; uncertain acquisition is inspected by its supplied ID. */
  async acquire(input: {
    readonly attemptId: typeof ReleaseAttemptId.Type;
    readonly commit: typeof ReleaseCommit.Type;
    readonly createdAt: number;
  }): CoordinatorResult<ReleaseAttempt> {
    const result = await this.database.batch([
      {
        sql: `INSERT INTO marketplace_release_attempts
        (attempt_id, merge_commit, release_ordinal, status, created_at)
        SELECT ?, ?, MAX(ordinal) + 1, 'preparing', ? FROM (
          SELECT COALESCE(MAX(release_ordinal), -1) AS ordinal FROM marketplace_release_attempts
          UNION ALL SELECT COALESCE(MAX(release_ordinal), -1) FROM marketplace_release_journal
        )`,
        params: [input.attemptId, input.commit, input.createdAt],
      },
    ]);
    if (Result.isFailure(result))
      return failure("release-lock-acquire-failed-inspect-before-retry");
    return this.read(input.attemptId);
  }

  /** Reads typed attempt authority; callers cannot derive it from a bundle. */
  async read(attemptId: typeof ReleaseAttemptId.Type): CoordinatorResult<ReleaseAttempt> {
    const result = await this.database.query({
      sql: `SELECT attempt_id, merge_commit, release_ordinal, set_digest, status
        FROM marketplace_release_attempts WHERE attempt_id = ?`,
      params: [attemptId],
    });
    if (Result.isFailure(result)) return failure("release-attempt-read-failed");
    const parsed = Schema.decodeUnknownResult(ReleaseAttempt)(result.success[0]);
    return Result.isFailure(parsed)
      ? failure("release-attempt-missing-or-invalid")
      : Result.succeed(parsed.success);
  }

  /** Shows only safe active-attempt metadata for operator recovery. */
  async active(): CoordinatorResult<ReadonlyArray<ReleaseAttempt>> {
    const result = await this.database.query({
      sql: `SELECT attempt_id, merge_commit, release_ordinal, set_digest, status
        FROM marketplace_release_attempts WHERE status IN ('preparing', 'approved', 'publishing')`,
      params: [],
    });
    if (Result.isFailure(result)) return failure("release-attempt-read-failed");
    const parsed = Schema.decodeUnknownResult(Schema.Array(ReleaseAttempt))(result.success);
    return Result.isFailure(parsed)
      ? failure("release-attempt-invalid")
      : Result.succeed(parsed.success);
  }

  /** Records the operator-approved exact release set before a publisher may start. */
  approve(attemptId: typeof ReleaseAttemptId.Type, digest: PluginSha256): CoordinatorResult<void> {
    return this.transition(
      `UPDATE marketplace_release_attempts SET set_digest = ?, status = 'approved'
      WHERE attempt_id = ? AND status = 'preparing'`,
      [digest, attemptId],
    );
  }

  /** One-shot publication admission checks commit, ordinal, and approval together. */
  beginPublication(input: {
    readonly attemptId: typeof ReleaseAttemptId.Type;
    readonly commit: typeof ReleaseCommit.Type;
    readonly ordinal: typeof ReleaseOrdinal.Type;
    readonly digest: PluginSha256;
  }): CoordinatorResult<void> {
    return this.transition(
      `UPDATE marketplace_release_attempts SET status = 'publishing'
      WHERE attempt_id = ? AND merge_commit = ? AND release_ordinal = ?
        AND set_digest = ? AND status = 'approved'`,
      [input.attemptId, input.commit, input.ordinal, input.digest],
    );
  }

  /** Releases the lock only after verified publication, or a pre-publication cancellation. */
  finish(
    attemptId: typeof ReleaseAttemptId.Type,
    outcome: "completed" | "cancelled",
  ): CoordinatorResult<void> {
    return outcome === "completed"
      ? this.transition(
          `UPDATE marketplace_release_attempts SET status = 'completed'
          WHERE attempt_id = ? AND status = 'publishing'`,
          [attemptId],
        )
      : this.transition(
          `UPDATE marketplace_release_attempts SET status = 'abandoned'
          WHERE attempt_id = ? AND status IN ('preparing', 'approved')`,
          [attemptId],
        );
  }

  /** Operator-only recovery: all prior processes and requests MUST have stopped before calling. */
  abandonStoppedAttempt(attemptId: typeof ReleaseAttemptId.Type): CoordinatorResult<void> {
    return this.transition(
      `UPDATE marketplace_release_attempts SET status = 'abandoned'
      WHERE attempt_id = ? AND status IN ('preparing', 'approved', 'publishing')`,
      [attemptId],
    );
  }

  private async transition(
    sql: string,
    params: ReadonlyArray<string | number>,
  ): CoordinatorResult<void> {
    const result = await this.database.batch([{ sql, params }]);
    if (Result.isFailure(result)) return failure("release-attempt-transition-failed");
    return result.success[0]?.changes === 1
      ? Result.succeed(undefined)
      : failure("release-attempt-fence-rejected");
  }
}
