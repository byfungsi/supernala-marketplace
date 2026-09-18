import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { expect, it } from "@effect/vitest";
import { zipSync } from "fflate";
import { inspectPublicRepositorySafety } from "./public-repo-safety.js";

it("reports only sanitized finding locations and types", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "marketplace-safety-"));
  const syntheticSecret = ["synthetic", "credential", "value"].join("");
  await writeFile(
    path.join(root, "candidate.txt"),
    ["Authorization: Bearer", syntheticSecret].join(" "),
  );
  const findings = await inspectPublicRepositorySafety(root);
  expect(findings).toEqual([{ location: "candidate.txt", type: "bearer-authorization" }]);
  expect(JSON.stringify(findings)).not.toContain(syntheticSecret);
});

it("covers JSON, env, YAML, key headers, token variants, and bounded archive entries", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "marketplace-safety-matrix-"));
  const assigned = ["long", "synthetic", "secret"].join("");
  const github = ["gh", "p_", "A".repeat(32)].join("");
  const privateHeader = ["-----BEGIN ", "OPENSSH PRIVATE KEY-----"].join("");
  await writeFile(
    path.join(root, "variants.txt"),
    [
      `{"client_secret":"${assigned}"}`,
      `API_KEY=${assigned}`,
      `refresh-token: '${assigned}'`,
      github,
      privateHeader,
    ].join("\n"),
  );
  await mkdir(path.join(root, "artifacts"));
  await writeFile(
    path.join(root, "artifacts", "candidate.plugin"),
    zipSync({ "nested.env": new TextEncoder().encode(`ACCESS_TOKEN=${assigned}`) }),
  );
  const findings = await inspectPublicRepositorySafety(root);
  expect(findings).toContainEqual({ location: "variants.txt", type: "assigned-secret" });
  expect(findings).toContainEqual({ location: "variants.txt", type: "github-token" });
  expect(findings).toContainEqual({ location: "variants.txt", type: "private-key" });
  expect(findings).toContainEqual({
    location: "artifacts/candidate.plugin!/nested.env",
    type: "assigned-secret",
  });
  expect(JSON.stringify(findings)).not.toContain(assigned);
});

it("rejects high-ratio archives before expansion", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "marketplace-safety-bomb-"));
  const bomb = zipSync({ "large.txt": new Uint8Array(2 * 1_048_576) }, { level: 9 });
  await writeFile(path.join(root, "candidate.plugin"), bomb);
  expect(await inspectPublicRepositorySafety(root)).toContainEqual({
    location: "candidate.plugin",
    type: "unreadable-archive",
  });
});
