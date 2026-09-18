import { expect, it } from "@effect/vitest";
import { Effect, Result } from "effect";
import { digestPluginBytes } from "./plugin-contract.js";
import { PublicationRehearsal, publicationRehearsalLayer } from "./publication-rehearsal.js";

it.effect("keeps staged and uploaded releases invisible until verified reconciliation", () =>
  Effect.gen(function* () {
    const rehearsal = yield* PublicationRehearsal;
    const bytes = new TextEncoder().encode("synthetic immutable package");
    const digest = yield* Effect.promise(() => digestPluginBytes(bytes));
    yield* rehearsal.stage(digest, 1);
    expect(yield* rehearsal.visibleDigest()).toBeUndefined();
    yield* rehearsal.upload(digest, bytes);
    expect(yield* rehearsal.visibleDigest()).toBeUndefined();
    yield* rehearsal.reconcile(1);
    expect(yield* rehearsal.visibleDigest()).toBe(digest);
  }).pipe(Effect.provide(publicationRehearsalLayer)),
);

it.effect("rejects tamper and changed review before publication", () =>
  Effect.gen(function* () {
    const rehearsal = yield* PublicationRehearsal;
    const bytes = new TextEncoder().encode("synthetic immutable package");
    const digest = yield* Effect.promise(() => digestPluginBytes(bytes));
    yield* rehearsal.stage(digest, 1);
    yield* rehearsal.upload(digest, bytes);
    const changedReview = yield* Effect.result(rehearsal.reconcile(2));
    expect(Result.isFailure(changedReview)).toBe(true);
    yield* rehearsal.tamper(new TextEncoder().encode("tampered"));
    const tampered = yield* Effect.result(rehearsal.reconcile(1));
    expect(Result.isFailure(tampered)).toBe(true);
    expect(yield* rehearsal.visibleDigest()).toBeUndefined();
  }).pipe(Effect.provide(publicationRehearsalLayer)),
);
