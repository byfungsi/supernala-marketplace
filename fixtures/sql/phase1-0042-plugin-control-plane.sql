CREATE TABLE plugin_marketplaces (
  marketplace_id TEXT PRIMARY KEY NOT NULL,
  name TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 120),
  visibility TEXT NOT NULL CHECK (visibility = 'public'),
  trust_class TEXT NOT NULL CHECK (trust_class = 'supernala-curated'),
  status TEXT NOT NULL CHECK (status IN ('active', 'disabled')),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
) WITHOUT ROWID;

INSERT INTO plugin_marketplaces
  (marketplace_id, name, visibility, trust_class, status, created_at, updated_at)
VALUES
  ('supernala-public', 'Supernala Marketplace', 'public', 'supernala-curated', 'active', 0, 0);

CREATE TABLE plugin_definitions (
  plugin_definition_id TEXT PRIMARY KEY NOT NULL,
  marketplace_id TEXT NOT NULL REFERENCES plugin_marketplaces(marketplace_id),
  publisher_namespace TEXT NOT NULL CHECK (length(publisher_namespace) BETWEEN 1 AND 80),
  plugin_slug TEXT NOT NULL CHECK (length(plugin_slug) BETWEEN 1 AND 80),
  name TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 120),
  short_description TEXT NOT NULL CHECK (length(short_description) BETWEEN 1 AND 500),
  long_description TEXT NOT NULL CHECK (length(long_description) BETWEEN 1 AND 8000),
  categories_json TEXT NOT NULL,
  publisher_trust TEXT NOT NULL CHECK (publisher_trust = 'supernala-curated'),
  status TEXT NOT NULL CHECK (status IN ('active', 'disabled')),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE (marketplace_id, publisher_namespace, plugin_slug)
) WITHOUT ROWID;

CREATE TABLE plugin_artifacts (
  artifact_digest TEXT PRIMARY KEY NOT NULL CHECK (length(artifact_digest) = 64),
  object_key TEXT NOT NULL UNIQUE,
  byte_size INTEGER NOT NULL CHECK (byte_size > 0),
  status TEXT NOT NULL CHECK (status IN ('pending', 'available', 'blocked')),
  verified_at INTEGER,
  created_at INTEGER NOT NULL,
  CHECK (
    (status = 'pending' AND verified_at IS NULL)
    OR (status IN ('available', 'blocked') AND verified_at IS NOT NULL)
  )
) WITHOUT ROWID;

CREATE TABLE provider_registrations (
  provider_registration_id TEXT PRIMARY KEY NOT NULL,
  provider TEXT NOT NULL CHECK (length(provider) BETWEEN 1 AND 100),
  resource_identity TEXT NOT NULL CHECK (length(resource_identity) BETWEEN 1 AND 2048),
  registration_mode TEXT NOT NULL CHECK (
    registration_mode IN ('dynamic', 'platform-pre-registered')
  ),
  authorization_metadata_url TEXT,
  authorization_endpoint TEXT,
  token_endpoint TEXT,
  registration_endpoint TEXT,
  userinfo_endpoint TEXT,
  revocation_endpoint TEXT,
  metadata_digest TEXT CHECK (metadata_digest IS NULL OR length(metadata_digest) = 64),
  callback_url TEXT NOT NULL CHECK (length(callback_url) BETWEEN 1 AND 2048),
  approved_scopes_json TEXT NOT NULL,
  client_credential_reference TEXT,
  dynamic_registration_claim TEXT,
  dynamic_registration_claimed_at INTEGER,
  source TEXT NOT NULL CHECK (source = 'platform'),
  status TEXT NOT NULL CHECK (status IN ('active', 'reauthorization-required', 'revoked')),
  revision INTEGER NOT NULL CHECK (revision >= 1),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  CHECK (
    (registration_mode = 'dynamic' AND authorization_metadata_url IS NOT NULL)
    OR (registration_mode = 'platform-pre-registered' AND client_credential_reference IS NOT NULL)
  ),
  CHECK (
    (dynamic_registration_claim IS NULL AND dynamic_registration_claimed_at IS NULL)
    OR (dynamic_registration_claim IS NOT NULL AND dynamic_registration_claimed_at IS NOT NULL)
  )
) WITHOUT ROWID;

CREATE TABLE platform_plugin_config_bindings (
  binding_id TEXT PRIMARY KEY NOT NULL,
  logical_group_key TEXT NOT NULL,
  field_key TEXT NOT NULL,
  source_kind TEXT NOT NULL CHECK (source_kind IN ('environment', 'secret', 'vault')),
  source_name TEXT NOT NULL,
  sensitivity TEXT NOT NULL CHECK (sensitivity IN ('non-secret', 'secret')),
  delivery TEXT NOT NULL CHECK (delivery IN (
    'oauth-broker-only',
    'token-minting-adapter-only',
    'plugin-host-environment',
    'remote-mcp-header',
    'control-plane-only'
  )),
  revision INTEGER NOT NULL CHECK (revision >= 1),
  status TEXT NOT NULL CHECK (status IN ('active', 'revoked')),
  UNIQUE (logical_group_key, field_key)
) WITHOUT ROWID;

CREATE TABLE remote_mcp_endpoint_registrations (
  endpoint_registration_id TEXT PRIMARY KEY NOT NULL,
  endpoint_url TEXT NOT NULL UNIQUE CHECK (endpoint_url LIKE 'https://%'),
  expected_origin TEXT NOT NULL CHECK (expected_origin LIKE 'https://%'),
  transport TEXT NOT NULL CHECK (transport = 'streamable-http'),
  provider_registration_id TEXT NOT NULL REFERENCES provider_registrations(provider_registration_id),
  resource_audience TEXT NOT NULL,
  protocol_policy_json TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('active', 'revoked')),
  revision INTEGER NOT NULL CHECK (revision >= 1),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
) WITHOUT ROWID;

CREATE TABLE plugin_catalog_snapshots (
  catalog_snapshot_id TEXT PRIMARY KEY NOT NULL,
  catalog_digest TEXT NOT NULL UNIQUE CHECK (length(catalog_digest) = 64),
  schema_version INTEGER NOT NULL CHECK (schema_version = 1),
  created_at INTEGER NOT NULL
) WITHOUT ROWID;

CREATE TABLE plugin_catalog_tools (
  catalog_snapshot_id TEXT NOT NULL REFERENCES plugin_catalog_snapshots(catalog_snapshot_id),
  tool_id TEXT NOT NULL,
  ordinal INTEGER NOT NULL CHECK (ordinal >= 0),
  mcp_name TEXT NOT NULL CHECK (length(mcp_name) BETWEEN 1 AND 160),
  title TEXT NOT NULL CHECK (length(title) BETWEEN 1 AND 160),
  description TEXT NOT NULL CHECK (length(description) BETWEEN 1 AND 1000),
  classification TEXT NOT NULL CHECK (
    classification IN ('read', 'write', 'destructive', 'unknown')
  ),
  default_policy TEXT NOT NULL CHECK (
    default_policy IN ('allow', 'require-approval', 'block')
  ),
  input_schema_json TEXT NOT NULL,
  maximum_output_bytes INTEGER NOT NULL CHECK (maximum_output_bytes BETWEEN 1 AND 1048576),
  PRIMARY KEY (catalog_snapshot_id, tool_id),
  UNIQUE (catalog_snapshot_id, ordinal)
) WITHOUT ROWID;

CREATE TABLE plugin_config_schemas (
  config_schema_id TEXT PRIMARY KEY NOT NULL,
  schema_digest TEXT NOT NULL UNIQUE CHECK (length(schema_digest) = 64),
  revision INTEGER NOT NULL CHECK (revision >= 1),
  fields_json TEXT NOT NULL,
  created_at INTEGER NOT NULL
) WITHOUT ROWID;

CREATE TABLE plugin_versions (
  plugin_version_id TEXT PRIMARY KEY NOT NULL,
  plugin_definition_id TEXT NOT NULL REFERENCES plugin_definitions(plugin_definition_id),
  semantic_version TEXT NOT NULL,
  manifest_digest TEXT NOT NULL CHECK (length(manifest_digest) = 64),
  catalog_snapshot_id TEXT NOT NULL REFERENCES plugin_catalog_snapshots(catalog_snapshot_id),
  config_schema_id TEXT NOT NULL REFERENCES plugin_config_schemas(config_schema_id),
  runtime_kind TEXT NOT NULL CHECK (runtime_kind IN ('managed-package', 'managed-remote-mcp')),
  artifact_digest TEXT REFERENCES plugin_artifacts(artifact_digest),
  package_entrypoint TEXT,
  package_node_version TEXT,
  endpoint_registration_id TEXT REFERENCES remote_mcp_endpoint_registrations(endpoint_registration_id),
  provider_registration_id TEXT REFERENCES provider_registrations(provider_registration_id),
  authentication_kind TEXT NOT NULL CHECK (authentication_kind IN ('none', 'oauth', 'github-app')),
  requested_scopes_json TEXT NOT NULL,
  allowed_hosts_json TEXT NOT NULL,
  license TEXT NOT NULL,
  provenance_json TEXT NOT NULL,
  privacy_policy_url TEXT,
  release_date INTEGER NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('publishing', 'published', 'revoked')),
  review_status TEXT NOT NULL CHECK (review_status IN ('pending', 'approved', 'rejected')),
  published_at INTEGER,
  revoked_at INTEGER,
  created_at INTEGER NOT NULL,
  UNIQUE (plugin_definition_id, semantic_version),
  CHECK (
    (runtime_kind = 'managed-package'
      AND artifact_digest IS NOT NULL
      AND package_entrypoint IS NOT NULL
      AND package_node_version = '22.x'
      AND endpoint_registration_id IS NULL)
    OR
    (runtime_kind = 'managed-remote-mcp'
      AND artifact_digest IS NULL
      AND package_entrypoint IS NULL
      AND package_node_version IS NULL
      AND endpoint_registration_id IS NOT NULL
      AND provider_registration_id IS NOT NULL)
  ),
  CHECK (
    (status = 'publishing' AND published_at IS NULL AND revoked_at IS NULL)
    OR (status = 'published' AND review_status = 'approved' AND published_at IS NOT NULL AND revoked_at IS NULL)
    OR (status = 'revoked' AND published_at IS NOT NULL AND revoked_at IS NOT NULL)
  )
) WITHOUT ROWID;

CREATE INDEX plugin_versions_installable
  ON plugin_versions (plugin_definition_id, status, release_date DESC);

CREATE TABLE plugin_publication_intents (
  publication_intent_id TEXT PRIMARY KEY NOT NULL,
  plugin_version_id TEXT NOT NULL UNIQUE REFERENCES plugin_versions(plugin_version_id),
  artifact_digest TEXT REFERENCES plugin_artifacts(artifact_digest),
  status TEXT NOT NULL CHECK (status IN ('pending', 'artifact-verified', 'published', 'failed')),
  attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  available_at INTEGER NOT NULL,
  last_failure_reason TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
) WITHOUT ROWID;

CREATE TABLE plugin_installations (
  installation_id TEXT PRIMARY KEY NOT NULL,
  user_id TEXT NOT NULL REFERENCES "user"("id"),
  plugin_definition_id TEXT NOT NULL REFERENCES plugin_definitions(plugin_definition_id),
  plugin_version_id TEXT NOT NULL REFERENCES plugin_versions(plugin_version_id),
  artifact_digest TEXT REFERENCES plugin_artifacts(artifact_digest),
  catalog_snapshot_id TEXT NOT NULL REFERENCES plugin_catalog_snapshots(catalog_snapshot_id),
  status TEXT NOT NULL CHECK (status IN ('active', 'deactivated', 'version-revoked')),
  revision INTEGER NOT NULL DEFAULT 1 CHECK (revision >= 1),
  installed_at INTEGER NOT NULL,
  deactivated_at INTEGER,
  client_operation_id TEXT NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE (user_id, client_operation_id)
) WITHOUT ROWID;

CREATE TABLE plugin_user_event_outbox (
  sequence INTEGER PRIMARY KEY AUTOINCREMENT,
  workspace_id TEXT NOT NULL,
  user_id TEXT NOT NULL
);

CREATE INDEX plugin_user_event_outbox_sequence
  ON plugin_user_event_outbox (sequence);

CREATE UNIQUE INDEX plugin_installations_active_definition
  ON plugin_installations (user_id, plugin_definition_id)
  WHERE status = 'active';

CREATE TABLE workspace_plugin_activations (
  activation_id TEXT PRIMARY KEY NOT NULL,
  installation_id TEXT NOT NULL REFERENCES plugin_installations(installation_id),
  workspace_id TEXT NOT NULL REFERENCES workspaces(workspace_id),
  status TEXT NOT NULL CHECK (status IN ('active', 'deactivated')),
  revision INTEGER NOT NULL CHECK (revision >= 1),
  client_operation_id TEXT NOT NULL,
  activated_at INTEGER NOT NULL,
  deactivated_at INTEGER,
  updated_at INTEGER NOT NULL,
  UNIQUE (installation_id, workspace_id),
  UNIQUE (workspace_id, client_operation_id)
) WITHOUT ROWID;

CREATE TABLE plugin_oauth_attempts (
  oauth_attempt_id TEXT PRIMARY KEY NOT NULL,
  user_id TEXT NOT NULL REFERENCES "user"("id"),
  workspace_id TEXT NOT NULL REFERENCES workspaces(workspace_id),
  activation_id TEXT NOT NULL REFERENCES workspace_plugin_activations(activation_id),
  client_operation_id TEXT NOT NULL,
  provider_registration_id TEXT NOT NULL REFERENCES provider_registrations(provider_registration_id),
  requested_scopes_json TEXT NOT NULL,
  state_hash TEXT NOT NULL UNIQUE CHECK (length(state_hash) = 64),
  pkce_verifier_credential_reference TEXT,
  github_installation_id INTEGER CHECK (github_installation_id >= 1),
  return_path_id TEXT NOT NULL CHECK (length(return_path_id) BETWEEN 1 AND 160),
  status TEXT NOT NULL CHECK (status IN ('pending', 'consumed', 'expired')),
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  consumed_at INTEGER,
  UNIQUE (user_id, client_operation_id)
) WITHOUT ROWID;

CREATE TABLE plugin_connections (
  connection_id TEXT PRIMARY KEY NOT NULL,
  activation_id TEXT NOT NULL REFERENCES workspace_plugin_activations(activation_id),
  provider_registration_id TEXT NOT NULL REFERENCES provider_registrations(provider_registration_id),
  display_label TEXT NOT NULL CHECK (length(display_label) BETWEEN 1 AND 160),
  provider_account_subject TEXT NOT NULL CHECK (length(provider_account_subject) BETWEEN 1 AND 300),
  credential_reference TEXT NOT NULL,
  granted_scopes_json TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN (
    'pending',
    'authorizing',
    'validating',
    'ready',
    'failed',
    'reauthorization-required',
    'disconnected'
  )),
  revision INTEGER NOT NULL CHECK (revision >= 1),
  client_operation_id TEXT NOT NULL,
  last_validated_at INTEGER,
  created_at INTEGER NOT NULL,
  disconnected_at INTEGER,
  updated_at INTEGER NOT NULL,
  UNIQUE (activation_id, client_operation_id)
) WITHOUT ROWID;

CREATE INDEX plugin_connections_activation_status
  ON plugin_connections (activation_id, status, created_at);

CREATE TABLE agent_plugin_grants (
  grant_id TEXT PRIMARY KEY NOT NULL,
  workspace_id TEXT NOT NULL REFERENCES workspaces(workspace_id),
  agent_id TEXT NOT NULL REFERENCES agent_profiles(agent_id),
  connection_id TEXT NOT NULL REFERENCES plugin_connections(connection_id),
  catalog_snapshot_id TEXT NOT NULL REFERENCES plugin_catalog_snapshots(catalog_snapshot_id),
  status TEXT NOT NULL CHECK (status IN ('active', 'revoked')),
  revision INTEGER NOT NULL CHECK (revision >= 1),
  client_operation_id TEXT NOT NULL,
  granted_at INTEGER NOT NULL,
  revoked_at INTEGER,
  updated_at INTEGER NOT NULL,
  UNIQUE (agent_id, connection_id),
  UNIQUE (workspace_id, client_operation_id)
) WITHOUT ROWID;

CREATE TABLE plugin_tool_policies (
  grant_id TEXT NOT NULL REFERENCES agent_plugin_grants(grant_id),
  tool_id TEXT NOT NULL,
  policy TEXT NOT NULL CHECK (policy IN ('allow', 'require-approval', 'block')),
  policy_revision INTEGER NOT NULL CHECK (policy_revision >= 1),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (grant_id, tool_id)
) WITHOUT ROWID;

CREATE TABLE plugin_grant_revision_history (
  grant_id TEXT NOT NULL REFERENCES agent_plugin_grants(grant_id),
  revision INTEGER NOT NULL CHECK (revision >= 1),
  status TEXT NOT NULL CHECK (status IN ('active', 'revoked')),
  tools_json TEXT NOT NULL,
  recorded_at INTEGER NOT NULL,
  PRIMARY KEY (grant_id, revision)
) WITHOUT ROWID;

CREATE TABLE plugin_invocations (
  invocation_id TEXT PRIMARY KEY NOT NULL,
  workspace_id TEXT NOT NULL REFERENCES workspaces(workspace_id),
  agent_id TEXT NOT NULL REFERENCES agent_profiles(agent_id),
  conversation_id TEXT NOT NULL REFERENCES conversation_projections(conversation_id),
  turn_id TEXT NOT NULL,
  native_tool_call_id TEXT NOT NULL,
  admitted_revisions_json TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN (
    'admitted', 'running', 'awaiting-approval', 'completed', 'failed', 'cancelled'
  )),
  result_json TEXT,
  failure_reason TEXT,
  admitted_at INTEGER NOT NULL,
  completed_at INTEGER,
  UNIQUE (agent_id, conversation_id, turn_id, native_tool_call_id)
) WITHOUT ROWID;

CREATE TABLE plugin_invocation_attempts (
  attempt_id TEXT PRIMARY KEY NOT NULL,
  invocation_id TEXT NOT NULL REFERENCES plugin_invocations(invocation_id),
  attempt_number INTEGER NOT NULL CHECK (attempt_number >= 1),
  code_sandbox_id TEXT NOT NULL UNIQUE,
  code_sandbox_generation INTEGER NOT NULL CHECK (code_sandbox_generation >= 1),
  status TEXT NOT NULL CHECK (status IN ('starting', 'running', 'completed', 'failed', 'cancelled', 'timed-out', 'orphaned')),
  started_at INTEGER,
  deadline_at INTEGER NOT NULL,
  finished_at INTEGER,
  UNIQUE (invocation_id, attempt_number)
) WITHOUT ROWID;

CREATE TABLE plugin_tool_calls (
  tool_call_id TEXT PRIMARY KEY NOT NULL,
  invocation_id TEXT NOT NULL REFERENCES plugin_invocations(invocation_id),
  ordinal INTEGER NOT NULL CHECK (ordinal >= 0),
  plugin_version_id TEXT NOT NULL REFERENCES plugin_versions(plugin_version_id),
  activation_id TEXT NOT NULL REFERENCES workspace_plugin_activations(activation_id),
  activation_revision INTEGER NOT NULL CHECK (activation_revision >= 1),
  installation_id TEXT NOT NULL REFERENCES plugin_installations(installation_id),
  installation_revision INTEGER NOT NULL CHECK (installation_revision >= 1),
  catalog_snapshot_id TEXT NOT NULL REFERENCES plugin_catalog_snapshots(catalog_snapshot_id),
  config_schema_id TEXT NOT NULL REFERENCES plugin_config_schemas(config_schema_id),
  config_schema_revision INTEGER NOT NULL CHECK (config_schema_revision >= 1),
  provider_registration_id TEXT REFERENCES provider_registrations(provider_registration_id),
  provider_registration_revision INTEGER CHECK (provider_registration_revision >= 1),
  endpoint_registration_id TEXT REFERENCES remote_mcp_endpoint_registrations(endpoint_registration_id),
  endpoint_registration_revision INTEGER CHECK (endpoint_registration_revision >= 1),
  connection_id TEXT NOT NULL REFERENCES plugin_connections(connection_id),
  connection_revision INTEGER NOT NULL CHECK (connection_revision >= 1),
  grant_id TEXT NOT NULL REFERENCES agent_plugin_grants(grant_id),
  grant_revision INTEGER NOT NULL CHECK (grant_revision >= 1),
  tool_id TEXT NOT NULL,
  policy TEXT NOT NULL CHECK (policy IN ('allow', 'require-approval', 'block')),
  policy_revision INTEGER NOT NULL CHECK (policy_revision >= 1),
  arguments_json TEXT NOT NULL,
  arguments_digest TEXT NOT NULL CHECK (length(arguments_digest) = 64),
  dispatch_status TEXT NOT NULL CHECK (dispatch_status IN (
    'reserved', 'approval-required', 'dispatching', 'completed', 'failed', 'cancelled', 'uncertain'
  )),
  outcome_json TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE (invocation_id, ordinal)
) WITHOUT ROWID;

CREATE TABLE plugin_approvals (
  approval_id TEXT PRIMARY KEY NOT NULL,
  invocation_id TEXT NOT NULL REFERENCES plugin_invocations(invocation_id),
  tool_call_id TEXT NOT NULL UNIQUE REFERENCES plugin_tool_calls(tool_call_id),
  workspace_id TEXT NOT NULL REFERENCES workspaces(workspace_id),
  agent_id TEXT NOT NULL REFERENCES agent_profiles(agent_id),
  conversation_id TEXT NOT NULL REFERENCES conversation_projections(conversation_id),
  plugin_version_id TEXT NOT NULL REFERENCES plugin_versions(plugin_version_id),
  runtime_descriptor_json TEXT NOT NULL,
  connection_id TEXT NOT NULL REFERENCES plugin_connections(connection_id),
  connection_revision INTEGER NOT NULL CHECK (connection_revision >= 1),
  grant_id TEXT NOT NULL REFERENCES agent_plugin_grants(grant_id),
  grant_revision INTEGER NOT NULL CHECK (grant_revision >= 1),
  policy_revision INTEGER NOT NULL CHECK (policy_revision >= 1),
  tool_id TEXT NOT NULL,
  arguments_json TEXT NOT NULL,
  arguments_digest TEXT NOT NULL CHECK (length(arguments_digest) = 64),
  summary TEXT NOT NULL CHECK (length(summary) BETWEEN 1 AND 1000),
  status TEXT NOT NULL CHECK (status IN ('pending', 'approved', 'rejected', 'expired', 'cancelled', 'settled')),
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  decided_at INTEGER,
  deciding_owner_id TEXT REFERENCES "user"("id"),
  decision_client_operation_id TEXT,
  resumed_at INTEGER
) WITHOUT ROWID;

CREATE TABLE plugin_invocation_audit (
  audit_id TEXT PRIMARY KEY NOT NULL,
  invocation_id TEXT NOT NULL REFERENCES plugin_invocations(invocation_id),
  tool_call_id TEXT REFERENCES plugin_tool_calls(tool_call_id),
  event_kind TEXT NOT NULL,
  safe_details_json TEXT NOT NULL,
  recorded_at INTEGER NOT NULL
) WITHOUT ROWID;

CREATE TABLE plugin_usage_events (
  usage_event_id TEXT PRIMARY KEY NOT NULL,
  event_kind TEXT NOT NULL CHECK (event_kind IN ('started', 'stopped', 'destroyed', 'start-failed', 'reconciled')),
  sandbox_kind TEXT NOT NULL CHECK (sandbox_kind IN ('executor', 'plugin-host')),
  purpose TEXT NOT NULL CHECK (purpose IN ('invocation', 'approved-write', 'connection-validation', 'catalog-validation')),
  workspace_id TEXT NOT NULL REFERENCES workspaces(workspace_id),
  agent_id TEXT REFERENCES agent_profiles(agent_id),
  invocation_id TEXT REFERENCES plugin_invocations(invocation_id),
  attempt_id TEXT NOT NULL,
  plugin_version_id TEXT REFERENCES plugin_versions(plugin_version_id),
  connection_id TEXT REFERENCES plugin_connections(connection_id),
  sandbox_generation INTEGER NOT NULL CHECK (sandbox_generation >= 1),
  observed_at INTEGER NOT NULL,
  termination_reason TEXT,
  measurement_quality TEXT NOT NULL CHECK (measurement_quality IN ('confirmed', 'reconciled', 'upper-bound', 'uncertain'))
) WITHOUT ROWID;

CREATE TABLE plugin_remote_invocation_facts (
  tool_call_id TEXT PRIMARY KEY NOT NULL REFERENCES plugin_tool_calls(tool_call_id),
  invocation_id TEXT NOT NULL REFERENCES plugin_invocations(invocation_id),
  plugin_version_id TEXT NOT NULL REFERENCES plugin_versions(plugin_version_id),
  connection_id TEXT NOT NULL REFERENCES plugin_connections(connection_id),
  latency_millis INTEGER NOT NULL CHECK (latency_millis >= 0),
  outcome TEXT NOT NULL CHECK (outcome IN ('completed', 'failed', 'cancelled', 'uncertain')),
  observed_at INTEGER NOT NULL
) WITHOUT ROWID;

CREATE TRIGGER plugin_user_event_installation_after_insert
AFTER INSERT ON plugin_installations
BEGIN
  INSERT INTO plugin_user_event_outbox (workspace_id, user_id)
  SELECT workspace_id, user_id FROM workspace_memberships
  WHERE user_id = new.user_id AND role = 'owner' AND status = 'active';
END;

CREATE TRIGGER plugin_user_event_installation_after_update
AFTER UPDATE ON plugin_installations
WHEN new.revision <> old.revision OR new.status <> old.status
BEGIN
  INSERT INTO plugin_user_event_outbox (workspace_id, user_id)
  SELECT workspace_id, user_id FROM workspace_memberships
  WHERE user_id = new.user_id AND role = 'owner' AND status = 'active';
END;

CREATE TRIGGER plugin_user_event_activation_after_change
AFTER UPDATE ON workspace_plugin_activations
BEGIN
  INSERT INTO plugin_user_event_outbox (workspace_id, user_id)
  SELECT new.workspace_id, i.user_id FROM plugin_installations i
  WHERE i.installation_id = new.installation_id;
END;

CREATE TRIGGER plugin_user_event_activation_after_insert
AFTER INSERT ON workspace_plugin_activations
BEGIN
  INSERT INTO plugin_user_event_outbox (workspace_id, user_id)
  SELECT new.workspace_id, i.user_id FROM plugin_installations i
  WHERE i.installation_id = new.installation_id;
END;

CREATE TRIGGER plugin_user_event_connection_after_insert
AFTER INSERT ON plugin_connections
BEGIN
  INSERT INTO plugin_user_event_outbox (workspace_id, user_id)
  SELECT a.workspace_id, i.user_id
  FROM workspace_plugin_activations a
  JOIN plugin_installations i ON i.installation_id = a.installation_id
  WHERE a.activation_id = new.activation_id;
END;

CREATE TRIGGER plugin_user_event_connection_after_update
AFTER UPDATE ON plugin_connections
WHEN new.revision <> old.revision OR new.status <> old.status
BEGIN
  INSERT INTO plugin_user_event_outbox (workspace_id, user_id)
  SELECT a.workspace_id, i.user_id
  FROM workspace_plugin_activations a
  JOIN plugin_installations i ON i.installation_id = a.installation_id
  WHERE a.activation_id = new.activation_id;
END;

CREATE TRIGGER plugin_user_event_grant_after_insert
AFTER INSERT ON agent_plugin_grants
BEGIN
  INSERT INTO plugin_user_event_outbox (workspace_id, user_id)
  SELECT new.workspace_id, user_id FROM workspace_memberships
  WHERE workspace_id = new.workspace_id AND role = 'owner' AND status = 'active';
END;

CREATE TRIGGER plugin_user_event_grant_after_update
AFTER UPDATE ON agent_plugin_grants
WHEN new.revision <> old.revision OR new.status <> old.status
BEGIN
  INSERT INTO plugin_user_event_outbox (workspace_id, user_id)
  SELECT new.workspace_id, user_id FROM workspace_memberships
  WHERE workspace_id = new.workspace_id AND role = 'owner' AND status = 'active';
END;

CREATE TRIGGER plugin_user_event_approval_after_insert
AFTER INSERT ON plugin_approvals
BEGIN
  INSERT INTO plugin_user_event_outbox (workspace_id, user_id)
  SELECT new.workspace_id, user_id FROM workspace_memberships
  WHERE workspace_id = new.workspace_id AND role = 'owner' AND status = 'active';
END;

CREATE TRIGGER plugin_user_event_approval_after_update
AFTER UPDATE ON plugin_approvals
WHEN new.status <> old.status OR new.resumed_at IS NOT old.resumed_at
BEGIN
  INSERT INTO plugin_user_event_outbox (workspace_id, user_id)
  SELECT new.workspace_id, user_id FROM workspace_memberships
  WHERE workspace_id = new.workspace_id AND role = 'owner' AND status = 'active';
END;

CREATE TRIGGER plugin_user_event_usage_after_insert
AFTER INSERT ON plugin_usage_events
BEGIN
  INSERT INTO plugin_user_event_outbox (workspace_id, user_id)
  SELECT new.workspace_id, user_id FROM workspace_memberships
  WHERE workspace_id = new.workspace_id AND role = 'owner' AND status = 'active';
END;

CREATE TABLE plugin_usage_intervals (
  attempt_id TEXT NOT NULL,
  sandbox_kind TEXT NOT NULL CHECK (sandbox_kind IN ('executor', 'plugin-host')),
  sandbox_generation INTEGER NOT NULL CHECK (sandbox_generation >= 1),
  workspace_id TEXT NOT NULL REFERENCES workspaces(workspace_id),
  agent_id TEXT REFERENCES agent_profiles(agent_id),
  plugin_version_id TEXT REFERENCES plugin_versions(plugin_version_id),
  purpose TEXT NOT NULL,
  started_at INTEGER NOT NULL,
  ended_at INTEGER,
  sandbox_duration_millis INTEGER CHECK (sandbox_duration_millis >= 0),
  measurement_quality TEXT NOT NULL CHECK (measurement_quality IN ('confirmed', 'reconciled', 'upper-bound', 'uncertain')),
  outcome TEXT NOT NULL CHECK (outcome IN ('active', 'completed', 'failed', 'cancelled', 'uncertain')),
  PRIMARY KEY (attempt_id, sandbox_kind, sandbox_generation)
) WITHOUT ROWID;

CREATE TABLE plugin_usage_daily (
  usage_date TEXT NOT NULL,
  workspace_id TEXT NOT NULL REFERENCES workspaces(workspace_id),
  agent_id TEXT NOT NULL DEFAULT '',
  plugin_version_id TEXT NOT NULL DEFAULT '',
  sandbox_kind TEXT NOT NULL CHECK (sandbox_kind IN ('executor', 'plugin-host')),
  purpose TEXT NOT NULL,
  outcome TEXT NOT NULL,
  measurement_quality TEXT NOT NULL,
  sandbox_duration_millis INTEGER NOT NULL CHECK (sandbox_duration_millis >= 0),
  attempt_count INTEGER NOT NULL CHECK (attempt_count >= 0),
  PRIMARY KEY (
    usage_date,
    workspace_id,
    agent_id,
    plugin_version_id,
    sandbox_kind,
    purpose,
    outcome,
    measurement_quality
  )
) WITHOUT ROWID;

CREATE TABLE plugin_event_outbox (
  sequence INTEGER PRIMARY KEY AUTOINCREMENT,
  event_id TEXT NOT NULL UNIQUE,
  workspace_id TEXT NOT NULL REFERENCES workspaces(workspace_id),
  user_id TEXT REFERENCES "user"("id"),
  event_kind TEXT NOT NULL CHECK (event_kind IN ('library', 'activation', 'connection', 'grant', 'approval', 'usage')),
  resource_id TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  delivered_at INTEGER
);

CREATE INDEX plugin_event_outbox_pending
  ON plugin_event_outbox (delivered_at, sequence);

CREATE TRIGGER plugin_version_immutable_after_publication
BEFORE UPDATE ON plugin_versions
WHEN old.status IN ('published', 'revoked') AND (
  old.plugin_definition_id <> new.plugin_definition_id
  OR old.semantic_version <> new.semantic_version
  OR old.manifest_digest <> new.manifest_digest
  OR old.catalog_snapshot_id <> new.catalog_snapshot_id
  OR old.config_schema_id <> new.config_schema_id
  OR old.runtime_kind <> new.runtime_kind
  OR COALESCE(old.artifact_digest, '') <> COALESCE(new.artifact_digest, '')
  OR COALESCE(old.endpoint_registration_id, '') <> COALESCE(new.endpoint_registration_id, '')
)
BEGIN
  SELECT RAISE(ABORT, 'published Plugin version authority is immutable');
END;

CREATE TRIGGER plugin_installation_requires_published_version
BEFORE INSERT ON plugin_installations
BEGIN
  SELECT RAISE(ABORT, 'Plugin version is not installable')
  WHERE NOT EXISTS (
    SELECT 1
    FROM plugin_versions
    WHERE plugin_version_id = new.plugin_version_id
      AND status = 'published'
      AND review_status = 'approved'
  );
END;

CREATE TRIGGER plugin_records_retained_no_delete_installation
BEFORE DELETE ON plugin_installations
BEGIN
  SELECT RAISE(ABORT, 'Plugin installations are retained in v0');
END;

CREATE TRIGGER plugin_records_retained_no_delete_connection
BEFORE DELETE ON plugin_connections
BEGIN
  SELECT RAISE(ABORT, 'Plugin Connections are retained in v0');
END;

CREATE TRIGGER plugin_records_retained_no_delete_invocation
BEFORE DELETE ON plugin_invocations
BEGIN
  SELECT RAISE(ABORT, 'Plugin invocations are retained in v0');
END;
