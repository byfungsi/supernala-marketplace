# Security policy

## Trust boundaries

- Pull-request code and package build scripts receive no R2, D1, OAuth, deployment, or signing credentials.
- Trusted publication consumes only a human-approved source tree, artifact digest, catalog digest, and authority-diff digest.
- Packages execute only after publication inspection and runtime catalog equality checks. Runtime dependency installation is forbidden.
- Public Config and provider files contain schemas and logical binding names, never values.
- Diagnostics contain safe reason codes and digests only—never credentials, provider payloads, signed URLs, package contents, raw stacks, or private paths.

## Reports

Report suspected credential exposure or publication-integrity failures privately to the Supernala maintainers. Do not include secrets or provider data in an issue.

Before any commit or publication approval, run `pnpm marketplace public-safety`. It scans the complete repository worktree (including ignored generated archives, except dependency and Git object stores), bounds ZIP metadata before extraction, and reports only sanitized location/type pairs. Once history exists, separately scan the exact Git history before approval. If a secret is found, stop publication and arrange rotation; deleting a working file does not remove history.

Supernala-authored repository source is licensed under the root MIT `LICENSE`. Package and provider metadata remains independently scoped: the repository license does not relicense third-party code, provider services, trademarks, remote-provider content, or synthetic fixture license declarations.
