import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { Result, Schema } from "effect";
import { describe, expect, it } from "vitest";
import {
  behaviorOffsetMinutes,
  checkPluginBehaviorDeclaration,
  isCoherentFailureHandling,
  parseBehaviorWakeWhen,
  parsePluginBehavior,
  type BehaviorCatalogTool,
  type PluginBehaviorProblem,
} from "./plugin-behavior.js";
import {
  behaviorCatalogTool,
  loadBehaviorCatalogSources,
  validatePluginBehaviors,
} from "./plugin-behavior-catalog.js";
import { canonicalPluginJson } from "./plugin-contract.js";
import { eligiblePluginDefinitionIds } from "./plugin-setup-guide.js";

const repositoryRoot = path.resolve(import.meta.dirname, "..");

const Conformance = Schema.Struct({
  relativePath: Schema.String,
  tools: Schema.Array(
    Schema.Struct({
      id: Schema.String,
      classification: Schema.String,
      inputSchema: Schema.JsonObject,
    }),
  ),
  accepted: Schema.Array(Schema.Struct({ name: Schema.String, declaration: Schema.JsonObject })),
  rejected: Schema.Array(
    Schema.Struct({ name: Schema.String, problem: Schema.String, declaration: Schema.JsonObject }),
  ),
});

const conformance = Schema.decodeUnknownSync(Conformance)(
  JSON.parse(
    await fs.readFile(path.join(repositoryRoot, "fixtures/behaviors/conformance.json"), "utf8"),
  ),
);
const tools: ReadonlyArray<BehaviorCatalogTool> = conformance.tools.map(behaviorCatalogTool);

/** The first problem the Marketplace reports for one declaration, or `undefined`. */
const firstProblem = (declaration: Schema.JsonObject): PluginBehaviorProblem | undefined => {
  const parsed = parsePluginBehavior(conformance.relativePath, JSON.stringify(declaration));
  if (Result.isFailure(parsed)) return parsed.failure.problem;
  return checkPluginBehaviorDeclaration(parsed.success.declaration, tools)[0]?.problem;
};

describe("plugin behaviour declarations", () => {
  it.each(conformance.accepted)("accepts $name", ({ declaration }) => {
    expect(firstProblem(declaration)).toBeUndefined();
  });

  it.each(conformance.rejected)("rejects $name with $problem", ({ declaration, problem }) => {
    expect(firstProblem(declaration)).toBe(problem);
  });

  it("stores the canonical JSON and its digest", () => {
    const declaration = conformance.accepted[0]?.declaration ?? {};
    const parsed = parsePluginBehavior(
      conformance.relativePath,
      JSON.stringify(declaration, null, 2),
    );
    if (Result.isFailure(parsed)) throw new Error(parsed.failure.problem);
    const canonical = canonicalPluginJson(declaration);

    expect(parsed.success).toMatchObject({
      definitionId: "supernala-public:acme:mail",
      revision: 1,
      canonicalJson: canonical,
      contentSha256: createHash("sha256").update(canonical).digest("hex"),
    });
  });

  it("refuses files over the size bound and invalid JSON", () => {
    expect(parsePluginBehavior(conformance.relativePath, "{").pipe(Result.isFailure)).toBe(true);
    const parsed = parsePluginBehavior(conformance.relativePath, " ".repeat(65_537));
    expect(Result.isFailure(parsed) && parsed.failure.problem).toBe("behavior-too-large");
  });

  it("reads offsets in minutes", () => {
    expect(["+5m", "+6h", "+7d", "6h", "+0m", "+1w"].map(behaviorOffsetMinutes)).toEqual([
      5,
      360,
      10_080,
      undefined,
      undefined,
      undefined,
    ]);
  });

  it("parses wake conditions, including options that contain or", () => {
    const judge = {
      classify: { name: "kind", options: ["ticket or booking", "bill"] },
      yesNo: { name: "urgent", question: "Is it urgent?" },
      score: { name: "reach", question: "How far?", levels: ["low", "usual", "high"] },
    };
    const parsed = parseBehaviorWakeWhen(
      "kind = ticket or booking or urgent != no or reach >= usual",
      judge,
    );

    expect(Result.isSuccess(parsed) && parsed.success).toEqual([
      { name: "kind", operator: "=", value: "ticket or booking" },
      { name: "urgent", operator: "!=", value: "no" },
      { name: "reach", operator: ">=", value: "usual", level: 2 },
    ]);
    expect(Result.isFailure(parseBehaviorWakeWhen("urgent >= yes", judge))).toBe(true);
    expect(Result.isFailure(parseBehaviorWakeWhen("urgent = yes and kind = bill", judge))).toBe(
      true,
    );
  });

  it("allows only coherent failure handling", () => {
    expect(isCoherentFailureHandling("auth_expired", "auto", "refresh_token")).toBe(true);
    expect(isCoherentFailureHandling("watch_expired", "auto", "rewatch")).toBe(true);
    expect(isCoherentFailureHandling("schema_changed", "publisher", "report")).toBe(true);
    expect(isCoherentFailureHandling("not_found", "none", "none")).toBe(true);
    expect(isCoherentFailureHandling("not_found", "auto", "rewatch")).toBe(false);
    expect(isCoherentFailureHandling("schema_changed", "auto", "retry")).toBe(false);
    expect(isCoherentFailureHandling("auth_revoked", "publisher", "reconnect")).toBe(false);
  });
});

describe("repository behaviour declarations", () => {
  it("checks every declaration against its definition's reviewed catalog", async () => {
    const behaviors = await validatePluginBehaviors(repositoryRoot);
    if (Result.isFailure(behaviors)) throw new Error(behaviors.failure.join("\n"));

    expect(behaviors.success.length).toBeGreaterThan(0);
  });

  it("declares behaviour only for publication-eligible Plugins", async () => {
    const behaviors = await validatePluginBehaviors(repositoryRoot);
    const eligible = await eligiblePluginDefinitionIds(repositoryRoot);
    if (Result.isFailure(behaviors) || Result.isFailure(eligible)) throw new Error("load failed");

    for (const behavior of behaviors.success) {
      expect(eligible.success).toContain(behavior.definitionId);
    }
  });

  it("resolves a definition to its publication-eligible source", async () => {
    const sources = await loadBehaviorCatalogSources(repositoryRoot);
    if (Result.isFailure(sources)) throw new Error(sources.failure);

    expect(sources.success.get("supernala-public:supernala:slack")?.sourceDirectory).toBe(
      "plugins/slack-api",
    );
    expect(sources.success.get("supernala-public:supernala:github")?.sourceDirectory).toBe(
      "plugins/remotes/github.json",
    );
    expect(sources.success.get("supernala-public:supernala:gmail")?.sourceDirectory).toBe(
      "plugins/gmail",
    );
  });

  it("keeps declarations outside every Plugin source root and release input", async () => {
    const index = JSON.parse(
      await fs.readFile(path.join(repositoryRoot, "releases/index.json"), "utf8"),
    ) as {
      readonly sharedInputs: ReadonlyArray<string>;
      readonly plugins: ReadonlyArray<{ readonly sourceDirectory: string }>;
    };
    for (const input of [
      ...index.sharedInputs,
      ...index.plugins.map((plugin) => plugin.sourceDirectory),
    ]) {
      expect(input.startsWith("behaviors/")).toBe(false);
    }
  });
});
