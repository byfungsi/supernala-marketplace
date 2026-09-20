# Contributing

Changes are welcome, but publication remains Supernala-curated.

## Add a Plugin

Start with `pnpm marketplace create <slug> --runtime managed-package` or
`pnpm marketplace create <slug> --runtime managed-remote-mcp`. Keep the resulting declarations,
implementation, and controlled fixtures under that Plugin's source directory. Then run
`pnpm marketplace validate <source>` and `pnpm marketplace prepare <source> <output>`.

An ordinary Plugin addition using a supported runtime and authentication method changes only its
Plugin-owned files and, when needed, one `releases/index.json` entry. It must not add D1 tables,
SQL hooks, publication-adapter branches, or credential handling. Such shared publisher changes mean
the contribution is platform work for a genuinely new runtime or authentication mechanism. Normal
review focuses on the Plugin directory, behavioral fixtures, provenance, and authority changes.

Remote templates are intentionally staged and incomplete. Replace sentinel catalog data only with a
controlled capture, bind reviewed provider-definition/scopes/evidence, and obtain human approval
before changing `status` to `reviewed-publishable`. A prepared remote envelope is not provider or
publication acceptance.

Unless explicitly stated otherwise for third-party material, contributions submitted to this repository are licensed under its MIT License. Do not contribute material that you lack authority to license, and preserve all applicable third-party notices and provider terms.

1. Pin immutable source and dependency identities and include license/provenance evidence.
2. Run the offline checks in `README.md` without credentials.
3. Review the complete authority diff: tools, JSON Schemas, classifications, policies, OAuth scopes/modes, network hosts, Config destinations, runtime, provenance, privacy, and license.
4. Record explicit approval for the exact source tree, artifact, catalog, and authority-diff digests.
5. A trusted maintainer may separately invoke the shared D1/R2 publisher after approval. Authors do
   not receive publication credentials or call privileged adapters.

Validation never implies publication. Added or expanded authority never enters existing Agent Grants automatically.

All content is public from inception. Do not read or copy local credentials, provider traffic, account payloads, absolute workstation paths, session identifiers, or credential-bearing registry URLs. Symbolic binding names are allowed; values are not.
