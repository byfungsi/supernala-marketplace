CREATE TABLE plugin_oauth_provider_definitions (
  provider_definition_digest TEXT PRIMARY KEY NOT NULL
    CHECK (
      length(provider_definition_digest) = 64
      AND provider_definition_digest NOT GLOB '*[^0-9a-f]*'
    ),
  schema_version INTEGER NOT NULL CHECK (schema_version = 1),
  canonical_definition_json TEXT NOT NULL
    CHECK (
      length(CAST(canonical_definition_json AS BLOB)) BETWEEN 1 AND 65536
      AND json_valid(canonical_definition_json)
    ),
  scopes_json TEXT NOT NULL CHECK (json_valid(scopes_json)),
  provider TEXT NOT NULL CHECK (length(provider) BETWEEN 1 AND 200),
  resource_identity TEXT NOT NULL CHECK (length(resource_identity) BETWEEN 1 AND 200),
  display_label_path_present INTEGER NOT NULL CHECK (display_label_path_present = 1),
  status TEXT NOT NULL CHECK (status IN ('active', 'revoked')),
  revision INTEGER NOT NULL CHECK (revision >= 1),
  admission_operation_id TEXT NOT NULL UNIQUE
    CHECK (length(admission_operation_id) BETWEEN 1 AND 160),
  admitted_by TEXT NOT NULL CHECK (length(admitted_by) BETWEEN 1 AND 200),
  source_kind TEXT NOT NULL CHECK (source_kind = 'marketplace-release'),
  source_repository TEXT NOT NULL CHECK (length(source_repository) BETWEEN 1 AND 240),
  source_revision TEXT NOT NULL CHECK (length(source_revision) BETWEEN 1 AND 200),
  source_path TEXT NOT NULL CHECK (length(source_path) BETWEEN 1 AND 1000),
  source_content_digest TEXT NOT NULL
    CHECK (
      length(source_content_digest) = 64
      AND source_content_digest NOT GLOB '*[^0-9a-f]*'
    ),
  reviewed_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  revoked_at INTEGER,
  revocation_operation_id TEXT UNIQUE
    CHECK (
      revocation_operation_id IS NULL
      OR length(revocation_operation_id) BETWEEN 1 AND 160
    ),
  revoked_by TEXT CHECK (revoked_by IS NULL OR length(revoked_by) BETWEEN 1 AND 200),
  revocation_reason TEXT
    CHECK (revocation_reason IS NULL OR length(revocation_reason) BETWEEN 1 AND 160),
  CHECK (
    (status = 'active'
      AND revision = 1
      AND revoked_at IS NULL
      AND revocation_operation_id IS NULL
      AND revoked_by IS NULL
      AND revocation_reason IS NULL)
    OR
    (status = 'revoked'
      AND revision = 2
      AND revoked_at IS NOT NULL
      AND revocation_operation_id IS NOT NULL
      AND revoked_by IS NOT NULL
      AND revocation_reason IS NOT NULL)
  )
) WITHOUT ROWID;

CREATE UNIQUE INDEX plugin_oauth_provider_definitions_digest_revision
  ON plugin_oauth_provider_definitions (provider_definition_digest, revision);

CREATE INDEX plugin_oauth_provider_definitions_active_identity
  ON plugin_oauth_provider_definitions
    (status, provider, resource_identity, provider_definition_digest);

ALTER TABLE provider_registrations
  ADD COLUMN oauth_provider_definition_digest TEXT
    REFERENCES plugin_oauth_provider_definitions(provider_definition_digest);

ALTER TABLE provider_registrations
  ADD COLUMN oauth_provider_definition_revision INTEGER
    CHECK (
      oauth_provider_definition_revision IS NULL
      OR oauth_provider_definition_revision >= 1
    );

ALTER TABLE provider_registrations
  ADD COLUMN oauth_authority_revision INTEGER
    CHECK (oauth_authority_revision IS NULL OR oauth_authority_revision >= 1);

ALTER TABLE plugin_versions
  ADD COLUMN provider_registration_authority_revision INTEGER
    CHECK (
      provider_registration_authority_revision IS NULL
      OR provider_registration_authority_revision >= 1
    );

ALTER TABLE plugin_versions
  ADD COLUMN provider_definition_digest TEXT
    REFERENCES plugin_oauth_provider_definitions(provider_definition_digest);

ALTER TABLE plugin_versions
  ADD COLUMN provider_definition_revision INTEGER
    CHECK (provider_definition_revision IS NULL OR provider_definition_revision >= 1);

CREATE INDEX provider_registrations_oauth_authority
  ON provider_registrations
    (oauth_provider_definition_digest, oauth_provider_definition_revision,
     oauth_authority_revision, status);

CREATE INDEX plugin_versions_oauth_definition_authority
  ON plugin_versions
    (provider_definition_digest, provider_definition_revision, status, review_status);

CREATE INDEX plugin_versions_oauth_registration_authority
  ON plugin_versions
    (provider_registration_id, provider_registration_authority_revision);

CREATE TRIGGER plugin_oauth_definition_immutable
BEFORE UPDATE ON plugin_oauth_provider_definitions
WHEN
  old.provider_definition_digest IS NOT new.provider_definition_digest
  OR old.schema_version IS NOT new.schema_version
  OR old.canonical_definition_json IS NOT new.canonical_definition_json
  OR old.scopes_json IS NOT new.scopes_json
  OR old.provider IS NOT new.provider
  OR old.resource_identity IS NOT new.resource_identity
  OR old.display_label_path_present IS NOT new.display_label_path_present
  OR old.admission_operation_id IS NOT new.admission_operation_id
  OR old.admitted_by IS NOT new.admitted_by
  OR old.source_kind IS NOT new.source_kind
  OR old.source_repository IS NOT new.source_repository
  OR old.source_revision IS NOT new.source_revision
  OR old.source_path IS NOT new.source_path
  OR old.source_content_digest IS NOT new.source_content_digest
  OR old.reviewed_at IS NOT new.reviewed_at
  OR old.created_at IS NOT new.created_at
BEGIN
  SELECT RAISE(ABORT, 'OAuth provider definition identity is immutable');
END;

CREATE TRIGGER plugin_oauth_definition_lifecycle
BEFORE UPDATE ON plugin_oauth_provider_definitions
WHEN NOT (
  old.status = 'active'
  AND new.status = 'revoked'
  AND new.revision = old.revision + 1
  AND new.updated_at >= old.updated_at
  AND new.revoked_at IS NOT NULL
  AND new.revocation_operation_id IS NOT NULL
  AND new.revoked_by IS NOT NULL
  AND new.revocation_reason IS NOT NULL
)
BEGIN
  SELECT RAISE(ABORT, 'OAuth provider definition lifecycle transition is invalid');
END;

CREATE TRIGGER plugin_oauth_definition_retained
BEFORE DELETE ON plugin_oauth_provider_definitions
BEGIN
  SELECT RAISE(ABORT, 'OAuth provider definitions are retained');
END;

CREATE TRIGGER provider_registration_oauth_shape_insert
BEFORE INSERT ON provider_registrations
WHEN NOT (
  (new.oauth_provider_definition_digest IS NULL
    AND new.oauth_provider_definition_revision IS NULL
    AND new.oauth_authority_revision IS NULL)
  OR
  (new.oauth_provider_definition_digest IS NOT NULL
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
  WHERE
    new.registration_mode <> 'platform-pre-registered'
    OR new.source <> 'platform'
    OR new.status <> 'active'
    OR new.oauth_authority_revision <> 1
    OR new.authorization_metadata_url IS NOT NULL
    OR new.authorization_endpoint IS NOT NULL
    OR new.token_endpoint IS NOT NULL
    OR new.registration_endpoint IS NOT NULL
    OR new.userinfo_endpoint IS NOT NULL
    OR new.revocation_endpoint IS NOT NULL
    OR new.metadata_digest IS NOT NULL
    OR new.dynamic_registration_claim IS NOT NULL
    OR new.dynamic_registration_claimed_at IS NOT NULL
    OR new.client_credential_reference IS NULL
    OR length(new.client_credential_reference) = 0
    OR NOT EXISTS (
      SELECT 1
      FROM plugin_oauth_provider_definitions d
      WHERE d.provider_definition_digest = new.oauth_provider_definition_digest
        AND d.revision = new.oauth_provider_definition_revision
        AND d.status = 'active'
        AND d.provider = new.provider
        AND d.resource_identity = new.resource_identity
        AND d.scopes_json = new.approved_scopes_json
        AND d.display_label_path_present = 1
    );
END;

CREATE TRIGGER provider_registration_oauth_shape_update
BEFORE UPDATE ON provider_registrations
WHEN NOT (
  (new.oauth_provider_definition_digest IS NULL
    AND new.oauth_provider_definition_revision IS NULL
    AND new.oauth_authority_revision IS NULL)
  OR
  (new.oauth_provider_definition_digest IS NOT NULL
    AND new.oauth_provider_definition_revision IS NOT NULL
    AND new.oauth_authority_revision IS NOT NULL)
)
BEGIN
  SELECT RAISE(ABORT, 'OAuth Provider Registration binding is partial');
END;

CREATE TRIGGER provider_registration_oauth_no_upgrade
BEFORE UPDATE ON provider_registrations
WHEN
  old.oauth_provider_definition_digest IS NULL
  AND (
    new.oauth_provider_definition_digest IS NOT NULL
    OR new.oauth_provider_definition_revision IS NOT NULL
    OR new.oauth_authority_revision IS NOT NULL
  )
BEGIN
  SELECT RAISE(ABORT, 'Legacy Provider Registration cannot become generic OAuth');
END;

CREATE TRIGGER provider_registration_oauth_semantic_lifecycle
BEFORE UPDATE ON provider_registrations
WHEN old.oauth_provider_definition_digest IS NOT NULL AND NOT (
  old.provider IS new.provider
  AND old.resource_identity IS new.resource_identity
  AND old.registration_mode IS new.registration_mode
  AND old.authorization_metadata_url IS new.authorization_metadata_url
  AND old.authorization_endpoint IS new.authorization_endpoint
  AND old.token_endpoint IS new.token_endpoint
  AND old.registration_endpoint IS new.registration_endpoint
  AND old.userinfo_endpoint IS new.userinfo_endpoint
  AND old.revocation_endpoint IS new.revocation_endpoint
  AND old.metadata_digest IS new.metadata_digest
  AND old.callback_url IS new.callback_url
  AND old.approved_scopes_json IS new.approved_scopes_json
  AND old.dynamic_registration_claim IS new.dynamic_registration_claim
  AND old.dynamic_registration_claimed_at IS new.dynamic_registration_claimed_at
  AND old.source IS new.source
  AND old.oauth_provider_definition_digest IS new.oauth_provider_definition_digest
  AND old.oauth_provider_definition_revision IS new.oauth_provider_definition_revision
  AND (
    (new.status IS old.status
      AND new.oauth_authority_revision IS old.oauth_authority_revision)
    OR
    (old.status = 'active'
      AND new.status IN ('reauthorization-required', 'revoked')
      AND new.oauth_authority_revision IS old.oauth_authority_revision + 1)
    OR
    (old.status = 'reauthorization-required'
      AND new.status = 'revoked'
      AND new.oauth_authority_revision IS old.oauth_authority_revision + 1)
  )
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
    (new.runtime_kind = 'managed-package'
      AND new.authentication_kind = 'oauth'
      AND new.provider_registration_id IS NOT NULL
      AND new.provider_registration_authority_revision IS NOT NULL
      AND new.provider_definition_digest IS NOT NULL
      AND new.provider_definition_revision IS NOT NULL
      AND new.requested_scopes_json <> '[]')
    OR
    (NOT (new.runtime_kind = 'managed-package' AND new.authentication_kind = 'oauth')
      AND new.provider_registration_authority_revision IS NULL
      AND new.provider_definition_digest IS NULL
      AND new.provider_definition_revision IS NULL)
  );

  SELECT RAISE(ABORT, 'Plugin version OAuth publication authority is invalid')
  WHERE
    new.provider_definition_digest IS NOT NULL
    AND NOT EXISTS (
      SELECT 1
      FROM provider_registrations r
      JOIN plugin_oauth_provider_definitions d
        ON d.provider_definition_digest = r.oauth_provider_definition_digest
       AND d.revision = r.oauth_provider_definition_revision
      WHERE r.provider_registration_id = new.provider_registration_id
        AND r.oauth_authority_revision = new.provider_registration_authority_revision
        AND r.status = 'active'
        AND r.registration_mode = 'platform-pre-registered'
        AND r.source = 'platform'
        AND r.oauth_provider_definition_digest = new.provider_definition_digest
        AND r.oauth_provider_definition_revision = new.provider_definition_revision
        AND r.approved_scopes_json = new.requested_scopes_json
        AND r.client_credential_reference IS NOT NULL
        AND length(r.client_credential_reference) > 0
        AND d.status = 'active'
        AND d.provider = r.provider
        AND d.resource_identity = r.resource_identity
        AND d.scopes_json = new.requested_scopes_json
        AND d.display_label_path_present = 1
    );
END;

CREATE TRIGGER plugin_version_auth_authority_immutable
BEFORE UPDATE ON plugin_versions
WHEN
  old.runtime_kind IS NOT new.runtime_kind
  OR old.authentication_kind IS NOT new.authentication_kind
  OR old.provider_registration_id IS NOT new.provider_registration_id
  OR old.requested_scopes_json IS NOT new.requested_scopes_json
  OR old.provider_registration_authority_revision
       IS NOT new.provider_registration_authority_revision
  OR old.provider_definition_digest IS NOT new.provider_definition_digest
  OR old.provider_definition_revision IS NOT new.provider_definition_revision
BEGIN
  SELECT RAISE(ABORT, 'Plugin version authentication authority is immutable');
END;

CREATE TRIGGER plugin_version_oauth_publish_guard
BEFORE UPDATE OF status ON plugin_versions
WHEN
  old.provider_definition_digest IS NOT NULL
  AND old.status = 'publishing'
  AND new.status = 'published'
BEGIN
  SELECT RAISE(ABORT, 'Plugin version OAuth publication authority is unavailable')
  WHERE NOT EXISTS (
    SELECT 1
    FROM provider_registrations r
    JOIN plugin_oauth_provider_definitions d
      ON d.provider_definition_digest = r.oauth_provider_definition_digest
     AND d.revision = r.oauth_provider_definition_revision
    WHERE r.provider_registration_id = old.provider_registration_id
      AND r.oauth_authority_revision = old.provider_registration_authority_revision
      AND r.status = 'active'
      AND r.oauth_provider_definition_digest = old.provider_definition_digest
      AND r.oauth_provider_definition_revision = old.provider_definition_revision
      AND r.approved_scopes_json = old.requested_scopes_json
      AND r.client_credential_reference IS NOT NULL
      AND length(r.client_credential_reference) > 0
      AND d.status = 'active'
      AND d.provider = r.provider
      AND d.resource_identity = r.resource_identity
      AND d.scopes_json = old.requested_scopes_json
      AND d.display_label_path_present = 1
  );
END;
