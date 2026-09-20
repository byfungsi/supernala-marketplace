import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { expect, it } from "@effect/vitest";
import { Result, Schema } from "effect";
import {
  deriveBootstrapAuthoritySnapshot,
  deriveManagedRemoteAuthoritySnapshot,
  diffPluginAuthority,
} from "./authority-diff.js";
import { PackagedPluginAuthentication } from "./package-archive.js";
import { OAuthScopeSet } from "./oauth-provider-definition.js";
import {
  canonicalPluginJson,
  digestPluginBytes,
  PluginSha256,
  PluginVersion,
} from "./plugin-contract.js";
import {
  preparePluginAuthoringSource,
  scaffoldPluginAuthoringSource,
  validatePluginAuthoringSource,
} from "./plugin-authoring.js";
import {
  calculateAuthorityBaselineDigest,
  calculateReleaseDigest,
  type ReleaseReview,
} from "./release-bundle.js";
import { PluginReleaseIdentity } from "./release-machine.js";
import {
  buildManagedRemoteReleaseBundle,
  calculateManagedRemoteSourceInputDigest,
  loadManagedRemoteReleaseBundle,
} from "./remote-release-bundle.js";
import { captureRemoteMcpCatalog } from "./remote-catalog-capture.js";
import { validateManagedRemotePluginRelease } from "./remote-release.js";

it("scaffolds, validates, and prepares a second controlled remote using only plugin-owned files", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "marketplace-remote-authoring-"));
  try {
    const created = await scaffoldPluginAuthoringSource({
      rootDirectory: root,
      slug: "controlled-remote",
      runtime: "managed-remote-mcp",
    });
    expect(created).toMatchObject({ _tag: "Success" });
    if (Result.isFailure(created)) throw new Error(created.failure);
    expect(created.success.files).toEqual(["remote.json"]);

    const staged = await validatePluginAuthoringSource(created.success.directory);
    expect(staged).toEqual(
      Result.succeed({
        runtime: "managed-remote-mcp",
        plugin: "supernala/controlled-remote",
        version: "1.0.0",
        tools: 0,
        publicationEligible: false,
        publicationBlocker: "remote-release-not-reviewed",
      }),
    );

    const declarationFile = path.join(created.success.directory, "remote.json");
    const declaration = JSON.parse(await readFile(declarationFile, "utf8"));
    const captured = await captureRemoteMcpCatalog({
      tools: [
        {
          name: "get_record",
          description: "Returns one synthetic controlled record",
          inputSchema: {
            type: "object",
            properties: { id: { type: "string", maxLength: 80 } },
            required: ["id"],
            additionalProperties: false,
          },
        },
      ],
    });
    if (Result.isFailure(captured)) throw new Error(captured.failure);
    await writeFile(
      declarationFile,
      `${JSON.stringify(
        {
          ...declaration,
          status: "reviewed-publishable",
          providerDefinitionDigest: "a".repeat(64),
          scopes: ["controlled.records.read"],
          catalog: {
            id: "controlled-remote-catalog-v1",
            schemaVersion: 1,
            digest: captured.success.digest,
            tools: [
              {
                id: "controlled-remote.get-record",
                mcpName: "get_record",
                title: "Get controlled record",
                description: "Returns one synthetic controlled record",
                classification: "read",
                defaultPolicy: "allow",
                inputSchema: {
                  type: "object",
                  properties: { id: { type: "string", maxLength: 80 } },
                  required: ["id"],
                  additionalProperties: false,
                },
                maximumOutputBytes: 4_096,
              },
            ],
          },
          evidenceUrls: ["https://controlled-remote.invalid/review-evidence"],
          verificationNotes: "Controlled fixture reviewed only for offline adapter behavior.",
        },
        null,
        2,
      )}\n`,
    );

    const reviewed = await validatePluginAuthoringSource(created.success.directory);
    expect(Result.isSuccess(reviewed)).toBe(true);
    if (Result.isFailure(reviewed)) throw new Error(reviewed.failure);
    expect(reviewed.success).toMatchObject({
      runtime: "managed-remote-mcp",
      publicationEligible: true,
      tools: 1,
    });
    const output = path.join(root, "prepared", "controlled-remote.json");
    expect(
      await preparePluginAuthoringSource({
        sourcePath: created.success.directory,
        outputFile: output,
      }),
    ).toEqual(
      Result.succeed({
        runtime: "managed-remote-mcp",
        publicationEligible: true,
        publicationBlocker: null,
      }),
    );
    const prepared = JSON.parse(await readFile(output, "utf8"));
    expect(prepared).toMatchObject({
      schemaVersion: 1,
      kind: "managed-remote-mcp",
      publication: "not-performed",
      publicationEligible: true,
      declaration: { pluginSlug: "controlled-remote" },
    });

    const remote = validateManagedRemotePluginRelease(prepared.declaration, "publication");
    if (Result.isFailure(remote)) throw new Error(remote.failure);
    const reviewedTool = remote.success.catalog.tools[0];
    if (reviewedTool === undefined) throw new Error("controlled-reviewed-tool-missing");
    const remoteWithTools = (tools: ReadonlyArray<object>) => ({
      schemaVersion: remote.success.schemaVersion,
      status: remote.success.status,
      id: remote.success.id,
      marketplaceId: remote.success.marketplaceId,
      publisherNamespace: remote.success.publisherNamespace,
      pluginSlug: remote.success.pluginSlug,
      version: remote.success.version,
      name: remote.success.name,
      description: remote.success.description,
      license: remote.success.license,
      runtime: remote.success.runtime,
      endpoint: remote.success.endpoint,
      oauthRegistrationMode: remote.success.oauthRegistrationMode,
      providerDefinitionDigest: remote.success.providerDefinitionDigest,
      scopes: remote.success.scopes,
      catalog: {
        id: remote.success.catalog.id,
        schemaVersion: remote.success.catalog.schemaVersion,
        digest: remote.success.catalog.digest,
        tools,
      },
      config: remote.success.config,
      allowedHosts: remote.success.allowedHosts,
      protocolPolicy: remote.success.protocolPolicy,
      evidenceUrls: remote.success.evidenceUrls,
      verificationNotes: remote.success.verificationNotes,
    });
    const changedDispatchTool = {
      id: reviewedTool.id,
      mcpName: "executeRead",
      title: reviewedTool.title,
      description: reviewedTool.description,
      classification: reviewedTool.classification,
      defaultPolicy: reviewedTool.defaultPolicy,
      inputSchema: reviewedTool.inputSchema,
      maximumOutputBytes: reviewedTool.maximumOutputBytes,
    };
    const duplicateTool = {
      id: "controlled-remote.duplicate-record",
      mcpName: reviewedTool.mcpName,
      title: reviewedTool.title,
      description: reviewedTool.description,
      classification: reviewedTool.classification,
      defaultPolicy: reviewedTool.defaultPolicy,
      inputSchema: reviewedTool.inputSchema,
      maximumOutputBytes: reviewedTool.maximumOutputBytes,
    };
    expect(
      validateManagedRemotePluginRelease(remoteWithTools([changedDispatchTool]), "publication"),
    ).toEqual(Result.fail("remote-catalog-generic-dispatch-tool-forbidden"));
    expect(
      validateManagedRemotePluginRelease(
        remoteWithTools([reviewedTool, duplicateTool]),
        "publication",
      ),
    ).toEqual(Result.fail("remote-catalog-duplicate-tool-name"));
    const identity = PluginReleaseIdentity.make({
      marketplaceId: remote.success.marketplaceId,
      publisherNamespace: remote.success.publisherNamespace,
      pluginSlug: remote.success.pluginSlug,
      semanticVersion: remote.success.version,
    });
    const sharedInputDigest = PluginSha256.make("c".repeat(64));
    const sourceInputDigest = await calculateManagedRemoteSourceInputDigest({
      sourceFile: declarationFile,
      sharedInputDigest,
    });
    const configDigest = await digestPluginBytes(
      new TextEncoder().encode(canonicalPluginJson(remote.success.config)),
    );
    const authentication = PackagedPluginAuthentication.make({
      kind: "oauth",
      providerRegistration: remote.success.runtime.providerRegistrationId,
      providerDefinitionDigest:
        remote.success.providerDefinitionDigest ?? PluginSha256.make("0".repeat(64)),
      requestedScopes: Schema.decodeUnknownSync(OAuthScopeSet)(remote.success.scopes),
      credentialDelivery: "short-lived-access-token-only",
    });
    const provenance = {
      kind: "managed-remote-mcp",
      endpoint: remote.success.endpoint,
      oauthRegistrationMode: remote.success.oauthRegistrationMode,
      protocolPolicy: remote.success.protocolPolicy ?? {
        catalogCompatibility: "reviewed-subset" as const,
        maximumCatalogPages: 10,
      },
      evidenceUrls: remote.success.evidenceUrls ?? [],
      verificationNotes: remote.success.verificationNotes,
    } as const;
    const provenanceDigest = await digestPluginBytes(
      new TextEncoder().encode(canonicalPluginJson(provenance)),
    );
    const authorityAfter = deriveManagedRemoteAuthoritySnapshot(remote.success);
    const authorityBefore = deriveBootstrapAuthoritySnapshot(authorityAfter);
    const authorityBeforeDigest = await digestPluginBytes(
      new TextEncoder().encode(canonicalPluginJson(authorityBefore)),
    );
    const authorityDigest = await digestPluginBytes(
      new TextEncoder().encode(canonicalPluginJson(authorityAfter)),
    );
    const authorityDiff = await diffPluginAuthority(authorityBefore, authorityAfter);
    const authorityDiffDigest = PluginSha256.make(authorityDiff.diffDigest);
    const baseline = {
      authorityBeforeIdentity: null,
      authorityBeforeReleaseDigest: null,
      authorityBefore,
      authorityBeforeDigest,
    } as const;
    const authorityBaselineDigest = await calculateAuthorityBaselineDigest(baseline);
    const version = PluginVersion.make({
      id: remote.success.id,
      marketplaceId: remote.success.marketplaceId,
      publisherNamespace: remote.success.publisherNamespace,
      pluginSlug: remote.success.pluginSlug,
      version: remote.success.version,
      name: remote.success.name,
      description: remote.success.description,
      license: remote.success.license,
      runtime: remote.success.runtime,
      catalog: remote.success.catalog,
      config: remote.success.config,
      allowedHosts: remote.success.allowedHosts,
      status: "published",
      publishedAt: 1,
    });
    const releaseDigest = await calculateReleaseDigest({
      identity,
      version,
      authentication,
      sourceInputDigest,
      catalogDigest: remote.success.catalog.digest,
      configDigest,
      provenanceDigest,
      authorityBaselineDigest,
      authorityDigest,
      authorityDiffDigest,
      artifactDigest: null,
    });
    const review: ReleaseReview = {
      schemaVersion: 1,
      identity,
      reviewId: "controlled-remote-review",
      reviewer: "controlled-test-reviewer",
      reviewedAt: 1,
      sourceInputDigest,
      artifactDigest: null,
      authentication,
      catalogDigest: remote.success.catalog.digest,
      configDigest,
      provenanceDigest,
      ...baseline,
      authorityAfter,
      authorityDigest,
      authorityDiffDigest,
      releaseDigest,
      decision: "approved",
    };
    const bundleDirectory = path.join(root, "bundle");
    const bundle = await buildManagedRemoteReleaseBundle({
      sourceFile: declarationFile,
      outputDirectory: bundleDirectory,
      sharedInputDigest,
      mergeCommit: "d".repeat(40),
      releaseOrdinal: 1,
      review,
      previousPublished: null,
    });
    expect(Result.isSuccess(bundle)).toBe(true);
    expect(
      Result.isSuccess(
        await loadManagedRemoteReleaseBundle({
          bundleDirectory,
          sourceFile: declarationFile,
          sharedInputDigest,
          trustedReview: review,
          expectedMergeCommit: "d".repeat(40),
          expectedReleaseOrdinal: 1,
        }),
      ),
    ).toBe(true);
  } finally {
    await rm(root, { recursive: true });
  }
});

it("rejects traversal names and refuses to overwrite scaffold or prepared remote files", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "marketplace-safe-scaffold-"));
  try {
    expect(
      await scaffoldPluginAuthoringSource({
        rootDirectory: root,
        slug: "../escape",
        runtime: "managed-remote-mcp",
      }),
    ).toEqual(Result.fail("plugin-slug-invalid"));
    const first = await scaffoldPluginAuthoringSource({
      rootDirectory: root,
      slug: "safe-plugin",
      runtime: "managed-remote-mcp",
    });
    expect(Result.isSuccess(first)).toBe(true);
    expect(
      await scaffoldPluginAuthoringSource({
        rootDirectory: root,
        slug: "safe-plugin",
        runtime: "managed-remote-mcp",
      }),
    ).toEqual(Result.fail("plugin-source-already-exists"));
    if (Result.isFailure(first)) throw new Error(first.failure);
    const output = path.join(root, "prepared.json");
    expect(
      Result.isSuccess(
        await preparePluginAuthoringSource({
          sourcePath: first.success.directory,
          outputFile: output,
        }),
      ),
    ).toBe(true);
    expect(
      await preparePluginAuthoringSource({
        sourcePath: first.success.directory,
        outputFile: output,
      }),
    ).toEqual(Result.fail("prepared-output-already-exists"));
  } finally {
    await rm(root, { recursive: true });
  }
});

it("scaffolds a valid non-publishable managed package with unchanged public validate/prepare flow", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "marketplace-package-authoring-"));
  try {
    const created = await scaffoldPluginAuthoringSource({
      rootDirectory: root,
      slug: "controlled-package",
      runtime: "managed-package",
      auth: "workspace-oauth",
    });
    if (Result.isFailure(created)) throw new Error(created.failure);
    expect(
      JSON.parse(await readFile(path.join(created.success.directory, "plugin.json"), "utf8")),
    ).toMatchObject({
      authentication: {
        kind: "oauth",
        providerRegistration: "controlled-package-oauth-v1",
        credentialDelivery: "short-lived-access-token-only",
      },
      authStrategy: {
        profile: "workspace-oauth",
        providerRegistrationId: "controlled-package-oauth-v1",
      },
    });
    const validated = await validatePluginAuthoringSource(created.success.directory);
    expect(Result.isSuccess(validated)).toBe(true);
    if (Result.isFailure(validated)) throw new Error(validated.failure);
    expect(validated.success).toMatchObject({
      runtime: "managed-package",
      publicationEligible: false,
    });
    const output = path.join(root, "controlled-package.plugin");
    const prepared = await preparePluginAuthoringSource({
      sourcePath: created.success.directory,
      outputFile: output,
    });
    expect(Result.isSuccess(prepared)).toBe(true);
    if (Result.isFailure(prepared)) throw new Error(prepared.failure);
    expect(prepared.success).toMatchObject({ runtime: "managed-package" });
    expect(
      await scaffoldPluginAuthoringSource({
        rootDirectory: root,
        slug: "unsupported-device-package",
        runtime: "managed-package",
        auth: "device-oauth",
      }),
    ).toEqual(Result.fail("managed-package-auth-profile-unsupported"));
  } finally {
    await rm(root, { recursive: true });
  }
});

it("validates and prepares existing build-recipe package candidates through the same facade", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "marketplace-recipe-authoring-"));
  try {
    for (const slug of ["github", "gmail"]) {
      const sourcePath = `plugins/${slug}`;
      const validated = await validatePluginAuthoringSource(sourcePath);
      expect(Result.isSuccess(validated)).toBe(true);
      if (Result.isFailure(validated)) throw new Error(validated.failure);
      expect(validated.success.runtime).toBe("managed-package");
      const prepared = await preparePluginAuthoringSource({
        sourcePath,
        outputFile: path.join(root, `${slug}.plugin`),
      });
      expect(Result.isSuccess(prepared)).toBe(true);
      if (Result.isFailure(prepared)) throw new Error(prepared.failure);
      expect(prepared.success.runtime).toBe("managed-package");
    }
  } finally {
    await rm(root, { recursive: true });
  }
});

it("validates and prepares the Notion and Resend provider-owned remote declarations", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "marketplace-provider-expansion-authoring-"));
  try {
    for (const slug of ["notion", "resend"]) {
      const sourcePath = `plugins/remotes/${slug}.json`;
      const validated = await validatePluginAuthoringSource(sourcePath);
      expect(Result.isSuccess(validated)).toBe(true);
      if (Result.isFailure(validated)) throw new Error(validated.failure);
      expect(validated.success).toMatchObject({
        runtime: "managed-remote-mcp",
        plugin: `supernala/${slug}`,
        publicationEligible: false,
        publicationBlocker: "remote-release-not-reviewed",
      });
      const prepared = await preparePluginAuthoringSource({
        sourcePath,
        outputFile: path.join(root, `${slug}.json`),
      });
      expect(Result.isSuccess(prepared)).toBe(true);
      if (Result.isFailure(prepared)) throw new Error(prepared.failure);
      expect(prepared.success).toMatchObject({ runtime: "managed-remote-mcp" });
    }
    const resend = validateManagedRemotePluginRelease(
      JSON.parse(await readFile("plugins/remotes/resend.json", "utf8")),
      "authoring",
    );
    if (Result.isFailure(resend) || resend.success.authStrategy?.profile !== "mcp-oauth") {
      throw new Error("resend-auth-strategy-missing");
    }
    const clientRegistration = resend.success.authStrategy.clientRegistration;
    if (clientRegistration.kind !== "cimd") throw new Error("resend-cimd-registration-missing");
    const publicOrigin = new URL(clientRegistration.clientIdMetadataDocumentUrl).origin;
    const rendered = (
      await readFile("plugins/remotes/resend-cimd.json.template", "utf8")
    ).replaceAll("{{PUBLIC_ORIGIN}}", publicOrigin);
    expect(rendered).not.toContain("{{PUBLIC_ORIGIN}}");
    expect(JSON.parse(rendered)).toEqual({
      client_id: clientRegistration.clientIdMetadataDocumentUrl,
      redirect_uris: [`${publicOrigin}/v1/plugins/oauth/callback`],
      token_endpoint_auth_method: "none",
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      client_name: "Supernala Resend MCP",
    });
  } finally {
    await rm(root, { recursive: true });
  }
});
