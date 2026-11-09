-- Portable subset of application migration 0148_plugin_event_sources.sql: the reviewed event
-- catalog Marketplace publication writes. Monitoring tables need App-owned identity tables.
-- Reviewed platform adapter metadata is immutable and pinned to one exact Plugin Version.
-- This does not grant monitoring consent, provision a provider subscription or execute package hooks.
CREATE TABLE plugin_version_event_catalogs (
  plugin_version_id TEXT PRIMARY KEY NOT NULL REFERENCES plugin_versions(plugin_version_id),
  reviewed_manifest_digest TEXT NOT NULL CHECK (
    length(reviewed_manifest_digest) = 64 AND reviewed_manifest_digest NOT GLOB '*[^0-9a-f]*'
  ),
  catalog_digest TEXT NOT NULL CHECK (
    length(catalog_digest) = 64 AND catalog_digest NOT GLOB '*[^0-9a-f]*'
  ),
  canonical_catalog_json TEXT NOT NULL CHECK (
    length(CAST(canonical_catalog_json AS BLOB)) BETWEEN 1 AND 16384
    AND json_valid(canonical_catalog_json)
    AND COALESCE(
      json_type(canonical_catalog_json, '$.pluginVersionId') = 'text'
      AND json_extract(canonical_catalog_json, '$.pluginVersionId') = plugin_version_id
      AND json_type(canonical_catalog_json, '$.events') = 'array'
      AND json_array_length(canonical_catalog_json, '$.events') BETWEEN 1 AND 16,
      0
    )
  ),
  reviewed_at INTEGER NOT NULL CHECK (reviewed_at >= 0),
  UNIQUE (plugin_version_id, catalog_digest)
) WITHOUT ROWID;

CREATE TRIGGER plugin_version_event_catalogs_no_update
BEFORE UPDATE ON plugin_version_event_catalogs
BEGIN
  SELECT RAISE(ABORT, 'Plugin event catalogs are immutable');
END;

CREATE TRIGGER plugin_version_event_catalogs_no_delete
BEFORE DELETE ON plugin_version_event_catalogs
BEGIN
  SELECT RAISE(ABORT, 'Plugin event catalogs are retained');
END;
