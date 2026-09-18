# GitHub managed-package candidate

First-party source for a narrow GitHub integration with three selected capabilities: search issues, read one issue, and create one issue. Reads are classified `read`; issue creation is `write` and requires exact Owner approval.

This candidate is **not publishable** yet. The portable package contract accepts the reviewed `github-app` declaration, but the provider registration, independent release review, and live installation/invocation acceptance remain unverified. The trusted Actor privately supplies its short-lived installation credential as `PLUGIN_ACCESS_TOKEN`; it is not authored Config or a static platform binding. The source never accepts a user token, OAuth client secret, or durable refresh credential.

The Supernala-authored candidate source is licensed under the MIT License in `plugins/github/LICENSE`; `plugins/github/NOTICE` records its scope. It is first-party code, not a repackaged upstream server, and has no runtime dependencies or bundled third-party code. The MIT license does not grant rights in GitHub trademarks, APIs, hosted content, or services; use of those remains subject to GitHub's applicable terms.
