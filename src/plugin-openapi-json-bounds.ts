/** Same pre-decode JSON depth/member budget as the application OpenAPI bundle loader. */
export function isBoundedPluginOpenApiJson(
  text: string,
  maximumDepth = 64,
  maximumMembers = 100_000,
): boolean {
  let depth = 0;
  let members = 0;
  let quoted = false;
  let escaped = false;
  for (const character of text) {
    if (escaped) {
      escaped = false;
      continue;
    }
    if (quoted && character === "\\") {
      escaped = true;
      continue;
    }
    if (character === '"') {
      quoted = !quoted;
      continue;
    }
    if (quoted) continue;
    if (character === "{" || character === "[") depth++;
    if (character === "}" || character === "]") depth--;
    if (character === ":") members++;
    if (depth > maximumDepth || depth < 0 || members > maximumMembers) return false;
  }
  return depth === 0 && !quoted && !escaped;
}
