import { resolve4, resolve6 } from "node:dns/promises";
import https from "node:https";
import { BlockList, isIP } from "node:net";
import { isBoundedPluginOpenApiJson } from "./plugin-openapi-json-bounds.js";

/** Explicit HTTPS source fetch boundary; tests inject this interface without network calls. */
export interface PluginOpenApiHostedTransport {
  resolve(hostname: string): Promise<ReadonlyArray<string>>;
  get(
    url: URL,
    address: string,
    signal: AbortSignal,
  ): Promise<{
    readonly status: number;
    readonly contentType: string | undefined;
    readonly location: string | undefined;
    readonly contentLength: string | undefined;
    readonly body: AsyncIterable<Uint8Array>;
  }>;
}

const blocked4 = new BlockList();
const blocked6 = new BlockList();
for (const [base, prefix] of [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.0.2.0", 24],
  ["192.88.99.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["198.51.100.0", 24],
  ["203.0.113.0", 24],
  ["224.0.0.0", 4],
  ["240.0.0.0", 4],
] as const)
  blocked4.addSubnet(base, prefix, "ipv4");
for (const [base, prefix] of [
  ["::", 128],
  ["::1", 128],
  ["::ffff:0:0", 96],
  ["64:ff9b:1::", 48],
  ["100::", 64],
  ["2001::", 23],
  ["2001:db8::", 32],
  ["2002::", 16],
  ["3fff::", 20],
  ["fc00::", 7],
  ["fe80::", 10],
  ["ff00::", 8],
] as const)
  blocked6.addSubnet(base, prefix, "ipv6");

/** Checks normalized numeric CIDR ranges, including equivalent IPv6 spellings. */
export const isPublicPluginOpenApiAddress = (address: string): boolean => {
  const family = isIP(address);
  if (family === 4) return !blocked4.check(address, "ipv4");
  if (family !== 6 || address.includes("%") || address.includes(".")) return false;
  // Public IPv6 global unicast only; BlockList normalizes compressed/full forms.
  const global = new BlockList();
  global.addSubnet("2000::", 3, "ipv6");
  return global.check(address, "ipv6") && !blocked6.check(address, "ipv6");
};

/** Validates a public, credential-free HTTPS JSON URL before any DNS or request. */
export function parsePluginOpenApiHostedUrl(value: string): URL | null {
  try {
    if (value.length > 2048) return null;
    const url = new URL(value);
    if (
      url.protocol !== "https:" ||
      url.username !== "" ||
      url.password !== "" ||
      url.hash !== "" ||
      url.search !== "" ||
      url.port !== "" ||
      url.hostname.endsWith(".") ||
      url.hostname === "localhost" ||
      isIP(url.hostname.replaceAll(/[[\]]/gu, "")) !== 0 ||
      !/^[a-z0-9.-]+$/iu.test(url.hostname) ||
      !url.hostname.includes(".")
    )
      return null;
    return url;
  } catch {
    return null;
  }
}

/** Node HTTPS adapter pins the resolved IP at socket creation while retaining hostname SNI/certificate verification. */
/** Creates a pinned HTTPS transport; a test CA may be supplied for an offline TLS fixture. */
export const createNodePluginOpenApiHostedTransport = (
  ca?: string,
): PluginOpenApiHostedTransport => ({
  async resolve(hostname) {
    const [v4, v6] = await Promise.all([
      resolve4(hostname).catch(() => []),
      resolve6(hostname).catch(() => []),
    ]);
    return [...v4, ...v6];
  },
  async get(url, address, signal) {
    return new Promise<Awaited<ReturnType<PluginOpenApiHostedTransport["get"]>>>(
      (resolve, reject) => {
        const request = https.request(
          url,
          {
            method: "GET",
            signal,
            agent: false,
            ...(ca === undefined ? {} : { ca }),
            lookup: (_hostname, options, callback) => {
              if (options.all) callback(null, [{ address, family: isIP(address) }]);
              else callback(null, address, isIP(address));
            },
            headers: { accept: "application/json" },
          },
          (response) => {
            resolve({
              status: response.statusCode ?? 0,
              contentType: response.headers["content-type"],
              location: response.headers.location,
              contentLength: response.headers["content-length"],
              body: response,
            });
          },
        );
        request.on("error", reject);
        request.end();
      },
    );
  },
});
/** Default production authoring transport resolves once and pins the socket address. */
export const nodePluginOpenApiHostedTransport = createNodePluginOpenApiHostedTransport();

/** Fetches at most 1 MiB, with an end-to-end deadline and pre-decode structural bounds. */
export async function fetchPluginOpenApiHostedJson(
  sourceUrl: string,
  transport: PluginOpenApiHostedTransport = nodePluginOpenApiHostedTransport,
  deadlineMs = 10_000,
): Promise<string> {
  const url = parsePluginOpenApiHostedUrl(sourceUrl);
  if (url === null) throw new Error("openapi-hosted-url-invalid");
  const controller = new AbortController();
  const deadline = AbortSignal.timeout(deadlineMs);
  const abort = () => controller.abort();
  deadline.addEventListener("abort", abort, { once: true });
  try {
    const fetchWork = async () => {
      const addresses = await transport.resolve(url.hostname);
      if (controller.signal.aborted) throw new Error("openapi-hosted-deadline-exceeded");
      if (
        addresses.length === 0 ||
        addresses.length > 16 ||
        addresses.some((address) => !isPublicPluginOpenApiAddress(address))
      ) {
        throw new Error("openapi-hosted-address-rejected");
      }
      const response = await transport.get(url, addresses[0] ?? "", controller.signal);
      if (response.status !== 200 || response.location !== undefined)
        throw new Error("openapi-hosted-response-invalid");
      const type = response.contentType?.split(";")[0]?.trim().toLowerCase();
      if (type !== "application/json" && type !== "application/vnd.oai.openapi+json")
        throw new Error("openapi-hosted-content-type-invalid");
      if (
        response.contentLength !== undefined &&
        (!/^\d+$/u.test(response.contentLength) || Number(response.contentLength) > 1_048_576)
      )
        throw new Error("openapi-hosted-source-too-large");
      const chunks: Uint8Array[] = [];
      let size = 0;
      for await (const chunk of response.body) {
        size += chunk.byteLength;
        if (size > 1_048_576) throw new Error("openapi-hosted-source-too-large");
        chunks.push(chunk);
      }
      const bytes = new Uint8Array(size);
      let offset = 0;
      for (const chunk of chunks) {
        bytes.set(chunk, offset);
        offset += chunk.byteLength;
      }
      let text: string;
      try {
        text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
      } catch {
        throw new Error("openapi-hosted-utf8-invalid");
      }
      if (!isBoundedPluginOpenApiJson(text)) throw new Error("openapi-hosted-bounds-exceeded");
      try {
        JSON.parse(text);
      } catch {
        throw new Error("openapi-hosted-json-invalid");
      }
      return text;
    };
    return await Promise.race([
      fetchWork(),
      new Promise<never>((_resolve, reject) =>
        deadline.addEventListener(
          "abort",
          () => reject(new Error("openapi-hosted-deadline-exceeded")),
          { once: true },
        ),
      ),
    ]);
  } finally {
    controller.abort();
    deadline.removeEventListener("abort", abort);
  }
}
