import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { Result } from "effect";
import { afterEach, describe, expect, it } from "vitest";
import { detectLicenseText, loadCuratedSkills } from "./marketplace-skill-cli.js";
import {
  CONTINUED_INSTRUCTIONS_FILE,
  isSkillFilePath,
  loadMarketplaceSkill,
  parseSkillMarkdown,
  skillFilesProblem,
  type MarketplaceSkillManifest,
} from "./marketplace-skill.js";

const repositoryRoot = path.resolve(import.meta.dirname, "..");
const scratchDirectories: Array<string> = [];

afterEach(async () => {
  await Promise.all(
    scratchDirectories
      .splice(0)
      .map((directory) => fs.rm(directory, { recursive: true, force: true })),
  );
});

const manifest = (overrides: Partial<MarketplaceSkillManifest> = {}): MarketplaceSkillManifest => ({
  schemaVersion: 1,
  marketplaceId: "supernala-public",
  publisher: { namespace: "acme", name: "Acme" },
  slug: "weekly-report",
  version: "1.0.0",
  name: "Weekly report",
  shortDescription: "Summarize a week of work.",
  longDescription: "",
  categories: ["Writing"],
  featuredRank: null,
  license: "MIT",
  attribution: "Copyright (c) Acme. MIT.",
  source: {
    _tag: "github",
    repository: "acme/skills",
    commit: "a".repeat(40),
    path: "weekly-report",
  },
  addedFiles: [],
  ...overrides,
});

/** Writes `skills/<publisher>/<slug>/` with the given files under `files/`. */
const writeSkill = async (
  files: Readonly<Record<string, string>>,
  overrides: Partial<MarketplaceSkillManifest> = {},
  slugDirectory = "weekly-report",
) => {
  const root = await fs.mkdtemp(path.join(tmpdir(), "skill-test-"));
  scratchDirectories.push(root);
  const directory = path.join(root, "skills", "acme", slugDirectory);
  await fs.mkdir(path.join(directory, "files"), { recursive: true });
  await fs.writeFile(path.join(directory, "skill.json"), JSON.stringify(manifest(overrides)));
  for (const [filePath, text] of Object.entries(files)) {
    await fs.mkdir(path.dirname(path.join(directory, "files", filePath)), { recursive: true });
    await fs.writeFile(path.join(directory, "files", filePath), text);
  }

  return directory;
};

const skillMarkdown = (body = "# Weekly report\n\nSummarize wins and blockers.") =>
  `---\nname: weekly-report\ndescription: Turn a week of chats into a report.\nlicense: MIT\n---\n\n${body}\n`;

describe("parseSkillMarkdown", () => {
  it("reads folded, literal and plain multi-line descriptions as one line", () => {
    for (const description of [
      "description: >\n  Turns a week\n  into a report.",
      "description: |-\n  Turns a week\n  into a report.",
      "description:\n  Turns a week\n  into a report.",
    ]) {
      const parsed = parseSkillMarkdown(`---\nname: report\n${description}\n---\nBody`);
      expect(Result.getOrThrow(parsed)).toEqual({
        name: "report",
        description: "Turns a week into a report.",
        instructions: "Body",
      });
    }
  });

  it("refuses a file without frontmatter or without instructions", () => {
    expect(parseSkillMarkdown("# Just a heading")).toEqual(
      Result.fail("skill-frontmatter-invalid"),
    );
    expect(parseSkillMarkdown("---\nname: a\ndescription: b\n---\n\n")).toEqual(
      Result.fail("skill-instructions-missing"),
    );
  });
});

describe("loadMarketplaceSkill", () => {
  it("publishes every file beside SKILL.md, path-sorted with exact digests", async () => {
    const directory = await writeSkill({
      "SKILL.md": skillMarkdown(),
      "templates/report.md": "## Wins",
      "LICENSE.txt": "MIT",
      "assets/logo.svg": "<svg/>",
    });
    const release = Result.getOrThrow(await loadMarketplaceSkill(directory));
    expect(release.id).toBe("acme/weekly-report");
    expect(release.versionId).toBe("acme/weekly-report@1.0.0");
    expect(release.skillName).toBe("weekly-report");
    expect(release.instructionsMarkdown).toBe("# Weekly report\n\nSummarize wins and blockers.");
    expect(release.files.map((file) => file.path)).toEqual([
      "LICENSE.txt",
      "assets/logo.svg",
      "templates/report.md",
    ]);
    expect(release.files[2]?.sha256).toBe(createHash("sha256").update("## Wins").digest("hex"));
    expect(release.byteSize).toBe(3 + 6 + 7);
  });

  it("changes the release digest whenever installed content changes", async () => {
    const first = Result.getOrThrow(
      await loadMarketplaceSkill(await writeSkill({ "SKILL.md": skillMarkdown() })),
    );
    const again = Result.getOrThrow(
      await loadMarketplaceSkill(await writeSkill({ "SKILL.md": skillMarkdown() })),
    );
    const edited = Result.getOrThrow(
      await loadMarketplaceSkill(await writeSkill({ "SKILL.md": skillMarkdown("Changed.") })),
    );
    expect(again.releaseDigest).toBe(first.releaseDigest);
    expect(edited.releaseDigest).not.toBe(first.releaseDigest);
  });

  it("splits over-long instructions and clips long descriptions like the application import", async () => {
    const longBody = Array.from(
      { length: 900 },
      (_, index) => `## Part ${index}\n\n${"x".repeat(40)}`,
    ).join("\n\n");
    const directory = await writeSkill({
      "SKILL.md": `---\nname: big\ndescription: ${"d".repeat(700)}\n---\n${longBody}`,
    });
    const release = Result.getOrThrow(await loadMarketplaceSkill(directory));
    expect(release.instructionsMarkdown.length).toBeLessThanOrEqual(32_000);
    expect(release.instructionsMarkdown).toContain(
      `continue in \`${CONTINUED_INSTRUCTIONS_FILE}\``,
    );
    expect(release.files.map((file) => file.path)).toEqual([CONTINUED_INSTRUCTIONS_FILE]);
    const rest = new TextDecoder().decode(release.contents.get(release.files[0]?.sha256 ?? ""));
    expect(rest.startsWith("## Part")).toBe(true);
    expect(release.skillDescription).toHaveLength(600);
    expect(release.skillDescription.endsWith("…")).toBe(true);
  });

  it("refuses identity mismatches, links and missing added files", async () => {
    expect(
      await loadMarketplaceSkill(
        await writeSkill({ "SKILL.md": skillMarkdown() }, {}, "other-name"),
      ),
    ).toEqual(Result.fail("skill-identity-mismatch"));
    expect(
      await loadMarketplaceSkill(
        await writeSkill({ "SKILL.md": skillMarkdown() }, { addedFiles: ["LICENSE"] }),
      ),
    ).toEqual(Result.fail("skill-added-file-missing"));
    const linked = await writeSkill({ "SKILL.md": skillMarkdown() });
    await fs.symlink("/etc/hosts", path.join(linked, "files", "hosts"));
    expect(await loadMarketplaceSkill(linked)).toEqual(Result.fail("skill-file-link-not-allowed"));
  });
});

describe("Skill folder rules", () => {
  it("accepts only relative, clean paths and never a root SKILL.md", () => {
    expect(isSkillFilePath("references/guide.md")).toBe(true);
    expect(isSkillFilePath("nested/SKILL.md")).toBe(true);
    for (const invalid of [
      "SKILL.md",
      "skill.md",
      "../escape",
      "a//b",
      "a/./b",
      "a\\b",
      " lead",
      "c:d",
    ]) {
      expect(isSkillFilePath(invalid)).toBe(false);
    }
  });

  it("enforces the application's file count, size and file/directory conflicts", () => {
    const file = (filePath: string, byteSize = 1) => ({ path: filePath, byteSize });
    expect(skillFilesProblem(Array.from({ length: 201 }, (_, index) => file(`f${index}`)))).toBe(
      "skill-too-many-files",
    );
    expect(skillFilesProblem([file("big", 10_000_001)])).toBe("skill-file-too-large");
    expect(
      skillFilesProblem(Array.from({ length: 6 }, (_, index) => file(`f${index}`, 9_000_000))),
    ).toBe("skill-too-large");
    expect(skillFilesProblem([file("docs"), file("docs/a.md")])).toBe("skill-path-conflict");
    expect(skillFilesProblem([file("docs/a.md"), file("docs/b.md")])).toBeUndefined();
  });
});

describe("detectLicenseText", () => {
  it("recognizes permissive licenses and refuses anything else", () => {
    expect(detectLicenseText("Apache License\n Version 2.0, January 2004")).toBe("Apache-2.0");
    expect(
      detectLicenseText(
        "Permission is hereby granted, free of charge, to any person obtaining a copy",
      ),
    ).toBe("MIT");
    expect(
      detectLicenseText(
        "Redistribution and use in source and binary forms ... Neither the name of the copyright holder",
      ),
    ).toBe("BSD-3-Clause");
    expect(detectLicenseText("© Anthropic, PBC. All rights reserved.")).toBeUndefined();
    expect(detectLicenseText("")).toBeUndefined();
  });
});

describe("curated catalog", () => {
  it("loads every committed Skill, pinned and permissively licensed", async () => {
    const skills = Result.getOrThrow(await loadCuratedSkills(repositoryRoot));
    expect(skills.length).toBeGreaterThan(0);
    for (const { release } of skills) {
      expect(release.manifest.source._tag).toBe("github");
      if (release.manifest.source._tag === "github") {
        expect(release.manifest.source.commit).toMatch(/^[0-9a-f]{40}$/u);
      }
      const paths = release.files.map((file) => file.path);
      // Every copy carries its license notice.
      expect(paths.some((filePath) => /^LICENSE(?:\.txt)?$/u.test(filePath))).toBe(true);
      expect(release.manifest.attribution).toContain(
        release.manifest.license === "MIT" ? "MIT" : "Apache",
      );
    }
  });

  it("vendors the exact application schema it publishes into", async () => {
    const directory = path.join(repositoryRoot, "compatibility", "marketplace-skills");
    const vendored = JSON.parse(
      await fs.readFile(path.join(directory, "manifest.json"), "utf8"),
    ) as {
      readonly files: Readonly<Record<string, { readonly sha256: string }>>;
    };
    for (const [file, { sha256 }] of Object.entries(vendored.files)) {
      const bytes = await fs.readFile(path.join(directory, file));
      expect(createHash("sha256").update(bytes).digest("hex")).toBe(sha256);
    }
  });
});
