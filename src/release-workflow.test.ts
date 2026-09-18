import { readFile } from "node:fs/promises";
import { describe, expect, it } from "@effect/vitest";

describe("merge release trust boundary", () => {
  it("triggers on protected-main pushes without privileged PR execution", async () => {
    const workflow = await readFile(".github/workflows/release-on-main.yml", "utf8");
    expect(workflow).toContain("push:");
    expect(workflow).toContain("branches: [main]");
    expect(workflow).not.toContain("pull_request_target");
    expect(workflow).toContain("persist-credentials: false");
    expect(workflow).toContain("group: marketplace-release-main");
  });

  it("keeps build steps credential-free and publication environment-gated", async () => {
    const workflow = await readFile(".github/workflows/release-on-main.yml", "utf8");
    const baseline = workflow.slice(
      workflow.indexOf("authoritative-baseline:"),
      workflow.indexOf("credential-free-build:"),
    );
    expect(baseline).toContain("APPLICATION_PLUGIN_READ_TOKEN");
    expect(baseline).toContain("PLUGIN_PACKAGE_R2_READ_ACCESS_KEY_ID");
    expect(baseline).not.toContain("APPLICATION_PLUGIN_PUBLISH_TOKEN");
    expect(baseline).not.toContain("MARKETPLACE_JOURNAL_WRITE_TOKEN");
    expect(baseline).toContain('baseline release-baseline.json "$GITHUB_SHA"');
    expect(baseline).toContain("authoritative-release-baseline-${{ github.sha }}");
    const build = workflow.slice(
      workflow.indexOf("credential-free-build:"),
      workflow.indexOf("trusted-publication:"),
    );
    expect(build).not.toContain("secrets.");
    expect(build).not.toContain("CLOUDFLARE_");
    expect(build).toContain("publish release-output --dry-run");
    const publish = workflow.slice(workflow.indexOf("trusted-publication:"));
    expect(publish).toContain("environment: marketplace-production-publication");
    expect(publish).toContain("MARKETPLACE_APPROVED_RELEASE_SET_DIGEST");
    expect(publish).toContain("APPLICATION_PLUGIN_PUBLISH_TOKEN");
  });

  it("pins every workflow action to the independently verified upstream commit", async () => {
    const evidence = JSON.parse(
      await readFile("compatibility/github-action-pins.json", "utf8"),
    ) as {
      readonly actions: Readonly<Record<string, { readonly commit: string }>>;
    };
    const workflows = await Promise.all([
      readFile(".github/workflows/pull-request.yml", "utf8"),
      readFile(".github/workflows/release-on-main.yml", "utf8"),
    ]);
    const uses = workflows
      .flatMap((workflow) => [...workflow.matchAll(/uses: ([^@\s]+)@([a-f0-9]{40})/gu)])
      .map((match) => ({ action: match[1], commit: match[2] }));
    expect(uses.length).toBeGreaterThan(0);
    for (const use of uses) {
      const evidenceEntry = Object.entries(evidence.actions).find(([tag]) =>
        tag.startsWith(`${use.action}@`),
      );
      expect(evidenceEntry, `missing upstream evidence for ${use.action}`).toBeDefined();
      expect(use.commit).toBe(evidenceEntry?.[1].commit);
    }
  });

  it("uses Alchemy refs for app stores and provisions only the release journal", async () => {
    const infra = await readFile("tools/infra/alchemy.run.ts", "utf8");
    expect(infra).toContain('Cloudflare.D1.Database.ref("ApplicationDatabase"');
    expect(infra).toContain('Cloudflare.R2.Bucket.ref("PluginPackages"');
    expect(infra).toContain('Cloudflare.D1.Database("MarketplaceReleaseJournal"');
    expect(infra).not.toContain('Cloudflare.R2.Bucket("PluginPackages"');
    expect(infra).not.toContain('Cloudflare.D1.Database("ApplicationDatabase"');
  });
});
