import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { Result } from "effect";
import { describe, expect, it } from "vitest";
import {
  eligiblePluginDefinitionIds,
  loadPluginSetupGuides,
  parsePluginSetupGuide,
  pluginsMissingSetupGuides,
} from "./plugin-setup-guide.js";

const repositoryRoot = path.resolve(import.meta.dirname, "..");
const guidePath = path.join("guides", "acme", "mail.md");

const guide = (body: string, frontmatter = "plugin: supernala-public:acme:mail\nrevision: 2") =>
  `---\n${frontmatter}\n---\n\n${body}\n`;

const valid = [
  "# Set up Mail",
  "",
  "1. Open the [console](https://console.example.com/) and add `{{oauthCallbackUrl}}`.",
  "2. Copy the `<client-id>` value.",
  "",
  "## In Supernala",
  "",
  "Click **Install**.",
].join("\n");

describe("plugin setup guides", () => {
  it("parses a guide into the body and digest the application stores", () => {
    const parsed = parsePluginSetupGuide(guidePath, guide(valid));

    expect(Result.isSuccess(parsed) && parsed.success).toEqual({
      definitionId: "supernala-public:acme:mail",
      revision: 2,
      markdown: valid,
      contentSha256: createHash("sha256").update(valid).digest("hex"),
      relativePath: guidePath,
    });
  });

  it.each([
    ["guide-frontmatter-invalid", guide(valid, "plugin: Mail\nrevision: 1")],
    ["guide-frontmatter-invalid", guide(valid, "plugin: supernala-public:acme:mail\nrevision: 0")],
    ["guide-frontmatter-invalid", `${valid}\n`],
    ["guide-path-mismatch", guide(valid, "plugin: supernala-public:acme:other\nrevision: 1")],
    ["guide-path-mismatch", guide(valid, "plugin: private-team:acme:mail\nrevision: 1")],
    ["guide-html-not-allowed", guide(`${valid}\n\n<script>alert(1)</script>`)],
    ["guide-image-not-allowed", guide(`${valid}\n\n![pixel](https://example.com/p.png)`)],
    ["guide-link-not-https", guide(`${valid}\n\n[Docs](http://example.com/)`)],
    ["guide-placeholder-unknown", guide(`${valid}\n\nUse {{apiKey}}.`)],
    ["guide-supernala-section-missing", guide("# Set up Mail\n\nSteps.")],
    ["guide-too-long", guide(`${valid}\n\n${"x".repeat(16_001)}`)],
  ])("rejects a guide with %s", (problem, source) => {
    const parsed = parsePluginSetupGuide(guidePath, source);

    expect(Result.isFailure(parsed) && parsed.failure).toBe(problem);
  });

  it("covers every publication-eligible Plugin with a valid guide", async () => {
    const guides = await loadPluginSetupGuides(repositoryRoot);
    const eligible = await eligiblePluginDefinitionIds(repositoryRoot);
    if (Result.isFailure(guides)) throw new Error(guides.failure);
    if (Result.isFailure(eligible)) throw new Error(eligible.failure);

    expect(eligible.success.length).toBeGreaterThan(0);
    expect(pluginsMissingSetupGuides(eligible.success, guides.success)).toEqual([]);
    for (const loaded of guides.success) {
      expect(loaded.markdown).not.toMatch(/\b(sk|re|ghp|xox[bp])_[A-Za-z0-9]{12,}/u);
    }
  });

  it("vendors the exact application schema it publishes into", async () => {
    const directory = path.join(repositoryRoot, "compatibility", "plugin-setup-guides");
    const vendored = JSON.parse(
      await fs.readFile(path.join(directory, "manifest.json"), "utf8"),
    ) as { readonly files: Readonly<Record<string, { readonly sha256: string }>> };
    for (const [file, { sha256 }] of Object.entries(vendored.files)) {
      const bytes = await fs.readFile(path.join(directory, file));
      expect(createHash("sha256").update(bytes).digest("hex")).toBe(sha256);
    }
  });
});
