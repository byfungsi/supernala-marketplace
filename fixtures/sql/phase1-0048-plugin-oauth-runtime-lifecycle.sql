CREATE TABLE plugin_oauth_runtime_attempts (
  oauth_attempt_id TEXT PRIMARY KEY NOT NULL
    REFERENCES plugin_oauth_attempts(oauth_attempt_id),
  session_binding_digest TEXT NOT NULL CHECK (
    length(session_binding_digest) = 64
    AND session_binding_digest NOT GLOB '*[^0-9a-f]*'
  ),
  provider_registration_id TEXT NOT NULL,
  provider_definition_digest TEXT NOT NULL,
  provider_definition_revision INTEGER NOT NULL CHECK (provider_definition_revision >= 1),
  provider_registration_authority_revision INTEGER NOT NULL
    CHECK (provider_registration_authority_revision >= 1),
  material_source_revision INTEGER NOT NULL CHECK (material_source_revision >= 1),
  material_version TEXT NOT NULL CHECK (length(material_version) BETWEEN 1 AND 128),
  declaration_id TEXT NOT NULL CHECK (length(declaration_id) BETWEEN 1 AND 160),
  deployment_revision TEXT NOT NULL CHECK (length(deployment_revision) BETWEEN 1 AND 200),
  token_endpoint_auth_method TEXT NOT NULL CHECK (
    token_endpoint_auth_method IN ('client_secret_post', 'client_secret_basic', 'none')
  ),
  requested_scopes_json TEXT NOT NULL CHECK (json_valid(requested_scopes_json)),
  callback_url TEXT NOT NULL CHECK (length(callback_url) BETWEEN 1 AND 2048),
  phase TEXT NOT NULL CHECK (phase IN (
    'pending',
    'exchange-dispatching',
    'exchange-possibly-dispatched',
    'exchange-succeeded',
    'credential-staged',
    'projection-dispatching',
    'projection-possibly-dispatched',
    'projection-succeeded',
    'validating',
    'credential-adopted',
    'ready',
    'failed',
    'expired'
  )),
  exchange_claimed_at INTEGER,
  exchange_completed_at INTEGER,
  projection_claimed_at INTEGER,
  projection_completed_at INTEGER,
  staged_credential_reference TEXT CHECK (
    staged_credential_reference IS NULL
    OR (
      length(staged_credential_reference) = 49
      AND substr(staged_credential_reference, 1, 13) = 'plugin-vault:'
      AND substr(staged_credential_reference, 14) NOT GLOB '*[^0-9a-f-]*'
    )
  ),
  connection_id TEXT REFERENCES plugin_connections(connection_id) DEFERRABLE INITIALLY DEFERRED,
  provider_account_subject TEXT
    CHECK (provider_account_subject IS NULL OR length(provider_account_subject) BETWEEN 1 AND 300),
  display_label TEXT CHECK (display_label IS NULL OR length(display_label) BETWEEN 1 AND 160),
  subject_stability TEXT CHECK (subject_stability IS NULL OR subject_stability IN ('stable', 'mutable')),
  adoption_operation_id TEXT
    CHECK (adoption_operation_id IS NULL OR length(adoption_operation_id) BETWEEN 1 AND 160),
  adoption_receipt TEXT
    CHECK (adoption_receipt IS NULL OR length(adoption_receipt) BETWEEN 1 AND 240),
  credential_lineage INTEGER CHECK (credential_lineage IS NULL OR credential_lineage >= 1),
  failure_reason TEXT CHECK (failure_reason IS NULL OR length(failure_reason) BETWEEN 1 AND 160),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  FOREIGN KEY (provider_definition_digest)
    REFERENCES plugin_oauth_provider_definitions(provider_definition_digest),
  FOREIGN KEY (provider_registration_id)
    REFERENCES provider_registrations(provider_registration_id),
  FOREIGN KEY (
    provider_registration_id, material_source_revision
  ) REFERENCES plugin_oauth_registration_material_sources(provider_registration_id, source_revision),
  CHECK (
    (phase = 'failed' AND failure_reason IS NOT NULL)
    OR (phase <> 'failed' AND failure_reason IS NULL)
  ),
  CHECK (
    (phase IN ('credential-staged', 'projection-dispatching', 'projection-possibly-dispatched',
      'projection-succeeded', 'validating', 'credential-adopted', 'ready')
      AND staged_credential_reference IS NOT NULL)
    OR
    (phase NOT IN ('credential-staged', 'projection-dispatching', 'projection-possibly-dispatched',
      'projection-succeeded', 'validating', 'credential-adopted', 'ready'))
  ),
  CHECK (
    (phase IN ('projection-succeeded', 'validating', 'credential-adopted', 'ready')
      AND provider_account_subject IS NOT NULL
      AND display_label IS NOT NULL
      AND subject_stability IS NOT NULL)
    OR
    (phase NOT IN ('projection-succeeded', 'validating', 'credential-adopted', 'ready'))
  ),
  CHECK (
    (phase IN ('credential-adopted', 'ready')
      AND connection_id IS NOT NULL
      AND adoption_operation_id IS NOT NULL
      AND adoption_receipt IS NOT NULL
      AND credential_lineage = 1)
    OR
    (phase NOT IN ('credential-adopted', 'ready'))
  )
) WITHOUT ROWID;

CREATE INDEX plugin_oauth_runtime_attempts_phase
  ON plugin_oauth_runtime_attempts (phase, updated_at, oauth_attempt_id);

CREATE UNIQUE INDEX plugin_oauth_runtime_attempts_connection
  ON plugin_oauth_runtime_attempts (connection_id)
  WHERE connection_id IS NOT NULL;

CREATE TABLE plugin_oauth_connection_credentials (
  connection_id TEXT PRIMARY KEY NOT NULL REFERENCES plugin_connections(connection_id),
  oauth_attempt_id TEXT NOT NULL UNIQUE REFERENCES plugin_oauth_runtime_attempts(oauth_attempt_id),
  credential_reference TEXT NOT NULL CHECK (
    length(credential_reference) = 49
    AND substr(credential_reference, 1, 13) = 'plugin-vault:'
    AND substr(credential_reference, 14) NOT GLOB '*[^0-9a-f-]*'
  ),
  status TEXT NOT NULL CHECK (status IN ('staged', 'active', 'revoked')),
  lineage INTEGER NOT NULL CHECK (lineage BETWEEN 0 AND 1000000000),
  adoption_operation_id TEXT UNIQUE
    CHECK (adoption_operation_id IS NULL OR length(adoption_operation_id) BETWEEN 1 AND 160),
  adoption_receipt TEXT UNIQUE
    CHECK (adoption_receipt IS NULL OR length(adoption_receipt) BETWEEN 1 AND 240),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  revoked_at INTEGER,
  cleanup_receipt TEXT UNIQUE
    CHECK (cleanup_receipt IS NULL OR length(cleanup_receipt) BETWEEN 1 AND 240),
  CHECK (
    (status = 'staged' AND lineage = 0 AND adoption_operation_id IS NULL
      AND adoption_receipt IS NULL AND revoked_at IS NULL AND cleanup_receipt IS NULL)
    OR
    (status = 'active' AND lineage >= 1 AND adoption_operation_id IS NOT NULL
      AND adoption_receipt IS NOT NULL AND revoked_at IS NULL AND cleanup_receipt IS NULL)
    OR
    (status = 'revoked' AND lineage >= 1 AND adoption_operation_id IS NOT NULL
      AND adoption_receipt IS NOT NULL AND revoked_at IS NOT NULL AND cleanup_receipt IS NOT NULL)
  )
) WITHOUT ROWID;

CREATE TABLE plugin_oauth_refresh_operations (
  refresh_operation_id TEXT PRIMARY KEY NOT NULL CHECK (length(refresh_operation_id) BETWEEN 1 AND 160),
  connection_id TEXT NOT NULL REFERENCES plugin_oauth_connection_credentials(connection_id),
  expected_lineage INTEGER NOT NULL CHECK (expected_lineage >= 1),
  resulting_lineage INTEGER NOT NULL CHECK (resulting_lineage = expected_lineage + 1),
  phase TEXT NOT NULL CHECK (phase IN (
    'dispatching', 'possibly-dispatched', 'response-received', 'credential-staged',
    'credential-adopted', 'committed', 'invalid-grant', 'failed'
  )),
  staged_credential_reference TEXT,
  adoption_operation_id TEXT UNIQUE
    CHECK (adoption_operation_id IS NULL OR length(adoption_operation_id) BETWEEN 1 AND 160),
  adoption_receipt TEXT UNIQUE
    CHECK (adoption_receipt IS NULL OR length(adoption_receipt) BETWEEN 1 AND 240),
  failure_reason TEXT CHECK (failure_reason IS NULL OR length(failure_reason) BETWEEN 1 AND 160),
  claimed_at INTEGER NOT NULL,
  dispatch_completed_at INTEGER,
  completed_at INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE (connection_id, expected_lineage),
  CHECK (
    (phase IN ('credential-staged', 'credential-adopted', 'committed')
      AND staged_credential_reference IS NOT NULL)
    OR phase NOT IN ('credential-staged', 'credential-adopted', 'committed')
  ),
  CHECK (
    (phase IN ('credential-adopted', 'committed')
      AND adoption_operation_id IS NOT NULL AND adoption_receipt IS NOT NULL)
    OR phase NOT IN ('credential-adopted', 'committed')
  ),
  CHECK (
    (phase IN ('possibly-dispatched', 'invalid-grant', 'failed') AND failure_reason IS NOT NULL)
    OR (phase NOT IN ('possibly-dispatched', 'invalid-grant', 'failed') AND failure_reason IS NULL)
  )
) WITHOUT ROWID;

CREATE INDEX plugin_oauth_refresh_operations_connection_phase
  ON plugin_oauth_refresh_operations (connection_id, phase, updated_at);

CREATE TABLE plugin_oauth_revocation_operations (
  revocation_operation_id TEXT PRIMARY KEY NOT NULL
    CHECK (length(revocation_operation_id) BETWEEN 1 AND 160),
  connection_id TEXT NOT NULL UNIQUE REFERENCES plugin_oauth_connection_credentials(connection_id),
  expected_connection_revision INTEGER NOT NULL CHECK (expected_connection_revision >= 1),
  credential_lineage INTEGER NOT NULL CHECK (credential_lineage >= 1),
  selected_token TEXT NOT NULL CHECK (selected_token IN ('refresh-token', 'access-token', 'none')),
  phase TEXT NOT NULL CHECK (phase IN (
    'local-disconnected', 'dispatching', 'possibly-dispatched', 'accepted', 'failed', 'cleaned'
  )),
  observed_outcome TEXT CHECK (observed_outcome IS NULL OR observed_outcome IN (
    'not-configured', 'accepted', 'failed', 'possibly-dispatched'
  )),
  failure_reason TEXT CHECK (failure_reason IS NULL OR length(failure_reason) BETWEEN 1 AND 160),
  cleanup_receipt TEXT UNIQUE
    CHECK (cleanup_receipt IS NULL OR length(cleanup_receipt) BETWEEN 1 AND 240),
  locally_disconnected_at INTEGER NOT NULL,
  dispatch_claimed_at INTEGER,
  dispatch_completed_at INTEGER,
  cleaned_at INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  CHECK (
    (phase = 'cleaned' AND observed_outcome IS NOT NULL
      AND cleanup_receipt IS NOT NULL AND cleaned_at IS NOT NULL)
    OR phase <> 'cleaned'
  )
) WITHOUT ROWID;

CREATE INDEX plugin_oauth_revocation_operations_phase
  ON plugin_oauth_revocation_operations (phase, updated_at, connection_id);

CREATE TRIGGER plugin_oauth_runtime_attempt_authority_immutable
BEFORE UPDATE ON plugin_oauth_runtime_attempts
WHEN
  old.oauth_attempt_id IS NOT new.oauth_attempt_id
  OR old.session_binding_digest IS NOT new.session_binding_digest
  OR old.provider_registration_id IS NOT new.provider_registration_id
  OR old.provider_definition_digest IS NOT new.provider_definition_digest
  OR old.provider_definition_revision IS NOT new.provider_definition_revision
  OR old.provider_registration_authority_revision
       IS NOT new.provider_registration_authority_revision
  OR old.material_source_revision IS NOT new.material_source_revision
  OR old.material_version IS NOT new.material_version
  OR old.declaration_id IS NOT new.declaration_id
  OR old.deployment_revision IS NOT new.deployment_revision
  OR old.token_endpoint_auth_method IS NOT new.token_endpoint_auth_method
  OR old.requested_scopes_json IS NOT new.requested_scopes_json
  OR old.callback_url IS NOT new.callback_url
  OR old.created_at IS NOT new.created_at
BEGIN
  SELECT RAISE(ABORT, 'OAuth runtime attempt authority is immutable');
END;

CREATE TRIGGER plugin_oauth_runtime_attempt_transition
BEFORE UPDATE ON plugin_oauth_runtime_attempts
WHEN NOT (
  new.updated_at >= old.updated_at
  AND (
    (old.phase = 'pending' AND new.phase IN ('exchange-dispatching', 'expired', 'failed'))
    OR (old.phase = 'exchange-dispatching'
      AND new.phase IN ('exchange-possibly-dispatched', 'exchange-succeeded', 'failed'))
    OR (old.phase = 'exchange-possibly-dispatched' AND new.phase = 'failed')
    OR (old.phase = 'exchange-succeeded' AND new.phase IN ('credential-staged', 'failed'))
    OR (old.phase = 'credential-staged'
      AND new.phase IN ('projection-dispatching', 'failed'))
    OR (old.phase = 'projection-dispatching'
      AND new.phase IN ('projection-possibly-dispatched', 'projection-succeeded', 'failed'))
    OR (old.phase = 'projection-possibly-dispatched' AND new.phase = 'failed')
    OR (old.phase = 'projection-succeeded' AND new.phase IN ('validating', 'failed'))
    OR (old.phase = 'validating' AND new.phase IN ('credential-adopted', 'failed'))
    OR (old.phase = 'credential-adopted' AND new.phase IN ('ready', 'failed'))
  )
)
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
  old.connection_id IS new.connection_id
  AND old.oauth_attempt_id IS new.oauth_attempt_id
  AND old.created_at IS new.created_at
  AND new.updated_at >= old.updated_at
  AND (
    (old.status = 'staged' AND new.status = 'active' AND new.lineage = 1
      AND old.credential_reference IS new.credential_reference
      AND EXISTS (
        SELECT 1 FROM plugin_oauth_runtime_attempts a
        WHERE a.oauth_attempt_id = old.oauth_attempt_id
          AND a.connection_id = old.connection_id
          AND a.phase = 'credential-adopted'
          AND a.staged_credential_reference = new.credential_reference
          AND a.adoption_operation_id = new.adoption_operation_id
          AND a.adoption_receipt = new.adoption_receipt
          AND a.credential_lineage = new.lineage
      ))
    OR
    (old.status = 'active' AND new.status = 'active' AND new.lineage = old.lineage + 1
      AND old.credential_reference IS new.credential_reference
      AND EXISTS (
        SELECT 1 FROM plugin_oauth_refresh_operations refresh
        WHERE refresh.connection_id = old.connection_id
          AND refresh.expected_lineage = old.lineage
          AND refresh.resulting_lineage = new.lineage
          AND refresh.phase = 'credential-adopted'
          AND refresh.staged_credential_reference = new.credential_reference
          AND refresh.adoption_operation_id = new.adoption_operation_id
          AND refresh.adoption_receipt = new.adoption_receipt
      ))
    OR
    (old.status = 'active' AND new.status = 'revoked' AND new.lineage = old.lineage
      AND new.credential_reference IS old.credential_reference
      AND new.adoption_operation_id IS old.adoption_operation_id
      AND new.adoption_receipt IS old.adoption_receipt
      AND EXISTS (
        SELECT 1 FROM plugin_oauth_revocation_operations revocation
        WHERE revocation.connection_id = old.connection_id
          AND revocation.credential_lineage = old.lineage
          AND revocation.phase = 'cleaned'
          AND revocation.cleanup_receipt = new.cleanup_receipt
      ))
  )
)
BEGIN
  SELECT RAISE(ABORT, 'OAuth Connection credential transition is invalid');
END;

CREATE TRIGGER plugin_oauth_connection_credential_retained
BEFORE DELETE ON plugin_oauth_connection_credentials
BEGIN
  SELECT RAISE(ABORT, 'OAuth Connection credential authority is retained');
END;

CREATE TRIGGER plugin_oauth_connection_ready_insert
BEFORE INSERT ON plugin_connections
WHEN new.status = 'ready'
  AND EXISTS (
    SELECT 1 FROM provider_registrations r
    WHERE r.provider_registration_id = new.provider_registration_id
      AND r.oauth_provider_definition_digest IS NOT NULL
  )
BEGIN
  SELECT RAISE(ABORT, 'OAuth Connection requires an exact adopted credential')
  WHERE NOT EXISTS (
    SELECT 1
    FROM plugin_oauth_connection_credentials c
    JOIN plugin_oauth_runtime_attempts a ON a.oauth_attempt_id = c.oauth_attempt_id
    WHERE c.connection_id = new.connection_id
      AND c.credential_reference = new.credential_reference
      AND c.status = 'active' AND c.lineage >= 1
      AND a.connection_id = new.connection_id
      AND a.phase IN ('credential-adopted', 'ready')
      AND a.adoption_operation_id = c.adoption_operation_id
      AND a.adoption_receipt = c.adoption_receipt
      AND a.credential_lineage = c.lineage
  );
END;

CREATE TRIGGER plugin_oauth_connection_ready_update
BEFORE UPDATE OF status ON plugin_connections
WHEN new.status = 'ready' AND old.status <> 'ready'
  AND EXISTS (
    SELECT 1 FROM provider_registrations r
    WHERE r.provider_registration_id = new.provider_registration_id
      AND r.oauth_provider_definition_digest IS NOT NULL
  )
BEGIN
  SELECT RAISE(ABORT, 'OAuth Connection requires an exact adopted credential')
  WHERE NOT EXISTS (
    SELECT 1
    FROM plugin_oauth_connection_credentials c
    JOIN plugin_oauth_runtime_attempts a ON a.oauth_attempt_id = c.oauth_attempt_id
    WHERE c.connection_id = new.connection_id
      AND c.credential_reference = new.credential_reference
      AND c.status = 'active' AND c.lineage >= 1
      AND a.connection_id = new.connection_id
      AND a.phase IN ('credential-adopted', 'ready')
      AND a.adoption_operation_id = c.adoption_operation_id
      AND a.adoption_receipt = c.adoption_receipt
      AND a.credential_lineage = c.lineage
  );
END;

CREATE TRIGGER plugin_oauth_refresh_operation_transition
BEFORE UPDATE ON plugin_oauth_refresh_operations
WHEN NOT (
  old.refresh_operation_id IS new.refresh_operation_id
  AND old.connection_id IS new.connection_id
  AND old.expected_lineage IS new.expected_lineage
  AND old.resulting_lineage IS new.resulting_lineage
  AND old.claimed_at IS new.claimed_at
  AND old.created_at IS new.created_at
  AND new.updated_at >= old.updated_at
  AND (
    (old.phase = 'dispatching'
      AND new.phase IN ('possibly-dispatched', 'response-received', 'invalid-grant', 'failed'))
    OR (old.phase = 'response-received' AND new.phase IN ('credential-staged', 'failed'))
    OR (old.phase = 'credential-staged' AND new.phase IN ('credential-adopted', 'failed'))
    OR (old.phase = 'credential-adopted' AND new.phase IN ('committed', 'failed'))
  )
)
BEGIN
  SELECT RAISE(ABORT, 'OAuth refresh transition is invalid');
END;

CREATE TRIGGER plugin_oauth_refresh_operation_retained
BEFORE DELETE ON plugin_oauth_refresh_operations
BEGIN
  SELECT RAISE(ABORT, 'OAuth refresh operations are retained');
END;

CREATE TRIGGER plugin_oauth_revocation_admission
BEFORE INSERT ON plugin_oauth_revocation_operations
BEGIN
  SELECT RAISE(ABORT, 'OAuth revocation requires local disconnect')
  WHERE NOT EXISTS (
    SELECT 1 FROM plugin_connections c
    WHERE c.connection_id = new.connection_id
      AND c.status = 'disconnected'
      AND c.revision = new.expected_connection_revision + 1
      AND c.disconnected_at = new.locally_disconnected_at
  );
END;

CREATE TRIGGER plugin_oauth_revocation_transition
BEFORE UPDATE ON plugin_oauth_revocation_operations
WHEN NOT (
  old.revocation_operation_id IS new.revocation_operation_id
  AND old.connection_id IS new.connection_id
  AND old.expected_connection_revision IS new.expected_connection_revision
  AND old.credential_lineage IS new.credential_lineage
  AND old.selected_token IS new.selected_token
  AND old.locally_disconnected_at IS new.locally_disconnected_at
  AND old.created_at IS new.created_at
  AND new.updated_at >= old.updated_at
  AND (
    (old.phase = 'local-disconnected'
      AND new.phase IN ('dispatching', 'accepted', 'failed', 'cleaned'))
    OR (old.phase = 'dispatching'
      AND new.phase IN ('possibly-dispatched', 'accepted', 'failed'))
    OR (old.phase IN ('possibly-dispatched', 'accepted', 'failed') AND new.phase = 'cleaned')
  )
)
BEGIN
  SELECT RAISE(ABORT, 'OAuth revocation transition is invalid');
END;

CREATE TRIGGER plugin_oauth_revocation_retained
BEFORE DELETE ON plugin_oauth_revocation_operations
BEGIN
  SELECT RAISE(ABORT, 'OAuth revocation operations are retained');
END;
