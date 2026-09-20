import { constants } from "node:fs";
import { open, realpath } from "node:fs/promises";
import path from "node:path";
import { parseEnv } from "node:util";
import { Redacted, Result, Schema } from "effect";
import { LocalReleaseFailure } from "./local-release-coordinator.js";

const Topology = Schema.Struct({
  CLOUDFLARE_ACCOUNT_ID: Schema.String.pipe(Schema.check(Schema.isPattern(/^[a-f0-9]{32}$/u))),
  MARKETPLACE_JOURNAL_DATABASE_ID: Schema.String.pipe(Schema.check(Schema.isUUID())),
  APPLICATION_DATABASE_ID: Schema.String.pipe(Schema.check(Schema.isUUID())),
  APPLICATION_OAUTH_CALLBACK_URL: Schema.String.pipe(
    Schema.check(Schema.isLengthBetween(1, 2_048)),
  ),
  MARKETPLACE_SOURCE_REPOSITORY: Schema.String.pipe(
    Schema.check(Schema.isPattern(/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/u)),
  ),
  PLUGIN_PACKAGE_BUCKET_NAME: Schema.String.pipe(
    Schema.check(Schema.isPattern(/^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/u)),
  ),
});
const controlKeys = [
  "MARKETPLACE_JOURNAL_WRITE_TOKEN",
  "MARKETPLACE_JOURNAL_READ_TOKEN",
  "APPLICATION_PLUGIN_READ_TOKEN",
  "PLUGIN_PACKAGE_R2_READ_ACCESS_KEY_ID",
  "PLUGIN_PACKAGE_R2_READ_SECRET_ACCESS_KEY",
] as const;
const publicationKeys = [
  "APPLICATION_PLUGIN_PUBLISH_TOKEN",
  "PLUGIN_PACKAGE_R2_ACCESS_KEY_ID",
  "PLUGIN_PACKAGE_R2_SECRET_ACCESS_KEY",
] as const;

/** Local release credentials stay redacted until the Cloudflare adapter or subprocess boundary. */
export interface LocalReleaseCredentials {
  readonly topology: typeof Topology.Type;
  readonly secrets: Readonly<Record<string, Redacted.Redacted<string>>>;
}

/** Reads an owner-only file outside the checkout; publication credentials are opened only after approval. */
export async function readLocalReleaseCredentials(input: {
  readonly file: string;
  readonly repositoryRoot: string;
  readonly phase: "control" | "publication";
}): Promise<Result.Result<LocalReleaseCredentials, LocalReleaseFailure>> {
  try {
    const resolved = await realpath(input.file);
    const root = await realpath(input.repositoryRoot);
    if (resolved === root || resolved.startsWith(`${root}${path.sep}`)) {
      return Result.fail(
        new LocalReleaseFailure({ reason: "release-credentials-must-be-outside-repository" }),
      );
    }
    const file = await open(input.file, constants.O_RDONLY | constants.O_NOFOLLOW);
    try {
      const stat = await file.stat();
      if (
        !stat.isFile() ||
        stat.size > 65_536 ||
        (stat.mode & 0o077) !== 0 ||
        (process.getuid !== undefined && stat.uid !== process.getuid())
      ) {
        return Result.fail(
          new LocalReleaseFailure({ reason: "release-credentials-require-owner-only-file" }),
        );
      }
      const values = parseEnv(await file.readFile("utf8"));
      const topology = Schema.decodeUnknownResult(Topology)(values);
      if (Result.isFailure(topology))
        return Result.fail(new LocalReleaseFailure({ reason: "release-topology-invalid" }));
      const keys = input.phase === "control" ? controlKeys : publicationKeys;
      const allowed = new Set<string>([...Object.keys(Topology.fields), ...keys]);
      if (Object.keys(values).some((key) => !allowed.has(key))) {
        return Result.fail(
          new LocalReleaseFailure({ reason: "release-credentials-unexpected-key" }),
        );
      }
      const secrets: Record<string, Redacted.Redacted<string>> = {};
      for (const key of keys) {
        const value = values[key];
        if (value === undefined || value.trim() === "")
          return Result.fail(new LocalReleaseFailure({ reason: "release-credentials-incomplete" }));
        secrets[key] = Redacted.make(value);
      }
      return Result.succeed({ topology: topology.success, secrets });
    } finally {
      await file.close();
    }
  } catch {
    return Result.fail(new LocalReleaseFailure({ reason: "release-credentials-read-failed" }));
  }
}

/** Exact allowlist unwrap occurs only when passing credentials to the designated I/O process. */
export function releaseCredentialEnvironment(
  credentials: LocalReleaseCredentials,
): Readonly<Record<string, string>> {
  return {
    ...credentials.topology,
    ...Object.fromEntries(
      Object.entries(credentials.secrets).map(([key, value]) => [key, Redacted.value(value)]),
    ),
  };
}
