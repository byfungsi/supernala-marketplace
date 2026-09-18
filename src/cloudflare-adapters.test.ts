import { GetObjectCommand, PutObjectCommand, type S3Client } from "@aws-sdk/client-s3";
import { expect, it } from "@effect/vitest";
import { Result } from "effect";
import {
  CloudflareD1RestTransport,
  CloudflareR2S3ArtifactStore,
  pluginArtifactObjectKey,
  type SanitizedHttpTransport,
} from "./cloudflare-adapters.js";
import { digestPluginBytes } from "./plugin-contract.js";

class ControlledS3Transport {
  readonly objects = new Map<string, Uint8Array>();
  putCount = 0;

  async send(command: GetObjectCommand | PutObjectCommand): Promise<unknown> {
    if (command instanceof GetObjectCommand) {
      const bytes = this.objects.get(command.input.Key ?? "");
      if (bytes === undefined) {
        throw { $metadata: { httpStatusCode: 404 } };
      }
      return {
        ContentLength: bytes.byteLength,
        Body: { transformToByteArray: async () => Uint8Array.from(bytes) },
      };
    }
    if (command.input.IfNoneMatch !== "*") throw new Error("conditional create missing");
    const key = command.input.Key ?? "";
    if (this.objects.has(key)) throw { $metadata: { httpStatusCode: 412 } };
    this.objects.set(key, Uint8Array.from(command.input.Body as Uint8Array));
    this.putCount += 1;
    return {};
  }
}

it("uses exact R2 key, conditional create, verified readback, and zero rerun PUTs", async () => {
  const transport = new ControlledS3Transport();
  const store = new CloudflareR2S3ArtifactStore(
    {
      accountId: "synthetic-account",
      bucketName: "synthetic-private-bucket",
      accessKeyId: "synthetic-access-key-id",
      secretAccessKey: "synthetic-secret-access-key",
    },
    transport as never as S3Client,
  );
  const bytes = new TextEncoder().encode("synthetic package bytes");
  const digest = await digestPluginBytes(bytes);
  expect(await store.ensureVerified(digest, bytes)).toEqual(Result.succeed("uploaded"));
  expect(await store.ensureVerified(digest, bytes)).toEqual(Result.succeed("reused"));
  expect(await store.verifyExisting(digest, bytes.byteLength)).toEqual(Result.succeed(true));
  expect(transport.putCount).toBe(1);
  expect(transport.objects.has(pluginArtifactObjectKey(digest))).toBe(true);
});

it("fails read-only verification on missing, wrong-size, or wrong-digest complete bytes", async () => {
  const transport = new ControlledS3Transport();
  const store = new CloudflareR2S3ArtifactStore(
    {
      accountId: "synthetic-account",
      bucketName: "synthetic-private-bucket",
      accessKeyId: "synthetic-access-key-id",
      secretAccessKey: "synthetic-secret-access-key",
    },
    transport as never as S3Client,
  );
  const bytes = new TextEncoder().encode("reviewed bytes");
  const digest = await digestPluginBytes(bytes);
  expect(await store.verifyExisting(digest, bytes.byteLength)).toEqual(Result.succeed(false));
  transport.objects.set(pluginArtifactObjectKey(digest), bytes);
  expect(await store.verifyExisting(digest, bytes.byteLength + 1)).toEqual(
    Result.fail("artifact-readback-size-mismatch"),
  );
  transport.objects.set(
    pluginArtifactObjectKey(digest),
    Uint8Array.from(bytes, (byte) => (byte + 1) % 256),
  );
  expect(await store.verifyExisting(digest, bytes.byteLength)).toEqual(Result.succeed(false));
  expect(transport.putCount).toBe(0);
});

it("never overwrites corrupt existing content at a digest key", async () => {
  const transport = new ControlledS3Transport();
  const bytes = new TextEncoder().encode("reviewed bytes");
  const digest = await digestPluginBytes(bytes);
  transport.objects.set(pluginArtifactObjectKey(digest), new TextEncoder().encode("wrong bytes"));
  const store = new CloudflareR2S3ArtifactStore(
    {
      accountId: "synthetic-account",
      bucketName: "synthetic-private-bucket",
      accessKeyId: "synthetic-access-key-id",
      secretAccessKey: "synthetic-secret-access-key",
    },
    transport as never as S3Client,
  );
  expect(await store.ensureVerified(digest, bytes)).toEqual(
    Result.fail("artifact-readback-size-mismatch"),
  );
  expect(transport.putCount).toBe(0);
});

it("sends the documented D1 batch object and preserves per-statement changes", async () => {
  let requestBody = "";
  const http: SanitizedHttpTransport = {
    request: async (input) => {
      requestBody = input.body;
      return Result.succeed({
        status: 200,
        body: new TextEncoder().encode(
          JSON.stringify({
            success: true,
            result: [
              { success: true, results: [], meta: { changes: 1 } },
              { success: true, results: [], meta: { changes: 0 } },
            ],
            errors: [],
            messages: [],
          }),
        ),
      });
    },
  };
  const transport = new CloudflareD1RestTransport(
    {
      accountId: "synthetic-account",
      databaseId: "synthetic-database",
      apiToken: "synthetic-token",
    },
    http,
  );
  expect(
    await transport.batch([
      { sql: "INSERT INTO synthetic(value) VALUES (?)", params: ["one"] },
      { sql: "UPDATE synthetic SET value = ?", params: ["two"] },
    ]),
  ).toEqual(Result.succeed([{ changes: 1 }, { changes: 0 }]));
  expect(JSON.parse(requestBody)).toEqual({
    batch: [
      { sql: "INSERT INTO synthetic(value) VALUES (?)", params: ["one"] },
      { sql: "UPDATE synthetic SET value = ?", params: ["two"] },
    ],
  });
});

it("rejects malformed, failed, and count-mismatched D1 envelopes", async () => {
  const responseBodies = [
    { success: false, result: [] },
    { success: true, result: [{ success: false, results: [] }] },
    { success: true, result: [] },
  ];
  for (const responseBody of responseBodies) {
    const transport = new CloudflareD1RestTransport(
      {
        accountId: "synthetic-account",
        databaseId: "synthetic-database",
        apiToken: "synthetic-token",
      },
      {
        request: async () =>
          Result.succeed({
            status: 200,
            body: new TextEncoder().encode(JSON.stringify(responseBody)),
          }),
      },
    );
    expect(Result.isFailure(await transport.batch([{ sql: "SELECT 1", params: [] }]))).toBe(true);
  }
});
