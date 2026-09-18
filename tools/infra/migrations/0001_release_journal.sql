CREATE TABLE marketplace_release_journal (
  release_identity TEXT PRIMARY KEY NOT NULL,
  marketplace_id TEXT NOT NULL,
  publisher_namespace TEXT NOT NULL,
  plugin_slug TEXT NOT NULL,
  semantic_version TEXT NOT NULL,
  definition_id TEXT NOT NULL,
  runtime_kind TEXT NOT NULL CHECK (runtime_kind IN ('managed-package', 'managed-remote-mcp')),
  version_json TEXT NOT NULL,
  source_input_digest TEXT NOT NULL CHECK (length(source_input_digest) = 64),
  release_digest TEXT NOT NULL CHECK (length(release_digest) = 64),
  catalog_digest TEXT NOT NULL CHECK (length(catalog_digest) = 64),
  config_digest TEXT NOT NULL CHECK (length(config_digest) = 64),
  provenance_json TEXT NOT NULL,
  provenance_digest TEXT NOT NULL CHECK (length(provenance_digest) = 64),
  authority_baseline_digest TEXT NOT NULL CHECK (length(authority_baseline_digest) = 64),
  authority_digest TEXT NOT NULL CHECK (length(authority_digest) = 64),
  authority_diff_digest TEXT NOT NULL CHECK (length(authority_diff_digest) = 64),
  artifact_digest TEXT CHECK (artifact_digest IS NULL OR length(artifact_digest) = 64),
  artifact_byte_length INTEGER CHECK (artifact_byte_length IS NULL OR artifact_byte_length > 0),
  merge_commit TEXT NOT NULL,
  release_ordinal INTEGER NOT NULL CHECK (release_ordinal >= 0),
  review_id TEXT NOT NULL,
  reviewer TEXT NOT NULL,
  reviewed_at INTEGER NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('claimed', 'artifact-verified', 'published', 'failed')),
  attempts INTEGER NOT NULL CHECK (attempts >= 1),
  failure_type TEXT,
  generation INTEGER NOT NULL CHECK (generation >= 1),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE (marketplace_id, publisher_namespace, plugin_slug, semantic_version)
) WITHOUT ROWID;

CREATE INDEX marketplace_release_journal_plugin_status
  ON marketplace_release_journal
    (marketplace_id, publisher_namespace, plugin_slug, status, release_ordinal DESC);

CREATE TABLE marketplace_release_baselines (
  plugin_identity TEXT PRIMARY KEY NOT NULL,
  release_identity TEXT NOT NULL REFERENCES marketplace_release_journal(release_identity),
  release_ordinal INTEGER NOT NULL CHECK (release_ordinal >= 0),
  release_digest TEXT NOT NULL CHECK (length(release_digest) = 64),
  updated_at INTEGER NOT NULL
) WITHOUT ROWID;
