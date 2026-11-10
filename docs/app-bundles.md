# Marketplace app bundles

The Owner installs, updates, and uninstalls an **app**. Immutable Plugin releases
are its internal runtime components. The application owns the curated membership
registry and commits lifecycle changes across all components atomically.

| App       | Component releases                                     | Account setup                                                                                                                 |
| --------- | ------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------- |
| Gmail     | `gmail@0.2.1`                                          | One account reads and sends; choose each Bot's read and send access.                                                          |
| Resend    | `resend@1.0.3` + `resend-api@1.0.0`                    | Sign in, provide an API key, or connect both; choose Bot access for each connection.                                          |
| Atlassian | `atlassian` (Rovo MCP sign-in) + `atlassian-api@1.0.0` | Sign in for Jira and Confluence, or use a Jira API token with scopes (no admin setting).                                      |
| Jev       | `jev@1.0.0` + `jev-openrouter@1.0.0`                   | Your TypeSafe API key or your OpenRouter API key; both give Bots and workflows the same Ask Jev tool. See [jev.md](./jev.md). |
| Vercel    | `vercel@1.0.0` + `vercel-api@1.0.0`                    | Sign in with Vercel (its MCP server's own tools), or your Vercel access token. See [vercel-api.md](./vercel-api.md).          |

Gmail 0.2.1 replaced the separate `gmail` (read) and `gmail-send` components with one release under a new `google-gmail-rest-v2` registration, so one Google consent covers reading and sending. `gmail-send@0.1.0` stays published for history; the application no longer offers it. (0.2.0 failed to stage in production and is never published: a Plugin keeps the description it was first published with.)

Atlassian's API-token method is `atlassian-api@1.0.0`: Jira REST through `api.atlassian.com/ex/jira/{cloudId}`, where the site's public `tenant_info` names the `cloudId` and every call has it filled from the connection. It replaced `atlassian-api-token`, whose Rovo MCP route accepts API tokens only where an organization admin enabled it; that component stays published for history. See [atlassian-api.md](./atlassian-api.md).

Installation includes every component but does not authorize accounts or grant
tools. Existing partial installations are completed by the application without
silently upgrading existing versions or discarding their working connections.
Publication still admits each exact reviewed component artifact independently;
an app cannot be freshly installed until every component is available.

Resend MCP exposes the consented `resend.send_email` operation. The API-key
component exposes 59 admitted REST operations, including `http.post.emails`.
These send contracts differ: MCP includes analytics arguments, different input
constraints, and natural-language scheduling; REST uses the pinned HTTP body
and header bindings. They are not declared interchangeable. When both connections
are authorized, the available tool set is their union, with each invocation bound
to one exact connection and operation. No app lifecycle change authorizes duplicate
dispatch or cross-adapter retry of an uncertain send.

The Owner reauthorized API-key publication on 2026-09-30. The release index now
includes the existing independently reviewed `resend-api@1.0.0` artifact. Its
source, artifact, catalog, permission policies, and review digests are unchanged.
Production publication uses the trusted exact-main release workflow. Live API-key
setup and provider invocation acceptance remain separate from publication evidence.
