# Notion live catalog staging

`plugins/remotes/notion.json` stages version `1.0.3` from an owner-consented OAuth
`tools/list` capture. The capture advertised 45 tools; this release selects
`notion-search`, `notion-fetch`, and the read-only `notion-get-tool-access` tool.
Only their input schemas are copied exactly. The full capture remains outside this
repository. The selected schemas were checked for embedded URLs and email
addresses; they contained only the public JSON Schema specification URL.

The installed `1.0.0` catalog's `notion-search` accepts only `query`; the live
schema has nine properties and different constraints. The application checks the
invoked tool against its reviewed schema, so this drift blocks invocation. The
new version gives the snapshot a distinct ID and digest. Its three selected tools
have default policy `allow`, subject to the application's independent grants and
runtime restrictions. Notion documents `notion-get-tool-access` as the read-only
prerequisite for search routing and plan-dependent parameters.

This source is **staged-unverified**. The formerly cataloged
`notion-create-pages` and `notion-update-page` are omitted. Their captured schemas
include `anyOf` and `propertyNames`, which the pinned application tool argument
validator does not support, and update-page now requires `command`. Publishing
these write tools would make some valid arguments fail. An application-side schema
contract change and joint review are required before adding them; do not replace
the captured schemas with lossy approximations. The live read schemas use
`additionalProperties: {}` at the root, permitting extra keys in the application's
validator; this exact provider constraint needs explicit authority review. The
read-only search and get-tool-access probes returned `isError: false`; the search
response had one content block, but its shape and result count were not established.
There is no reviewed `1.0.3` release record or approval, and no claim of live
publication, Store visibility, installation, or application invocation.
`releases/index.json` therefore marks this version ineligible. The credential-free
`fixtures/remotes/notion-1.0.2.json` is the exact `ac61760` baseline declaration,
retained only for historical publication-adapter regression coverage; it does not
represent the current source or approve `1.0.3`.

After a separately approved publication, upgrading an existing installation
revokes its active agent grants and disconnects its connections in the application.
Owners must reconnect Notion and regrant the selected tools; publication alone
does not repair an existing `1.0.0` installation.

For the full offline gate run `pnpm check`. Before any commit or publication
approval run `pnpm marketplace public-safety`; independently inspect exact Git
history as required by `SECURITY.md`.
