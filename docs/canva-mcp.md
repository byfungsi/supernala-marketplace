# Canva MCP publication

`plugins/remotes/canva.json` targets the current official Developer Portal MCP surface. It remains
staged until client registration, consented catalog capture and authority review are complete.

## Current provider setup

Checked on 2026-10-28 against the [official quickstart](https://www.canva.dev/docs/apps/quickstart/)
and [access requirements](https://www.canva.dev/docs/apps/mcp/access/):

1. Open [Your apps](https://www.canva.com/developers/apps) in the Developer Portal. Create a Public
   app named Supernala. Canva says the public/private choice cannot be changed later; private apps
   require Enterprise. The account owner must accept Canva's Developer Terms.
2. Select Outside Canva, then Start integrating. Under Configuration, enable Canva MCP. REST API
   access is a separate choice and is not required solely for MCP.
3. Under Credentials, obtain the client ID and generate a secret. Store both privately; the secret
   is shown once. Never put their values in source, Config, review records, logs or chat.
4. Under Redirect URLs, add `https://app.supernala.com/v1/plugins/oauth/callback`, the callback derived from the authoritative
   application production origin. Verify the authoritative deployment callback before registration
   or release if the environment changes. The Marketplace operator files currently retain the older
   origin and must be reconciled before publishing. A separate local review callback must be explicitly
   registered if used for prepublication schema capture.
5. The app backend must bind the private client material to the exact reviewed provider registration,
   provider-definition digest, authentication method and material version before consent can work.
   This is deployment configuration, separate from public Marketplace declaration authoring.

The quickstart now identifies `https://api.canva.com/connect/v1/mcp` as the remote endpoint. Its
[protected-resource metadata](https://api.canva.com/.well-known/oauth-protected-resource/connect/v1/mcp)
binds that exact resource audience to authorization server `https://www.canva.com`. An unauthenticated
MCP initialize request returns 401 with that metadata URL. Authorization-server discovery from the
workstation returned 403; it does not establish token endpoint or lifecycle policy.

Earlier `https://mcp.canva.com/mcp` metadata still advertises CIMD and DCR, but it belongs to a
different resource and authorization server. Do not combine its token endpoints, client metadata
support or audience with the Developer Portal surface. The retained `canva-cimd.json.template` is
historical candidate material, not the active registration or a deployment instruction. The old
waitlist/CIMD plan has been superseded by the current official setup above.

## Remaining publication evidence

- Review the desired design, folder, asset, comment and brand capabilities against the exact
  authenticated tool catalog. The declaration's existing read-only scope proposal is provisional;
  it does not establish that all Canva tools work or authorize new write scopes by itself.
- Capture all paginated `tools/list` schemas after Owner consent. Retain only tool names,
  descriptions and exact schemas; never retain protocol headers, tokens, account identifiers,
  designs or other account payload values in public source. Normalize the retained declarations
  through `marketplace capture-remote-catalog`.
- Review stable account identity and any resource selection from redacted output shapes. The
  current opaque connection label is an unverified placeholder. Canva authorization is per user;
  do not infer organization-wide access or reuse a shared human account.
- Establish and digest-bind the actual authorization/token endpoints, authentication method,
  granted-scope policy, expiry bounds, refresh behavior and revocation semantics. Do not assume
  the former endpoint's lifecycle applies here or that MCP tokens work on other Canva REST APIs.
- Review tool classifications, policies, output limits, catalog digest, source and authority diff.
  Obtain the required independent approval before promoting the declaration and release entry.
- Perform trusted publication and verify application readback, Store visibility, installation,
  per-user OAuth, catalog compatibility, invocation, token recovery and disconnect.

Empty catalogs and zero evidence digests are deliberate publication blockers. Authoring validation,
preparation and offline checks do not prove live provider or application acceptance.
