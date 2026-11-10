# Vercel REST API connection (`vercel-api`)

`plugins/vercel-api/` connects Vercel with the Owner's own access token (`Authorization: Bearer`), checked at `GET https://api.vercel.com/v2/user` during setup.

## Source

`openapi.json` is a reviewed local selection derived from Vercel's official `https://vercel.com/openapi.json` (12 MB, 478 operations; over the 1 MiB source limit). It keeps 26 operations with their parameters and request bodies; responses are dropped (the compiler does not use them) and authentication is normalized to the bearer token. Input schemas are normalized to the compiler's supported subset: references inlined, `oneOf`/`anyOf` of scalars turned into type lists and object unions loosened to open objects, `nullable` turned into a `null` type, untyped enum items typed, and keywords the compiler does not use (`title`, `pattern`, `format`, `writeOnly`, `maxProperties`) removed. Vercel validates every request, so loosened shapes cannot widen what Vercel accepts.

Deliberately excluded: deletes, the `decrypt` option of project environment listing and the single-variable value read, `createDeployment.gitAccessToken`, billing, teams administration, sandboxes, KMS and AI Gateway keys.

## Tools

Reads (allow): connected user, teams, projects, deployments, build events, runtime logs, deployment aliases, aliases, project domains, domain configuration, domains, project environment variables (encrypted and sensitive values stay encrypted; plain values are visible as in the dashboard), aliases waiting on a promotion.

Writes (allow, at the Owner's request): create or redeploy a deployment, cancel, promote, roll back, add and verify a project domain, assign an alias, create and edit a project environment variable.

## Sign in with Vercel (`vercel`)

`plugins/remotes/vercel.json` is the sign-in component, through Vercel's hosted MCP server `https://mcp.vercel.com`. Vercel accepts clients identified by a Client ID Metadata Document without review; ours is `https://supernala.com/.well-known/oauth-client/vercel.json`, published by the application. It requests the `openid` scope (what Vercel grants) with PKCE as a public client; Vercel issues refresh tokens and revokes at `/api/login/oauth/token/revoke`.

The catalog is an Owner-consented `tools/list` capture (246 tools, exact input schemas, 2026-11-10). Vercel marks nearly every change destructive, so tools are classified by effect: 147 read-only tools are reads; deletes, key revocation, DNS replacement, project-transfer acceptance and domain purchase or transfer (8) are destructive and ask first; the other 91 are writes that default to allow at the Owner's request. The catalog is a reviewed subset: tools Vercel adds later stay hidden until a new version reviews them.

## Release prerequisites

- A credential-free provider registration `vercel-api-v1` in production.
- Live token acceptance is pending until an Owner connects a real token.
