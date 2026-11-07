-- Marketplace setup guides tell an Owner how to prepare an app's credentials, for example
-- creating a Google OAuth client. They are published from the Marketplace repository apart
-- from Plugin versions, so a guide can improve without a new version. Revisions are
-- immutable; the highest revision is current.
CREATE TABLE plugin_setup_guides (
  plugin_definition_id TEXT NOT NULL REFERENCES plugin_definitions(plugin_definition_id),
  revision INTEGER NOT NULL CHECK (revision >= 1),
  markdown TEXT NOT NULL CHECK (length(markdown) BETWEEN 1 AND 16000),
  content_sha256 TEXT NOT NULL CHECK (length(content_sha256) = 64),
  published_at INTEGER NOT NULL,
  PRIMARY KEY (plugin_definition_id, revision)
) WITHOUT ROWID;

CREATE TRIGGER plugin_setup_guides_immutable_update
BEFORE UPDATE ON plugin_setup_guides
BEGIN
  SELECT RAISE(ABORT, 'plugin setup guide revisions are immutable');
END;

CREATE TRIGGER plugin_setup_guides_immutable_delete
BEFORE DELETE ON plugin_setup_guides
BEGIN
  SELECT RAISE(ABORT, 'plugin setup guide revisions are immutable');
END;
