import { constants } from "node:fs";
import { open, realpath } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { parseEnv } from "node:util";
import { Redacted, Result, Schema } from "effect";
import {
  releaseProcessEnvironment,
  verifyLocalReleaseCheckout,
} from "./local-release-workspace.js";

/*
 * Shared authority for commands that write Marketplace-owned rows into the application database
 * (setup guides, behaviour declarations): a clean checkout of fetched `origin/main`, and an
 * owner-only credentials file outside the checkout holding the database topology and one
 * purpose-specific token. Nothing is read from the process environment or the repository.
 */

/** Where the application database is; public identifiers, not secrets. */
export const ApplicationDatabaseTopology = Schema.Struct({
  CLOUDFLARE_ACCOUNT_ID: Schema.String.pipe(Schema.check(Schema.isPattern(/^[a-f0-9]{32}$/u))),
  APPLICATION_DATABASE_ID: Schema.String.pipe(Schema.check(Schema.isUUID())),
});

export interface ApplicationPublicationCredentials {
  readonly topology: typeof ApplicationDatabaseTopology.Type;
  readonly token: Redacted.Redacted<string>;
}

/**
 * Reads an owner-only file outside the checkout with exactly the topology keys and `tokenKey`.
 * Failures are `<label>-credentials-*` / `<label>-topology-invalid` and never echo values.
 */
export const readApplicationPublicationCredentials = async (input: {
  readonly file: string;
  readonly repositoryRoot: string;
  readonly tokenKey: string;
  readonly label: string;
}): Promise<Result.Result<ApplicationPublicationCredentials, string>> => {
  const { label } = input;
  try {
    const resolved = await realpath(input.file);
    const root = await realpath(input.repositoryRoot);
    if (resolved === root || resolved.startsWith(`${root}${path.sep}`)) {
      return Result.fail(`${label}-credentials-must-be-outside-repository`);
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
        return Result.fail(`${label}-credentials-require-owner-only-file`);
      }
      const values = parseEnv(await file.readFile("utf8"));
      const topology = Schema.decodeUnknownResult(ApplicationDatabaseTopology)(values);
      if (Result.isFailure(topology)) return Result.fail(`${label}-topology-invalid`);
      const allowed = new Set([...Object.keys(ApplicationDatabaseTopology.fields), input.tokenKey]);
      if (Object.keys(values).some((key) => !allowed.has(key))) {
        return Result.fail(`${label}-credentials-unexpected-key`);
      }
      const token = values[input.tokenKey];
      if (token === undefined || token.trim() === "") {
        return Result.fail(`${label}-credentials-incomplete`);
      }

      return Result.succeed({ topology: topology.success, token: Redacted.make(token) });
    } finally {
      await file.close();
    }
  } catch {
    return Result.fail(`${label}-credentials-read-failed`);
  }
};

/**
 * Same Git authority as Plugin deploys: the operator's Git config and SSH agent, nothing else.
 * Succeeds with the verified commit of a clean `main` equal to fetched `origin/main`.
 */
export const verifyApplicationPublicationCheckout = (repositoryRoot: string) =>
  verifyLocalReleaseCheckout({
    cwd: repositoryRoot,
    environment: {
      ...releaseProcessEnvironment(homedir()),
      HOME: homedir(),
      GIT_CONFIG_GLOBAL: path.join(homedir(), ".gitconfig"),
      ...(process.env["SSH_AUTH_SOCK"] === undefined
        ? {}
        : { SSH_AUTH_SOCK: process.env["SSH_AUTH_SOCK"] }),
    },
  });
