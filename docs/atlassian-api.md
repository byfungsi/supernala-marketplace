# Jira REST API-token connection (`atlassian-api`)

`plugins/atlassian-api/` is the API-token method of the [Atlassian app](./app-bundles.md), beside the Rovo MCP sign-in. It replaced `atlassian-api-token`, whose MCP route works only where an organization admin enabled API-token access.

## How it connects

- The Owner enters an Atlassian email, a **Jira API token created with scopes**, and the site (`team.atlassian.net`). Atlassian accepts tokens with scopes only through its gateway, `https://api.atlassian.com/ex/jira/{cloudId}`, and needs no admin setting there.
- Setup reads the site's public `https://<site>/_edge/tenant_info` without credentials. Its `cloudId` becomes the connection's selected resource; the site's hostname is the connection label.
- Setup then verifies the token at `/ex/jira/{cloudId}/rest/api/3/myself` with HTTP Basic. A 401 or 403 is reported as rejected credentials, so the Owner can fix the token instead of retrying.
- Every tool's `cloudId` path parameter is `fill: "connection-resource"`: absent from the Bot's input schema and injected from the connection at call time. Contracts admit a filled parameter only where the reviewed resource binding (`["path", "cloudId"]`) injects it, and the runtime still checks the injected value against the connection.

## Source

`openapi.json` is a reviewed local selection of the Jira Cloud REST API v3 for the gateway paths (Atlassian's full specification exceeds the 1 MiB source limit and is written for site URLs). `openapi-source.json` declares the API-key strategy explicitly because the credential has three fields and uses Basic auth.

Tools: get the connected user; search issues with JQL; get an issue; list comments and status changes; find projects and people; list a project's issue types and their fields (reads, default **allow**); create, edit, comment on, change the status of and assign an issue (writes, default **ask each time**). Confluence is not included: a token with scopes covers one app.

## Result size (1.0.1)

Each tool declares `maximumOutputBytes`. 1.0.0 gave every tool 256 KiB, and a JQL search without `fields` returned more than that, which failed a Bot's task. 1.0.1 raises the reads that return issue content (search, get issue, comments, issue-type fields) to the platform maximum of 1 MiB, and the search, get-issue and comments descriptions tell the Bot to request only the fields it needs, keep pages small and continue with `nextPageToken`. Only descriptions and output limits changed: no tool's input schema, classification or policy did, so the authority diff is empty and existing grants carry over on update. The application reports a response over the limit to the Bot as a definite failure with guidance to narrow the request.

## Release prerequisites

- The application must ship site-scoped API-key support (credential-origin lookup, `https-json-resource` verification and filled parameters) before publication.
- A credential-free provider registration `atlassian-rest-v1` must exist in production, like `resend-api-credentials-v1`.
- Live token acceptance is pending until an Owner connects a real site.
