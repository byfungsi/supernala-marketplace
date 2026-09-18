import { Schema } from "effect";
import { PluginSha256 } from "./plugin-contract.js";
import { PluginReleaseIdentity } from "./release-machine.js";

/** Release-set wire bytes remain compatible across workflow and local-operator publication. */
export const ReleaseSet = Schema.Struct({
  schemaVersion: Schema.Literal(1),
  mergeCommit: Schema.String.pipe(Schema.check(Schema.isPattern(/^[a-f0-9]{40}$/u))),
  releaseOrdinal: Schema.Int.pipe(
    Schema.check(Schema.isGreaterThanOrEqualTo(0)),
    Schema.check(Schema.isLessThanOrEqualTo(Number.MAX_SAFE_INTEGER)),
  ),
  setDigest: PluginSha256,
  bundles: Schema.Array(
    Schema.Struct({
      relativePath: Schema.NonEmptyString,
      identity: PluginReleaseIdentity,
      releaseDigest: PluginSha256,
      reviewId: Schema.NonEmptyString,
    }),
  ),
});
