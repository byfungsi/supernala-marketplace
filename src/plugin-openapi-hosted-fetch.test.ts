import { mkdtemp, readFile, rm, writeFile, symlink, unlink } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import os from "node:os";
import path from "node:path";
import https from "node:https";
import type { TLSSocket } from "node:tls";
import { readFileSync } from "node:fs";
import { once } from "node:events";
import { Result } from "effect";
import { describe, expect, it } from "vitest";
import {
  scaffoldPluginAuthoringSource,
  preparePluginAuthoringSource,
  validatePluginAuthoringSource,
} from "./plugin-authoring.js";
import {
  fetchPluginOpenApiHostedJson,
  createNodePluginOpenApiHostedTransport,
  isPublicPluginOpenApiAddress,
  type PluginOpenApiHostedTransport,
} from "./plugin-openapi-hosted-fetch.js";
import {
  inspectPluginOpenApiHostedCandidates,
  refreshPluginOpenApiHostedSource,
} from "./plugin-openapi-source.js";
import { discoverPluginOpenApiCandidates } from "./plugin-openapi-discovery.js";

const url = "https://spec.example.org/openapi.json";
const spec = (extra = false) =>
  JSON.stringify({
    openapi: "3.1.0",
    info: { title: "Test", version: "1" },
    servers: [{ url: "https://api.example.org" }],
    components: {
      securitySchemes: { ApiKey: { type: "apiKey", in: "header", name: "x-api-key" } },
    },
    paths: {
      "/items": {
        get: {
          operationId: "items_list",
          security: [],
          responses: { "200": { description: "ok" } },
        },
        ...(extra
          ? { post: { operationId: "items_create", responses: { "200": { description: "ok" } } } }
          : {}),
      },
    },
  });
const transport = (text: string, addresses = ["8.8.8.8"]): PluginOpenApiHostedTransport => ({
  async resolve() {
    return addresses;
  },
  async get(_url, _address, _signal) {
    return {
      status: 200,
      contentType: "application/json",
      location: undefined,
      contentLength: undefined,
      body: (async function* () {
        yield new TextEncoder().encode(text);
      })(),
    };
  },
});

describe("hosted OpenAPI explicit import", () => {
  it("stages candidates, preserves reviewed selection, and compiles offline from pinned bytes", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "openapi-hosted-"));
    try {
      const created = await scaffoldPluginAuthoringSource({
        rootDirectory: root,
        slug: "hosted",
        runtime: "managed-openapi",
        auth: "api-key",
        sourceUrl: url,
      });
      expect(Result.isSuccess(created)).toBe(true);
      const directory = path.join(root, "hosted");
      expect(await validatePluginAuthoringSource(directory)).toMatchObject({
        _tag: "Failure",
        failure: "openapi-hosted-pin-required",
      });
      const first = await refreshPluginOpenApiHostedSource({
        sourcePath: directory,
        transport: transport(spec()),
      });
      expect(first).toMatchObject({
        _tag: "Success",
        success: {
          added: ["items_list"],
          candidates: [{ operationId: "items_list", authentication: "none", reason: null }],
        },
      });
      const firstMetadata = JSON.parse(
        await readFile(path.join(directory, "openapi-source.json"), "utf8"),
      );
      const prepared = await preparePluginAuthoringSource({
        sourcePath: directory,
        outputFile: path.join(root, "bundle1.json"),
      });
      expect(Result.isSuccess(prepared)).toBe(true);
      expect(await validatePluginAuthoringSource(directory)).toMatchObject({
        _tag: "Success",
        success: { publicationEligible: false, tools: 1 },
      });
      const cliOutput = path.join(root, "cli-bundle.json");
      const cliText = execFileSync("pnpm", ["marketplace", "prepare", directory, cliOutput], {
        encoding: "utf8",
      });
      const cli = JSON.parse(cliText.slice(cliText.indexOf("{")));
      expect(cli.runtime).toBe("managed-openapi");
      expect(await readFile(cliOutput)).toEqual(await readFile(path.join(root, "bundle1.json")));
      const same = await refreshPluginOpenApiHostedSource({
        sourcePath: directory,
        transport: transport(spec(true)),
      });
      expect(same).toMatchObject({
        _tag: "Failure",
        failure: "openapi-hosted-new-version-required",
      });
      expect(await readFile(path.join(directory, "openapi-source.json"), "utf8")).toContain(
        firstMetadata.hostedSource.sha256,
      );
      expect(
        await refreshPluginOpenApiHostedSource({
          sourcePath: directory,
          transport: transport("not json"),
        }),
      ).toMatchObject({ _tag: "Failure", failure: "openapi-hosted-json-invalid" });
      expect(await readFile(path.join(directory, "openapi-source.json"), "utf8")).toContain(
        firstMetadata.hostedSource.sha256,
      );
      firstMetadata.version = "1.1.0";
      firstMetadata.pluginVersionId = "supernala-public:supernala:hosted@1.1.0";
      firstMetadata.catalogSnapshotId = "hosted-catalog-v2";
      await writeFile(path.join(directory, "openapi-source.json"), JSON.stringify(firstMetadata));
      const second = await refreshPluginOpenApiHostedSource({
        sourcePath: directory,
        transport: transport(spec(true)),
      });
      expect(second).toMatchObject({ _tag: "Success", success: { added: ["items_create"] } });
      const updated = JSON.parse(
        await readFile(path.join(directory, "openapi-source.json"), "utf8"),
      );
      expect(updated.operations).toEqual(firstMetadata.operations);
      expect(
        await preparePluginAuthoringSource({
          sourcePath: directory,
          outputFile: path.join(root, "bundle2.json"),
        }),
      ).toMatchObject({ _tag: "Success" });
      const bytes = await readFile(path.join(root, "bundle2.json"));
      expect(JSON.parse(bytes.toString()).catalog.tools).toHaveLength(1);
      await writeFile(path.join(directory, `openapi-${updated.hostedSource.sha256}.json`), "{}");
      expect(await validatePluginAuthoringSource(directory)).toMatchObject({
        _tag: "Failure",
        failure: "openapi-hosted-pin-mismatch",
      });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("rejects invalid URLs, private DNS, malformed JSON, oversized streams, and deadlines", async () => {
    for (const address of [
      "2001:0db8::1",
      "2001:0DB8:0000:0000:0000:0000:0000:0001",
      "2001:0000::1",
      "2002:0a00:1::",
      "198.51.100.42",
      "100.64.1.1",
    ])
      expect(isPublicPluginOpenApiAddress(address)).toBe(false);
    expect(isPublicPluginOpenApiAddress("2001:4860:4860::8888")).toBe(true);
    for (const badUrl of [
      "http://spec.example.org/x",
      (() => {
        const credentialUrl = new URL(url);
        credentialUrl.username = "a";
        credentialUrl.password = "b";
        return credentialUrl.href;
      })(),
      "https://spec.example.org/x?token=x",
      "https://127.0.0.1/x",
      "https://spec.example.org/x#fragment",
    ]) {
      await expect(fetchPluginOpenApiHostedJson(badUrl, transport(spec()))).rejects.toThrow(
        "openapi-hosted-url-invalid",
      );
    }
    for (const address of [
      "127.0.0.1",
      "10.1.1.1",
      "169.254.1.1",
      "::1",
      "::ffff:127.0.0.1",
      "fd00::1",
    ]) {
      await expect(fetchPluginOpenApiHostedJson(url, transport(spec(), [address]))).rejects.toThrow(
        "openapi-hosted-address-rejected",
      );
    }
    await expect(fetchPluginOpenApiHostedJson(url, transport("not json"))).rejects.toThrow();
    await expect(
      fetchPluginOpenApiHostedJson(url, {
        ...transport(spec()),
        async get() {
          return {
            status: 302,
            contentType: "application/json",
            location: "https://other.example.org/x",
            contentLength: undefined,
            body: (async function* () {})(),
          };
        },
      }),
    ).rejects.toThrow("openapi-hosted-response-invalid");
    await expect(
      fetchPluginOpenApiHostedJson(url, {
        ...transport(spec()),
        async get() {
          return {
            status: 200,
            contentType: "text/html",
            location: undefined,
            contentLength: undefined,
            body: (async function* () {})(),
          };
        },
      }),
    ).rejects.toThrow("openapi-hosted-content-type-invalid");
    await expect(
      fetchPluginOpenApiHostedJson(url, transport(" ".repeat(1_048_577))),
    ).rejects.toThrow("openapi-hosted-source-too-large");
    await expect(
      fetchPluginOpenApiHostedJson(
        url,
        {
          async resolve() {
            return new Promise(() => {});
          },
          async get() {
            throw Error("unreachable");
          },
        },
        1,
      ),
    ).rejects.toThrow("openapi-hosted-deadline-exceeded");
    let finishDns!: (addresses: string[]) => void;
    let sent = 0;
    const delayed: PluginOpenApiHostedTransport = {
      async resolve() {
        return new Promise((resolve) => {
          finishDns = resolve;
        });
      },
      async get() {
        sent++;
        throw Error("unexpected-request");
      },
    };
    await expect(fetchPluginOpenApiHostedJson(url, delayed, 1)).rejects.toThrow(
      "openapi-hosted-deadline-exceeded",
    );
    finishDns(["8.8.8.8"]);
    await new Promise((resolve) => setImmediate(resolve));
    expect(sent).toBe(0);
  });

  it("auto-selects one bearer scheme, exposes ambiguous candidates and preserves explicit IDs", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "openapi-discovery-"));
    try {
      const directory = path.join(root, "bearer");
      await scaffoldPluginAuthoringSource({
        rootDirectory: root,
        slug: "bearer",
        runtime: "managed-openapi",
        auth: "api-key",
        sourceUrl: url,
      });
      const document = JSON.parse(spec());
      document.components.securitySchemes = { BearerAuth: { type: "http", scheme: "bearer" } };
      document.security = [{ BearerAuth: [] }];
      const text = JSON.stringify(document);
      const first = await refreshPluginOpenApiHostedSource({
        sourcePath: directory,
        transport: transport(text),
      });
      expect(first).toMatchObject({ _tag: "Success" });
      const metadata = JSON.parse(
        await readFile(path.join(directory, "openapi-source.json"), "utf8"),
      );
      expect(metadata.credential.securityScheme).toBe("BearerAuth");
      metadata.operations[0].toolId = "curated.inventory.list";
      metadata.version = "1.1.0";
      metadata.pluginVersionId = "supernala-public:supernala:bearer@1.1.0";
      metadata.catalogSnapshotId = "bearer-catalog-v2";
      await writeFile(path.join(directory, "openapi-source.json"), JSON.stringify(metadata));
      document.paths["/other"] = { get: { operationId: "items-list", security: [] } };
      const report = await inspectPluginOpenApiHostedCandidates({
        sourcePath: directory,
        transport: transport(JSON.stringify(document)),
      });
      expect(report).toMatchObject({
        _tag: "Success",
        success: {
          candidates: [
            { toolId: "curated.inventory.list", reason: null },
            { toolId: "items.list", reason: null },
          ],
        },
      });
      const refreshed = await refreshPluginOpenApiHostedSource({
        sourcePath: directory,
        transport: transport(JSON.stringify(document)),
      });
      expect(refreshed).toMatchObject({ _tag: "Success" });
      const after = JSON.parse(await readFile(path.join(directory, "openapi-source.json"), "utf8"));
      expect(after.operations[0].toolId).toBe("curated.inventory.list");
      document.paths["/missing"] = { head: { responses: {} } };
      document.paths["/duplicate"] = { get: { operationId: "items_list" } };
      const conflicts = await discoverPluginOpenApiCandidates(JSON.stringify(document), after);
      expect(
        conflicts.some(
          (candidate) =>
            candidate.reason === "openapi-method-unsupported" &&
            candidate.operationId === "http:HEAD:/missing",
        ),
      ).toBe(true);
      expect(
        conflicts.filter((candidate) => candidate.reason === "openapi-operation-id-collision"),
      ).toHaveLength(2);
      delete document.paths["/missing"];
      delete document.paths["/duplicate"];
      const conflictingSelection = {
        ...after,
        operations: [...after.operations, { ...after.operations[0], operationId: "items-list" }],
      };
      const explicitCollision = await discoverPluginOpenApiCandidates(
        JSON.stringify(document),
        conflictingSelection,
      );
      expect(
        explicitCollision.filter((candidate) => candidate.reason === "openapi-tool-id-collision"),
      ).toHaveLength(2);
      document.components.securitySchemes = {
        BearerAuth: { type: "http", scheme: "bearer" },
        AnotherKey: { type: "apiKey", in: "header", name: "x-api-key" },
      };
      const candidates = await inspectPluginOpenApiHostedCandidates({
        sourcePath: directory,
        transport: transport(JSON.stringify(document)),
      });
      expect(Result.isSuccess(candidates) && candidates.success.securitySchemes).toEqual([
        "AnotherKey",
        "BearerAuth",
      ]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("rejects concurrent refresh and corrupt or linked existing pins without changing metadata", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "openapi-lock-"));
    try {
      await scaffoldPluginAuthoringSource({
        rootDirectory: root,
        slug: "locked",
        runtime: "managed-openapi",
        auth: "api-key",
        sourceUrl: url,
      });
      const directory = path.join(root, "locked");
      let release!: () => void;
      let entered!: () => void;
      const waiting = new Promise<void>((resolve) => {
        release = resolve;
      });
      const started = new Promise<void>((resolve) => {
        entered = resolve;
      });
      const held: PluginOpenApiHostedTransport = {
        ...transport(spec()),
        async resolve() {
          entered();
          await waiting;
          return ["8.8.8.8"];
        },
      };
      const first = refreshPluginOpenApiHostedSource({ sourcePath: directory, transport: held });
      await started;
      expect(
        await refreshPluginOpenApiHostedSource({
          sourcePath: directory,
          transport: transport(spec()),
        }),
      ).toMatchObject({ _tag: "Failure", failure: "openapi-hosted-refresh-locked" });
      release();
      expect(await first).toMatchObject({ _tag: "Success" });
      const metadataPath = path.join(directory, "openapi-source.json");
      const before = await readFile(metadataPath, "utf8");
      const pin = JSON.parse(before).hostedSource.sha256;
      const pinPath = path.join(directory, `openapi-${pin}.json`);
      await writeFile(pinPath, "broken");
      expect(
        await refreshPluginOpenApiHostedSource({
          sourcePath: directory,
          transport: transport(spec()),
        }),
      ).toMatchObject({ _tag: "Failure", failure: "openapi-hosted-pin-conflict" });
      expect(await readFile(metadataPath, "utf8")).toBe(before);
      await unlink(pinPath);
      await symlink(metadataPath, pinPath);
      expect(
        await refreshPluginOpenApiHostedSource({
          sourcePath: directory,
          transport: transport(spec()),
        }),
      ).toMatchObject({ _tag: "Failure", failure: "openapi-hosted-pin-conflict" });
      expect(await readFile(metadataPath, "utf8")).toBe(before);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("pins a real TLS socket with hostname SNI and certificate validation offline", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "openapi-tls-"));
    const key = path.join(root, "key.pem");
    const cert = path.join(root, "cert.pem");
    execFileSync(
      "openssl",
      [
        "req",
        "-x509",
        "-newkey",
        "rsa:2048",
        "-nodes",
        "-keyout",
        key,
        "-out",
        cert,
        "-days",
        "1",
        "-subj",
        "/CN=spec.example.org",
        "-addext",
        "subjectAltName=DNS:spec.example.org",
      ],
      { stdio: "ignore" },
    );
    let seenSni = "";
    const server = https.createServer(
      { key: readFileSync(key), cert: readFileSync(cert) },
      (request, response) => {
        const servername = (request.socket as TLSSocket).servername;
        seenSni = typeof servername === "string" ? servername : "";
        response.writeHead(200, { "content-type": "application/json" });
        response.end(spec());
      },
    );
    try {
      server.listen(0, "127.0.0.1");
      await once(server, "listening");
      const address = server.address();
      if (address === null || typeof address === "string") throw Error("fixture-port-missing");
      const transport = createNodePluginOpenApiHostedTransport(readFileSync(cert, "utf8"));
      const response = await transport.get(
        new URL(`https://spec.example.org:${address.port}/openapi.json`),
        "127.0.0.1",
        new AbortController().signal,
      );
      const chunks: Uint8Array[] = [];
      for await (const chunk of response.body) chunks.push(chunk);
      expect(response.status).toBe(200);
      expect(Buffer.concat(chunks).toString()).toBe(spec());
      expect(seenSni).toBe("spec.example.org");
      await expect(
        transport.get(
          new URL(`https://wrong.example.org:${address.port}/openapi.json`),
          "127.0.0.1",
          new AbortController().signal,
        ),
      ).rejects.toThrow();
    } finally {
      server.close();
      await rm(root, { recursive: true, force: true });
    }
  });
});
