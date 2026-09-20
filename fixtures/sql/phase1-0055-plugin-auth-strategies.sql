-- One versioned provider-independent authentication contract drives setup, identity,
-- resource binding, credential custody, invocation, and durable device polling.

CREATE TABLE plugin_auth_strategy_definitions (
  auth_definition_digest TEXT PRIMARY KEY NOT NULL CHECK (length(auth_definition_digest) = 64),
  schema_version INTEGER NOT NULL CHECK (schema_version = 1),
  canonical_definition_json TEXT NOT NULL,
  profile TEXT NOT NULL CHECK (
    profile IN ('workspace-oauth', 'mcp-oauth', 'api-key', 'device-oauth')
  ),
  status TEXT NOT NULL CHECK (status IN ('active', 'retired')),
  revision INTEGER NOT NULL CHECK (revision >= 1),
  source_kind TEXT NOT NULL CHECK (source_kind IN ('marketplace-release', 'legacy-derived')),
  source_digest TEXT NOT NULL CHECK (length(source_digest) = 64),
  reviewed_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
) WITHOUT ROWID;

ALTER TABLE plugin_versions
  ADD COLUMN auth_profile TEXT CHECK (
    auth_profile IS NULL
    OR auth_profile IN ('workspace-oauth', 'mcp-oauth', 'api-key', 'device-oauth')
  );

ALTER TABLE plugin_versions
  ADD COLUMN auth_definition_digest TEXT
    REFERENCES plugin_auth_strategy_definitions(auth_definition_digest);

ALTER TABLE plugin_versions
  ADD COLUMN auth_definition_revision INTEGER CHECK (
    auth_definition_revision IS NULL OR auth_definition_revision >= 1
  );

DROP TRIGGER plugin_version_oauth_shape_insert;

CREATE TRIGGER plugin_version_oauth_shape_insert
BEFORE INSERT ON plugin_versions
BEGIN
  SELECT RAISE(ABORT, 'Plugin version OAuth authority shape is invalid') WHERE NOT (
    (new.auth_profile = 'device-oauth' AND new.authentication_kind = 'oauth'
      AND new.provider_registration_id IS NOT NULL
      AND new.provider_registration_authority_revision IS NOT NULL
      AND new.provider_definition_digest IS NOT NULL
      AND new.provider_definition_revision IS NOT NULL)
    OR (new.authentication_kind = 'oauth' AND new.provider_registration_id IS NOT NULL
      AND new.provider_definition_digest IS NOT NULL AND new.provider_definition_revision IS NOT NULL
      AND new.requested_scopes_json <> '[]'
      AND ((new.runtime_kind = 'managed-package' AND new.provider_registration_authority_revision IS NOT NULL)
        OR (new.runtime_kind = 'managed-remote-mcp' AND new.provider_registration_authority_revision IS NULL)))
    OR (new.runtime_kind = 'managed-remote-mcp' AND new.authentication_kind = 'oauth'
      AND new.provider_registration_id IS NOT NULL
      AND new.provider_registration_authority_revision IS NULL
      AND new.provider_definition_digest IS NULL AND new.provider_definition_revision IS NULL)
    OR (NOT (new.runtime_kind IN ('managed-package', 'managed-remote-mcp')
      AND new.authentication_kind = 'oauth')
      AND new.provider_registration_authority_revision IS NULL
      AND new.provider_definition_digest IS NULL AND new.provider_definition_revision IS NULL)
  );
  SELECT RAISE(ABORT, 'Plugin version OAuth publication authority is invalid')
  WHERE new.provider_definition_digest IS NOT NULL AND new.auth_profile <> 'device-oauth'
    AND NOT EXISTS (
    SELECT 1 FROM provider_registrations r
    JOIN plugin_oauth_provider_definitions d
      ON d.provider_definition_digest = new.provider_definition_digest
     AND d.revision = new.provider_definition_revision
    WHERE r.provider_registration_id = new.provider_registration_id AND r.status = 'active'
      AND r.source = 'platform' AND r.provider = d.provider AND r.resource_identity = d.resource_identity
      AND r.approved_scopes_json = new.requested_scopes_json AND d.scopes_json = new.requested_scopes_json
      AND d.status = 'active' AND d.display_label_path_present = 1
      AND ((new.runtime_kind = 'managed-package'
          AND r.registration_mode IN ('workspace-oauth-app', 'platform-pre-registered')
          AND r.oauth_authority_revision = new.provider_registration_authority_revision)
        OR (new.runtime_kind = 'managed-remote-mcp' AND r.registration_mode = 'dynamic'
          AND new.provider_registration_authority_revision IS NULL))
  );
END;

ALTER TABLE plugin_connections ADD COLUMN selected_resource_id TEXT CHECK (
  selected_resource_id IS NULL OR length(selected_resource_id) BETWEEN 1 AND 300
);

ALTER TABLE plugin_connections ADD COLUMN selected_resource_label TEXT CHECK (
  selected_resource_label IS NULL OR length(selected_resource_label) BETWEEN 1 AND 160
);

CREATE TABLE plugin_auth_setup_attempts (
  setup_attempt_id TEXT PRIMARY KEY NOT NULL,
  user_id TEXT NOT NULL REFERENCES user(id),
  workspace_id TEXT NOT NULL REFERENCES workspaces(workspace_id),
  activation_id TEXT NOT NULL REFERENCES workspace_plugin_activations(activation_id),
  connection_id TEXT REFERENCES plugin_connections(connection_id),
  client_operation_id TEXT NOT NULL,
  auth_definition_digest TEXT NOT NULL
    REFERENCES plugin_auth_strategy_definitions(auth_definition_digest),
  auth_definition_revision INTEGER NOT NULL CHECK (auth_definition_revision >= 1),
  profile TEXT NOT NULL CHECK (
    profile IN ('workspace-oauth', 'mcp-oauth', 'api-key', 'device-oauth')
  ),
  state TEXT NOT NULL CHECK (state IN (
    'needs-credentials', 'needs-oauth-app', 'redirecting', 'device-pending',
    'resolving-identity', 'needs-resource-selection', 'connected', 'denied',
    'expired', 'cancelled', 'failed'
  )),
  public_action_json TEXT NOT NULL,
  credential_reference TEXT,
  selected_resource_id TEXT,
  discovered_resources_json TEXT,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  completed_at INTEGER,
  UNIQUE (user_id, client_operation_id),
  CHECK (
    (state IN ('connected', 'denied', 'expired', 'cancelled', 'failed')
      AND completed_at IS NOT NULL)
    OR
    (state NOT IN ('connected', 'denied', 'expired', 'cancelled', 'failed')
      AND completed_at IS NULL)
  )
) WITHOUT ROWID;

CREATE INDEX plugin_auth_setup_attempts_activation
  ON plugin_auth_setup_attempts (activation_id, state, created_at);

CREATE TABLE plugin_connection_auth_credentials (
  connection_id TEXT PRIMARY KEY NOT NULL REFERENCES plugin_connections(connection_id),
  auth_definition_digest TEXT NOT NULL
    REFERENCES plugin_auth_strategy_definitions(auth_definition_digest),
  profile TEXT NOT NULL CHECK (
    profile IN ('workspace-oauth', 'mcp-oauth', 'api-key', 'device-oauth')
  ),
  credential_reference TEXT NOT NULL,
  lineage INTEGER NOT NULL CHECK (lineage >= 1),
  status TEXT NOT NULL CHECK (status IN ('active', 'replaced', 'revoked')),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  revoked_at INTEGER,
  CHECK (
    (status = 'active' AND revoked_at IS NULL)
    OR (status IN ('replaced', 'revoked') AND revoked_at IS NOT NULL)
  )
) WITHOUT ROWID;

CREATE TABLE plugin_device_oauth_attempts (
  setup_attempt_id TEXT PRIMARY KEY NOT NULL
    REFERENCES plugin_auth_setup_attempts(setup_attempt_id),
  connection_id TEXT NOT NULL UNIQUE REFERENCES plugin_connections(connection_id),
  device_code_credential_reference TEXT NOT NULL,
  oauth_app_id TEXT REFERENCES plugin_oauth_apps(oauth_app_id),
  client_credential_reference TEXT,
  client_material_version TEXT NOT NULL CHECK (length(client_material_version) BETWEEN 1 AND 128),
  poll_interval_seconds INTEGER NOT NULL CHECK (poll_interval_seconds BETWEEN 1 AND 120),
  next_poll_at INTEGER NOT NULL,
  poll_claim TEXT,
  poll_claimed_at INTEGER,
  dispatch_count INTEGER NOT NULL DEFAULT 0 CHECK (dispatch_count >= 0),
  last_outcome TEXT CHECK (
    last_outcome IS NULL
    OR last_outcome IN (
      'authorization-pending', 'slow-down', 'denied', 'expired', 'succeeded', 'failed', 'cancelled'
    )
  ),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  CHECK (
    (poll_claim IS NULL AND poll_claimed_at IS NULL)
    OR (poll_claim IS NOT NULL AND poll_claimed_at IS NOT NULL)
  )
) WITHOUT ROWID;

CREATE INDEX plugin_device_oauth_attempts_due
  ON plugin_device_oauth_attempts (next_poll_at, last_outcome);

-- Device OAuth retains credentials through the generic strategy tables. Preserve the exact
-- adopted-credential invariant for legacy/code-flow OAuth while excluding device profiles.
DROP TRIGGER IF EXISTS plugin_oauth_connection_ready_insert;
DROP TRIGGER IF EXISTS plugin_oauth_connection_ready_update;

CREATE TRIGGER plugin_oauth_connection_ready_insert
BEFORE INSERT ON plugin_connections
WHEN new.status = 'ready'
  AND EXISTS (
    SELECT 1
    FROM provider_registrations registration
    JOIN workspace_plugin_activations activation ON activation.activation_id = new.activation_id
    JOIN plugin_installations installation
      ON installation.installation_id = activation.installation_id
    JOIN plugin_versions version ON version.plugin_version_id = installation.plugin_version_id
    WHERE registration.provider_registration_id = new.provider_registration_id
      AND registration.oauth_provider_definition_digest IS NOT NULL
      AND (version.auth_profile IS NULL OR version.auth_profile IN ('workspace-oauth', 'mcp-oauth'))
  )
BEGIN
  SELECT RAISE(ABORT, 'OAuth Connection requires an exact adopted credential')
  WHERE NOT EXISTS (
    SELECT 1
    FROM plugin_oauth_connection_credentials credential
    JOIN plugin_oauth_runtime_attempts attempt
      ON attempt.oauth_attempt_id = credential.oauth_attempt_id
    WHERE credential.connection_id = new.connection_id
      AND credential.credential_reference = new.credential_reference
      AND credential.status = 'active' AND credential.lineage >= 1
      AND attempt.connection_id = new.connection_id
      AND attempt.phase IN ('credential-adopted', 'ready')
      AND attempt.adoption_operation_id = credential.adoption_operation_id
      AND attempt.adoption_receipt = credential.adoption_receipt
      AND attempt.credential_lineage = credential.lineage
  );
END;

CREATE TRIGGER plugin_oauth_connection_ready_update
BEFORE UPDATE OF status ON plugin_connections
WHEN new.status = 'ready' AND old.status <> 'ready'
  AND EXISTS (
    SELECT 1
    FROM provider_registrations registration
    JOIN workspace_plugin_activations activation ON activation.activation_id = new.activation_id
    JOIN plugin_installations installation
      ON installation.installation_id = activation.installation_id
    JOIN plugin_versions version ON version.plugin_version_id = installation.plugin_version_id
    WHERE registration.provider_registration_id = new.provider_registration_id
      AND registration.oauth_provider_definition_digest IS NOT NULL
      AND (version.auth_profile IS NULL OR version.auth_profile IN ('workspace-oauth', 'mcp-oauth'))
  )
BEGIN
  SELECT RAISE(ABORT, 'OAuth Connection requires an exact adopted credential')
  WHERE NOT EXISTS (
    SELECT 1
    FROM plugin_oauth_connection_credentials credential
    JOIN plugin_oauth_runtime_attempts attempt
      ON attempt.oauth_attempt_id = credential.oauth_attempt_id
    WHERE credential.connection_id = new.connection_id
      AND credential.credential_reference = new.credential_reference
      AND credential.status = 'active' AND credential.lineage >= 1
      AND attempt.connection_id = new.connection_id
      AND attempt.phase IN ('credential-adopted', 'ready')
      AND attempt.adoption_operation_id = credential.adoption_operation_id
      AND attempt.adoption_receipt = credential.adoption_receipt
      AND attempt.credential_lineage = credential.lineage
  );
END;

CREATE TRIGGER plugin_auth_strategy_definition_immutable
BEFORE UPDATE ON plugin_auth_strategy_definitions
WHEN NOT (
  old.auth_definition_digest IS new.auth_definition_digest
  AND old.schema_version IS new.schema_version
  AND old.canonical_definition_json IS new.canonical_definition_json
  AND old.profile IS new.profile
  AND old.revision IS new.revision
  AND old.source_kind IS new.source_kind
  AND old.source_digest IS new.source_digest
  AND old.reviewed_at IS new.reviewed_at
  AND old.created_at IS new.created_at
  AND old.status = 'active'
  AND new.status = 'retired'
  AND new.updated_at >= old.updated_at
)
BEGIN
  SELECT RAISE(ABORT, 'Plugin authentication strategy definition is immutable');
END;

CREATE TRIGGER plugin_version_auth_strategy_shape_insert
BEFORE INSERT ON plugin_versions
WHEN new.auth_profile IS NOT NULL
BEGIN
  SELECT RAISE(ABORT, 'Plugin version authentication strategy authority is invalid')
  WHERE new.auth_definition_digest IS NULL
    OR new.auth_definition_revision IS NULL
    OR NOT EXISTS (
      SELECT 1
      FROM plugin_auth_strategy_definitions definition
      WHERE definition.auth_definition_digest = new.auth_definition_digest
        AND definition.revision = new.auth_definition_revision
        AND definition.profile = new.auth_profile
        AND definition.status = 'active'
    );

  SELECT RAISE(ABORT, 'Plugin version authentication profile is incompatible')
  WHERE NOT (
    (new.auth_profile IN ('workspace-oauth', 'mcp-oauth', 'device-oauth')
      AND new.authentication_kind = 'oauth')
    OR (new.auth_profile = 'api-key' AND new.authentication_kind = 'none')
  );
END;

CREATE TRIGGER plugin_version_auth_strategy_immutable
BEFORE UPDATE ON plugin_versions
WHEN old.status IN ('published', 'revoked') AND (
  old.auth_profile IS NOT new.auth_profile
  OR old.auth_definition_digest IS NOT new.auth_definition_digest
  OR old.auth_definition_revision IS NOT new.auth_definition_revision
)
BEGIN
  SELECT RAISE(ABORT, 'Published Plugin authentication strategy is immutable');
END;

CREATE TRIGGER plugin_auth_setup_attempt_retained
BEFORE DELETE ON plugin_auth_setup_attempts
BEGIN
  SELECT RAISE(ABORT, 'Plugin authentication setup attempts are retained');
END;

CREATE TRIGGER plugin_connection_auth_credential_retained
BEFORE DELETE ON plugin_connection_auth_credentials
BEGIN
  SELECT RAISE(ABORT, 'Plugin Connection authentication credentials are retained');
END;
