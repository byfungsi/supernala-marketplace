-- Dynamic managed-remote OAuth binds one reviewed definition and Vault-backed DCR
-- material before the durable generic OAuth runtime admits an authorization attempt.

ALTER TABLE plugin_oauth_registration_material_sources
  ADD COLUMN material_origin TEXT NOT NULL DEFAULT 'deployment-environment'
    CHECK (material_origin IN (
      'deployment-environment', 'dynamic-registration', 'client-id-metadata-document'
    ));

PRAGMA defer_foreign_keys = ON;

DROP TRIGGER plugin_oauth_runtime_attempt_authority_immutable;
DROP TRIGGER plugin_oauth_runtime_attempt_transition;
DROP TRIGGER plugin_oauth_runtime_attempt_retained;
DROP TRIGGER plugin_oauth_connection_credential_transition;
DROP TRIGGER plugin_oauth_connection_ready_insert;
DROP TRIGGER plugin_oauth_connection_ready_update;

CREATE TABLE plugin_oauth_runtime_attempts_next (
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
  oauth_app_id TEXT REFERENCES plugin_oauth_apps(oauth_app_id),
  oauth_app_revision INTEGER CHECK (oauth_app_revision IS NULL OR oauth_app_revision >= 1),
  oauth_app_credential_reference TEXT CHECK (
    oauth_app_credential_reference IS NULL OR (
      length(oauth_app_credential_reference) = 49
      AND substr(oauth_app_credential_reference, 1, 13) = 'plugin-vault:'
      AND substr(oauth_app_credential_reference, 14) NOT GLOB '*[^0-9a-f-]*'
    )
  ),
  dynamic_client_credential_reference TEXT CHECK (
    dynamic_client_credential_reference IS NULL OR (
      length(dynamic_client_credential_reference) = 49
      AND substr(dynamic_client_credential_reference, 1, 13) = 'plugin-vault:'
      AND substr(dynamic_client_credential_reference, 14) NOT GLOB '*[^0-9a-f-]*'
    )
  ),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  CHECK ((oauth_app_id IS NULL AND oauth_app_revision IS NULL
      AND oauth_app_credential_reference IS NULL)
    OR (oauth_app_id IS NOT NULL AND oauth_app_revision IS NOT NULL
      AND oauth_app_credential_reference IS NOT NULL)),
  CHECK ((phase = 'failed' AND failure_reason IS NOT NULL)
    OR (phase <> 'failed' AND failure_reason IS NULL)),
  CHECK ((phase IN ('credential-staged', 'projection-dispatching',
      'projection-possibly-dispatched', 'projection-succeeded', 'validating',
      'credential-adopted', 'ready') AND staged_credential_reference IS NOT NULL)
    OR phase NOT IN ('credential-staged', 'projection-dispatching',
      'projection-possibly-dispatched', 'projection-succeeded', 'validating',
      'credential-adopted', 'ready')),
  CHECK ((phase IN ('projection-succeeded', 'validating', 'credential-adopted', 'ready')
      AND provider_account_subject IS NOT NULL AND display_label IS NOT NULL
      AND subject_stability IS NOT NULL)
    OR phase NOT IN ('projection-succeeded', 'validating', 'credential-adopted', 'ready')),
  CHECK ((phase IN ('credential-adopted', 'ready') AND connection_id IS NOT NULL
      AND adoption_operation_id IS NOT NULL AND adoption_receipt IS NOT NULL
      AND credential_lineage = 1)
    OR phase NOT IN ('credential-adopted', 'ready'))
) WITHOUT ROWID;

INSERT INTO plugin_oauth_runtime_attempts_next
  (oauth_attempt_id, session_binding_digest, provider_registration_id,
   provider_definition_digest, provider_definition_revision,
   provider_registration_authority_revision, material_source_revision, material_version,
   declaration_id, deployment_revision, token_endpoint_auth_method, requested_scopes_json,
   callback_url, phase, exchange_claimed_at, exchange_completed_at, projection_claimed_at,
   projection_completed_at, staged_credential_reference, connection_id,
   provider_account_subject, display_label, subject_stability, adoption_operation_id,
   adoption_receipt, credential_lineage, failure_reason, oauth_app_id, oauth_app_revision,
   oauth_app_credential_reference, dynamic_client_credential_reference, created_at, updated_at)
SELECT oauth_attempt_id, session_binding_digest, provider_registration_id,
       provider_definition_digest, provider_definition_revision,
       provider_registration_authority_revision,
       COALESCE(material_source_revision, oauth_app_revision),
       COALESCE(material_version, 'workspace-owned-v1'),
       COALESCE(declaration_id, oauth_app_id),
       COALESCE(deployment_revision, 'workspace-owned'), token_endpoint_auth_method,
       requested_scopes_json, callback_url, phase, exchange_claimed_at, exchange_completed_at,
       projection_claimed_at, projection_completed_at, staged_credential_reference,
       connection_id, provider_account_subject, display_label, subject_stability,
       adoption_operation_id, adoption_receipt, credential_lineage, failure_reason,
       oauth_app_id, oauth_app_revision, oauth_app_credential_reference, NULL, created_at, updated_at
FROM plugin_oauth_runtime_attempts;

DROP TABLE plugin_oauth_runtime_attempts;
ALTER TABLE plugin_oauth_runtime_attempts_next RENAME TO plugin_oauth_runtime_attempts;

CREATE INDEX plugin_oauth_runtime_attempts_phase
  ON plugin_oauth_runtime_attempts (phase, updated_at, oauth_attempt_id);
CREATE UNIQUE INDEX plugin_oauth_runtime_attempts_connection
  ON plugin_oauth_runtime_attempts (connection_id) WHERE connection_id IS NOT NULL;

CREATE TRIGGER plugin_oauth_runtime_attempt_authority_immutable
BEFORE UPDATE ON plugin_oauth_runtime_attempts
WHEN old.oauth_attempt_id IS NOT new.oauth_attempt_id
  OR old.session_binding_digest IS NOT new.session_binding_digest
  OR old.provider_registration_id IS NOT new.provider_registration_id
  OR old.provider_definition_digest IS NOT new.provider_definition_digest
  OR old.provider_definition_revision IS NOT new.provider_definition_revision
  OR old.provider_registration_authority_revision IS NOT new.provider_registration_authority_revision
  OR old.material_source_revision IS NOT new.material_source_revision
  OR old.material_version IS NOT new.material_version
  OR old.declaration_id IS NOT new.declaration_id
  OR old.deployment_revision IS NOT new.deployment_revision
  OR old.token_endpoint_auth_method IS NOT new.token_endpoint_auth_method
  OR old.requested_scopes_json IS NOT new.requested_scopes_json
  OR old.callback_url IS NOT new.callback_url OR old.oauth_app_id IS NOT new.oauth_app_id
  OR old.oauth_app_revision IS NOT new.oauth_app_revision
  OR old.oauth_app_credential_reference IS NOT new.oauth_app_credential_reference
  OR old.dynamic_client_credential_reference IS NOT new.dynamic_client_credential_reference
  OR old.created_at IS NOT new.created_at
BEGIN SELECT RAISE(ABORT, 'OAuth runtime attempt authority is immutable'); END;

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
BEGIN SELECT RAISE(ABORT, 'OAuth runtime attempt transition is invalid'); END;

CREATE TRIGGER plugin_oauth_runtime_attempt_retained
BEFORE DELETE ON plugin_oauth_runtime_attempts
BEGIN SELECT RAISE(ABORT, 'OAuth runtime attempts are retained'); END;

CREATE TRIGGER plugin_oauth_connection_credential_transition
BEFORE UPDATE ON plugin_oauth_connection_credentials
WHEN NOT (
  old.connection_id IS new.connection_id AND old.oauth_attempt_id IS new.oauth_attempt_id
  AND old.created_at IS new.created_at AND new.updated_at >= old.updated_at
  AND ((old.status = 'staged' AND new.status = 'active' AND new.lineage = 1
    AND old.credential_reference IS new.credential_reference
    AND EXISTS (SELECT 1 FROM plugin_oauth_runtime_attempts a
      WHERE a.oauth_attempt_id = old.oauth_attempt_id AND a.connection_id = old.connection_id
        AND a.phase = 'credential-adopted'
        AND a.staged_credential_reference = new.credential_reference
        AND a.adoption_operation_id = new.adoption_operation_id
        AND a.adoption_receipt = new.adoption_receipt AND a.credential_lineage = new.lineage))
  OR (old.status = 'active' AND new.status = 'active' AND new.lineage = old.lineage + 1
    AND old.credential_reference IS new.credential_reference
    AND EXISTS (SELECT 1 FROM plugin_oauth_refresh_operations refresh
      WHERE refresh.connection_id = old.connection_id
        AND refresh.expected_lineage = old.lineage AND refresh.resulting_lineage = new.lineage
        AND refresh.phase = 'credential-adopted'
        AND refresh.staged_credential_reference = new.credential_reference
        AND refresh.adoption_operation_id = new.adoption_operation_id
        AND refresh.adoption_receipt = new.adoption_receipt))
  OR (old.status = 'active' AND new.status = 'revoked' AND new.lineage = old.lineage
    AND new.credential_reference IS old.credential_reference
    AND new.adoption_operation_id IS old.adoption_operation_id
    AND new.adoption_receipt IS old.adoption_receipt
    AND EXISTS (SELECT 1 FROM plugin_oauth_revocation_operations revocation
      WHERE revocation.connection_id = old.connection_id
        AND revocation.credential_lineage = old.lineage AND revocation.phase = 'cleaned'
        AND revocation.cleanup_receipt = new.cleanup_receipt)))
)
BEGIN SELECT RAISE(ABORT, 'OAuth Connection credential transition is invalid'); END;

CREATE TRIGGER plugin_oauth_connection_ready_insert
BEFORE INSERT ON plugin_connections
WHEN new.status = 'ready' AND EXISTS (SELECT 1 FROM provider_registrations r
  WHERE r.provider_registration_id = new.provider_registration_id
    AND r.oauth_provider_definition_digest IS NOT NULL)
BEGIN
  SELECT RAISE(ABORT, 'OAuth Connection requires an exact adopted credential')
  WHERE NOT EXISTS (SELECT 1 FROM plugin_oauth_connection_credentials c
    JOIN plugin_oauth_runtime_attempts a ON a.oauth_attempt_id = c.oauth_attempt_id
    WHERE c.connection_id = new.connection_id AND c.credential_reference = new.credential_reference
      AND c.status = 'active' AND c.lineage >= 1 AND a.connection_id = new.connection_id
      AND a.phase IN ('credential-adopted', 'ready')
      AND a.adoption_operation_id = c.adoption_operation_id
      AND a.adoption_receipt = c.adoption_receipt AND a.credential_lineage = c.lineage);
END;

CREATE TRIGGER plugin_oauth_connection_ready_update
BEFORE UPDATE OF status ON plugin_connections
WHEN new.status = 'ready' AND old.status <> 'ready' AND EXISTS (
  SELECT 1 FROM provider_registrations r
  WHERE r.provider_registration_id = new.provider_registration_id
    AND r.oauth_provider_definition_digest IS NOT NULL)
BEGIN
  SELECT RAISE(ABORT, 'OAuth Connection requires an exact adopted credential')
  WHERE NOT EXISTS (SELECT 1 FROM plugin_oauth_connection_credentials c
    JOIN plugin_oauth_runtime_attempts a ON a.oauth_attempt_id = c.oauth_attempt_id
    WHERE c.connection_id = new.connection_id AND c.credential_reference = new.credential_reference
      AND c.status = 'active' AND c.lineage >= 1 AND a.connection_id = new.connection_id
      AND a.phase IN ('credential-adopted', 'ready')
      AND a.adoption_operation_id = c.adoption_operation_id
      AND a.adoption_receipt = c.adoption_receipt AND a.credential_lineage = c.lineage);
END;

DROP TRIGGER provider_registration_oauth_no_upgrade;
DROP TRIGGER plugin_oauth_material_source_admission;
DROP TRIGGER plugin_oauth_material_source_lifecycle;

CREATE TRIGGER provider_registration_oauth_no_upgrade
BEFORE UPDATE ON provider_registrations
WHEN old.oauth_provider_definition_digest IS NULL
  AND (
    new.oauth_provider_definition_digest IS NOT NULL
    OR new.oauth_provider_definition_revision IS NOT NULL
    OR new.oauth_authority_revision IS NOT NULL
  )
BEGIN
  SELECT RAISE(ABORT, 'Legacy Provider Registration cannot become generic OAuth')
  WHERE NOT (
    old.registration_mode = 'dynamic'
    AND old.source = 'platform'
    AND old.status = 'active'
    AND old.oauth_provider_definition_digest IS NULL
    AND old.oauth_provider_definition_revision IS NULL
    AND old.oauth_authority_revision IS NULL
    AND old.client_credential_reference IS NULL
    AND new.registration_mode = 'dynamic'
    AND new.source = 'platform'
    AND new.status = 'active'
    AND new.oauth_provider_definition_digest IS NOT NULL
    AND new.oauth_provider_definition_revision IS NOT NULL
    AND new.oauth_authority_revision = 1
    AND new.client_credential_reference IS NOT NULL
    AND new.authorization_endpoint IS NOT NULL
    AND new.token_endpoint IS NOT NULL
    AND (
      new.registration_endpoint IS NOT NULL
      OR EXISTS (
        SELECT 1
        FROM plugin_oauth_provider_definitions public_client_definition
        WHERE public_client_definition.provider_definition_digest =
              new.oauth_provider_definition_digest
          AND public_client_definition.revision = new.oauth_provider_definition_revision
          AND json_extract(
            public_client_definition.canonical_definition_json,
            '$.tokenEndpointAuthMethod'
          ) = 'none'
      )
    )
    AND new.metadata_digest IS NOT NULL
    AND new.dynamic_registration_claim IS NULL
    AND new.dynamic_registration_claimed_at IS NULL
    AND EXISTS (
      SELECT 1
      FROM plugin_oauth_provider_definitions d
      WHERE d.provider_definition_digest = new.oauth_provider_definition_digest
        AND d.revision = new.oauth_provider_definition_revision
        AND d.status = 'active'
        AND d.provider = new.provider
        AND d.resource_identity = new.resource_identity
        AND d.scopes_json = new.approved_scopes_json
        AND d.display_label_path_present = 1
    )
  );
END;

CREATE TRIGGER plugin_oauth_material_source_admission
BEFORE INSERT ON plugin_oauth_registration_material_sources
BEGIN
  SELECT RAISE(ABORT, 'OAuth material source revision is stale')
  WHERE new.source_revision <> COALESCE((
    SELECT MAX(s.source_revision) + 1
    FROM plugin_oauth_registration_material_sources s
    WHERE s.provider_registration_id = new.provider_registration_id
  ), 1);

  SELECT RAISE(ABORT, 'OAuth material source authority is invalid')
  WHERE NOT EXISTS (
    SELECT 1
    FROM provider_registrations r
    JOIN plugin_oauth_provider_definitions d
      ON d.provider_definition_digest = r.oauth_provider_definition_digest
     AND d.revision = r.oauth_provider_definition_revision
    WHERE r.provider_registration_id = new.provider_registration_id
      AND r.status = 'active'
      AND r.source = 'platform'
      AND r.oauth_authority_revision = new.oauth_authority_revision
      AND r.oauth_provider_definition_digest = new.provider_definition_digest
      AND r.oauth_provider_definition_revision = new.provider_definition_revision
      AND d.status = 'active'
      AND d.provider = r.provider
      AND d.resource_identity = r.resource_identity
      AND d.scopes_json = r.approved_scopes_json
      AND d.display_label_path_present = 1
      AND json_extract(d.canonical_definition_json, '$.tokenEndpointAuthMethod')
            = new.token_endpoint_auth_method
      AND (
        (new.material_origin = 'deployment-environment'
          AND r.registration_mode = 'platform-pre-registered'
          AND r.client_credential_reference IS NULL)
        OR
        (new.material_origin = 'dynamic-registration'
          AND r.registration_mode = 'dynamic'
          AND r.client_credential_reference IS NOT NULL)
        OR
        (new.material_origin = 'client-id-metadata-document'
          AND r.registration_mode = 'dynamic'
          AND r.client_credential_reference IS NOT NULL
          AND new.token_endpoint_auth_method = 'none')
      )
  );
END;

CREATE TRIGGER plugin_oauth_material_source_lifecycle
BEFORE UPDATE ON plugin_oauth_registration_material_sources
WHEN NOT (
  old.provider_registration_id IS new.provider_registration_id
  AND old.source_revision IS new.source_revision
  AND old.oauth_authority_revision IS new.oauth_authority_revision
  AND old.provider_definition_digest IS new.provider_definition_digest
  AND old.provider_definition_revision IS new.provider_definition_revision
  AND old.source_kind IS new.source_kind
  AND old.material_origin IS new.material_origin
  AND old.material_version IS new.material_version
  AND old.declaration_id IS new.declaration_id
  AND old.token_endpoint_auth_method IS new.token_endpoint_auth_method
  AND old.deployment_revision IS new.deployment_revision
  AND old.attestation_operation_id IS new.attestation_operation_id
  AND old.attested_by IS new.attested_by
  AND old.attested_at IS new.attested_at
  AND old.created_at IS new.created_at
  AND old.status = 'active'
  AND new.status = 'retired'
  AND new.updated_at >= old.updated_at
  AND new.retired_at IS NOT NULL
  AND new.retirement_reason IS NOT NULL
)
BEGIN
  SELECT RAISE(ABORT, 'OAuth material source lifecycle is invalid');
END;


CREATE TABLE managed_remote_dynamic_oauth_rebuild_fk_guard (
  valid INTEGER NOT NULL CHECK (valid = 1)
);
INSERT INTO managed_remote_dynamic_oauth_rebuild_fk_guard (valid)
SELECT 0 WHERE EXISTS (SELECT 1 FROM pragma_foreign_key_check);
DROP TABLE managed_remote_dynamic_oauth_rebuild_fk_guard;
PRAGMA defer_foreign_keys = OFF;
