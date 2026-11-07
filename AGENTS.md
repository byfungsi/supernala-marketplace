# Marketplace agent guide

## Contract

Treat `compatibility/phase-1-sources.json` and `docs/phase-1-compatibility.md` as the integration baseline whenever changing schemas, archives, runtime descriptors, or publication plans. Preserve wire bytes and digest behavior until the application and Marketplace migrate together.

## Setup guides

Every publication-eligible Plugin in `releases/index.json` needs a guide under `guides/<publisher>/<slug>.md`; `pnpm check` fails without one. Follow `docs/plugin-setup-guides.md`, and bump a guide's `revision` when changing published text.

## Security

Read `SECURITY.md` before changing builds, publication, provider metadata, archive handling, or diagnostics. Public files contain declarations and binding names only. Keep values and publication authority outside this repository.

## Verification

Use `pnpm check` for the complete offline gate. A successful offline gate does not establish live R2/D1 publication, Store visibility, OAuth, installation, invocation, or revocation acceptance.
