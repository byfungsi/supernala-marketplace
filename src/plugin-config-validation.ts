import { Schema } from "effect";

const pluginConfigFieldKeys = new Set([
  "key",
  "label",
  "type",
  "scope",
  "sensitivity",
  "sourcePolicy",
  "delivery",
  "runtimeName",
  "affects",
]);

/** Reject recursively unknown Config field properties before schema decoding can discard them. */
export function pluginConfigFieldsHaveNoExcessProperties(value: Schema.Json): boolean {
  return (
    Array.isArray(value) &&
    value.every(
      (field) =>
        Schema.is(Schema.JsonObject)(field) &&
        Object.keys(field).every((key) => pluginConfigFieldKeys.has(key)),
    )
  );
}

/** Reject unknown Config document properties at both the root and every field. */
export function pluginConfigHasNoExcessProperties(value: Schema.Json): boolean {
  return (
    Schema.is(Schema.JsonObject)(value) &&
    Object.keys(value).every((key) => key === "revision" || key === "fields") &&
    pluginConfigFieldsHaveNoExcessProperties(value.fields ?? null)
  );
}
