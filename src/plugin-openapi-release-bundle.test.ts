import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Result, Schema } from "effect";
import { describe, expect, it } from "vitest";
import {
  deriveBootstrapAuthoritySnapshot,
  derivePluginOpenApiAuthoritySnapshot,
  diffPluginAuthority,
  PluginAuthoritySnapshot,
} from "./authority-diff.js";
import { PackagedPluginAuthentication } from "./package-archive.js";
import {
  canonicalPluginJson,
  digestPluginBytes,
  PluginSha256,
  PluginVersion,
  ProviderRegistrationId,
} from "./plugin-contract.js";
import { loadPluginOpenApiSource } from "./plugin-openapi-source.js";
import {
  buildPluginOpenApiReleaseBundle,
  calculatePluginOpenApiSourceInputDigest,
  loadPluginOpenApiReleaseBundle,
} from "./plugin-openapi-release-bundle.js";
import {
  calculateAuthorityBaselineDigest,
  calculateReleaseDigest,
  releaseIdentityFileStem,
  releaseReviewFile,
  ReleaseReview,
} from "./release-bundle.js";
import { PluginReleaseIdentity } from "./release-machine.js";

const digestJson = (value: Parameters<typeof canonicalPluginJson>[0]) =>
  digestPluginBytes(new TextEncoder().encode(canonicalPluginJson(value)));

describe("OpenAPI reviewed release bundle", () => {
  it("binds source, operations and authority to the protected review, then rejects modified bundle bytes", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "marketplace-openapi-review-"));
    try {
      const sourceDirectory = path.join(root, "source");
      const bundleDirectory = path.join(root, "bundle");
      const { mkdir, copyFile } = await import("node:fs/promises");
      await mkdir(sourceDirectory);
      for (const file of ["openapi.json", "openapi-source.json"]) {
        await copyFile(`plugins/openapi-inventory/${file}`, path.join(sourceDirectory, file));
      }
      const configFile = path.join(sourceDirectory, "openapi-source.json");
      const config = JSON.parse(await readFile(configFile, "utf8"));
      config.status = "reviewed-publishable";
      await writeFile(configFile, `${JSON.stringify(config, null, 2)}\n`);
      const loaded = await loadPluginOpenApiSource(sourceDirectory);
      expect(Result.isSuccess(loaded)).toBe(true);
      if (Result.isFailure(loaded)) return;
      const { source, compiled } = loaded.success;
      await writeFile(path.join(root, "shared.txt"), "shared-openapi-v1\n");
      const sharedInputDigest = await digestPluginBytes(
        new TextEncoder().encode(
          JSON.stringify([
            {
              file: "shared.txt",
              digest: await digestPluginBytes(
                new Uint8Array(await readFile(path.join(root, "shared.txt"))),
              ),
            },
          ]),
        ),
      );
      const sourceInputDigest = await calculatePluginOpenApiSourceInputDigest({
        sourceDirectory,
        sharedInputDigest,
      });
      const identity = PluginReleaseIdentity.make({
        marketplaceId: source.marketplaceId,
        publisherNamespace: source.publisherNamespace,
        pluginSlug: source.pluginSlug,
        semanticVersion: source.version,
      });
      const after = derivePluginOpenApiAuthoritySnapshot(compiled.contract);
      const before = deriveBootstrapAuthoritySnapshot(after);
      const beforeDigest = await digestJson(before);
      const afterDigest = await digestJson(after);
      const diff = await diffPluginAuthority(before, after);
      const priorVersion = Schema.decodeUnknownSync(PluginAuthoritySnapshot)({
        ...Object.fromEntries(Object.entries(after)),
        tools: after.tools.slice(0, 1),
        openApiBindings: after.openApiBindings?.slice(0, 1),
      });
      const replacement = await diffPluginAuthority(priorVersion, after);
      expect(replacement.addedTools).toEqual(["items.list", "items.update"]);
      const changedBinding = Schema.decodeUnknownSync(PluginAuthoritySnapshot)({
        ...Object.fromEntries(Object.entries(after)),
        openApiBindings: after.openApiBindings?.map((binding) =>
          binding.toolId === "items.list" ? { ...binding, pathTemplate: "/new-items" } : binding,
        ),
      });
      expect((await diffPluginAuthority(after, changedBinding)).changedTools).toEqual([
        "items.list",
      ]);
      const configSchema = { revision: 1, fields: [] } as const;
      const configDigest = await digestPluginBytes(
        new TextEncoder().encode(JSON.stringify(configSchema)),
      );
      const provenanceDigest = await digestJson({ sourceDigest: compiled.contract.sourceDigest });
      const authentication = PackagedPluginAuthentication.make({ kind: "none" });
      const reviewedAt = 100;
      const version = PluginVersion.make({
        id: source.pluginVersionId,
        marketplaceId: source.marketplaceId,
        publisherNamespace: source.publisherNamespace,
        pluginSlug: source.pluginSlug,
        version: source.version,
        name: source.name,
        description: source.description,
        license: source.license,
        status: "published",
        publishedAt: reviewedAt,
        runtime: {
          _tag: "ManagedOpenApi",
          kind: "managed-openapi",
          artifactDigest: compiled.artifactDigest,
          manifestDigest: compiled.artifactDigest,
          providerRegistrationId: ProviderRegistrationId.make(source.providerRegistrationId),
        },
        catalog: compiled.contract.catalog,
        config: configSchema,
        allowedHosts: after.allowedHosts,
      });
      const authorityBaselineDigest = await calculateAuthorityBaselineDigest({
        authorityBeforeIdentity: null,
        authorityBeforeReleaseDigest: null,
        authorityBefore: before,
        authorityBeforeDigest: beforeDigest,
      });
      const authorityDiffDigest = diff.diffDigest;
      const releaseDigest = await calculateReleaseDigest({
        identity,
        version,
        authentication,
        sourceInputDigest,
        catalogDigest: compiled.contract.catalog.digest,
        configDigest,
        provenanceDigest,
        authorityBaselineDigest,
        authorityDigest: afterDigest,
        authorityDiffDigest: PluginSha256.make(diff.diffDigest),
        artifactDigest: compiled.artifactDigest,
      });
      const review = ReleaseReview.make({
        schemaVersion: 1,
        identity,
        reviewId: "review-inventory-1",
        reviewer: "offline-reviewer",
        reviewedAt,
        sourceInputDigest,
        artifactDigest: compiled.artifactDigest,
        authentication,
        authStrategy: compiled.contract.authStrategy,
        catalogDigest: compiled.contract.catalog.digest,
        configDigest,
        provenanceDigest,
        authorityBeforeIdentity: null,
        authorityBeforeReleaseDigest: null,
        authorityBefore: before,
        authorityBeforeDigest: beforeDigest,
        authorityAfter: after,
        authorityDigest: afterDigest,
        authorityDiffDigest: PluginSha256.make(authorityDiffDigest),
        releaseDigest,
        decision: "approved",
      });
      const input = {
        sourceDirectory,
        outputDirectory: bundleDirectory,
        sharedInputDigest,
        mergeCommit: "b".repeat(40),
        releaseOrdinal: 1,
        review,
        previousPublished: null,
      } as const;
      const built = await buildPluginOpenApiReleaseBundle(input);
      expect(Result.isSuccess(built)).toBe(true);
      if (Result.isFailure(built)) return;
      expect(
        await loadPluginOpenApiReleaseBundle({
          bundleDirectory,
          sourceDirectory,
          sharedInputDigest,
          trustedReview: review,
          expectedMergeCommit: input.mergeCommit,
          expectedReleaseOrdinal: 1,
        }),
      ).toMatchObject({ _tag: "Success" });
      await mkdir(path.join(root, "releases", "reviews"), { recursive: true });
      await writeFile(
        path.join(root, "releases", "index.json"),
        JSON.stringify({
          schemaVersion: 1,
          sharedInputs: ["shared.txt"],
          plugins: [
            {
              sourceDirectory: "source",
              kind: "managed-openapi",
              publicationEligible: true,
              reason: "synthetic integration review",
            },
          ],
        }),
      );
      await writeFile(path.join(root, releaseReviewFile(identity)), JSON.stringify(review));
      await writeFile(
        path.join(root, "baseline.json"),
        JSON.stringify({ schemaVersion: 1, mergeCommit: input.mergeCommit, records: [] }),
      );
      const runCli = (arguments_: ReadonlyArray<string>) =>
        new Promise<{
          code: number | null;
          stdout: string;
          stderr: string;
        }>((resolve, reject) => {
          const cli = path.join(path.resolve("."), "src", "release-cli.ts");
          const tsx = path.join(path.resolve("."), "node_modules", "tsx", "dist", "cli.mjs");
          const child = spawn(process.execPath, [tsx, cli, ...arguments_], {
            cwd: root,
            env: { PATH: process.env.PATH ?? "" },
            stdio: ["ignore", "pipe", "pipe"],
          });
          let stdout = "";
          let stderr = "";
          child.stdout.setEncoding("utf8").on("data", (chunk: string) => {
            stdout += chunk;
          });
          child.stderr.setEncoding("utf8").on("data", (chunk: string) => {
            stderr += chunk;
          });
          child.once("error", reject);
          child.once("close", (code) => resolve({ code, stdout, stderr }));
        });
      const cliBuild = await runCli([
        "build",
        "baseline.json",
        "cli-output",
        input.mergeCommit,
        "1",
      ]);
      expect(cliBuild).toMatchObject({ code: 0, stderr: "" });
      const cliBundle = path.join(
        root,
        "cli-output",
        releaseIdentityFileStem(identity),
        "openapi-bundle.json",
      );
      expect(await readFile(cliBundle)).toEqual(
        await readFile(path.join(bundleDirectory, "openapi-bundle.json")),
      );
      const dryRun = await runCli(["publish", "cli-output", "--dry-run"]);
      expect(dryRun).toMatchObject({ code: 0, stderr: "" });
      expect(JSON.parse(dryRun.stdout)).toEqual({ mode: "dry-run", writes: 0, bundles: 1 });
      await writeFile(cliBundle, `${await readFile(cliBundle, "utf8")} `);
      const tampered = await runCli(["publish", "cli-output", "--dry-run"]);
      expect(tampered).toMatchObject({
        code: 1,
        stderr: "Release failed: release-artifact-byte-mismatch\n",
      });
      expect(tampered.stderr).not.toContain(root);
      const artifact = path.join(bundleDirectory, "openapi-bundle.json");
      await writeFile(artifact, `${await readFile(artifact, "utf8")} `);
      expect(
        await loadPluginOpenApiReleaseBundle({
          bundleDirectory,
          sourceDirectory,
          sharedInputDigest,
          trustedReview: review,
          expectedMergeCommit: input.mergeCommit,
          expectedReleaseOrdinal: 1,
        }),
      ).toMatchObject({ _tag: "Failure", failure: "release-artifact-byte-mismatch" });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
