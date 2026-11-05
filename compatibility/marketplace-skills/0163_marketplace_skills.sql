-- Curated Marketplace Skills. The supernala-marketplace release publishes reviewed Skill files to
-- the platform AgentSkillBundles bucket (marketplace/sha256/<digest>) and writes these rows; the
-- application owns the schema and reads them. Rows decide what is visible and installable.
CREATE TABLE marketplace_skill_definitions (
  skill_definition_id TEXT PRIMARY KEY NOT NULL
    CHECK (skill_definition_id = publisher_namespace || '/' || skill_slug),
  marketplace_id TEXT NOT NULL REFERENCES plugin_marketplaces(marketplace_id),
  publisher_namespace TEXT NOT NULL CHECK (length(publisher_namespace) BETWEEN 1 AND 80),
  publisher_name TEXT NOT NULL CHECK (length(publisher_name) BETWEEN 1 AND 120),
  skill_slug TEXT NOT NULL CHECK (length(skill_slug) BETWEEN 1 AND 80),
  name TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 120),
  short_description TEXT NOT NULL CHECK (length(short_description) BETWEEN 1 AND 600),
  long_description TEXT NOT NULL CHECK (length(long_description) <= 8000),
  categories_json TEXT NOT NULL CHECK (json_valid(categories_json) AND json_type(categories_json) = 'array'),
  -- Lower ranks are featured first; NULL is not featured.
  featured_rank INTEGER CHECK (featured_rank IS NULL OR featured_rank >= 0),
  status TEXT NOT NULL CHECK (status IN ('active', 'disabled')),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE (marketplace_id, publisher_namespace, skill_slug)
) WITHOUT ROWID;

CREATE TABLE marketplace_skill_versions (
  skill_version_id TEXT PRIMARY KEY NOT NULL
    CHECK (skill_version_id = skill_definition_id || '@' || semantic_version),
  skill_definition_id TEXT NOT NULL REFERENCES marketplace_skill_definitions(skill_definition_id),
  semantic_version TEXT NOT NULL CHECK (semantic_version GLOB '[0-9]*.[0-9]*.[0-9]*'),
  version_ordinal INTEGER NOT NULL CHECK (version_ordinal > 0),
  -- The Skill as installed: its own name, description, SKILL.md body and folder files.
  skill_name TEXT NOT NULL CHECK (length(trim(skill_name)) BETWEEN 1 AND 120),
  skill_description TEXT NOT NULL CHECK (length(trim(skill_description)) BETWEEN 1 AND 600),
  instructions_markdown TEXT NOT NULL CHECK (length(trim(instructions_markdown)) BETWEEN 1 AND 32000),
  files_json TEXT NOT NULL CHECK (json_valid(files_json) AND json_type(files_json) = 'array'),
  file_count INTEGER NOT NULL CHECK (file_count BETWEEN 0 AND 200),
  byte_size INTEGER NOT NULL CHECK (byte_size BETWEEN 0 AND 50000000),
  license_spdx TEXT NOT NULL,
  attribution TEXT NOT NULL CHECK (length(attribution) <= 4000),
  source_json TEXT NOT NULL CHECK (json_valid(source_json)),
  release_digest TEXT NOT NULL CHECK (length(release_digest) = 64),
  status TEXT NOT NULL CHECK (status IN ('published', 'withdrawn')),
  published_at INTEGER NOT NULL,
  UNIQUE (skill_definition_id, version_ordinal),
  UNIQUE (skill_definition_id, semantic_version)
) WITHOUT ROWID;
CREATE INDEX marketplace_skill_versions_current
  ON marketplace_skill_versions (skill_definition_id, status, version_ordinal DESC);

-- Published content is immutable; a version can only be withdrawn.
CREATE TRIGGER marketplace_skill_versions_content_immutable
BEFORE UPDATE ON marketplace_skill_versions
WHEN NOT (
  old.status = 'published' AND new.status = 'withdrawn'
  AND old.skill_version_id = new.skill_version_id
  AND old.skill_definition_id = new.skill_definition_id
  AND old.semantic_version = new.semantic_version
  AND old.version_ordinal = new.version_ordinal
  AND old.skill_name = new.skill_name
  AND old.skill_description = new.skill_description
  AND old.instructions_markdown = new.instructions_markdown
  AND old.files_json = new.files_json
  AND old.file_count = new.file_count
  AND old.byte_size = new.byte_size
  AND old.license_spdx = new.license_spdx
  AND old.attribution = new.attribution
  AND old.source_json = new.source_json
  AND old.release_digest = new.release_digest
  AND old.published_at = new.published_at
)
BEGIN
  SELECT RAISE(ABORT, 'marketplace skill versions are immutable and can only be withdrawn');
END;

CREATE TRIGGER marketplace_skill_versions_no_delete
BEFORE DELETE ON marketplace_skill_versions
BEGIN
  SELECT RAISE(ABORT, 'marketplace skill versions are retained');
END;

-- Install provenance: which catalog version a Workspace Skill was installed or last updated from,
-- and which of its own versions that was, so later local edits are detectable.
ALTER TABLE workspace_skills ADD COLUMN origin_skill_version_id TEXT
  REFERENCES marketplace_skill_versions(skill_version_id);
ALTER TABLE workspace_skills ADD COLUMN origin_workspace_version INTEGER
  CHECK (origin_workspace_version IS NULL OR origin_workspace_version > 0);
CREATE INDEX workspace_skills_marketplace_origin
  ON workspace_skills (workspace_id, origin_skill_version_id)
  WHERE origin_skill_version_id IS NOT NULL;
