import { Schema } from "effect";

const encoder = new TextEncoder();

/** Compares OpenAPI object keys by unsigned UTF-8 bytes, independent of locale. */
export const comparePluginOpenApiUtf8Keys = (left: string, right: string): number => {
  const a = encoder.encode(left);
  const b = encoder.encode(right);
  for (let index = 0; index < Math.min(a.length, b.length); index += 1) {
    const difference = (a[index] ?? 0) - (b[index] ?? 0);
    if (difference !== 0) return difference;
  }
  return a.length - b.length;
};

/** Canonical OpenAPI JSON sorts every object key by UTF-8 bytes and retains array order. */
export const canonicalPluginOpenApiJson = (value: Schema.Json): string => {
  if (Array.isArray(value)) return `[${value.map(canonicalPluginOpenApiJson).join(",")}]`;
  if (Schema.is(Schema.JsonObject)(value)) {
    return `{${Object.entries(value)
      .toSorted(([left], [right]) => comparePluginOpenApiUtf8Keys(left, right))
      .map(([key, entry]) => `${JSON.stringify(key)}:${canonicalPluginOpenApiJson(entry)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
};
