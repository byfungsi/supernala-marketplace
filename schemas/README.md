# Portable schemas

These JSON Schema documents are generated from the owning Effect schemas by `pnpm marketplace export-schemas`. CI checks structural equality after formatting, so external tooling and TypeScript validation cannot drift silently.

`plugin.schema.json` matches the accepted effective Phase 1 managed-package archive inspector, including strict `none`/`github-app` authentication metadata and optional digest-bound full MIT `licenseEvidence`. The GitHub candidate remains staged because provider registration, independent review, and live acceptance are not established by schema compatibility.
