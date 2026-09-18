# Trusted publication adapter contract

`plan-publication` writes JSON plus a relative `.plugin` sidecar reference. Package bytes are never represented as a JSON numeric-key object or embedded credential-bearing payload.

The legacy plan verifier establishes these requirements for any adapter:

1. decode `PackagedPluginPublicationPlan`;
2. receive the expected immutable `reviewId` from the trusted release authority, not PR code;
3. resolve the relative sidecar path without traversal;
4. verify byte length, artifact SHA-256, source-tree SHA-256, catalog/config digests, authority-diff digest, provenance, and review decision;
5. parse the archive again with `parsePackagedPluginArchive`;
6. preserve the internal input semantics exactly as:

```ts
publishPackagedPluginVersion(bindings, {
  definitionId: plan.definitionId,
  version: plan.version,
  archiveBytes,
  expectedArtifactDigest: plan.artifact.sha256,
  reviewedAt: plan.review.reviewedAt,
});
```

`bindings` remain private application-owned `{ database: D1Database; packages: PluginPackageBucket }` capabilities. `Phase1D1PublicationAdapter` and `CloudflareR2S3ArtifactStore` now implement the equivalent stage/upload/readback/finalize contract against documented Cloudflare interfaces, while `D1ReleaseJournal` records durable release progress in Marketplace-owned state. They are invoked only by `pnpm release publish`; `verify-plan` remains an offline reconstruction command and always reports `publication: not-performed`.

No live adapter configuration is present. Store visibility remains a live acceptance check, and the two precise application compatibility gaps are documented in `docs/release-operations.md`.
