# Immutable release reviews

An eligible managed package version requires `<pluginSlug>-<semanticVersion>.json`, decoded by `ReleaseReview`. It binds the exact source-input, artifact, catalog, Config, authority snapshot, and authority-diff digests plus reviewer-controlled ID/time. The protected-main workflow separately injects and verifies the exact merge SHA and run ordinal.

These files are security decisions, not booleans or labels. Branch protection must require independent CODEOWNER review. The production environment must expose the matching approved review ID; PR code cannot supply that environment value. No Plugin is currently eligible, so no approval is fabricated here.
