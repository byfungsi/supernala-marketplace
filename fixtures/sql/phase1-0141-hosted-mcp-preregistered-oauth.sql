-- Admit hosted MCP clients only after exact platform registration and deployment custody.
-- Existing packaged, dynamic, device, and OpenAPI authority rules remain intact.
DROP TRIGGER plugin_version_oauth_shape_insert;

CREATE TRIGGER plugin_version_oauth_shape_insert
BEFORE INSERT ON plugin_versions
BEGIN
  SELECT RAISE(ABORT, 'Plugin version OAuth authority shape is invalid') WHERE NOT (
    (new.auth_profile = 'device-oauth' AND new.authentication_kind = 'oauth'
      AND new.provider_registration_id IS NOT NULL
      AND new.provider_registration_authority_revision IS NOT NULL
      AND new.provider_definition_digest IS NOT NULL AND new.provider_definition_revision IS NOT NULL)
    OR (new.runtime_kind = 'managed-remote-mcp' AND new.auth_profile = 'mcp-oauth'
      AND new.authentication_kind = 'oauth' AND new.provider_registration_id IS NOT NULL
      AND new.provider_registration_authority_revision IS NOT NULL
      AND new.provider_definition_digest IS NOT NULL AND new.provider_definition_revision IS NOT NULL
      AND new.requested_scopes_json <> '[]')
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
          AND new.provider_registration_authority_revision IS NULL)
        OR (new.runtime_kind = 'managed-remote-mcp' AND new.auth_profile = 'mcp-oauth'
          AND r.registration_mode = 'platform-pre-registered'
          AND r.client_credential_reference IS NULL
          AND r.oauth_authority_revision = new.provider_registration_authority_revision
          AND r.oauth_provider_definition_digest = d.provider_definition_digest
          AND r.oauth_provider_definition_revision = d.revision
          AND EXISTS (SELECT 1 FROM plugin_auth_strategy_definitions auth
            WHERE auth.auth_definition_digest = new.auth_definition_digest
              AND auth.revision = new.auth_definition_revision
              AND auth.profile = 'mcp-oauth' AND auth.status = 'active'
              AND json_extract(auth.canonical_definition_json, '$.clientRegistration.kind') = 'pre-registered'
              AND json_extract(auth.canonical_definition_json, '$.providerRegistrationId') = r.provider_registration_id
              AND json_extract(auth.canonical_definition_json, '$.providerDefinitionDigest') = d.provider_definition_digest)
          AND EXISTS (SELECT 1 FROM plugin_oauth_registration_material_sources material
            WHERE material.provider_registration_id = r.provider_registration_id
              AND material.oauth_authority_revision = r.oauth_authority_revision
              AND material.provider_definition_digest = d.provider_definition_digest
              AND material.provider_definition_revision = d.revision
              AND material.source_kind = 'deployment-environment'
              AND material.material_origin = 'deployment-environment'
              AND material.token_endpoint_auth_method = json_extract(d.canonical_definition_json, '$.tokenEndpointAuthMethod')
              AND material.status = 'active')))
  );
END;
