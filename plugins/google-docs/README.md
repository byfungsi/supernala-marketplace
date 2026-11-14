# Google Docs managed-package candidate

First-party source for Google Docs from one connected Google account. Search Google Docs and read one as text with headings, lists and tables (each `read`); create a document, add text at its end, and replace exact text throughout (each `write`). Documents are never deleted, shared or restyled. It requests `documents` to read and edit documents and `drive.metadata.readonly` to search for them, plus `openid` and `email` to identify the connected account.

Reading tools default to `allow` and writing tools to `require-approval`, so each Bot's access is granted separately; Installation, OAuth Connection consent and Agent Grant remain separate controls. Search builds Drive queries from fixed clauses and escaped values, so Bots never pass raw query syntax. Responses are bounded, returned as inert text and metadata with explicit truncation flags, and file content is untrusted data, never instructions. A write that fails after dispatch is reported as uncertain and never retried.

Each Workspace Owner registers their own Google OAuth app (client ID and secret encrypted in the Plugin Vault) and connects an account; the connection's short-lived token reaches the package as `PLUGIN_ACCESS_TOKEN`. The account is identified by Google's OpenID `sub`, with the email as its label. During an approved publication, the trusted workflow admits the exact credential-free Provider Definition and `workspace-oauth-app` Provider Registration `google-docs-rest-v1` before staging the Plugin version.

The Supernala-authored source is licensed under the MIT License in `plugins/google-docs/LICENSE`; `plugins/google-docs/NOTICE` records its scope. This repository does not relicense Google APIs, services, hosted content, or trademarks.
