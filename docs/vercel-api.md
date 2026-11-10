# Vercel REST API connection (`vercel-api`)

`plugins/vercel-api/` connects Vercel with the Owner's own access token (`Authorization: Bearer`), checked at `GET https://api.vercel.com/v2/user` during setup.

## Source

`openapi.json` is a reviewed local selection derived from Vercel's official `https://vercel.com/openapi.json` (12 MB, 478 operations; over the 1 MiB source limit). It keeps 26 operations with their parameters and request bodies; responses are dropped (the compiler does not use them) and authentication is normalized to the bearer token. Input schemas are normalized to the compiler's supported subset: references inlined, `oneOf`/`anyOf` of scalars turned into type lists and object unions loosened to open objects, `nullable` turned into a `null` type, untyped enum items typed, and keywords the compiler does not use (`title`, `pattern`, `format`, `writeOnly`, `maxProperties`) removed. Vercel validates every request, so loosened shapes cannot widen what Vercel accepts.

Deliberately excluded: deletes, the `decrypt` option of project environment listing and the single-variable value read, `createDeployment.gitAccessToken`, billing, teams administration, sandboxes, KMS and AI Gateway keys.

## Tools

Reads (allow): connected user, teams, projects, deployments, build events, runtime logs, deployment aliases, aliases, project domains, domain configuration, domains, project environment variables (encrypted and sensitive values stay encrypted; plain values are visible as in the dashboard), aliases waiting on a promotion.

Writes (allow, at the Owner's request): create or redeploy a deployment, cancel, promote, roll back, add and verify a project domain, assign an alias, create and edit a project environment variable.

## Not yet

Vercel's hosted MCP server (`mcp.vercel.com`) accepts clients identified by a Client ID Metadata Document without review. A sign-in component needs its tool catalog captured once from a signed-in session.

## Release prerequisites

- A credential-free provider registration `vercel-api-v1` in production.
- Live token acceptance is pending until an Owner connects a real token.
