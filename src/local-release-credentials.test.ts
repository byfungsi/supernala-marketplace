import { chmod, mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { expect, it } from "@effect/vitest";
import { Result } from "effect";
import {
  readLocalReleaseCredentials,
  releaseCredentialEnvironment,
} from "./local-release-credentials.js";

const topology = `CLOUDFLARE_ACCOUNT_ID=${"a".repeat(32)}\nMARKETPLACE_JOURNAL_DATABASE_ID=123e4567-e89b-42d3-a456-426614174001\nAPPLICATION_DATABASE_ID=123e4567-e89b-42d3-a456-426614174002\nPLUGIN_PACKAGE_BUCKET_NAME=fixture-packages\n`;
const secrets =
  "APPLICATION_PLUGIN_PUBLISH_TOKEN=synthetic-test-only\nPLUGIN_PACKAGE_R2_ACCESS_KEY_ID=synthetic-test-only\nPLUGIN_PACKAGE_R2_SECRET_ACCESS_KEY=synthetic-test-only\n";

it("requires external owner-only secret files, rejects mixed phase credentials and redacts values", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "local-release-credentials-"));
  try {
    const repositoryRoot = path.join(root, "repo");
    await mkdir(repositoryRoot);
    const file = path.join(root, "publication.env");
    await writeFile(file, topology + secrets, { mode: 0o600 });
    const input = { file, repositoryRoot, phase: "publication" as const };
    const parsed = await readLocalReleaseCredentials(input);
    if (Result.isFailure(parsed)) throw new Error("test-credentials-invalid");
    expect(JSON.stringify(parsed.success)).not.toContain("synthetic-test-only");
    expect(releaseCredentialEnvironment(parsed.success).APPLICATION_PLUGIN_PUBLISH_TOKEN).toBe(
      "synthetic-test-only",
    );
    expect(
      Result.isFailure(await readLocalReleaseCredentials({ ...input, phase: "control" })),
    ).toBe(true);
    await chmod(file, 0o644);
    expect(Result.isFailure(await readLocalReleaseCredentials(input))).toBe(true);
    await chmod(file, 0o600);
    await symlink(file, path.join(root, "linked.env"));
    expect(
      Result.isFailure(
        await readLocalReleaseCredentials({ ...input, file: path.join(root, "linked.env") }),
      ),
    ).toBe(true);
    await writeFile(path.join(repositoryRoot, "inside.env"), topology + secrets, { mode: 0o600 });
    expect(
      Result.isFailure(
        await readLocalReleaseCredentials({
          ...input,
          file: path.join(repositoryRoot, "inside.env"),
        }),
      ),
    ).toBe(true);
    await writeFile(file, `${topology}${secrets}NODE_OPTIONS=--inspect\n`);
    expect(Result.isFailure(await readLocalReleaseCredentials(input))).toBe(true);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
