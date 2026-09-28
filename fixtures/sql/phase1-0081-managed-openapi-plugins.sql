-- Rebuild the version table to admit digest-pinned declarative HTTP artifacts.
-- Existing rows retain every column and foreign-key identity in the same order.
PRAGMA defer_foreign_keys = ON;

-- Recreate unchanged cross-table triggers after rebuilding their referenced table.
DROP TRIGGER plugin_installation_requires_published_version;
DROP TRIGGER plugin_default_grants_after_ready_connection_insert;
DROP TRIGGER plugin_default_grants_after_connection_ready;
DROP TRIGGER plugin_default_grants_after_agent_insert;
DROP TRIGGER plugin_publication_intent_oauth_source_insert;
DROP TRIGGER plugin_oauth_connection_ready_insert;
DROP TRIGGER plugin_oauth_connection_ready_update;

CREATE TABLE plugin_versions_next (
  plugin_version_id TEXT PRIMARY KEY NOT NULL,
  plugin_definition_id TEXT NOT NULL REFERENCES plugin_definitions(plugin_definition_id),
  semantic_version TEXT NOT NULL,
  manifest_digest TEXT NOT NULL CHECK (length(manifest_digest) = 64),
  catalog_snapshot_id TEXT NOT NULL REFERENCES plugin_catalog_snapshots(catalog_snapshot_id),
  config_schema_id TEXT NOT NULL REFERENCES plugin_config_schemas(config_schema_id),
  runtime_kind TEXT NOT NULL CHECK (runtime_kind IN ('managed-package', 'managed-remote-mcp', 'managed-openapi')),
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
  provider_registration_authority_revision INTEGER CHECK (
    provider_registration_authority_revision IS NULL OR provider_registration_authority_revision >= 1),
  provider_definition_digest TEXT REFERENCES plugin_oauth_provider_definitions(provider_definition_digest),
  provider_definition_revision INTEGER CHECK (provider_definition_revision IS NULL OR provider_definition_revision >= 1),
  auth_profile TEXT CHECK (auth_profile IS NULL OR auth_profile IN ('workspace-oauth', 'mcp-oauth', 'api-key', 'device-oauth')),
  auth_definition_digest TEXT REFERENCES plugin_auth_strategy_definitions(auth_definition_digest),
  auth_definition_revision INTEGER CHECK (auth_definition_revision IS NULL OR auth_definition_revision >= 1),
  UNIQUE (plugin_definition_id, semantic_version),
  CHECK (
    (runtime_kind = 'managed-package' AND artifact_digest IS NOT NULL
      AND package_entrypoint IS NOT NULL AND package_node_version = '22.x'
      AND endpoint_registration_id IS NULL)
    OR (runtime_kind = 'managed-remote-mcp' AND artifact_digest IS NULL
      AND package_entrypoint IS NULL AND package_node_version IS NULL
      AND endpoint_registration_id IS NOT NULL AND provider_registration_id IS NOT NULL)
    OR (runtime_kind = 'managed-openapi' AND artifact_digest IS NOT NULL
      AND manifest_digest = artifact_digest
      AND package_entrypoint IS NULL AND package_node_version IS NULL
      AND endpoint_registration_id IS NULL AND provider_registration_id IS NOT NULL
      AND authentication_kind = 'none' AND auth_profile IS NOT NULL AND auth_profile = 'api-key'
      AND auth_definition_digest IS NOT NULL AND auth_definition_revision IS NOT NULL)
  ),
  CHECK (
    (status = 'publishing' AND published_at IS NULL AND revoked_at IS NULL)
    OR (status = 'published' AND review_status = 'approved' AND published_at IS NOT NULL AND revoked_at IS NULL)
    OR (status = 'revoked' AND published_at IS NOT NULL AND revoked_at IS NOT NULL)
  )
) WITHOUT ROWID;

INSERT INTO plugin_versions_next SELECT * FROM plugin_versions;
DROP TABLE plugin_versions;
ALTER TABLE plugin_versions_next RENAME TO plugin_versions;

CREATE INDEX plugin_versions_installable
  ON plugin_versions (plugin_definition_id, status, release_date DESC);

CREATE INDEX plugin_versions_oauth_definition_authority
  ON plugin_versions
    (provider_definition_digest, provider_definition_revision, status, review_status);

CREATE INDEX plugin_versions_oauth_registration_authority
  ON plugin_versions
    (provider_registration_id, provider_registration_authority_revision);

CREATE TRIGGER plugin_version_immutable_after_publication
BEFORE UPDATE ON plugin_versions
WHEN old.status IN ('published', 'revoked') AND (
  old.plugin_definition_id <> new.plugin_definition_id OR old.semantic_version <> new.semantic_version
  OR old.manifest_digest <> new.manifest_digest OR old.catalog_snapshot_id <> new.catalog_snapshot_id
  OR old.config_schema_id <> new.config_schema_id OR old.runtime_kind <> new.runtime_kind
  OR COALESCE(old.artifact_digest, '') <> COALESCE(new.artifact_digest, '')
  OR COALESCE(old.endpoint_registration_id, '') <> COALESCE(new.endpoint_registration_id, '')
)
BEGIN SELECT RAISE(ABORT, 'published Plugin version authority is immutable'); END;

CREATE TRIGGER plugin_version_auth_authority_immutable
BEFORE UPDATE ON plugin_versions
WHEN old.runtime_kind IS NOT new.runtime_kind
  OR old.authentication_kind IS NOT new.authentication_kind
  OR old.provider_registration_id IS NOT new.provider_registration_id
  OR old.requested_scopes_json IS NOT new.requested_scopes_json
  OR old.provider_registration_authority_revision IS NOT new.provider_registration_authority_revision
  OR old.provider_definition_digest IS NOT new.provider_definition_digest
  OR old.provider_definition_revision IS NOT new.provider_definition_revision
BEGIN SELECT RAISE(ABORT, 'Plugin version authentication authority is immutable'); END;

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

CREATE TRIGGER plugin_version_oauth_shape_insert
BEFORE INSERT ON plugin_versions
BEGIN
  SELECT RAISE(ABORT, 'Plugin version OAuth authority shape is invalid') WHERE NOT (
    (new.auth_profile = 'device-oauth' AND new.authentication_kind = 'oauth'
      AND new.provider_registration_id IS NOT NULL
      AND new.provider_registration_authority_revision IS NOT NULL
      AND new.provider_definition_digest IS NOT NULL AND new.provider_definition_revision IS NOT NULL)
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

CREATE TRIGGER plugin_version_auth_strategy_shape_insert
BEFORE INSERT ON plugin_versions
WHEN new.auth_profile IS NOT NULL
BEGIN
  SELECT RAISE(ABORT, 'Plugin version authentication strategy authority is invalid')
  WHERE new.auth_definition_digest IS NULL OR new.auth_definition_revision IS NULL
    OR NOT EXISTS (SELECT 1 FROM plugin_auth_strategy_definitions definition
      WHERE definition.auth_definition_digest = new.auth_definition_digest
        AND definition.revision = new.auth_definition_revision
        AND definition.profile = new.auth_profile AND definition.status = 'active');
  SELECT RAISE(ABORT, 'Plugin version authentication profile is incompatible')
  WHERE NOT ((new.auth_profile IN ('workspace-oauth', 'mcp-oauth', 'device-oauth')
    AND new.authentication_kind = 'oauth')
    OR (new.auth_profile = 'api-key' AND new.authentication_kind = 'none'));
END;

CREATE TRIGGER plugin_version_auth_strategy_immutable
BEFORE UPDATE ON plugin_versions
WHEN old.status IN ('published', 'revoked') AND (
  old.auth_profile IS NOT new.auth_profile
  OR old.auth_definition_digest IS NOT new.auth_definition_digest
  OR old.auth_definition_revision IS NOT new.auth_definition_revision)
BEGIN SELECT RAISE(ABORT, 'Published Plugin authentication strategy is immutable'); END;

CREATE TRIGGER plugin_openapi_version_authority_immutable
BEFORE UPDATE ON plugin_versions
WHEN old.runtime_kind = 'managed-openapi' AND old.status IN ('published', 'revoked') AND (
  old.manifest_digest IS NOT new.manifest_digest
  OR old.artifact_digest IS NOT new.artifact_digest
  OR old.catalog_snapshot_id IS NOT new.catalog_snapshot_id
  OR old.config_schema_id IS NOT new.config_schema_id
  OR old.provider_registration_id IS NOT new.provider_registration_id
  OR old.auth_definition_digest IS NOT new.auth_definition_digest
  OR old.auth_definition_revision IS NOT new.auth_definition_revision
  OR old.allowed_hosts_json IS NOT new.allowed_hosts_json
  OR old.provenance_json IS NOT new.provenance_json
  OR old.requested_scopes_json IS NOT new.requested_scopes_json
)
BEGIN SELECT RAISE(ABORT, 'Published OpenAPI Plugin authority is immutable'); END;

CREATE TRIGGER plugin_openapi_version_auth_identity_insert
BEFORE INSERT ON plugin_versions
WHEN new.runtime_kind = 'managed-openapi'
BEGIN
  SELECT RAISE(ABORT, 'OpenAPI Plugin authentication provider is incompatible')
  WHERE NOT EXISTS (
    SELECT 1 FROM plugin_auth_strategy_definitions definition
    JOIN provider_registrations registration
      ON registration.provider_registration_id = new.provider_registration_id
    WHERE definition.auth_definition_digest = new.auth_definition_digest
      AND definition.revision = new.auth_definition_revision
      AND definition.profile = 'api-key' AND definition.status = 'active'
      AND json_extract(definition.canonical_definition_json, '$.providerRegistrationId') = new.provider_registration_id
      AND registration.status = 'active'
  );
END;

CREATE TRIGGER plugin_openapi_version_requires_staging
BEFORE INSERT ON plugin_versions
WHEN new.runtime_kind = 'managed-openapi' AND new.status <> 'publishing'
BEGIN SELECT RAISE(ABORT, 'OpenAPI Plugin version must be staged before publication'); END;

CREATE TRIGGER plugin_openapi_version_publish_guard
BEFORE UPDATE OF status ON plugin_versions
WHEN old.runtime_kind = 'managed-openapi'
  AND old.status = 'publishing' AND new.status = 'published'
BEGIN
  SELECT RAISE(ABORT, 'OpenAPI Plugin publication authority is unavailable')
  WHERE NOT (
    new.auth_profile IS 'api-key'
    AND new.auth_definition_digest IS NOT NULL AND new.auth_definition_revision IS NOT NULL
    AND new.artifact_digest IS NOT NULL AND new.manifest_digest IS new.artifact_digest
    AND new.provider_registration_id IS NOT NULL
    AND EXISTS (
      SELECT 1 FROM plugin_auth_strategy_definitions definition
      JOIN provider_registrations registration
        ON registration.provider_registration_id = new.provider_registration_id
      JOIN plugin_artifacts artifact ON artifact.artifact_digest = new.artifact_digest
      JOIN plugin_publication_intents intent
        ON intent.plugin_version_id = new.plugin_version_id
       AND intent.artifact_digest = new.artifact_digest
      WHERE definition.auth_definition_digest = new.auth_definition_digest
        AND definition.revision = new.auth_definition_revision
        AND definition.profile = 'api-key' AND definition.status = 'active'
        AND json_extract(definition.canonical_definition_json, '$.providerRegistrationId') = new.provider_registration_id
        AND registration.status = 'active' AND artifact.status = 'available'
        AND artifact.verified_at IS NOT NULL AND intent.status = 'artifact-verified'
    )
  );
END;

-- Byte-identical definitions from the pre-migration schema.
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

CREATE TRIGGER plugin_default_grants_after_ready_connection_insert
AFTER INSERT ON plugin_connections
WHEN new.status = 'ready'
BEGIN
  INSERT OR IGNORE INTO agent_plugin_grants
    (grant_id, workspace_id, agent_id, connection_id, catalog_snapshot_id,
     status, revision, client_operation_id, granted_at, revoked_at, updated_at)
  SELECT
    'default-grant:' || profile.agent_id || ':' || new.connection_id,
    activation.workspace_id,
    profile.agent_id,
    new.connection_id,
    version.catalog_snapshot_id,
    'active', 1,
    'default-grant:' || profile.agent_id || ':' || new.connection_id,
    MAX(profile.created_at, new.created_at), NULL,
    MAX(profile.created_at, new.created_at)
  FROM workspace_plugin_activations activation
  JOIN plugin_installations installation
    ON installation.installation_id = activation.installation_id
  JOIN plugin_versions version
    ON version.plugin_version_id = installation.plugin_version_id
  JOIN workspace_memberships membership
    ON membership.workspace_id = activation.workspace_id
   AND membership.role = 'owner'
   AND membership.status = 'active'
  JOIN agent_profiles profile
    ON profile.owner_id = membership.user_id
   AND profile.status = 'active'
  WHERE activation.activation_id = new.activation_id
    AND activation.status = 'active'
    AND installation.status = 'active';

  INSERT OR IGNORE INTO plugin_tool_policies
    (grant_id, tool_id, policy, policy_revision, created_at, updated_at)
  SELECT
    grant.grant_id,
    tool.tool_id,
    CASE
      WHEN tool.classification IN ('read', 'write') THEN 'require-approval'
      ELSE 'block'
    END,
    1,
    grant.granted_at,
    grant.granted_at
  FROM agent_plugin_grants grant
  JOIN plugin_catalog_tools tool
    ON tool.catalog_snapshot_id = grant.catalog_snapshot_id
  WHERE grant.connection_id = new.connection_id
    AND grant.grant_id LIKE 'default-grant:%'
    AND grant.revision = 1;

  INSERT OR IGNORE INTO plugin_grant_revision_history
    (grant_id, revision, status, tools_json, recorded_at)
  SELECT
    grant.grant_id,
    1,
    'active',
    (
      SELECT json_group_array(json_object(
        'toolId', policy.tool_id,
        'policy', policy.policy,
        'policyRevision', policy.policy_revision
      ))
      FROM (
        SELECT tool_id, policy, policy_revision
        FROM plugin_tool_policies
        WHERE grant_id = grant.grant_id
        ORDER BY tool_id
      ) policy
    ),
    grant.granted_at
  FROM agent_plugin_grants grant
  WHERE grant.connection_id = new.connection_id
    AND grant.grant_id LIKE 'default-grant:%'
    AND grant.revision = 1;
END;

CREATE TRIGGER plugin_default_grants_after_connection_ready
AFTER UPDATE OF status ON plugin_connections
WHEN new.status = 'ready' AND old.status <> 'ready'
BEGIN
  INSERT OR IGNORE INTO agent_plugin_grants
    (grant_id, workspace_id, agent_id, connection_id, catalog_snapshot_id,
     status, revision, client_operation_id, granted_at, revoked_at, updated_at)
  SELECT
    'default-grant:' || profile.agent_id || ':' || new.connection_id,
    activation.workspace_id,
    profile.agent_id,
    new.connection_id,
    version.catalog_snapshot_id,
    'active', 1,
    'default-grant:' || profile.agent_id || ':' || new.connection_id,
    MAX(profile.created_at, new.updated_at), NULL,
    MAX(profile.created_at, new.updated_at)
  FROM workspace_plugin_activations activation
  JOIN plugin_installations installation
    ON installation.installation_id = activation.installation_id
  JOIN plugin_versions version
    ON version.plugin_version_id = installation.plugin_version_id
  JOIN workspace_memberships membership
    ON membership.workspace_id = activation.workspace_id
   AND membership.role = 'owner'
   AND membership.status = 'active'
  JOIN agent_profiles profile
    ON profile.owner_id = membership.user_id
   AND profile.status = 'active'
  WHERE activation.activation_id = new.activation_id
    AND activation.status = 'active'
    AND installation.status = 'active';

  INSERT OR IGNORE INTO plugin_tool_policies
    (grant_id, tool_id, policy, policy_revision, created_at, updated_at)
  SELECT
    grant.grant_id,
    tool.tool_id,
    CASE
      WHEN tool.classification IN ('read', 'write') THEN 'require-approval'
      ELSE 'block'
    END,
    1,
    grant.granted_at,
    grant.granted_at
  FROM agent_plugin_grants grant
  JOIN plugin_catalog_tools tool
    ON tool.catalog_snapshot_id = grant.catalog_snapshot_id
  WHERE grant.connection_id = new.connection_id
    AND grant.grant_id LIKE 'default-grant:%'
    AND grant.revision = 1;

  INSERT OR IGNORE INTO plugin_grant_revision_history
    (grant_id, revision, status, tools_json, recorded_at)
  SELECT
    grant.grant_id,
    1,
    'active',
    (
      SELECT json_group_array(json_object(
        'toolId', policy.tool_id,
        'policy', policy.policy,
        'policyRevision', policy.policy_revision
      ))
      FROM (
        SELECT tool_id, policy, policy_revision
        FROM plugin_tool_policies
        WHERE grant_id = grant.grant_id
        ORDER BY tool_id
      ) policy
    ),
    grant.granted_at
  FROM agent_plugin_grants grant
  WHERE grant.connection_id = new.connection_id
    AND grant.grant_id LIKE 'default-grant:%'
    AND grant.revision = 1;
END;

CREATE TRIGGER plugin_default_grants_after_agent_insert
AFTER INSERT ON agent_profiles
WHEN new.status = 'active'
BEGIN
  INSERT OR IGNORE INTO agent_plugin_grants
    (grant_id, workspace_id, agent_id, connection_id, catalog_snapshot_id,
     status, revision, client_operation_id, granted_at, revoked_at, updated_at)
  SELECT
    'default-grant:' || new.agent_id || ':' || connection.connection_id,
    activation.workspace_id,
    new.agent_id,
    connection.connection_id,
    version.catalog_snapshot_id,
    'active', 1,
    'default-grant:' || new.agent_id || ':' || connection.connection_id,
    MAX(new.created_at, connection.created_at), NULL,
    MAX(new.created_at, connection.created_at)
  FROM plugin_connections connection
  JOIN workspace_plugin_activations activation
    ON activation.activation_id = connection.activation_id
  JOIN plugin_installations installation
    ON installation.installation_id = activation.installation_id
  JOIN plugin_versions version
    ON version.plugin_version_id = installation.plugin_version_id
  JOIN workspace_memberships membership
    ON membership.workspace_id = activation.workspace_id
   AND membership.user_id = new.owner_id
   AND membership.role = 'owner'
   AND membership.status = 'active'
  WHERE connection.status = 'ready'
    AND activation.status = 'active'
    AND installation.status = 'active';

  INSERT OR IGNORE INTO plugin_tool_policies
    (grant_id, tool_id, policy, policy_revision, created_at, updated_at)
  SELECT
    grant.grant_id,
    tool.tool_id,
    CASE
      WHEN tool.classification IN ('read', 'write') THEN 'require-approval'
      ELSE 'block'
    END,
    1,
    grant.granted_at,
    grant.granted_at
  FROM agent_plugin_grants grant
  JOIN plugin_catalog_tools tool
    ON tool.catalog_snapshot_id = grant.catalog_snapshot_id
  WHERE grant.agent_id = new.agent_id
    AND grant.grant_id LIKE 'default-grant:%'
    AND grant.revision = 1;

  INSERT OR IGNORE INTO plugin_grant_revision_history
    (grant_id, revision, status, tools_json, recorded_at)
  SELECT
    grant.grant_id,
    1,
    'active',
    (
      SELECT json_group_array(json_object(
        'toolId', policy.tool_id,
        'policy', policy.policy,
        'policyRevision', policy.policy_revision
      ))
      FROM (
        SELECT tool_id, policy, policy_revision
        FROM plugin_tool_policies
        WHERE grant_id = grant.grant_id
        ORDER BY tool_id
      ) policy
    ),
    grant.granted_at
  FROM agent_plugin_grants grant
  WHERE grant.agent_id = new.agent_id
    AND grant.grant_id LIKE 'default-grant:%'
    AND grant.revision = 1;
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

PRAGMA defer_foreign_keys = OFF;
