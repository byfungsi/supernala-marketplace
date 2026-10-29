import { readFile } from "node:fs/promises";
import { expect, it } from "@effect/vitest";
import { Result } from "effect";
import { canonicalPluginJson, digestPluginBytes } from "./plugin-contract.js";
import { digestPluginOAuthProviderDefinition } from "./oauth-provider-definition.js";
import { captureRemoteMcpCatalog } from "./remote-catalog-capture.js";
import { validateManagedRemotePluginRelease } from "./remote-release.js";

it.each([
  ["atlassian", 117],
  ["canva", 49],
  ["buffer", 17],
  ["github", 46],
  ["slack", 27],
] as const)("binds %s authority to all %i consented tool schemas", async (slug, count) => {
  const captured = JSON.parse(
    await readFile(`fixtures/mcp/captures/${slug}-20261028.json`, "utf8"),
  );
  const observed = await captureRemoteMcpCatalog({ tools: captured.tools });
  if (Result.isFailure(observed)) throw new Error(observed.failure);
  expect(observed.success.digest).toBe(captured.digest);
  expect(observed.success.tools).toHaveLength(count);
  const parsed = validateManagedRemotePluginRelease(
    JSON.parse(await readFile(`plugins/remotes/${slug}.json`, "utf8")),
    "authoring",
  );
  if (Result.isFailure(parsed)) throw new Error(parsed.failure);
  const release = parsed.success;
  expect(release.catalog.tools).toHaveLength(count);
  for (const observedTool of observed.success.tools) {
    const reviewedTool = release.catalog.tools.find((tool) => tool.mcpName === observedTool.name);
    expect(reviewedTool?.inputSchema).toEqual(observedTool.inputSchema);
    if (reviewedTool?.classification !== "read") {
      expect(reviewedTool?.defaultPolicy).not.toBe("allow");
    }
  }
  expect(release.catalog.digest).toBe(
    await digestPluginBytes(
      new TextEncoder().encode(
        canonicalPluginJson({ schemaVersion: 1, tools: release.catalog.tools }),
      ),
    ),
  );
  if (release.oauthProviderDefinition === undefined) throw new Error("provider-definition-missing");
  expect(release.providerDefinitionDigest).toBe(
    await digestPluginOAuthProviderDefinition(release.oauthProviderDefinition),
  );
  expect(release.authStrategy?.profile).toBe("mcp-oauth");
});

it("labels the owner-authorized Slack preview without claiming directory approval", async () => {
  const source = JSON.parse(await readFile("plugins/remotes/slack.json", "utf8"));
  const parsed = validateManagedRemotePluginRelease(source, "publication");
  expect(Result.isSuccess(parsed)).toBe(true);
  expect(source.name).toBe("Slack (Preview)");
  expect(source.description).toContain("approval is pending");
  const index = JSON.parse(await readFile("releases/index.json", "utf8"));
  expect(
    index.plugins.find(
      (entry: { readonly sourceDirectory: string }) =>
        entry.sourceDirectory === "plugins/remotes/slack.json",
    )?.publicationEligible,
  ).toBe(true);
});
