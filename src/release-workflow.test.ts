import { readFile, readdir } from "node:fs/promises";
import { describe, expect, it } from "@effect/vitest";

describe("local release trust boundary", () => {
  it("runs only credential-free checks on PRs and main; publication has no workflow trigger", async () => {
    expect(await readdir(".github/workflows")).toEqual(["pull-request.yml"]);
    const workflow = await readFile(".github/workflows/pull-request.yml", "utf8");
    expect(workflow).toContain("push:");
    expect(workflow).toContain("branches: [main]");
    expect(workflow).not.toContain("pull_request_target");
    expect(workflow).toContain("persist-credentials: false");
    expect(workflow).not.toContain("secrets.");
    expect(workflow).not.toContain("release publish");
    expect(workflow).toContain("pnpm check");
  });

  it("requires durable one-shot admission rather than GitHub environment variables", async () => {
    const publisher = await readFile("src/release-cli.ts", "utf8");
    expect(publisher).not.toContain("GITHUB_SHA");
    expect(publisher).not.toContain("GITHUB_RUN_NUMBER");
    expect(publisher).toContain("coordinator.beginPublication");
    expect(publisher).toContain("MARKETPLACE_APPROVED_RELEASE_SET_DIGEST");
  });

  it("pins every workflow action to the independently verified upstream commit", async () => {
    const evidence = JSON.parse(
      await readFile("compatibility/github-action-pins.json", "utf8"),
    ) as {
      readonly actions: Readonly<Record<string, { readonly commit: string }>>;
    };
    const workflows = [await readFile(".github/workflows/pull-request.yml", "utf8")];
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
