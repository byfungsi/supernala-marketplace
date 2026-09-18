import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "@effect/vitest";
import { Result, Schema } from "effect";
import { preparePluginPackage, validatePluginSource } from "./authoring-validation.js";
import { PluginSha256 } from "./plugin-contract.js";
import {
  loadPhase1PublicationInput,
  makePackagedPluginPublicationPlan,
  PublicationReviewBinding,
} from "./publication-plan.js";

describe("publication plan adapter contract", () => {
  it("serializes a sidecar reference and reconstructs exact Uint8Array input", async () => {
    const sourceResult = await validatePluginSource("plugins/offline-fixture");
    expect(Result.isSuccess(sourceResult)).toBe(true);
    if (Result.isFailure(sourceResult)) return;
    const prepared = await preparePluginPackage({
      source: sourceResult.success,
      marketplaceId: "supernala-public",
      versionId: "offline-fixture-1.0.0",
      publishedAt: 0,
    });
    expect(Result.isSuccess(prepared)).toBe(true);
    if (Result.isFailure(prepared)) return;
    const root = await mkdtemp(path.join(os.tmpdir(), "marketplace-plan-"));
    await mkdir(path.join(root, "artifacts"));
    await writeFile(path.join(root, "artifacts", "fixture.plugin"), prepared.success.archiveBytes);
    const review = PublicationReviewBinding.make({
      reviewId: "synthetic-review-1",
      reviewedAt: 1,
      reviewer: "synthetic-reviewer",
      sourceTreeDigest: PluginSha256.make("1".repeat(64)),
      artifactDigest: prepared.success.artifactDigest,
      authentication: prepared.success.parsed.authentication,
      catalogDigest: prepared.success.parsed.version.catalog.digest,
      configDigest: prepared.success.parsed.configDigest,
      authorityDiffDigest: PluginSha256.make("2".repeat(64)),
      decision: "approved",
    });
    const plan = makePackagedPluginPublicationPlan({
      definitionId: "offline-fixture",
      artifactRelativePath: "artifacts/fixture.plugin",
      artifactByteLength: prepared.success.archiveBytes.byteLength,
      version: prepared.success.parsed.version,
      authentication: prepared.success.parsed.authentication,
      catalog: sourceResult.success.catalog,
      config: sourceResult.success.config,
      provenance: sourceResult.success.provenance,
      review,
    });
    const planFile = path.join(root, "plan.json");
    await writeFile(planFile, JSON.stringify(plan));
    const encoded = JSON.stringify(plan);
    expect(encoded).not.toContain('"0":');
    expect(encoded).not.toContain("archiveBytes");
    const loaded = await loadPhase1PublicationInput({
      planFile,
      expectedReviewId: "synthetic-review-1",
    });
    expect(Result.isSuccess(loaded)).toBe(true);
    if (Result.isFailure(loaded)) return;
    expect(loaded.success.archiveBytes).toBeInstanceOf(Uint8Array);
    expect(loaded.success.archiveBytes).toEqual(prepared.success.archiveBytes);
    expect(loaded.success).toMatchObject({
      definitionId: "offline-fixture",
      expectedArtifactDigest: prepared.success.artifactDigest,
      expectedAuthentication: { kind: "none" },
      reviewedAt: 1,
    });
    const tamperedAuthentication = {
      kind: "github-app" as const,
      providerRegistration: "unreviewed-provider",
      credentialDelivery: "short-lived-installation-token-only" as const,
    };
    const serializedPlan = Schema.decodeUnknownSync(Schema.JsonObject)(
      JSON.parse(JSON.stringify(plan)),
    );
    const serializedReview = Schema.decodeUnknownSync(Schema.JsonObject)(serializedPlan.review);
    await writeFile(
      planFile,
      JSON.stringify({
        ...serializedPlan,
        authentication: tamperedAuthentication,
        review: { ...serializedReview, authentication: tamperedAuthentication },
      }),
    );
    expect(
      await loadPhase1PublicationInput({
        planFile,
        expectedReviewId: "synthetic-review-1",
      }),
    ).toEqual(Result.fail("release-contract-mismatch"));

    const excessAuthenticationCases = [
      {
        ...serializedPlan,
        authentication: { kind: "none", scopes: ["synthetic-disallowed-scope"] },
      },
      {
        ...serializedPlan,
        review: {
          ...serializedReview,
          authentication: { kind: "none", tokenName: "SYNTHETIC_TOKEN_OVERRIDE" },
        },
      },
      {
        ...serializedPlan,
        authentication: {
          ...tamperedAuthentication,
          provider: "synthetic-unreviewed-provider-kind",
        },
        review: { ...serializedReview, authentication: tamperedAuthentication },
      },
    ];
    for (const excessAuthentication of excessAuthenticationCases) {
      await writeFile(planFile, JSON.stringify(excessAuthentication));
      expect(
        await loadPhase1PublicationInput({
          planFile,
          expectedReviewId: "synthetic-review-1",
        }),
      ).toEqual(Result.fail("publication-plan-invalid"));
    }
  });

  it("rejects tampered sidecar bytes", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "marketplace-plan-bad-"));
    const planFile = path.join(root, "plan.json");
    await writeFile(planFile, "{}");
    const loaded = await loadPhase1PublicationInput({ planFile, expectedReviewId: "missing" });
    expect(loaded).toEqual(Result.fail("publication-plan-invalid"));
  });
});
