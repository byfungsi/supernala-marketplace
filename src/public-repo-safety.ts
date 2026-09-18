import { promises as fs } from "node:fs";
import path from "node:path";
import { Result } from "effect";
import { unzipSync } from "fflate";
import { parsePluginZipEntries } from "./package-archive.js";

/** Sanitized public-repository finding that never contains matched content. */
export interface PublicRepoSafetyFinding {
  readonly location: string;
  readonly type: string;
}

const patterns: ReadonlyArray<{ readonly type: string; readonly expression: RegExp }> = [
  {
    type: "private-key",
    expression: new RegExp(
      ["-----BEGIN ", "(?:RSA |EC |DSA |OPENSSH )?PRIVATE KEY-----"].join(""),
      "u",
    ),
  },
  { type: "github-token", expression: new RegExp(["gh", "[opsu]_[A-Za-z0-9]{30,}"].join("")) },
  { type: "aws-access-key", expression: new RegExp(["AK", "IA[0-9A-Z]{16}"].join("")) },
  { type: "gitlab-token", expression: new RegExp(["gl", "pat-[A-Za-z0-9_-]{20,}"].join("")) },
  { type: "slack-token", expression: new RegExp(["xo", "x[baprs]-[A-Za-z0-9-]{20,}"].join("")) },
  { type: "stripe-live-key", expression: new RegExp(["sk", "_live_[A-Za-z0-9]{16,}"].join("")) },
  { type: "google-api-key", expression: new RegExp(["AI", "za[0-9A-Za-z_-]{30,}"].join("")) },
  {
    type: "bearer-authorization",
    expression: new RegExp(
      ["Authorization", ":\\s*Bearer\\s+[A-Za-z0-9._~+/=-]{12,}"].join(""),
      "iu",
    ),
  },
  { type: "credential-url", expression: /https?:\/\/[^/\s:@]+:[^/\s@]+@/u },
  { type: "session-identifier", expression: new RegExp(["ses", "_[A-Za-z0-9]{16,}"].join("")) },
  { type: "local-absolute-path", expression: new RegExp(["/", "Users/[^/\\s]+/"].join("")) },
  {
    type: "assigned-secret",
    expression: new RegExp(
      [
        "[\"']?(?:client[_-]?secret|api[_-]?key|access[_-]?token|refresh[_-]?token|password|private[_-]?key)[\"']?",
        "\\s*[:=]\\s*(?!process\\.env|\\$\\{|Config\\.|requiredEnvironment\\()(?:[\"'][^\"'\\r\\n]{12,}[\"']|[^\\s#\"']{12,})",
      ].join(""),
      "iu",
    ),
  },
];

const excludedDirectories = new Set([".git", "node_modules"]);
const scanBytes = (location: string, bytes: Uint8Array): ReadonlyArray<PublicRepoSafetyFinding> => {
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return [];
  }
  return patterns
    .filter(({ expression }) => expression.test(text))
    .map(({ type }) => ({ location, type }));
};

/** Scan tracked, untracked, ignored, and generated archive content without exposing matches. */
export async function inspectPublicRepositorySafety(
  root: string,
): Promise<ReadonlyArray<PublicRepoSafetyFinding>> {
  const findings: Array<PublicRepoSafetyFinding> = [];
  const visit = async (directory: string): Promise<void> => {
    const entries = await fs.readdir(directory, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isDirectory() && excludedDirectories.has(entry.name)) continue;
      const absolute = path.join(directory, entry.name);
      const relative = path.relative(root, absolute).split(path.sep).join("/");
      if (entry.isSymbolicLink()) {
        findings.push({ location: relative, type: "symbolic-link" });
      } else if (entry.isDirectory()) {
        await visit(absolute);
      } else if (entry.isFile()) {
        const bytes = new Uint8Array(await fs.readFile(absolute));
        findings.push(...scanBytes(relative, bytes));
        if (entry.name.endsWith(".plugin") || entry.name.endsWith(".zip")) {
          try {
            if (bytes.byteLength > 20 * 1_048_576) throw new Error("archive-input-too-large");
            const metadata = parsePluginZipEntries(bytes);
            if (Result.isFailure(metadata)) throw new Error("archive-layout-invalid");
            const expanded = metadata.success.reduce(
              (total, item) => total + item.expandedBytes,
              0,
            );
            if (
              metadata.success.length > 1_000 ||
              expanded > 20 * 1_048_576 ||
              metadata.success.some(
                (item) =>
                  item.expandedBytes > 5 * 1_048_576 ||
                  (item.expandedBytes > 0 &&
                    (item.compressedBytes === 0 ||
                      item.expandedBytes / item.compressedBytes > 100)),
              )
            ) {
              throw new Error("archive-expansion-bound-exceeded");
            }
            for (const [archivePath, archiveBytes] of Object.entries(unzipSync(bytes))) {
              findings.push(...scanBytes(`${relative}!/${archivePath}`, archiveBytes));
            }
          } catch {
            findings.push({ location: relative, type: "unreadable-archive" });
          }
        }
      }
    }
  };
  await visit(path.resolve(root));
  return findings.toSorted(
    (left, right) =>
      left.location.localeCompare(right.location) || left.type.localeCompare(right.type),
  );
}
