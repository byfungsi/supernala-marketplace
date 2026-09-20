PRAGMA defer_foreign_keys = ON;

-- Deployment-owned OAuth authority cannot be assigned to a Workspace Owner.
-- Stop rather than fabricate ownership or erase retained runtime evidence.
CREATE TABLE workspace_oauth_authority_migration_guard (
  valid INTEGER NOT NULL CHECK (valid = 1)
);

INSERT INTO workspace_oauth_authority_migration_guard (valid)
SELECT 0
WHERE EXISTS (SELECT 1 FROM plugin_oauth_registration_material_sources)
   OR EXISTS (SELECT 1 FROM plugin_oauth_apps)
   OR EXISTS (SELECT 1 FROM plugin_oauth_runtime_attempts)
   OR EXISTS (
     SELECT 1
     FROM plugin_publication_intents
     WHERE provider_registration_material_source_revision IS NOT NULL
   );

DROP TABLE workspace_oauth_authority_migration_guard;

DROP TRIGGER provider_registration_oauth_shape_insert;
DROP TRIGGER provider_registration_oauth_admission_insert;
DROP TRIGGER provider_registration_oauth_shape_update;
DROP TRIGGER provider_registration_oauth_no_upgrade;
DROP TRIGGER provider_registration_oauth_semantic_lifecycle;
DROP TRIGGER provider_registration_oauth_retained;
DROP TRIGGER provider_registration_oauth_terminalizes_material_sources;
DROP TRIGGER plugin_oauth_definition_terminalizes_material_sources;
DROP TRIGGER plugin_version_oauth_shape_insert;
DROP TRIGGER plugin_version_auth_authority_immutable;
DROP TRIGGER plugin_version_oauth_publish_guard;
DROP TRIGGER plugin_publication_intent_oauth_source_insert;
DROP TRIGGER plugin_publication_intent_oauth_source_immutable;
DROP TRIGGER plugin_oauth_connection_credential_transition;
DROP TRIGGER plugin_oauth_connection_ready_insert;
DROP TRIGGER plugin_oauth_connection_ready_update;

DROP TABLE plugin_oauth_runtime_attempts;
DROP TABLE plugin_oauth_apps;
DROP TABLE plugin_oauth_registration_material_sources;

CREATE TABLE provider_registrations_next (
  provider_registration_id TEXT PRIMARY KEY NOT NULL,
  provider TEXT NOT NULL CHECK (length(provider) BETWEEN 1 AND 100),
  resource_identity TEXT NOT NULL CHECK (length(resource_identity) BETWEEN 1 AND 2048),
  registration_mode TEXT NOT NULL CHECK (
    registration_mode IN ('dynamic', 'platform-pre-registered', 'workspace-oauth-app')
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
  oauth_provider_definition_digest TEXT
    REFERENCES plugin_oauth_provider_definitions(provider_definition_digest),
  oauth_provider_definition_revision INTEGER
    CHECK (oauth_provider_definition_revision IS NULL OR oauth_provider_definition_revision >= 1),
  oauth_authority_revision INTEGER
    CHECK (oauth_authority_revision IS NULL OR oauth_authority_revision >= 1),
  CHECK (
    (registration_mode = 'dynamic' AND authorization_metadata_url IS NOT NULL)
    OR (registration_mode = 'platform-pre-registered' AND client_credential_reference IS NOT NULL)
    OR (registration_mode = 'workspace-oauth-app'
      AND client_credential_reference IS NULL
      AND oauth_provider_definition_digest IS NOT NULL)
  ),
  CHECK (
    (dynamic_registration_claim IS NULL AND dynamic_registration_claimed_at IS NULL)
    OR (dynamic_registration_claim IS NOT NULL AND dynamic_registration_claimed_at IS NOT NULL)
  )
) WITHOUT ROWID;

INSERT INTO provider_registrations_next
  (provider_registration_id, provider, resource_identity, registration_mode,
   authorization_metadata_url, authorization_endpoint, token_endpoint, registration_endpoint,
   userinfo_endpoint, revocation_endpoint, metadata_digest, callback_url, approved_scopes_json,
   client_credential_reference, dynamic_registration_claim, dynamic_registration_claimed_at,
   source, status, revision, created_at, updated_at, oauth_provider_definition_digest,
   oauth_provider_definition_revision, oauth_authority_revision)
SELECT provider_registration_id, provider, resource_identity,
       CASE WHEN oauth_provider_definition_digest IS NOT NULL
         THEN 'workspace-oauth-app' ELSE registration_mode END,
       authorization_metadata_url, authorization_endpoint, token_endpoint, registration_endpoint,
       userinfo_endpoint, revocation_endpoint, metadata_digest, callback_url, approved_scopes_json,
       client_credential_reference, dynamic_registration_claim, dynamic_registration_claimed_at,
       source, status, revision, created_at, updated_at, oauth_provider_definition_digest,
       oauth_provider_definition_revision, oauth_authority_revision
FROM provider_registrations;

DROP TABLE provider_registrations;
ALTER TABLE provider_registrations_next RENAME TO provider_registrations;

CREATE INDEX provider_registrations_oauth_authority
  ON provider_registrations
    (oauth_provider_definition_digest, oauth_provider_definition_revision,
     oauth_authority_revision, status);

CREATE TABLE plugin_publication_intents_next (
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

INSERT INTO plugin_publication_intents_next
  (publication_intent_id, plugin_version_id, artifact_digest, status, attempts,
   available_at, last_failure_reason, created_at, updated_at)
SELECT publication_intent_id, plugin_version_id, artifact_digest, status, attempts,
       available_at, last_failure_reason, created_at, updated_at
FROM plugin_publication_intents;

DROP TABLE plugin_publication_intents;
ALTER TABLE plugin_publication_intents_next RENAME TO plugin_publication_intents;

CREATE TABLE plugin_oauth_apps (
  oauth_app_id TEXT PRIMARY KEY NOT NULL,
  user_id TEXT NOT NULL REFERENCES user(id),
  workspace_id TEXT NOT NULL REFERENCES workspaces(workspace_id),
  provider_registration_id TEXT NOT NULL REFERENCES provider_registrations(provider_registration_id),
  provider_definition_digest TEXT NOT NULL
    REFERENCES plugin_oauth_provider_definitions(provider_definition_digest),
  provider_definition_revision INTEGER NOT NULL CHECK (provider_definition_revision >= 1),
  credential_reference TEXT NOT NULL CHECK (
    length(credential_reference) = 49
    AND substr(credential_reference, 1, 13) = 'plugin-vault:'
    AND substr(credential_reference, 14) NOT GLOB '*[^0-9a-f-]*'
  ),
  name TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 80),
  token_endpoint_auth_method TEXT NOT NULL CHECK (
    token_endpoint_auth_method IN ('client_secret_post', 'client_secret_basic')
  ),
  status TEXT NOT NULL CHECK (status IN ('active', 'deactivated')),
  revision INTEGER NOT NULL CHECK (revision >= 1),
  client_operation_id TEXT NOT NULL CHECK (length(client_operation_id) BETWEEN 1 AND 160),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  deactivated_at INTEGER,
  UNIQUE (user_id, client_operation_id),
  UNIQUE (workspace_id, provider_registration_id, name),
  CHECK (
    (status = 'active' AND deactivated_at IS NULL)
    OR (status = 'deactivated' AND deactivated_at IS NOT NULL)
  )
) WITHOUT ROWID;

CREATE INDEX plugin_oauth_apps_workspace_provider
  ON plugin_oauth_apps (workspace_id, provider_registration_id, status, created_at);

CREATE TABLE plugin_oauth_runtime_attempts (
  oauth_attempt_id TEXT PRIMARY KEY NOT NULL REFERENCES plugin_oauth_attempts(oauth_attempt_id),
  session_binding_digest TEXT NOT NULL CHECK (
    length(session_binding_digest) = 64 AND session_binding_digest NOT GLOB '*[^0-9a-f]*'
  ),
  provider_registration_id TEXT NOT NULL REFERENCES provider_registrations(provider_registration_id),
  provider_definition_digest TEXT NOT NULL
    REFERENCES plugin_oauth_provider_definitions(provider_definition_digest),
  provider_definition_revision INTEGER NOT NULL CHECK (provider_definition_revision >= 1),
  provider_registration_authority_revision INTEGER NOT NULL CHECK (
    provider_registration_authority_revision >= 1
  ),
  token_endpoint_auth_method TEXT NOT NULL CHECK (
    token_endpoint_auth_method IN ('client_secret_post', 'client_secret_basic')
  ),
  requested_scopes_json TEXT NOT NULL CHECK (json_valid(requested_scopes_json)),
  callback_url TEXT NOT NULL CHECK (length(callback_url) BETWEEN 1 AND 2048),
  phase TEXT NOT NULL CHECK (phase IN (
    'pending', 'exchange-dispatching', 'exchange-possibly-dispatched', 'exchange-succeeded',
    'credential-staged', 'projection-dispatching', 'projection-possibly-dispatched',
    'projection-succeeded', 'validating', 'credential-adopted', 'ready', 'failed', 'expired'
  )),
  exchange_claimed_at INTEGER,
  exchange_completed_at INTEGER,
  projection_claimed_at INTEGER,
  projection_completed_at INTEGER,
  staged_credential_reference TEXT CHECK (
    staged_credential_reference IS NULL OR (
      length(staged_credential_reference) = 49
      AND substr(staged_credential_reference, 1, 13) = 'plugin-vault:'
      AND substr(staged_credential_reference, 14) NOT GLOB '*[^0-9a-f-]*'
    )
  ),
  connection_id TEXT REFERENCES plugin_connections(connection_id) DEFERRABLE INITIALLY DEFERRED,
  provider_account_subject TEXT CHECK (
    provider_account_subject IS NULL OR length(provider_account_subject) BETWEEN 1 AND 300
  ),
  display_label TEXT CHECK (display_label IS NULL OR length(display_label) BETWEEN 1 AND 160),
  subject_stability TEXT CHECK (
    subject_stability IS NULL OR subject_stability IN ('stable', 'mutable')
  ),
  adoption_operation_id TEXT CHECK (
    adoption_operation_id IS NULL OR length(adoption_operation_id) BETWEEN 1 AND 160
  ),
  adoption_receipt TEXT CHECK (
    adoption_receipt IS NULL OR length(adoption_receipt) BETWEEN 1 AND 240
  ),
  credential_lineage INTEGER CHECK (credential_lineage IS NULL OR credential_lineage >= 1),
  failure_reason TEXT CHECK (failure_reason IS NULL OR length(failure_reason) BETWEEN 1 AND 160),
  oauth_app_id TEXT NOT NULL REFERENCES plugin_oauth_apps(oauth_app_id),
  oauth_app_revision INTEGER NOT NULL CHECK (oauth_app_revision >= 1),
  oauth_app_credential_reference TEXT NOT NULL CHECK (
    length(oauth_app_credential_reference) = 49
    AND substr(oauth_app_credential_reference, 1, 13) = 'plugin-vault:'
    AND substr(oauth_app_credential_reference, 14) NOT GLOB '*[^0-9a-f-]*'
  ),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  CHECK ((phase = 'failed' AND failure_reason IS NOT NULL)
    OR (phase <> 'failed' AND failure_reason IS NULL)),
  CHECK (
    (phase IN ('credential-staged', 'projection-dispatching', 'projection-possibly-dispatched',
      'projection-succeeded', 'validating', 'credential-adopted', 'ready')
      AND staged_credential_reference IS NOT NULL)
    OR (phase NOT IN ('credential-staged', 'projection-dispatching',
      'projection-possibly-dispatched', 'projection-succeeded', 'validating',
      'credential-adopted', 'ready'))
  ),
  CHECK (
    (phase IN ('projection-succeeded', 'validating', 'credential-adopted', 'ready')
      AND provider_account_subject IS NOT NULL AND display_label IS NOT NULL
      AND subject_stability IS NOT NULL)
    OR (phase NOT IN ('projection-succeeded', 'validating', 'credential-adopted', 'ready'))
  ),
  CHECK (
    (phase IN ('credential-adopted', 'ready') AND connection_id IS NOT NULL
      AND adoption_operation_id IS NOT NULL AND adoption_receipt IS NOT NULL
      AND credential_lineage = 1)
    OR (phase NOT IN ('credential-adopted', 'ready'))
  )
) WITHOUT ROWID;

CREATE INDEX plugin_oauth_runtime_attempts_phase
  ON plugin_oauth_runtime_attempts (phase, updated_at, oauth_attempt_id);
CREATE UNIQUE INDEX plugin_oauth_runtime_attempts_connection
  ON plugin_oauth_runtime_attempts (connection_id) WHERE connection_id IS NOT NULL;

CREATE TRIGGER provider_registration_oauth_shape_insert
BEFORE INSERT ON provider_registrations
WHEN NOT (
  (new.oauth_provider_definition_digest IS NULL
    AND new.oauth_provider_definition_revision IS NULL
    AND new.oauth_authority_revision IS NULL)
  OR (new.oauth_provider_definition_digest IS NOT NULL
    AND new.oauth_provider_definition_revision IS NOT NULL
    AND new.oauth_authority_revision IS NOT NULL)
)
BEGIN
  SELECT RAISE(ABORT, 'OAuth Provider Registration binding is partial');
END;

CREATE TRIGGER provider_registration_oauth_admission_insert
BEFORE INSERT ON provider_registrations
WHEN new.oauth_provider_definition_digest IS NOT NULL
BEGIN
  SELECT RAISE(ABORT, 'OAuth Provider Registration admission is invalid')
  WHERE new.registration_mode <> 'workspace-oauth-app'
    OR new.source <> 'platform' OR new.status <> 'active' OR new.oauth_authority_revision <> 1
    OR new.authorization_metadata_url IS NOT NULL OR new.authorization_endpoint IS NOT NULL
    OR new.token_endpoint IS NOT NULL OR new.registration_endpoint IS NOT NULL
    OR new.userinfo_endpoint IS NOT NULL OR new.revocation_endpoint IS NOT NULL
    OR new.metadata_digest IS NOT NULL OR new.dynamic_registration_claim IS NOT NULL
    OR new.dynamic_registration_claimed_at IS NOT NULL
    OR new.client_credential_reference IS NOT NULL
    OR NOT EXISTS (
      SELECT 1 FROM plugin_oauth_provider_definitions d
      WHERE d.provider_definition_digest = new.oauth_provider_definition_digest
        AND d.revision = new.oauth_provider_definition_revision AND d.status = 'active'
        AND d.provider = new.provider AND d.resource_identity = new.resource_identity
        AND d.scopes_json = new.approved_scopes_json AND d.display_label_path_present = 1
        AND json_extract(d.canonical_definition_json, '$.tokenEndpointAuthMethod')
              IN ('client_secret_post', 'client_secret_basic')
    );
END;

CREATE TRIGGER provider_registration_oauth_shape_update
BEFORE UPDATE ON provider_registrations
WHEN NOT (
  (new.oauth_provider_definition_digest IS NULL
    AND new.oauth_provider_definition_revision IS NULL
    AND new.oauth_authority_revision IS NULL)
  OR (new.oauth_provider_definition_digest IS NOT NULL
    AND new.oauth_provider_definition_revision IS NOT NULL
    AND new.oauth_authority_revision IS NOT NULL)
)
BEGIN
  SELECT RAISE(ABORT, 'OAuth Provider Registration binding is partial');
END;

CREATE TRIGGER provider_registration_oauth_no_upgrade
BEFORE UPDATE ON provider_registrations
WHEN old.oauth_provider_definition_digest IS NULL
  AND (new.oauth_provider_definition_digest IS NOT NULL
    OR new.oauth_provider_definition_revision IS NOT NULL
    OR new.oauth_authority_revision IS NOT NULL)
BEGIN
  SELECT RAISE(ABORT, 'Legacy Provider Registration cannot become generic OAuth');
END;

CREATE TRIGGER provider_registration_oauth_semantic_lifecycle
BEFORE UPDATE ON provider_registrations
WHEN old.oauth_provider_definition_digest IS NOT NULL AND NOT (
  old.provider IS new.provider AND old.resource_identity IS new.resource_identity
  AND old.registration_mode IS new.registration_mode
  AND old.authorization_metadata_url IS new.authorization_metadata_url
  AND old.authorization_endpoint IS new.authorization_endpoint
  AND old.token_endpoint IS new.token_endpoint
  AND old.registration_endpoint IS new.registration_endpoint
  AND old.userinfo_endpoint IS new.userinfo_endpoint
  AND old.revocation_endpoint IS new.revocation_endpoint
  AND old.metadata_digest IS new.metadata_digest AND old.callback_url IS new.callback_url
  AND old.approved_scopes_json IS new.approved_scopes_json
  AND old.client_credential_reference IS new.client_credential_reference
  AND old.dynamic_registration_claim IS new.dynamic_registration_claim
  AND old.dynamic_registration_claimed_at IS new.dynamic_registration_claimed_at
  AND old.source IS new.source
  AND old.oauth_provider_definition_digest IS new.oauth_provider_definition_digest
  AND old.oauth_provider_definition_revision IS new.oauth_provider_definition_revision
  AND ((new.status IS old.status AND new.oauth_authority_revision IS old.oauth_authority_revision)
    OR (old.status = 'active' AND new.status IN ('reauthorization-required', 'revoked')
      AND new.oauth_authority_revision IS old.oauth_authority_revision + 1)
    OR (old.status = 'reauthorization-required' AND new.status = 'revoked'
      AND new.oauth_authority_revision IS old.oauth_authority_revision + 1))
)
BEGIN
  SELECT RAISE(ABORT, 'OAuth Provider Registration semantic authority is immutable');
END;

CREATE TRIGGER provider_registration_oauth_retained
BEFORE DELETE ON provider_registrations
WHEN old.oauth_provider_definition_digest IS NOT NULL
BEGIN
  SELECT RAISE(ABORT, 'OAuth Provider Registrations are retained');
END;

CREATE TRIGGER plugin_version_oauth_shape_insert
BEFORE INSERT ON plugin_versions
BEGIN
  SELECT RAISE(ABORT, 'Plugin version OAuth authority shape is invalid')
  WHERE NOT (
    (new.runtime_kind = 'managed-package' AND new.authentication_kind = 'oauth'
      AND new.provider_registration_id IS NOT NULL
      AND new.provider_registration_authority_revision IS NOT NULL
      AND new.provider_definition_digest IS NOT NULL
      AND new.provider_definition_revision IS NOT NULL
      AND new.requested_scopes_json <> '[]')
    OR (NOT (new.runtime_kind = 'managed-package' AND new.authentication_kind = 'oauth')
      AND new.provider_registration_authority_revision IS NULL
      AND new.provider_definition_digest IS NULL AND new.provider_definition_revision IS NULL)
  );
  SELECT RAISE(ABORT, 'Plugin version OAuth publication authority is invalid')
  WHERE new.provider_definition_digest IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM provider_registrations r
    JOIN plugin_oauth_provider_definitions d
      ON d.provider_definition_digest = r.oauth_provider_definition_digest
     AND d.revision = r.oauth_provider_definition_revision
    WHERE r.provider_registration_id = new.provider_registration_id
      AND r.oauth_authority_revision = new.provider_registration_authority_revision
      AND r.status = 'active' AND r.registration_mode = 'workspace-oauth-app'
      AND r.source = 'platform' AND r.client_credential_reference IS NULL
      AND r.oauth_provider_definition_digest = new.provider_definition_digest
      AND r.oauth_provider_definition_revision = new.provider_definition_revision
      AND r.approved_scopes_json = new.requested_scopes_json
      AND d.status = 'active' AND d.provider = r.provider
      AND d.resource_identity = r.resource_identity AND d.scopes_json = new.requested_scopes_json
      AND d.display_label_path_present = 1
  );
END;

CREATE TRIGGER plugin_version_auth_authority_immutable
BEFORE UPDATE ON plugin_versions
WHEN old.runtime_kind IS NOT new.runtime_kind
  OR old.authentication_kind IS NOT new.authentication_kind
  OR old.provider_registration_id IS NOT new.provider_registration_id
  OR old.requested_scopes_json IS NOT new.requested_scopes_json
  OR old.provider_registration_authority_revision IS NOT new.provider_registration_authority_revision
  OR old.provider_definition_digest IS NOT new.provider_definition_digest
  OR old.provider_definition_revision IS NOT new.provider_definition_revision
BEGIN
  SELECT RAISE(ABORT, 'Plugin version authentication authority is immutable');
END;

CREATE TRIGGER plugin_version_oauth_publish_guard
BEFORE UPDATE OF status ON plugin_versions
WHEN old.provider_definition_digest IS NOT NULL
  AND old.status = 'publishing' AND new.status = 'published'
BEGIN
  SELECT RAISE(ABORT, 'Plugin version OAuth publication authority is unavailable')
  WHERE NOT EXISTS (
    SELECT 1 FROM provider_registrations r
    JOIN plugin_oauth_provider_definitions d
      ON d.provider_definition_digest = r.oauth_provider_definition_digest
     AND d.revision = r.oauth_provider_definition_revision
    WHERE r.provider_registration_id = old.provider_registration_id
      AND r.oauth_authority_revision = old.provider_registration_authority_revision
      AND r.status = 'active' AND r.registration_mode = 'workspace-oauth-app'
      AND r.source = 'platform' AND r.client_credential_reference IS NULL
      AND r.oauth_provider_definition_digest = old.provider_definition_digest
      AND r.oauth_provider_definition_revision = old.provider_definition_revision
      AND r.approved_scopes_json = old.requested_scopes_json
      AND d.status = 'active' AND d.provider = r.provider
      AND d.resource_identity = r.resource_identity AND d.scopes_json = old.requested_scopes_json
      AND d.display_label_path_present = 1
  );
END;

CREATE TRIGGER plugin_oauth_app_retained
BEFORE DELETE ON plugin_oauth_apps
BEGIN
  SELECT RAISE(ABORT, 'Workspace OAuth apps are retained');
END;

CREATE TRIGGER plugin_oauth_runtime_attempt_authority_immutable
BEFORE UPDATE ON plugin_oauth_runtime_attempts
WHEN old.oauth_attempt_id IS NOT new.oauth_attempt_id
  OR old.session_binding_digest IS NOT new.session_binding_digest
  OR old.provider_registration_id IS NOT new.provider_registration_id
  OR old.provider_definition_digest IS NOT new.provider_definition_digest
  OR old.provider_definition_revision IS NOT new.provider_definition_revision
  OR old.provider_registration_authority_revision IS NOT new.provider_registration_authority_revision
  OR old.token_endpoint_auth_method IS NOT new.token_endpoint_auth_method
  OR old.requested_scopes_json IS NOT new.requested_scopes_json
  OR old.callback_url IS NOT new.callback_url OR old.oauth_app_id IS NOT new.oauth_app_id
  OR old.oauth_app_revision IS NOT new.oauth_app_revision
  OR old.oauth_app_credential_reference IS NOT new.oauth_app_credential_reference
  OR old.created_at IS NOT new.created_at
BEGIN
  SELECT RAISE(ABORT, 'OAuth runtime attempt authority is immutable');
END;

CREATE TRIGGER plugin_oauth_runtime_attempt_transition
BEFORE UPDATE ON plugin_oauth_runtime_attempts
WHEN NOT (new.updated_at >= old.updated_at AND (
  (old.phase = 'pending' AND new.phase IN ('exchange-dispatching', 'expired', 'failed'))
  OR (old.phase = 'exchange-dispatching'
    AND new.phase IN ('exchange-possibly-dispatched', 'exchange-succeeded', 'failed'))
  OR (old.phase = 'exchange-possibly-dispatched' AND new.phase = 'failed')
  OR (old.phase = 'exchange-succeeded' AND new.phase IN ('credential-staged', 'failed'))
  OR (old.phase = 'credential-staged' AND new.phase IN ('projection-dispatching', 'failed'))
  OR (old.phase = 'projection-dispatching'
    AND new.phase IN ('projection-possibly-dispatched', 'projection-succeeded', 'failed'))
  OR (old.phase = 'projection-possibly-dispatched' AND new.phase = 'failed')
  OR (old.phase = 'projection-succeeded' AND new.phase IN ('validating', 'failed'))
  OR (old.phase = 'validating' AND new.phase IN ('credential-adopted', 'failed'))
  OR (old.phase = 'credential-adopted' AND new.phase IN ('ready', 'failed'))
))
BEGIN
  SELECT RAISE(ABORT, 'OAuth runtime attempt transition is invalid');
END;

CREATE TRIGGER plugin_oauth_runtime_attempt_retained
BEFORE DELETE ON plugin_oauth_runtime_attempts
BEGIN
  SELECT RAISE(ABORT, 'OAuth runtime attempts are retained');
END;

CREATE TRIGGER plugin_oauth_connection_credential_transition
BEFORE UPDATE ON plugin_oauth_connection_credentials
WHEN NOT (
  old.connection_id IS new.connection_id AND old.oauth_attempt_id IS new.oauth_attempt_id
  AND old.created_at IS new.created_at AND new.updated_at >= old.updated_at
  AND (
    (old.status = 'staged' AND new.status = 'active' AND new.lineage = 1
      AND old.credential_reference IS new.credential_reference
      AND EXISTS (
        SELECT 1 FROM plugin_oauth_runtime_attempts a
        WHERE a.oauth_attempt_id = old.oauth_attempt_id AND a.connection_id = old.connection_id
          AND a.phase = 'credential-adopted'
          AND a.staged_credential_reference = new.credential_reference
          AND a.adoption_operation_id = new.adoption_operation_id
          AND a.adoption_receipt = new.adoption_receipt AND a.credential_lineage = new.lineage
      ))
    OR (old.status = 'active' AND new.status = 'active' AND new.lineage = old.lineage + 1
      AND old.credential_reference IS new.credential_reference
      AND EXISTS (
        SELECT 1 FROM plugin_oauth_refresh_operations refresh
        WHERE refresh.connection_id = old.connection_id
          AND refresh.expected_lineage = old.lineage AND refresh.resulting_lineage = new.lineage
          AND refresh.phase = 'credential-adopted'
          AND refresh.staged_credential_reference = new.credential_reference
          AND refresh.adoption_operation_id = new.adoption_operation_id
          AND refresh.adoption_receipt = new.adoption_receipt
      ))
    OR (old.status = 'active' AND new.status = 'revoked' AND new.lineage = old.lineage
      AND new.credential_reference IS old.credential_reference
      AND new.adoption_operation_id IS old.adoption_operation_id
      AND new.adoption_receipt IS old.adoption_receipt
      AND EXISTS (
        SELECT 1 FROM plugin_oauth_revocation_operations revocation
        WHERE revocation.connection_id = old.connection_id
          AND revocation.credential_lineage = old.lineage AND revocation.phase = 'cleaned'
          AND revocation.cleanup_receipt = new.cleanup_receipt
      ))
  )
)
BEGIN
  SELECT RAISE(ABORT, 'OAuth Connection credential transition is invalid');
END;

CREATE TRIGGER plugin_oauth_connection_ready_insert
BEFORE INSERT ON plugin_connections
WHEN new.status = 'ready' AND EXISTS (
  SELECT 1 FROM provider_registrations r
  WHERE r.provider_registration_id = new.provider_registration_id
    AND r.oauth_provider_definition_digest IS NOT NULL
)
BEGIN
  SELECT RAISE(ABORT, 'OAuth Connection requires an exact adopted credential')
  WHERE NOT EXISTS (
    SELECT 1 FROM plugin_oauth_connection_credentials c
    JOIN plugin_oauth_runtime_attempts a ON a.oauth_attempt_id = c.oauth_attempt_id
    WHERE c.connection_id = new.connection_id
      AND c.credential_reference = new.credential_reference
      AND c.status = 'active' AND c.lineage >= 1 AND a.connection_id = new.connection_id
      AND a.phase IN ('credential-adopted', 'ready')
      AND a.adoption_operation_id = c.adoption_operation_id
      AND a.adoption_receipt = c.adoption_receipt AND a.credential_lineage = c.lineage
  );
END;

CREATE TRIGGER plugin_oauth_connection_ready_update
BEFORE UPDATE OF status ON plugin_connections
WHEN new.status = 'ready' AND old.status <> 'ready' AND EXISTS (
  SELECT 1 FROM provider_registrations r
  WHERE r.provider_registration_id = new.provider_registration_id
    AND r.oauth_provider_definition_digest IS NOT NULL
)
BEGIN
  SELECT RAISE(ABORT, 'OAuth Connection requires an exact adopted credential')
  WHERE NOT EXISTS (
    SELECT 1 FROM plugin_oauth_connection_credentials c
    JOIN plugin_oauth_runtime_attempts a ON a.oauth_attempt_id = c.oauth_attempt_id
    WHERE c.connection_id = new.connection_id
      AND c.credential_reference = new.credential_reference
      AND c.status = 'active' AND c.lineage >= 1 AND a.connection_id = new.connection_id
      AND a.phase IN ('credential-adopted', 'ready')
      AND a.adoption_operation_id = c.adoption_operation_id
      AND a.adoption_receipt = c.adoption_receipt AND a.credential_lineage = c.lineage
  );
END;

CREATE TABLE workspace_oauth_authority_rebuild_fk_guard (
  valid INTEGER NOT NULL CHECK (valid = 1)
);

INSERT INTO workspace_oauth_authority_rebuild_fk_guard (valid)
SELECT 0 WHERE EXISTS (SELECT 1 FROM pragma_foreign_key_check);

DROP TABLE workspace_oauth_authority_rebuild_fk_guard;

PRAGMA defer_foreign_keys = OFF;
