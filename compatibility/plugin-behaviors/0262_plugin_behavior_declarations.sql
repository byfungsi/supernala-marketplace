-- Plugin behaviour declarations (docs/plans/proactive-agents.md section 2; Marketplace
-- docs/proactive-manifest-app-contract.md section 1). One immutable row per
-- (plugin_definition_id, revision), published apart from Plugin versions like setup guides; the
-- highest revision is current. `declaration_json` is the canonical JSON and `content_sha256` its
-- SHA-256; readers recompute the digest and bind the declaration to each installed version's
-- catalog, ignoring entries that do not check.
CREATE TABLE plugin_behavior_declarations (
  plugin_definition_id TEXT NOT NULL REFERENCES plugin_definitions(plugin_definition_id),
  revision INTEGER NOT NULL CHECK (revision >= 1),
  declaration_json TEXT NOT NULL CHECK (length(declaration_json) BETWEEN 2 AND 65536),
  content_sha256 TEXT NOT NULL CHECK (length(content_sha256) = 64),
  published_at INTEGER NOT NULL,
  PRIMARY KEY (plugin_definition_id, revision)
) WITHOUT ROWID;

CREATE TRIGGER plugin_behavior_declarations_immutable_update
BEFORE UPDATE ON plugin_behavior_declarations
BEGIN
  SELECT RAISE(ABORT, 'plugin behavior declaration revisions are immutable');
END;

CREATE TRIGGER plugin_behavior_declarations_immutable_delete
BEFORE DELETE ON plugin_behavior_declarations
BEGIN
  SELECT RAISE(ABORT, 'plugin behavior declaration revisions are immutable');
END;

-- The typed failure kind the host classified for one failed Plugin call, how it was handled and
-- whether a later call of the same tool fixed it. Values only: no arguments, results or messages.
CREATE TABLE plugin_call_failures (
  tool_call_id TEXT PRIMARY KEY NOT NULL,
  workspace_id TEXT NOT NULL,
  connection_id TEXT NOT NULL,
  plugin_version_id TEXT NOT NULL,
  tool_id TEXT NOT NULL,
  agent_id TEXT,
  kind TEXT NOT NULL CHECK (kind IN (
    'auth_expired', 'auth_revoked', 'rate_limited', 'transient', 'watch_expired',
    'not_found', 'permission_denied', 'schema_changed', 'quota_exceeded'
  )),
  fix TEXT NOT NULL CHECK (fix IN ('auto', 'owner', 'publisher', 'none')),
  action TEXT NOT NULL CHECK (action IN (
    'retry', 'backoff', 'rewatch', 'refresh_token', 'reconnect', 'report', 'none'
  )),
  source TEXT NOT NULL CHECK (source IN ('declared', 'host')),
  behavior_revision INTEGER,
  http_status INTEGER,
  provider_code TEXT CHECK (provider_code IS NULL OR length(provider_code) <= 100),
  write_call INTEGER NOT NULL CHECK (write_call IN (0, 1)),
  status TEXT NOT NULL CHECK (status IN ('open', 'fixed', 'owner-notified', 'reported', 'fact')),
  recorded_at INTEGER NOT NULL,
  fixed_at INTEGER
) WITHOUT ROWID;

CREATE INDEX plugin_call_failures_open_by_tool
  ON plugin_call_failures(connection_id, tool_id, status, recorded_at);

-- Per Workspace and app: proactive follow-ups on (default), off, or failures only.
CREATE TABLE plugin_proactive_settings (
  workspace_id TEXT NOT NULL,
  plugin_definition_id TEXT NOT NULL,
  follow_ups TEXT NOT NULL CHECK (follow_ups IN ('on', 'off', 'failures-only')),
  updated_by_user_id TEXT NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (workspace_id, plugin_definition_id)
) WITHOUT ROWID;
