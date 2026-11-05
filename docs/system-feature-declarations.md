# System feature declarations

Remote MCP and OpenAPI authoring records support optional `systemFeatures`, using the authoritative Supernala declaration schema v1. Feature declarations implement a Supernala-owned contract; they do not define new application features.

The initial supported operation is read-only `unfurl.get-detail`, contract version 1. Declare its exact catalog tool ID, deterministic input mapping, and output mapping. Input targets are key paths (including nested OpenAPI argument objects). Output envelopes are direct JSON, MCP structured content, or a single MCP text block containing JSON.

Publication validation requires an exact reviewed read tool. Feature declarations are retained inside release provenance, covered by its digest and the protected release review/readback. Introducing declarations requires a newly reviewed release. Existing source files without declarations retain their previous provenance bytes and digest behavior.

The application derives an account-specific binding when the release's Connection is ready. Installation alone does not authorize execution. System access is independent of Agent grants. Declared system operations use direct remote MCP/OpenAPI calls, without local sandboxes.

The owner contract lives in Supernala's `packages/domain/src/plugin-system-feature.ts`. Marketplace consumes a hash-pinned portable distribution in `vendor/supernala-system-feature-v1`, with generated runtime schemas in `src/generated/plugin-system-feature.v1.ts`. Check it with:

```sh
node tools/vendor-plugin-system-feature-contract.mjs check
```

Declaration, feature contract, and mapping versions are independent and mandatory. Unsupported versions, duplicate operations, ambiguous target paths, excess declaration properties, and write tools fail closed. Complex provider output requires a new supported versioned transformation; declarations cannot contain executable code.

No current published Notion release is rewritten by this change. Its first feature implementation must be reviewed against the actual page-detail response envelope before publication. The existing Notion self-identity response is not sufficient evidence for a page-metadata mapping.
