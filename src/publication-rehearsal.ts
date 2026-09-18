import { Context, Effect, Layer, Ref, Schema } from "effect";
import type { PluginSha256 } from "./plugin-contract.js";

/** Lifecycle state for controlled offline publication interruption tests. */
export type PublicationRehearsalState =
  | { readonly _tag: "Staged"; readonly digest: PluginSha256; readonly reviewRevision: number }
  | { readonly _tag: "Uploaded"; readonly digest: PluginSha256; readonly reviewRevision: number }
  | { readonly _tag: "Published"; readonly digest: PluginSha256; readonly reviewRevision: number };

/** Expected failure from the controlled publication rehearsal. */
export class PublicationRehearsalFailure extends Schema.TaggedError<PublicationRehearsalFailure>()(
  "PublicationRehearsalFailure",
  { reason: Schema.Literals(["artifact-conflict", "artifact-tampered", "review-changed"]) },
) {}

/** Faithful lifecycle controls used only for offline interruption and visibility tests. */
export interface PublicationRehearsalInterface {
  readonly stage: (
    digest: PluginSha256,
    reviewRevision: number,
  ) => Effect.Effect<void, PublicationRehearsalFailure>;
  readonly upload: (
    digest: PluginSha256,
    bytes: Uint8Array,
  ) => Effect.Effect<void, PublicationRehearsalFailure>;
  readonly reconcile: (reviewRevision: number) => Effect.Effect<void, PublicationRehearsalFailure>;
  readonly visibleDigest: () => Effect.Effect<PluginSha256 | undefined>;
  readonly tamper: (bytes: Uint8Array) => Effect.Effect<void>;
}

/** Offline publication rehearsal service; it is not a D1/R2 adapter. */
export class PublicationRehearsal extends Context.Service<
  PublicationRehearsal,
  PublicationRehearsalInterface
>()("@supernala/marketplace/PublicationRehearsal") {}

/** Fresh in-memory Layer for controlled lifecycle tests, never integration evidence. */
export const publicationRehearsalLayer = Layer.effect(
  PublicationRehearsal,
  Effect.gen(function* () {
    const state = yield* Ref.make<PublicationRehearsalState | undefined>(undefined);
    const storedBytes = yield* Ref.make<Uint8Array | undefined>(undefined);
    const stage = Effect.fn("PublicationRehearsal.stage")(function* (
      digest: PluginSha256,
      reviewRevision: number,
    ) {
      const current = yield* Ref.get(state);
      if (current !== undefined && current.digest !== digest) {
        return yield* new PublicationRehearsalFailure({ reason: "artifact-conflict" });
      }
      if (current === undefined) {
        const staged: PublicationRehearsalState = { _tag: "Staged", digest, reviewRevision };
        yield* Ref.set(state, staged);
      }
    });
    const upload = Effect.fn("PublicationRehearsal.upload")(function* (
      digest: PluginSha256,
      bytes: Uint8Array,
    ) {
      const current = yield* Ref.get(state);
      if (current === undefined || current.digest !== digest) {
        return yield* new PublicationRehearsalFailure({ reason: "artifact-conflict" });
      }
      yield* Ref.set(storedBytes, Uint8Array.from(bytes));
      const uploaded: PublicationRehearsalState = {
        _tag: "Uploaded",
        digest,
        reviewRevision: current.reviewRevision,
      };
      yield* Ref.set(state, uploaded);
    });
    const reconcile = Effect.fn("PublicationRehearsal.reconcile")(function* (
      reviewRevision: number,
    ) {
      const current = yield* Ref.get(state);
      if (current === undefined || current.reviewRevision !== reviewRevision) {
        return yield* new PublicationRehearsalFailure({ reason: "review-changed" });
      }
      if (current._tag === "Staged") {
        return yield* new PublicationRehearsalFailure({ reason: "artifact-tampered" });
      }
      const bytes = yield* Ref.get(storedBytes);
      if (bytes === undefined) {
        return yield* new PublicationRehearsalFailure({ reason: "artifact-tampered" });
      }
      const actual = yield* Effect.promise(async () => {
        const digest = await crypto.subtle.digest("SHA-256", Uint8Array.from(bytes).buffer);
        return [...new Uint8Array(digest)]
          .map((value) => value.toString(16).padStart(2, "0"))
          .join("");
      });
      if (actual !== current.digest) {
        return yield* new PublicationRehearsalFailure({ reason: "artifact-tampered" });
      }
      const published: PublicationRehearsalState = {
        _tag: "Published",
        digest: current.digest,
        reviewRevision,
      };
      yield* Ref.set(state, published);
    });
    const visibleDigest = Effect.fn("PublicationRehearsal.visibleDigest")(function* () {
      const current = yield* Ref.get(state);
      return current?._tag === "Published" ? current.digest : undefined;
    });
    const tamper = Effect.fn("PublicationRehearsal.tamper")(function* (bytes: Uint8Array) {
      yield* Ref.set(storedBytes, Uint8Array.from(bytes));
    });
    return PublicationRehearsal.of({ stage, upload, reconcile, visibleDigest, tamper });
  }),
);
