CREATE TABLE plugin_oauth_apps (
  oauth_app_id TEXT PRIMARY KEY NOT NULL,
  user_id TEXT NOT NULL REFERENCES user(id),
  workspace_id TEXT NOT NULL REFERENCES workspaces(workspace_id),
  provider_registration_id TEXT NOT NULL REFERENCES provider_registrations(provider_registration_id),
  provider_definition_digest TEXT NOT NULL
    REFERENCES plugin_oauth_provider_definitions(provider_definition_digest),
  provider_definition_revision INTEGER NOT NULL CHECK (provider_definition_revision >= 1),
  material_source_revision INTEGER NOT NULL CHECK (material_source_revision >= 1),
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
  FOREIGN KEY (provider_registration_id, material_source_revision)
    REFERENCES plugin_oauth_registration_material_sources(provider_registration_id, source_revision),
  CHECK (
    (status = 'active' AND deactivated_at IS NULL)
    OR (status = 'deactivated' AND deactivated_at IS NOT NULL)
  )
) WITHOUT ROWID;

CREATE INDEX plugin_oauth_apps_workspace_provider
  ON plugin_oauth_apps (workspace_id, provider_registration_id, status, created_at);

ALTER TABLE plugin_oauth_runtime_attempts
  ADD COLUMN oauth_app_id TEXT REFERENCES plugin_oauth_apps(oauth_app_id);

ALTER TABLE plugin_oauth_runtime_attempts
  ADD COLUMN oauth_app_revision INTEGER CHECK (oauth_app_revision IS NULL OR oauth_app_revision >= 1);

ALTER TABLE plugin_oauth_runtime_attempts
  ADD COLUMN oauth_app_credential_reference TEXT CHECK (
    oauth_app_credential_reference IS NULL
    OR (
      length(oauth_app_credential_reference) = 49
      AND substr(oauth_app_credential_reference, 1, 13) = 'plugin-vault:'
      AND substr(oauth_app_credential_reference, 14) NOT GLOB '*[^0-9a-f-]*'
    )
  );

CREATE TRIGGER plugin_oauth_app_retained
BEFORE DELETE ON plugin_oauth_apps
BEGIN
  SELECT RAISE(ABORT, 'Workspace OAuth apps are retained');
END;

CREATE TRIGGER plugin_oauth_runtime_app_authority_immutable
BEFORE UPDATE ON plugin_oauth_runtime_attempts
WHEN
  old.oauth_app_id IS NOT new.oauth_app_id
  OR old.oauth_app_revision IS NOT new.oauth_app_revision
  OR old.oauth_app_credential_reference IS NOT new.oauth_app_credential_reference
BEGIN
  SELECT RAISE(ABORT, 'OAuth runtime app authority is immutable');
END;
