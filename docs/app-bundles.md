# Marketplace app bundles

The Owner installs, updates, and uninstalls an **app**. Immutable Plugin releases
are its internal runtime components. The application owns the curated membership
registry and commits lifecycle changes across all components atomically.

| App    | Component releases                  | Account setup                                                                        |
| ------ | ----------------------------------- | ------------------------------------------------------------------------------------ |
| Gmail  | `gmail` + `gmail-send`              | Authorize reading and/or sending and choose Bot access.                              |
| Resend | `resend@1.0.3` + `resend-api@1.0.0` | Sign in, provide an API key, or connect both; choose Bot access for each connection. |

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
