import {
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
  type S3ClientConfig,
} from "@aws-sdk/client-s3";
import { Result, Schema } from "effect";
import { digestPluginBytes, type PluginSha256 } from "./plugin-contract.js";
import type { ImmutableArtifactReader, ImmutableArtifactStore } from "./release-machine.js";

const maximumPluginArtifactBytes = 64 * 1_048_576;

/** Exact Phase 1 private content-addressed package key. */
export const pluginArtifactObjectKey = (digest: PluginSha256): string =>
  `plugin-packages/sha256/${digest.slice(0, 2)}/${digest}.plugin`;

/** Explicit credentials are injected only into the trusted publisher process. */
export interface CloudflareR2S3Configuration {
  readonly accountId: string;
  readonly bucketName: string;
  readonly accessKeyId: string;
  readonly secretAccessKey: string;
}

/** R2 S3 adapter using conditional create and full-byte readback, never HEAD-only trust. */
export class CloudflareR2S3ArtifactStore
  implements ImmutableArtifactStore, ImmutableArtifactReader
{
  readonly #bucketName: string;
  readonly #client: S3Client;

  constructor(configuration: CloudflareR2S3Configuration, client?: S3Client) {
    this.#bucketName = configuration.bucketName;
    const clientConfiguration: S3ClientConfig = {
      region: "auto",
      endpoint: `https://${configuration.accountId}.r2.cloudflarestorage.com`,
      credentials: {
        accessKeyId: configuration.accessKeyId,
        secretAccessKey: configuration.secretAccessKey,
      },
    };
    this.#client = client ?? new S3Client(clientConfiguration);
  }

  async #readAndVerify(
    key: string,
    digest: PluginSha256,
    expectedByteLength: number,
  ): Promise<Result.Result<boolean, string>> {
    try {
      const response = await this.#client.send(
        new GetObjectCommand({ Bucket: this.#bucketName, Key: key }),
      );
      if (response.Body === undefined) return Result.fail("artifact-readback-empty");
      if (
        response.ContentLength === undefined ||
        response.ContentLength !== expectedByteLength ||
        response.ContentLength > maximumPluginArtifactBytes
      ) {
        return Result.fail("artifact-readback-size-mismatch");
      }
      const bytes = await response.Body.transformToByteArray();
      return Result.succeed(
        bytes.byteLength === expectedByteLength && (await digestPluginBytes(bytes)) === digest,
      );
    } catch (error: unknown) {
      const status = (error as { readonly $metadata?: { readonly httpStatusCode?: number } })
        .$metadata?.httpStatusCode;
      return status === 404 ? Result.succeed(false) : Result.fail("artifact-readback-failed");
    }
  }

  verifyExisting(
    digest: PluginSha256,
    expectedByteLength: number,
  ): Promise<Result.Result<boolean, string>> {
    if (
      !Number.isSafeInteger(expectedByteLength) ||
      expectedByteLength < 1 ||
      expectedByteLength > maximumPluginArtifactBytes
    ) {
      return Promise.resolve(Result.fail("artifact-expected-size-invalid"));
    }
    return this.#readAndVerify(pluginArtifactObjectKey(digest), digest, expectedByteLength);
  }

  async ensureVerified(
    digest: PluginSha256,
    bytes: Uint8Array,
  ): Promise<Result.Result<"reused" | "uploaded", string>> {
    if ((await digestPluginBytes(bytes)) !== digest) {
      return Result.fail("artifact-input-digest-mismatch");
    }
    if (bytes.byteLength < 1 || bytes.byteLength > maximumPluginArtifactBytes) {
      return Result.fail("artifact-input-size-invalid");
    }
    const key = pluginArtifactObjectKey(digest);
    const existing = await this.#readAndVerify(key, digest, bytes.byteLength);
    if (Result.isFailure(existing)) return Result.fail(existing.failure);
    if (existing.success) return Result.succeed("reused" as const);
    try {
      await this.#client.send(
        new PutObjectCommand({
          Bucket: this.#bucketName,
          Key: key,
          Body: bytes,
          IfNoneMatch: "*",
          Metadata: { sha256: digest },
        }),
      );
    } catch (error: unknown) {
      const status = (error as { readonly $metadata?: { readonly httpStatusCode?: number } })
        .$metadata?.httpStatusCode;
      if (status !== 409 && status !== 412) return Result.fail("artifact-upload-failed");
    }
    const readback = await this.#readAndVerify(key, digest, bytes.byteLength);
    if (Result.isFailure(readback) || !readback.success) {
      return Result.fail("artifact-readback-mismatch");
    }
    return Result.succeed("uploaded" as const);
  }
}

export interface D1Statement {
  readonly sql: string;
  readonly params: ReadonlyArray<string | number | null>;
}

export interface D1BatchTransport {
  readonly batch: (
    statements: ReadonlyArray<D1Statement>,
  ) => Promise<Result.Result<ReadonlyArray<{ readonly changes: number }>, string>>;
  readonly query: (
    statement: D1Statement,
  ) => Promise<Result.Result<ReadonlyArray<Schema.JsonObject>, string>>;
}

export interface SanitizedHttpTransport {
  readonly request: (input: {
    readonly url: string;
    readonly headers: Readonly<Record<string, string>>;
    readonly body: string;
    readonly timeoutMillis: number;
    readonly maximumResponseBytes: number;
  }) => Promise<Result.Result<{ readonly status: number; readonly body: Uint8Array }, string>>;
}

const nativeSanitizedHttpTransport: SanitizedHttpTransport = {
  request: async (input) => {
    try {
      const response = await fetch(input.url, {
        method: "POST",
        headers: input.headers,
        body: input.body,
        redirect: "error",
        signal: AbortSignal.timeout(input.timeoutMillis),
      });
      const declaredLength = Number(response.headers.get("content-length") ?? "0");
      if (declaredLength > input.maximumResponseBytes)
        return Result.fail("http-response-too-large");
      const body = new Uint8Array(await response.arrayBuffer());
      if (body.byteLength > input.maximumResponseBytes)
        return Result.fail("http-response-too-large");
      return Result.succeed({ status: response.status, body });
    } catch {
      return Result.fail("http-transport-failed");
    }
  },
};

const D1QueryResult = Schema.Struct({
  success: Schema.Literal(true),
  meta: Schema.optionalKey(
    Schema.Struct({
      changes: Schema.optionalKey(Schema.Number),
    }),
  ),
  results: Schema.optionalKey(Schema.Array(Schema.JsonObject)),
});

const D1Envelope = Schema.Struct({
  success: Schema.Literal(true),
  result: Schema.Array(D1QueryResult),
  errors: Schema.optionalKey(Schema.Array(Schema.Json)),
  messages: Schema.optionalKey(Schema.Array(Schema.Json)),
});

/** Cloudflare D1 REST transport. It receives credentials only in the trusted publisher job. */
export class CloudflareD1RestTransport implements D1BatchTransport {
  constructor(
    private readonly configuration: {
      readonly accountId: string;
      readonly databaseId: string;
      readonly apiToken: string;
    },
    private readonly http: SanitizedHttpTransport = nativeSanitizedHttpTransport,
  ) {}

  async #request(body: Schema.JsonObject): Promise<Result.Result<typeof D1Envelope.Type, string>> {
    try {
      const response = await this.http.request({
        url: `https://api.cloudflare.com/client/v4/accounts/${this.configuration.accountId}/d1/database/${this.configuration.databaseId}/query`,
        headers: {
          Authorization: `Bearer ${this.configuration.apiToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
        timeoutMillis: 15_000,
        maximumResponseBytes: 8 * 1_048_576,
      });
      if (Result.isFailure(response)) return Result.fail(response.failure);
      if (response.success.status < 200 || response.success.status >= 300) {
        return Result.fail(`d1-http-${response.success.status}`);
      }
      const json = JSON.parse(
        new TextDecoder("utf-8", { fatal: true }).decode(response.success.body),
      );
      return Schema.decodeUnknownResult(D1Envelope)(json).pipe(
        Result.mapError(() => "d1-response-invalid"),
      );
    } catch {
      return Result.fail("d1-response-invalid");
    }
  }

  async batch(
    statements: ReadonlyArray<D1Statement>,
  ): Promise<Result.Result<ReadonlyArray<{ readonly changes: number }>, string>> {
    if (statements.length === 0) return Result.fail("d1-empty-batch");
    const result = await this.#request({
      batch: statements.map((statement) => ({ sql: statement.sql, params: statement.params })),
    });
    if (Result.isFailure(result)) return Result.fail(result.failure);
    if (result.success.result.length !== statements.length)
      return Result.fail("d1-result-count-mismatch");
    return Result.succeed(
      result.success.result.map((entry) => ({ changes: entry.meta?.changes ?? 0 })),
    );
  }

  async query(
    statement: D1Statement,
  ): Promise<Result.Result<ReadonlyArray<Schema.JsonObject>, string>> {
    const result = await this.#request({ sql: statement.sql, params: statement.params });
    if (Result.isFailure(result)) return Result.fail(result.failure);
    if (result.success.result.length !== 1) return Result.fail("d1-result-count-mismatch");
    return Result.succeed(result.success.result[0]?.results ?? []);
  }
}
