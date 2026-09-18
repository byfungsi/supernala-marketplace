import { readFile } from "node:fs/promises";
import { expect, it } from "@effect/vitest";
import { Schema } from "effect";
import { PluginProvenance } from "./authoring-validation.js";
import { PackageManifest } from "./package-archive.js";
import { digestPluginBytes, PluginSha256 } from "./plugin-contract.js";

const GithubBuildRecipe = Schema.Struct({
  license: Schema.Literal("MIT"),
  licenseFile: Schema.Literal("plugins/github/LICENSE"),
  noticeFile: Schema.Literal("plugins/github/NOTICE"),
  preservedThirdPartyNotices: Schema.Array(Schema.String),
  packageFiles: Schema.Array(
    Schema.Struct({
      source: Schema.NonEmptyString,
      destination: Schema.NonEmptyString,
      sha256: PluginSha256,
    }),
  ),
});

const readJsonObject = async (file: string): Promise<Schema.JsonObject> =>
  Schema.decodeUnknownSync(Schema.JsonObject)(JSON.parse(await readFile(file, "utf8")));

it("licenses repository-owned source and the first-party GitHub candidate under MIT", async () => {
  const [rootLicense, githubLicense, rootNotice, githubNotice, githubSource] = await Promise.all([
    readFile("LICENSE", "utf8"),
    readFile("plugins/github/LICENSE", "utf8"),
    readFile("NOTICE", "utf8"),
    readFile("plugins/github/NOTICE", "utf8"),
    readFile("plugins/github/source/server.mjs", "utf8"),
  ]);

  expect(githubLicense).toBe(rootLicense);
  expect(rootLicense).toContain("MIT License");
  expect(rootLicense).toContain("Copyright (c) 2026 Supernala contributors");
  expect(rootNotice).toContain("Third-party dependencies");
  expect(githubNotice).toContain("GitHub's applicable rights and terms");
  expect(githubSource.startsWith("// SPDX-License-Identifier: MIT\n")).toBe(true);
  expect(githubSource).toContain("process.env.PLUGIN_ACCESS_TOKEN");
  expect(githubSource).not.toContain("GITHUB_INSTALLATION_ACCESS_TOKEN");
});

it("records MIT package, candidate, provenance, and build metadata without enabling release", async () => {
  const [rootPackage, infraPackage, candidate, provenanceJson, recipe, releaseIndex] =
    await Promise.all([
      readJsonObject("package.json"),
      readJsonObject("tools/infra/package.json"),
      readJsonObject("plugins/github/candidate.json"),
      readJsonObject("plugins/github/provenance.json"),
      readJsonObject("plugins/github/build-recipe.json"),
      readJsonObject("releases/index.json"),
    ]);
  const provenance = Schema.decodeUnknownSync(PluginProvenance)(provenanceJson);
  const buildRecipe = Schema.decodeUnknownSync(GithubBuildRecipe)(recipe);
  const manifest = Schema.decodeUnknownSync(PackageManifest, { onExcessProperty: "error" })(
    JSON.parse(await readFile("plugins/github/package-manifest.json", "utf8")),
  );

  expect(rootPackage.license).toBe("MIT");
  expect(infraPackage.license).toBe("MIT");
  expect(candidate.license).toBe("MIT");
  expect(candidate.status).toBe("staged-nonpublishable");
  expect(provenance.license).toEqual({
    spdx: "MIT",
    status: "approved-first-party-source",
    file: "plugins/github/LICENSE",
    notice: "plugins/github/NOTICE",
    copyright: "Copyright (c) 2026 Supernala contributors",
  });
  expect(buildRecipe.preservedThirdPartyNotices).toEqual([]);
  expect(manifest.licenseEvidence).toEqual({
    kind: "spdx-mit-full-text",
    license: {
      path: "LICENSE",
      sha256: "21be23755fcecf50aec5729fe4a36db0e6600175e276716b55a61da91ac07091",
    },
    notice: {
      path: "NOTICE",
      sha256: "29d7f3fdd6c998da171c49c271f2edfb7f9175e666e1ad7d20120945d4be3378",
    },
  });
  expect(manifest.authentication).toEqual({
    kind: "github-app",
    providerRegistration: "supernala-github-app-v1",
    credentialDelivery: "short-lived-installation-token-only",
  });
  expect(buildRecipe.packageFiles.map(({ destination }) => destination).toSorted()).toEqual([
    "LICENSE",
    "NOTICE",
    "catalog.json",
    "config.json",
    "dist/server.mjs",
    "plugin.json",
    "provenance.json",
  ]);
  for (const packagedFile of buildRecipe.packageFiles) {
    expect(await digestPluginBytes(new Uint8Array(await readFile(packagedFile.source)))).toBe(
      packagedFile.sha256,
    );
  }
  expect(releaseIndex.plugins).toContainEqual({
    sourceDirectory: "plugins/github",
    kind: "managed-package",
    publicationEligible: false,
    reason: "provider registration, independent review, and live acceptance remain unverified",
  });
});

it("preserves synthetic fixture license metadata as test data", async () => {
  await expect(readFile("plugins/offline-fixture/LICENSE", "utf8")).resolves.toBe(
    "LicenseRef-Testing-Only\n",
  );
});
