-- Add provider-independent managed-remote OAuth publication authority after the immutable
-- Workspace-owned OAuth rebuild. Workspace OAuth apps remain the only credential source for
-- workspace-oauth; this table retains only generic DCR/CIMD/platform source custody.

PRAGMA defer_foreign_keys = ON;

DROP TRIGGER provider_registration_oauth_shape_insert;
DROP TRIGGER provider_registration_oauth_admission_insert;
DROP TRIGGER provider_registration_oauth_shape_update;
DROP TRIGGER provider_registration_oauth_no_upgrade;
DROP TRIGGER provider_registration_oauth_semantic_lifecycle;
DROP TRIGGER provider_registration_oauth_retained;
DROP TRIGGER plugin_version_oauth_shape_insert;
DROP TRIGGER plugin_version_oauth_publish_guard;
DROP TRIGGER plugin_oauth_connection_ready_insert;
DROP TRIGGER plugin_oauth_connection_ready_update;

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
    OR (registration_mode = 'platform-pre-registered' AND (
      client_credential_reference IS NOT NULL OR oauth_provider_definition_digest IS NOT NULL
    ))
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
SELECT provider_registration_id, provider, resource_identity, registration_mode,
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

CREATE TABLE plugin_oauth_registration_material_sources (
  provider_registration_id TEXT NOT NULL REFERENCES provider_registrations(provider_registration_id),
  source_revision INTEGER NOT NULL CHECK (source_revision >= 1),
  oauth_authority_revision INTEGER NOT NULL CHECK (oauth_authority_revision >= 1),
  provider_definition_digest TEXT NOT NULL
    REFERENCES plugin_oauth_provider_definitions(provider_definition_digest),
  provider_definition_revision INTEGER NOT NULL CHECK (provider_definition_revision >= 1),
  source_kind TEXT NOT NULL CHECK (source_kind = 'deployment-environment'),
  material_version TEXT NOT NULL CHECK (
    length(material_version) BETWEEN 1 AND 128
    AND material_version GLOB '[A-Za-z0-9]*'
    AND material_version NOT GLOB '*[^A-Za-z0-9._-]*'
  ),
  declaration_id TEXT NOT NULL CHECK (
    length(declaration_id) BETWEEN 1 AND 160
    AND declaration_id GLOB '[A-Za-z0-9]*'
    AND declaration_id NOT GLOB '*[^A-Za-z0-9._:-]*'
  ),
  token_endpoint_auth_method TEXT NOT NULL CHECK (
    token_endpoint_auth_method IN ('client_secret_post', 'client_secret_basic', 'none')
  ),
  deployment_revision TEXT NOT NULL CHECK (length(deployment_revision) BETWEEN 1 AND 200),
  status TEXT NOT NULL CHECK (status IN ('active', 'retired')),
  attestation_operation_id TEXT NOT NULL UNIQUE CHECK (length(attestation_operation_id) BETWEEN 1 AND 160),
  attested_by TEXT NOT NULL CHECK (length(attested_by) BETWEEN 1 AND 200),
  attested_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  retired_at INTEGER,
  retirement_reason TEXT CHECK (retirement_reason IS NULL OR length(retirement_reason) BETWEEN 1 AND 160),
  PRIMARY KEY (provider_registration_id, source_revision),
  UNIQUE (provider_registration_id, material_version),
  UNIQUE (provider_registration_id, declaration_id),
  CHECK (
    (status = 'active' AND retired_at IS NULL AND retirement_reason IS NULL)
    OR (status = 'retired' AND retired_at IS NOT NULL AND retirement_reason IS NOT NULL)
  )
) WITHOUT ROWID;

CREATE INDEX plugin_oauth_registration_material_sources_active
  ON plugin_oauth_registration_material_sources
    (provider_registration_id, status, source_revision, material_version);

ALTER TABLE plugin_publication_intents
  ADD COLUMN provider_registration_material_source_revision INTEGER
    CHECK (provider_registration_material_source_revision IS NULL
      OR provider_registration_material_source_revision >= 1);

ALTER TABLE plugin_oauth_runtime_attempts ADD COLUMN material_source_revision INTEGER
  CHECK (material_source_revision IS NULL OR material_source_revision >= 1);
ALTER TABLE plugin_oauth_runtime_attempts ADD COLUMN material_version TEXT;
ALTER TABLE plugin_oauth_runtime_attempts ADD COLUMN declaration_id TEXT;
ALTER TABLE plugin_oauth_runtime_attempts ADD COLUMN deployment_revision TEXT;

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
  WHERE new.source <> 'platform' OR new.status <> 'active' OR new.oauth_authority_revision <> 1
    OR new.client_credential_reference IS NOT NULL
    OR new.registration_mode NOT IN ('workspace-oauth-app', 'platform-pre-registered')
    OR (new.registration_mode = 'workspace-oauth-app' AND (
      new.authorization_metadata_url IS NOT NULL OR new.authorization_endpoint IS NOT NULL
      OR new.token_endpoint IS NOT NULL OR new.registration_endpoint IS NOT NULL
      OR new.userinfo_endpoint IS NOT NULL OR new.revocation_endpoint IS NOT NULL
      OR new.metadata_digest IS NOT NULL OR new.dynamic_registration_claim IS NOT NULL
      OR new.dynamic_registration_claimed_at IS NOT NULL))
    OR NOT EXISTS (
      SELECT 1 FROM plugin_oauth_provider_definitions d
      WHERE d.provider_definition_digest = new.oauth_provider_definition_digest
        AND d.revision = new.oauth_provider_definition_revision AND d.status = 'active'
        AND d.provider = new.provider AND d.resource_identity = new.resource_identity
        AND d.scopes_json = new.approved_scopes_json AND d.display_label_path_present = 1
        AND (new.registration_mode <> 'workspace-oauth-app'
          OR json_extract(d.canonical_definition_json, '$.tokenEndpointAuthMethod')
            IN ('client_secret_post', 'client_secret_basic'))
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
    OR new.oauth_provider_definition_revision IS NOT NULL OR new.oauth_authority_revision IS NOT NULL)
BEGIN
  SELECT RAISE(ABORT, 'Legacy Provider Registration cannot become generic OAuth')
  WHERE NOT (
    old.registration_mode = 'dynamic' AND old.source = 'platform' AND old.status = 'active'
    AND old.oauth_provider_definition_digest IS NULL
    AND old.oauth_provider_definition_revision IS NULL AND old.oauth_authority_revision IS NULL
    AND old.client_credential_reference IS NULL
    AND new.registration_mode = 'dynamic' AND new.source = 'platform' AND new.status = 'active'
    AND new.oauth_provider_definition_digest IS NOT NULL
    AND new.oauth_provider_definition_revision IS NOT NULL AND new.oauth_authority_revision = 1
    AND new.client_credential_reference IS NOT NULL
    AND new.authorization_endpoint IS NOT NULL AND new.token_endpoint IS NOT NULL
    AND new.metadata_digest IS NOT NULL AND new.dynamic_registration_claim IS NULL
    AND new.dynamic_registration_claimed_at IS NULL
    AND EXISTS (
      SELECT 1 FROM plugin_oauth_provider_definitions d
      WHERE d.provider_definition_digest = new.oauth_provider_definition_digest
        AND d.revision = new.oauth_provider_definition_revision AND d.status = 'active'
        AND d.provider = new.provider AND d.resource_identity = new.resource_identity
        AND d.scopes_json = new.approved_scopes_json AND d.display_label_path_present = 1
        AND (new.registration_endpoint IS NOT NULL
          OR json_extract(d.canonical_definition_json, '$.tokenEndpointAuthMethod') = 'none')
    )
  );
END;

CREATE TRIGGER provider_registration_oauth_semantic_lifecycle
BEFORE UPDATE ON provider_registrations
WHEN old.oauth_provider_definition_digest IS NOT NULL AND NOT (
  old.provider IS new.provider AND old.resource_identity IS new.resource_identity
  AND old.registration_mode IS new.registration_mode
  AND old.authorization_metadata_url IS new.authorization_metadata_url
  AND old.authorization_endpoint IS new.authorization_endpoint
  AND old.token_endpoint IS new.token_endpoint AND old.registration_endpoint IS new.registration_endpoint
  AND old.userinfo_endpoint IS new.userinfo_endpoint AND old.revocation_endpoint IS new.revocation_endpoint
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

CREATE TRIGGER plugin_oauth_material_source_admission
BEFORE INSERT ON plugin_oauth_registration_material_sources
BEGIN
  SELECT RAISE(ABORT, 'OAuth material source revision is stale')
  WHERE new.source_revision <> COALESCE((SELECT MAX(s.source_revision) + 1
    FROM plugin_oauth_registration_material_sources s
    WHERE s.provider_registration_id = new.provider_registration_id), 1);
  SELECT RAISE(ABORT, 'OAuth material source authority is invalid')
  WHERE NOT EXISTS (
    SELECT 1 FROM provider_registrations r
    JOIN plugin_oauth_provider_definitions d
      ON d.provider_definition_digest = r.oauth_provider_definition_digest
     AND d.revision = r.oauth_provider_definition_revision
    WHERE r.provider_registration_id = new.provider_registration_id AND r.status = 'active'
      AND r.source = 'platform' AND r.oauth_authority_revision = new.oauth_authority_revision
      AND r.oauth_provider_definition_digest = new.provider_definition_digest
      AND r.oauth_provider_definition_revision = new.provider_definition_revision
      AND d.status = 'active' AND d.provider = r.provider AND d.resource_identity = r.resource_identity
      AND d.scopes_json = r.approved_scopes_json AND d.display_label_path_present = 1
      AND json_extract(d.canonical_definition_json, '$.tokenEndpointAuthMethod') = new.token_endpoint_auth_method
      AND r.registration_mode IN ('dynamic', 'platform-pre-registered')
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
  AND old.source_kind IS new.source_kind AND old.material_version IS new.material_version
  AND old.declaration_id IS new.declaration_id
  AND old.token_endpoint_auth_method IS new.token_endpoint_auth_method
  AND old.deployment_revision IS new.deployment_revision
  AND old.attestation_operation_id IS new.attestation_operation_id
  AND old.attested_by IS new.attested_by AND old.attested_at IS new.attested_at
  AND old.created_at IS new.created_at AND old.status = 'active' AND new.status = 'retired'
  AND new.updated_at >= old.updated_at AND new.retired_at IS NOT NULL
  AND new.retirement_reason IS NOT NULL
)
BEGIN SELECT RAISE(ABORT, 'OAuth material source lifecycle is invalid'); END;

CREATE TRIGGER plugin_oauth_material_source_retained
BEFORE DELETE ON plugin_oauth_registration_material_sources
BEGIN SELECT RAISE(ABORT, 'OAuth material sources are retained'); END;

CREATE TRIGGER provider_registration_oauth_terminalizes_material_sources
AFTER UPDATE OF status ON provider_registrations
WHEN old.oauth_provider_definition_digest IS NOT NULL AND old.status = 'active'
  AND new.status IN ('reauthorization-required', 'revoked')
BEGIN
  UPDATE plugin_oauth_registration_material_sources
  SET status = 'retired', updated_at = new.updated_at, retired_at = new.updated_at,
      retirement_reason = 'parent-authority-terminalized'
  WHERE provider_registration_id = new.provider_registration_id AND status = 'active';
END;

CREATE TRIGGER plugin_oauth_definition_terminalizes_material_sources
AFTER UPDATE OF status ON plugin_oauth_provider_definitions
WHEN old.status = 'active' AND new.status = 'revoked'
BEGIN
  UPDATE plugin_oauth_registration_material_sources
  SET status = 'retired', updated_at = new.updated_at, retired_at = new.updated_at,
      retirement_reason = 'provider-definition-revoked'
  WHERE provider_definition_digest = new.provider_definition_digest AND status = 'active';
END;

CREATE TRIGGER plugin_version_oauth_shape_insert
BEFORE INSERT ON plugin_versions
BEGIN
  SELECT RAISE(ABORT, 'Plugin version OAuth authority shape is invalid') WHERE NOT (
    (new.authentication_kind = 'oauth' AND new.provider_registration_id IS NOT NULL
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
  WHERE new.provider_definition_digest IS NOT NULL AND NOT EXISTS (
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

CREATE TRIGGER plugin_publication_intent_oauth_source_insert
BEFORE INSERT ON plugin_publication_intents
BEGIN
  SELECT RAISE(ABORT, 'Plugin publication intent OAuth source shape is invalid') WHERE NOT (
    (new.provider_registration_material_source_revision IS NULL AND EXISTS (
      SELECT 1 FROM plugin_versions v LEFT JOIN provider_registrations r
        ON r.provider_registration_id = v.provider_registration_id
      WHERE v.plugin_version_id = new.plugin_version_id
        AND (v.authentication_kind <> 'oauth'
          OR r.registration_mode IN ('workspace-oauth-app', 'dynamic'))))
    OR (new.provider_registration_material_source_revision IS NOT NULL AND EXISTS (
      SELECT 1 FROM plugin_versions v JOIN provider_registrations r
        ON r.provider_registration_id = v.provider_registration_id
      JOIN plugin_oauth_registration_material_sources s
        ON s.provider_registration_id = r.provider_registration_id
      WHERE v.plugin_version_id = new.plugin_version_id AND v.authentication_kind = 'oauth'
        AND r.registration_mode = 'platform-pre-registered' AND r.status = 'active'
        AND s.source_revision = new.provider_registration_material_source_revision
        AND s.status = 'active'))
  );
END;

CREATE TRIGGER plugin_version_oauth_publish_guard
BEFORE UPDATE OF status ON plugin_versions
WHEN old.provider_definition_digest IS NOT NULL AND old.status = 'publishing' AND new.status = 'published'
BEGIN
  SELECT RAISE(ABORT, 'Plugin version OAuth publication authority is unavailable')
  WHERE NOT EXISTS (
    SELECT 1 FROM provider_registrations r
    JOIN plugin_oauth_provider_definitions d
      ON d.provider_definition_digest = old.provider_definition_digest
     AND d.revision = old.provider_definition_revision
    JOIN plugin_publication_intents i ON i.plugin_version_id = old.plugin_version_id
    WHERE r.provider_registration_id = old.provider_registration_id AND r.status = 'active'
      AND r.source = 'platform' AND r.provider = d.provider AND r.resource_identity = d.resource_identity
      AND r.approved_scopes_json = old.requested_scopes_json AND d.scopes_json = old.requested_scopes_json
      AND d.status = 'active' AND d.display_label_path_present = 1
      AND ((r.registration_mode = 'workspace-oauth-app'
          AND r.oauth_authority_revision = old.provider_registration_authority_revision
          AND i.provider_registration_material_source_revision IS NULL)
        OR (r.registration_mode = 'dynamic' AND old.provider_registration_authority_revision IS NULL
          AND i.provider_registration_material_source_revision IS NULL)
        OR (r.registration_mode = 'platform-pre-registered'
          AND r.oauth_authority_revision = old.provider_registration_authority_revision
          AND EXISTS (SELECT 1 FROM plugin_oauth_registration_material_sources s
            WHERE s.provider_registration_id = r.provider_registration_id
              AND s.source_revision = i.provider_registration_material_source_revision
              AND s.status = 'active')))
  );
END;

CREATE TABLE managed_remote_oauth_rebuild_fk_guard (
  valid INTEGER NOT NULL CHECK (valid = 1)
);

INSERT INTO managed_remote_oauth_rebuild_fk_guard (valid)
SELECT 0 WHERE EXISTS (SELECT 1 FROM pragma_foreign_key_check);

DROP TABLE managed_remote_oauth_rebuild_fk_guard;

PRAGMA defer_foreign_keys = OFF;
