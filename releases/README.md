# Release inputs

`index.json` declares Plugin-owned roots and shared inputs. Every file under a managed package source directory—including README and assets—affects that Plugin's source-input digest because it affects packaged public content. Root docs/assets outside declared roots do not trigger package builds. Any shared-input change invalidates every eligible managed package; if output or authority changes under the same semantic version, selection fails and requires a version bump.

The index contains no “published” state. Durable Marketplace journal and verified application D1/R2 readback are authoritative. A removed source causes no delete or revocation.

Gmail `0.1.0` is the only publication-eligible candidate. Its trusted release workflow admits a credential-free Provider Definition and Provider Registration; each Workspace Owner must separately register an OAuth app whose encrypted client credentials remain in the Plugin Vault. The offline fixture is test-only, GitHub remains blocked on verified provider registration, independent review, and live acceptance, and managed remotes remain staged-unverified.
