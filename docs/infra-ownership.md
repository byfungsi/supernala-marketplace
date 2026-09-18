# Infrastructure ownership and publication path

```text
protected-main merge
  |
  +-- credential-free build job
  |     selector -> package/inspect/conformance -> immutable release bundle
  |
  +-- environment-approved publisher job
        |
        +--> MarketplaceReleaseJournal (Marketplace-owned D1; Alchemy provisioned)
        |      claim / failure / verified / published / monotonic baseline
        |
        +--> PluginPackages (application-owned R2; Alchemy cross-stack ref only)
        |      content key -> conditional create -> complete GET hash verification
        |
        `--> ApplicationDatabase (application-owned D1; Alchemy cross-stack ref only)
               Phase 1 stage batch -> atomic guarded finalize batch -> readback
```

Alchemy owns only the release journal. The application retains runtime package and catalog ownership. No Terraform/Wrangler provisioning recipe exists here. A checked-in release snapshot, if added later, can only accelerate selection: it cannot establish publication, and stale/missing/forged snapshots fall back to journal plus application readback.

The D1 REST adapter uses the documented `{ batch: [...] }` request body and includes a final SQL statement that fails _inside the same transaction_ if conditional finalization did not happen. A post-commit `meta.changes` value is never treated as rollback. R2 uses S3 `If-None-Match: *`; a pre-existing or concurrent object is accepted only after downloading all bytes and verifying the SHA-256 implied by its content-addressed key.

The baseline job has separate read-only application-D1 and R2 credentials. It emits a published journal row as skippable only after exact application row verification plus a complete bounded R2 GET matching both the recorded byte length and digest. The credential-free build job receives only that verified baseline artifact.
