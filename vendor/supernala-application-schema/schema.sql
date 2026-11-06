CREATE TABLE "account" (
  "id" TEXT PRIMARY KEY NOT NULL,
  "accountId" TEXT NOT NULL,
  "providerId" TEXT NOT NULL,
  "userId" TEXT NOT NULL REFERENCES "user"("id") ON DELETE CASCADE,
  "accessToken" TEXT,
  "refreshToken" TEXT,
  "idToken" TEXT,
  "accessTokenExpiresAt" INTEGER,
  "refreshTokenExpiresAt" INTEGER,
  "scope" TEXT,
  "password" TEXT,
  "createdAt" INTEGER NOT NULL,
  "updatedAt" INTEGER NOT NULL
);

CREATE TABLE active_inference_runtime_policy (
  singleton INTEGER PRIMARY KEY NOT NULL CHECK (singleton = 1),
  policy_revision TEXT NOT NULL REFERENCES inference_runtime_policy_publications(policy_revision),
  activated_at INTEGER NOT NULL
);

CREATE TABLE agent_action_receipt_outbox (
  receipt_id TEXT PRIMARY KEY NOT NULL,
  owner_id TEXT NOT NULL REFERENCES "user"("id"),
  conversation_id TEXT NOT NULL,
  receipt_json TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  delivered_at INTEGER
, source_revision INTEGER NOT NULL DEFAULT 1
CHECK (source_revision >= 1)) WITHOUT ROWID;

CREATE TABLE agent_agent_direct_conversations (
  conversation_id TEXT PRIMARY KEY NOT NULL REFERENCES conversation_projections(conversation_id),
  workspace_id TEXT NOT NULL REFERENCES workspaces(workspace_id),
  first_agent_id TEXT NOT NULL REFERENCES agent_profiles(agent_id),
  second_agent_id TEXT NOT NULL REFERENCES agent_profiles(agent_id),
  status TEXT NOT NULL CHECK (status IN ('active', 'retired')),
  CHECK (first_agent_id < second_agent_id)
) WITHOUT ROWID;

CREATE TABLE agent_browser_screenshot_grants (
  workspace_id TEXT NOT NULL REFERENCES workspaces(workspace_id),
  agent_id TEXT NOT NULL,
  conversation_id TEXT NOT NULL,
  work_id TEXT NOT NULL,
  invocation_id TEXT NOT NULL,
  execution_id TEXT NOT NULL,
  generation INTEGER NOT NULL CHECK (generation >= 1),
  profile_version INTEGER NOT NULL CHECK (profile_version >= 1),
  upload_operation_id TEXT NOT NULL,
  file_id TEXT NOT NULL REFERENCES workspace_files(file_id),
  grant_id TEXT NOT NULL REFERENCES workspace_file_grants(grant_id),
  grant_version INTEGER NOT NULL CHECK (grant_version = 1),
  PRIMARY KEY (workspace_id, grant_id)
);

CREATE TABLE agent_carousel_export_grants (
  workspace_id TEXT NOT NULL REFERENCES workspaces(workspace_id),
  agent_id TEXT NOT NULL,
  conversation_id TEXT NOT NULL,
  work_id TEXT NOT NULL,
  invocation_id TEXT NOT NULL,
  profile_version INTEGER NOT NULL CHECK (profile_version >= 1),
  carousel_id TEXT NOT NULL REFERENCES carousels(carousel_id),
  revision INTEGER NOT NULL CHECK (revision >= 1),
  file_id TEXT NOT NULL,
  grant_id TEXT NOT NULL,
  grant_version INTEGER NOT NULL CHECK (grant_version = 1),
  started_at INTEGER NOT NULL,
  PRIMARY KEY (workspace_id, grant_id)
);

CREATE TABLE agent_image_generation_grants (
  workspace_id TEXT NOT NULL REFERENCES workspaces(workspace_id),
  agent_id TEXT NOT NULL,
  conversation_id TEXT NOT NULL,
  work_id TEXT NOT NULL,
  invocation_id TEXT NOT NULL,
  execution_id TEXT NOT NULL,
  generation INTEGER NOT NULL CHECK (generation >= 1),
  profile_version INTEGER NOT NULL CHECK (profile_version >= 1),
  operation_id TEXT NOT NULL REFERENCES image_generation_operations(operation_id),
  file_id TEXT NOT NULL REFERENCES workspace_files(file_id),
  grant_id TEXT NOT NULL REFERENCES workspace_file_grants(grant_id),
  grant_version INTEGER NOT NULL CHECK (grant_version = 1),
  PRIMARY KEY (workspace_id, grant_id)
);

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

CREATE TABLE agent_profiles (
  agent_id TEXT PRIMARY KEY NOT NULL,
  owner_id TEXT NOT NULL REFERENCES "user"("id"),
  version INTEGER NOT NULL CHECK (version >= 1),
  name TEXT NOT NULL,
  label TEXT,
  description TEXT NOT NULL,
  avatar TEXT,
  status TEXT NOT NULL CHECK (status IN ('active', 'archived')),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
) WITHOUT ROWID;

CREATE TABLE agent_question_owner_message_watermarks (
  owner_id TEXT NOT NULL REFERENCES "user"("id"),
  conversation_id TEXT NOT NULL,
  message_sequence INTEGER NOT NULL CHECK (message_sequence >= 1),
  message_id TEXT NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (owner_id, conversation_id)
) WITHOUT ROWID;

CREATE TABLE agent_question_turn_recoveries (
  question_id TEXT PRIMARY KEY NOT NULL REFERENCES agent_questions(question_id),
  status TEXT NOT NULL CHECK (status IN ('pending', 'completed', 'blocked')),
  attempts INTEGER NOT NULL CHECK (attempts >= 0),
  next_attempt_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
) WITHOUT ROWID;

CREATE TABLE "agent_questions" (
  question_id TEXT PRIMARY KEY NOT NULL,
  owner_id TEXT NOT NULL REFERENCES "user"("id"),
  conversation_id TEXT NOT NULL,
  agent_id TEXT NOT NULL,
  profile_version INTEGER NOT NULL CHECK (profile_version >= 1),
  client_operation_id TEXT NOT NULL,
  prompt TEXT NOT NULL,
  options_json TEXT NOT NULL,
  allow_custom_answer INTEGER NOT NULL CHECK (allow_custom_answer IN (0, 1)),
  purpose TEXT NOT NULL CHECK (purpose IN ('clarification', 'bot-onboarding')),
  status TEXT NOT NULL CHECK (status IN ('pending', 'answered', 'superseded', 'dismissed')),
  answer_tag TEXT CHECK (answer_tag IN ('Option', 'Custom')),
  answer_value TEXT,
  created_at INTEGER NOT NULL,
  answered_at INTEGER,
  thread_id TEXT,
  invoking_turn_id TEXT,
  tool_call_id TEXT,
  superseded_by_message_id TEXT,
  superseded_at INTEGER, admission_owner_message_sequence INTEGER NOT NULL DEFAULT 0
CHECK (admission_owner_message_sequence >= 0), agent_work_id TEXT, form_definition_json TEXT
  CHECK (form_definition_json IS NULL OR (json_valid(form_definition_json) AND length(CAST(form_definition_json AS BLOB)) <= 65536)), form_answer_json TEXT
  CHECK (form_answer_json IS NULL OR (json_valid(form_answer_json) AND length(CAST(form_answer_json AS BLOB)) <= 65536)), detail_answer_deadline_at INTEGER,
  UNIQUE (owner_id, client_operation_id)
) WITHOUT ROWID;

CREATE TABLE agent_skill_assignments (
  workspace_id TEXT NOT NULL,
  agent_id TEXT NOT NULL,
  skill_id TEXT NOT NULL,
  assigned_at INTEGER NOT NULL,
  removed_at INTEGER,
  PRIMARY KEY (workspace_id, agent_id, skill_id),
  FOREIGN KEY (workspace_id, agent_id) REFERENCES workspace_agents(workspace_id, agent_id),
  FOREIGN KEY (workspace_id, skill_id) REFERENCES workspace_skills(workspace_id, skill_id)
) WITHOUT ROWID;

CREATE TABLE agent_turn_incident_recovery_requests (
  conversation_id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  cutoff_at INTEGER NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending', 'completed')),
  updated_at INTEGER NOT NULL
);

CREATE TABLE agent_user_setting_operations (
  owner_id TEXT NOT NULL REFERENCES "user"("id"),
  operation_id TEXT NOT NULL,
  input_json TEXT NOT NULL,
  occurred_at INTEGER NOT NULL,
  changed INTEGER NOT NULL CHECK (changed IN (0, 1)),
  applied INTEGER NOT NULL CHECK (applied IN (0, 1)),
  PRIMARY KEY (owner_id, operation_id)
) WITHOUT ROWID;

CREATE TABLE agent_web_fetch_operations (
  client_operation_id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  workspace_id TEXT NOT NULL,
  conversation_id TEXT NOT NULL,
  agent_id TEXT NOT NULL,
  request_fingerprint TEXT NOT NULL CHECK (request_fingerprint GLOB 'sha256:*'),
  status TEXT NOT NULL CHECK (status IN ('dispatched', 'completed')),
  result_json TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  FOREIGN KEY (workspace_id, agent_id)
    REFERENCES workspace_agents(workspace_id, agent_id),
  CHECK (
    (status = 'dispatched' AND result_json IS NULL)
    OR (status = 'completed' AND result_json IS NOT NULL)
  )
);

CREATE TABLE application_user_event_outbox (
  sequence INTEGER PRIMARY KEY AUTOINCREMENT,
  workspace_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  payload_kind TEXT NOT NULL CHECK (
    payload_kind IN (
      'agent-profiles',
      'memories',
      'workspace-membership',
      'account-preferences'
    )
  )
);

CREATE TABLE artifact_creation_operations (
  workspace_id TEXT NOT NULL REFERENCES workspaces(workspace_id),
  operation_id TEXT NOT NULL,
  request_identity TEXT NOT NULL,
  revision_id TEXT NOT NULL REFERENCES artifact_revisions(revision_id),
  PRIMARY KEY (workspace_id, operation_id),
  FOREIGN KEY (revision_id, workspace_id) REFERENCES artifact_revisions(revision_id, workspace_id)
) WITHOUT ROWID;

CREATE TABLE artifact_references (
  reference_id TEXT PRIMARY KEY NOT NULL,
  artifact_id TEXT NOT NULL,
  revision_id TEXT NOT NULL,
  workspace_id TEXT NOT NULL,
  conversation_id TEXT NOT NULL,
  file_id TEXT NOT NULL,
  grant_id TEXT NOT NULL,
  display_name TEXT NOT NULL CHECK (length(display_name) BETWEEN 1 AND 255),
  media_type TEXT NOT NULL,
  byte_size INTEGER NOT NULL CHECK (byte_size BETWEEN 1 AND 100000000),
  status TEXT NOT NULL CHECK (status IN ('prepared', 'committed', 'failed')),
  message_id TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  committed_at INTEGER,
  FOREIGN KEY (artifact_id, workspace_id) REFERENCES artifacts(artifact_id, workspace_id),
  FOREIGN KEY (revision_id, artifact_id, file_id)
    REFERENCES artifact_revisions(revision_id, artifact_id, primary_file_id),
  FOREIGN KEY (workspace_id, conversation_id)
    REFERENCES workspace_conversations(workspace_id, conversation_id),
  FOREIGN KEY (file_id, workspace_id) REFERENCES workspace_files(file_id, workspace_id),
  FOREIGN KEY (grant_id) REFERENCES workspace_file_grants(grant_id),
  CHECK (
    (status = 'prepared' AND message_id IS NULL AND committed_at IS NULL)
    OR (status = 'committed' AND message_id IS NOT NULL AND committed_at IS NOT NULL)
    OR (status = 'failed' AND message_id IS NULL AND committed_at IS NULL)
  )
) WITHOUT ROWID;

CREATE TABLE artifact_representation_preparations (
  representation_key TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(workspace_id),
  status TEXT NOT NULL CHECK (status IN ('pending', 'ready', 'failed')),
  lease_token TEXT NOT NULL,
  lease_until INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE artifact_revision_images (
  revision_id TEXT NOT NULL,
  workspace_id TEXT NOT NULL,
  asset_name TEXT NOT NULL CHECK (length(asset_name) BETWEEN 1 AND 48
    AND substr(asset_name, 1, 1) GLOB '[a-z]' AND asset_name NOT GLOB '*[^a-z0-9-]*'),
  file_id TEXT NOT NULL,
  PRIMARY KEY (revision_id, asset_name),
  FOREIGN KEY (revision_id, workspace_id) REFERENCES artifact_revisions(revision_id, workspace_id),
  FOREIGN KEY (file_id, workspace_id) REFERENCES workspace_files(file_id, workspace_id)
) WITHOUT ROWID;

CREATE TABLE "artifact_revisions" (
  revision_id TEXT PRIMARY KEY NOT NULL,
  artifact_id TEXT NOT NULL,
  workspace_id TEXT NOT NULL,
  revision_number INTEGER NOT NULL CHECK (revision_number >= 1),
  presentation_type TEXT NOT NULL CHECK (
    presentation_type IN ('document', 'spreadsheet', 'presentation', 'image', 'file')
  ),
  publication_source TEXT NOT NULL CHECK (
    publication_source IN ('agent-authored', 'existing-file', 'computer-export')
  ),
  primary_file_id TEXT NOT NULL,
  publisher_kind TEXT NOT NULL CHECK (publisher_kind IN ('owner', 'agent')),
  publisher_user_id TEXT,
  publisher_agent_id TEXT,
  publisher_profile_version INTEGER CHECK (publisher_profile_version >= 1),
  published_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  UNIQUE (artifact_id, revision_number),
  UNIQUE (revision_id, artifact_id),
  UNIQUE (revision_id, artifact_id, primary_file_id),
  UNIQUE (revision_id, workspace_id),
  FOREIGN KEY (artifact_id, workspace_id) REFERENCES artifacts(artifact_id, workspace_id),
  FOREIGN KEY (primary_file_id, workspace_id) REFERENCES workspace_files(file_id, workspace_id),
  CHECK (
    (publisher_kind = 'owner' AND publisher_user_id IS NOT NULL
      AND publisher_agent_id IS NULL AND publisher_profile_version IS NULL)
    OR
    (publisher_kind = 'agent' AND publisher_user_id IS NULL
      AND publisher_agent_id IS NOT NULL AND publisher_profile_version IS NOT NULL)
  )
) WITHOUT ROWID;

CREATE TABLE artifacts (
  artifact_id TEXT PRIMARY KEY NOT NULL,
  workspace_id TEXT NOT NULL REFERENCES workspaces(workspace_id),
  status TEXT NOT NULL CHECK (status IN ('active', 'inactive')),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE (artifact_id, workspace_id)
) WITHOUT ROWID;

CREATE TABLE billing_checkout_product_events (
  operation_id TEXT PRIMARY KEY,
  checkout_id TEXT NOT NULL UNIQUE,
  workspace_id TEXT NOT NULL REFERENCES workspaces(workspace_id),
  created_at INTEGER NOT NULL
);

CREATE TABLE "bot_chat_operations" (
  owner_id TEXT NOT NULL REFERENCES "user"("id"),
  client_operation_id TEXT NOT NULL,
  agent_id TEXT NOT NULL,
  conversation_id TEXT UNIQUE,
  status TEXT NOT NULL CHECK (
    status IN ('reserved', 'awaiting-focus', 'completing', 'completed', 'dismissed', 'failed')
  ),
  failure_reason TEXT CHECK (failure_reason IN ('turn-failed', 'question-unavailable')),
  answer_tag TEXT CHECK (answer_tag IN ('Preset', 'Custom')),
  answer_value TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  requested_name TEXT, onboarding_turn_id TEXT, answer_profile_version INTEGER, applied_profile_version INTEGER,
  PRIMARY KEY (owner_id, client_operation_id)
) WITHOUT ROWID;

CREATE TABLE calendar_authorization_attempts (
  state_digest TEXT PRIMARY KEY NOT NULL,
  owner_id TEXT NOT NULL REFERENCES "user"("id"),
  provider TEXT NOT NULL CHECK (provider IN ('google')),
  workspace_id TEXT NOT NULL,
  code_verifier_envelope TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
) WITHOUT ROWID;

CREATE TABLE calendar_event_links (
  integration_id TEXT NOT NULL REFERENCES calendar_integrations("integration_id"),
  event_id TEXT NOT NULL REFERENCES calendar_events("event_id"),
  external_event_id TEXT NOT NULL,
  origin TEXT NOT NULL CHECK (origin IN ('supernala', 'provider')),
  mirrored_version INTEGER NOT NULL CHECK (mirrored_version >= 1),
  external_revision TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (integration_id, event_id)
) WITHOUT ROWID;

CREATE TABLE calendar_event_user_event_outbox (
  sequence INTEGER PRIMARY KEY AUTOINCREMENT,
  workspace_id TEXT NOT NULL,
  user_id TEXT NOT NULL
);

CREATE TABLE "calendar_events" (
  event_id TEXT PRIMARY KEY NOT NULL,
  owner_id TEXT NOT NULL REFERENCES "user"("id"),
  client_operation_id TEXT NOT NULL,
  last_operation_id TEXT NOT NULL,
  conversation_id TEXT,
  creator_kind TEXT NOT NULL CHECK (creator_kind IN ('owner', 'agent', 'service')),
  creator_agent_id TEXT,
  creator_profile_version INTEGER,
  creator_service_id TEXT,
  title TEXT NOT NULL,
  details TEXT,
  location TEXT,
  starts_at INTEGER NOT NULL,
  ends_at INTEGER NOT NULL CHECK (ends_at >= starts_at),
  all_day INTEGER NOT NULL CHECK (all_day IN (0, 1)),
  time_zone TEXT NOT NULL,
  version INTEGER NOT NULL CHECK (version >= 1),
  status TEXT NOT NULL CHECK (status IN ('confirmed', 'cancelled')),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  alert_minutes_before INTEGER,
  recurrence_rule TEXT,
  series_event_id TEXT REFERENCES "calendar_events"(event_id),
  original_starts_at INTEGER
) WITHOUT ROWID;

CREATE TABLE calendar_integrations (
  integration_id TEXT PRIMARY KEY NOT NULL,
  owner_id TEXT NOT NULL REFERENCES "user"("id"),
  provider TEXT NOT NULL CHECK (provider IN ('google')),
  status TEXT NOT NULL CHECK (status IN ('connected', 'paused', 'expired')),
  account_label TEXT,
  external_calendar_id TEXT NOT NULL,
  -- Version-one AES-GCM envelope holding the provider refresh token, or NULL once the
  -- authorization has been forgotten.
  credential_envelope TEXT,
  -- Incremented whenever a new authorization replaces an earlier one, so an envelope
  -- encrypted for a superseded authorization can never be decrypted as the current one.
  credential_lineage INTEGER NOT NULL DEFAULT 1 CHECK (credential_lineage >= 1),
  -- Opaque provider position of the last completed read; NULL asks for a full read.
  sync_token TEXT,
  synced_at INTEGER,
  sync_failure_reason TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
) WITHOUT ROWID;

CREATE TABLE "carousel_exports" (
  carousel_id TEXT NOT NULL REFERENCES carousels (carousel_id),
  revision INTEGER NOT NULL CHECK (revision >= 1),
  format TEXT NOT NULL CHECK (format IN ('pdf', 'png', 'pptx')),
  -- 0 is every slide; otherwise the 1-based slide number.
  slide INTEGER NOT NULL CHECK (slide >= 0),
  renderer_version TEXT NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('rendering', 'completed', 'failed')),
  file_ids_json TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (carousel_id, revision, format, slide, renderer_version)
);

CREATE TABLE carousel_revisions (
  carousel_id TEXT NOT NULL REFERENCES carousels(carousel_id),
  revision INTEGER NOT NULL,
  deck_json TEXT NOT NULL,
  author_agent_id TEXT,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (carousel_id, revision)
);

CREATE TABLE carousels (
  carousel_id TEXT PRIMARY KEY NOT NULL,
  owner_id TEXT NOT NULL REFERENCES "user"("id"),
  revision INTEGER NOT NULL CHECK (revision >= 1),
  title TEXT NOT NULL,
  creator_agent_id TEXT,
  conversation_id TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  deleted_at INTEGER
, kind TEXT NOT NULL DEFAULT 'carousel'
  CHECK (kind IN ('carousel', 'slides', 'poster')), workspace_id TEXT REFERENCES workspaces (workspace_id));

CREATE TABLE ceramic_search_attempts (
  operation_id TEXT PRIMARY KEY,
  request_fingerprint TEXT NOT NULL,
  admission_json TEXT NOT NULL,
  budget_key TEXT NOT NULL REFERENCES ceramic_search_risk_budgets(budget_key),
  maximum_usd INTEGER NOT NULL CHECK (maximum_usd > 0),
  state TEXT NOT NULL CHECK (state IN ('reserved','dispatched','completed','released')),
  completion_json TEXT,
  updated_at INTEGER NOT NULL
);

CREATE TABLE ceramic_search_risk_budgets (
  budget_key TEXT PRIMARY KEY,
  maximum_usd INTEGER NOT NULL CHECK (maximum_usd > 0),
  booked_usd INTEGER NOT NULL DEFAULT 0 CHECK (booked_usd >= 0 AND booked_usd <= maximum_usd)
);

CREATE TABLE conversation_agent_projections (
  conversation_id TEXT NOT NULL REFERENCES conversation_projections(conversation_id),
  agent_id TEXT NOT NULL,
  membership_epoch INTEGER NOT NULL CHECK (membership_epoch >= 1),
  joined_at INTEGER NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('active', 'removed')),
  PRIMARY KEY (conversation_id, agent_id, membership_epoch)
) WITHOUT ROWID;

CREATE TABLE conversation_list_message_projections (
  conversation_id TEXT PRIMARY KEY NOT NULL,
  sequence INTEGER NOT NULL CHECK (sequence >= 1),
  message_json TEXT NOT NULL,
  is_canonical INTEGER NOT NULL CHECK (is_canonical IN (0, 1)),
  updated_at INTEGER NOT NULL
) WITHOUT ROWID;

CREATE TABLE conversation_message_access_exclusions (
  owner_id TEXT NOT NULL REFERENCES "user"("id"),
  message_id TEXT NOT NULL,
  invalidated_at INTEGER NOT NULL,
  reason TEXT NOT NULL CHECK (reason IN ('memory-corrected', 'memory-retracted')),
  PRIMARY KEY (owner_id, message_id)
) WITHOUT ROWID;

CREATE VIRTUAL TABLE conversation_message_search_fts USING fts5(
  message_id UNINDEXED,
  conversation_id UNINDEXED,
  owner_id UNINDEXED,
  sequence UNINDEXED,
  content,
  tokenize = 'unicode61 remove_diacritics 2'
);

CREATE TABLE conversation_message_search_records (
  message_id TEXT PRIMARY KEY NOT NULL,
  conversation_id TEXT NOT NULL,
  owner_id TEXT NOT NULL,
  sequence INTEGER NOT NULL CHECK (sequence >= 1),
  author_kind TEXT NOT NULL CHECK (author_kind IN ('owner', 'agent', 'system')),
  author_id TEXT,
  author_profile_version INTEGER,
  content TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  UNIQUE (conversation_id, sequence)
) WITHOUT ROWID;

CREATE TABLE conversation_message_search_state (
  conversation_id TEXT PRIMARY KEY NOT NULL,
  indexed_through_sequence INTEGER NOT NULL CHECK (indexed_through_sequence >= 0),
  updated_at INTEGER NOT NULL
) WITHOUT ROWID;

CREATE TABLE conversation_projections (
  conversation_id TEXT PRIMARY KEY NOT NULL,
  owner_id TEXT NOT NULL REFERENCES "user"("id"),
  client_operation_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('direct', 'group')),
  title TEXT NOT NULL,
  purpose TEXT,
  status TEXT NOT NULL CHECK (status IN ('provisioning', 'active', 'soft-deleted')),
  version INTEGER NOT NULL CHECK (version >= 1),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE (owner_id, client_operation_id)
) WITHOUT ROWID;

CREATE TABLE conversation_read_states (
  owner_id TEXT NOT NULL,
  conversation_id TEXT NOT NULL,
  read_through_sequence INTEGER NOT NULL CHECK (read_through_sequence >= 0),
  read_at INTEGER NOT NULL,
  PRIMARY KEY (owner_id, conversation_id),
  FOREIGN KEY (conversation_id) REFERENCES conversation_projections(conversation_id)
) WITHOUT ROWID;

CREATE TABLE currency_rate_cache (
  currency_pair TEXT PRIMARY KEY CHECK (currency_pair = 'USD/IDR'),
  quote_json TEXT,
  next_attempt_at INTEGER NOT NULL DEFAULT 0,
  failure_attempts INTEGER NOT NULL DEFAULT 0 CHECK (failure_attempts BETWEEN 0 AND 8),
  lease_until INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE dashboards (
  dashboard_id TEXT PRIMARY KEY NOT NULL,
  owner_id TEXT NOT NULL REFERENCES "user"("id"),
  slug TEXT NOT NULL,
  spec_json TEXT NOT NULL,
  creator_agent_id TEXT,
  conversation_id TEXT,
  version INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE database_operation_receipts (
  workspace_id TEXT NOT NULL REFERENCES workspaces(workspace_id),
  operation_id TEXT NOT NULL,
  database_id TEXT NOT NULL REFERENCES workspace_databases(database_id),
  fingerprint TEXT NOT NULL,
  result_json TEXT NOT NULL, portal_authority_fingerprint TEXT,
  PRIMARY KEY(workspace_id, operation_id)
) WITHOUT ROWID;

CREATE TABLE database_records (
  record_id TEXT PRIMARY KEY NOT NULL,
  database_id TEXT NOT NULL REFERENCES workspace_databases(database_id),
  record_json TEXT NOT NULL,
  archived_at INTEGER
);

CREATE TABLE database_schema_revisions (
  database_id TEXT NOT NULL REFERENCES workspace_databases(database_id),
  revision INTEGER NOT NULL,
  definition_json TEXT NOT NULL,
  PRIMARY KEY(database_id, revision)
) WITHOUT ROWID;

CREATE TABLE database_tracker_operation_receipts (
  workspace_id TEXT NOT NULL REFERENCES workspaces(workspace_id),
  operation_id TEXT NOT NULL,
  fingerprint TEXT NOT NULL,
  result_json TEXT NOT NULL, portal_authority_fingerprint TEXT,
  PRIMARY KEY(workspace_id, operation_id)
) WITHOUT ROWID;

CREATE TABLE database_tracker_ui_revisions (
  tracker_id TEXT NOT NULL REFERENCES database_trackers(tracker_id),
  revision INTEGER NOT NULL,
  ui_json TEXT NOT NULL,
  PRIMARY KEY (tracker_id, revision)
) WITHOUT ROWID;

CREATE TABLE database_trackers (
  tracker_id TEXT PRIMARY KEY NOT NULL,
  workspace_id TEXT NOT NULL REFERENCES workspaces(workspace_id),
  database_id TEXT NOT NULL REFERENCES workspace_databases(database_id),
  slug TEXT NOT NULL,
  collection_alias TEXT NOT NULL,
  revision INTEGER NOT NULL,
  last_operation_id TEXT NOT NULL,
  creator_agent_id TEXT,
  conversation_id TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  archived_at INTEGER,
  UNIQUE (workspace_id, slug),
  UNIQUE (database_id)
);

CREATE TABLE dataset_rows (
  row_id TEXT PRIMARY KEY NOT NULL,
  owner_id TEXT NOT NULL REFERENCES "user"("id"),
  dataset TEXT NOT NULL,
  recorded_at INTEGER NOT NULL,
  values_json TEXT NOT NULL,
  client_operation_id TEXT NOT NULL,
  creator_agent_id TEXT,
  conversation_id TEXT,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'deleted')),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE form_operation_receipts (
  workspace_id TEXT NOT NULL REFERENCES workspaces(workspace_id),
  operation_id TEXT NOT NULL,
  form_id TEXT NOT NULL REFERENCES workspace_forms(form_id),
  fingerprint TEXT NOT NULL,
  form_json TEXT NOT NULL,
  portal_authority_fingerprint TEXT,
  PRIMARY KEY (workspace_id, operation_id)
) WITHOUT ROWID;

CREATE TABLE form_publication_revisions (
  form_id TEXT NOT NULL REFERENCES workspace_forms(form_id),
  revision INTEGER NOT NULL CHECK (revision >= 1),
  definition_json TEXT NOT NULL,
  PRIMARY KEY (form_id, revision)
) WITHOUT ROWID;

CREATE TABLE form_submissions (
  form_id TEXT NOT NULL REFERENCES workspace_forms(form_id),
  operation_id TEXT NOT NULL,
  revision INTEGER NOT NULL,
  record_id TEXT NOT NULL UNIQUE REFERENCES database_records(record_id),
  fingerprint TEXT NOT NULL,
  receipt_json TEXT NOT NULL,
  submitted_at INTEGER NOT NULL,
  portal_authority_fingerprint TEXT, original_json TEXT
  CHECK (original_json IS NULL OR json_valid(original_json)),
  PRIMARY KEY (form_id, operation_id),
  FOREIGN KEY (form_id, revision) REFERENCES form_publication_revisions(form_id, revision)
) WITHOUT ROWID;

CREATE TABLE human_agent_direct_conversations (
  conversation_id TEXT PRIMARY KEY NOT NULL REFERENCES conversation_projections(conversation_id),
  workspace_id TEXT NOT NULL REFERENCES workspaces(workspace_id),
  user_id TEXT NOT NULL REFERENCES "user"("id"),
  agent_id TEXT NOT NULL REFERENCES agent_profiles(agent_id),
  status TEXT NOT NULL CHECK (status IN ('active', 'retired'))
) WITHOUT ROWID;

CREATE TABLE image_generation_operations (
  operation_id TEXT PRIMARY KEY NOT NULL,
  -- The operation id digests these identifiers; they are kept readable for audit and support.
  workspace_id TEXT NOT NULL REFERENCES workspaces(workspace_id),
  agent_id TEXT NOT NULL,
  conversation_id TEXT NOT NULL,
  turn_id TEXT NOT NULL,
  tool_call_id TEXT NOT NULL,
  request_fingerprint TEXT NOT NULL,
  state TEXT NOT NULL CHECK (state IN
    ('reserved', 'dispatching', 'settlement-pending', 'completed', 'failed', 'absorbed')),
  failure_reason TEXT,
  -- The generated original lives only as a Workspace File; the row keeps its receipt.
  result_json TEXT,
  provider_cost_usd TEXT,
  image_tokens TEXT,
  actual_charge TEXT,
  -- The FX quote the charge was rated with, retained so recovery settles the same valuation.
  fx_revision TEXT,
  execution_lease_expires_at INTEGER,
  admitted_at INTEGER NOT NULL,
  completed_at INTEGER,
  updated_at INTEGER NOT NULL, model TEXT, reuse_key TEXT,
  CHECK (state <> 'settlement-pending' OR (result_json IS NOT NULL AND actual_charge IS NOT NULL)),
  CHECK (state <> 'completed' OR result_json IS NOT NULL)
) WITHOUT ROWID;

CREATE TABLE inference_absorption_release_audit (
  operation_id TEXT PRIMARY KEY NOT NULL REFERENCES paid_work_operations(operation_id),
  reservation_id TEXT NOT NULL UNIQUE,
  generation_id TEXT NOT NULL UNIQUE,
  release_id TEXT NOT NULL UNIQUE,
  work_id TEXT NOT NULL,
  evidence_json TEXT NOT NULL CHECK (json_valid(evidence_json)),
  merchant_absorbed_microrupiah TEXT NOT NULL,
  intent_at INTEGER NOT NULL,
  receipt_json TEXT CHECK (receipt_json IS NULL OR json_valid(receipt_json)),
  receipt_at INTEGER,
  CHECK ((receipt_json IS NULL) = (receipt_at IS NULL))
) WITHOUT ROWID;

CREATE TABLE inference_policy_wait_scan (
  singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
  created_at INTEGER NOT NULL,
  conversation_id TEXT NOT NULL,
  invocation_id TEXT NOT NULL,
  operation_key TEXT NOT NULL
);

CREATE TABLE inference_policy_waits (
  conversation_id TEXT NOT NULL,
  invocation_id TEXT NOT NULL,
  operation_key TEXT NOT NULL,
  workspace_id TEXT NOT NULL,
  owner_id TEXT NOT NULL,
  provider TEXT NOT NULL,
  model_id TEXT NOT NULL,
  attempt_timeout_ms INTEGER NOT NULL CHECK (attempt_timeout_ms > 0),
  created_at INTEGER NOT NULL,
  PRIMARY KEY (conversation_id, invocation_id, operation_key)
) WITHOUT ROWID;

CREATE TABLE inference_runtime_evidence (
  evidence_sha256 TEXT PRIMARY KEY NOT NULL CHECK (
    length(evidence_sha256) = 64 AND evidence_sha256 NOT GLOB '*[^0-9a-f]*'
  ),
  evidence_kind TEXT NOT NULL CHECK (evidence_kind IN ('provider-rate', 'fx-quote')),
  source_url TEXT NOT NULL,
  source_observed_at INTEGER NOT NULL,
  source_business_date TEXT,
  exact_payload TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE inference_runtime_policy_publications (
  policy_revision TEXT PRIMARY KEY NOT NULL,
  policy_json TEXT NOT NULL,
  provider_rate_evidence_sha256 TEXT NOT NULL
    REFERENCES inference_runtime_evidence(evidence_sha256),
  fx_quote_evidence_sha256 TEXT NOT NULL
    REFERENCES inference_runtime_evidence(evidence_sha256),
  published_at INTEGER NOT NULL
);

CREATE TABLE inference_runtime_policy_refresh_status (
  singleton INTEGER PRIMARY KEY NOT NULL CHECK (singleton = 1),
  last_attempted_at INTEGER NOT NULL,
  last_succeeded_at INTEGER,
  last_failure_reason TEXT CHECK (last_failure_reason IS NULL OR last_failure_reason IN (
    'authority-unavailable', 'source-unavailable', 'invalid-provider-rate',
    'invalid-fx-quote', 'publication-failed'
  ))
);

CREATE TABLE marketplace_skill_definitions (
  skill_definition_id TEXT PRIMARY KEY NOT NULL
    CHECK (skill_definition_id = publisher_namespace || '/' || skill_slug),
  marketplace_id TEXT NOT NULL REFERENCES plugin_marketplaces(marketplace_id),
  publisher_namespace TEXT NOT NULL CHECK (length(publisher_namespace) BETWEEN 1 AND 80),
  publisher_name TEXT NOT NULL CHECK (length(publisher_name) BETWEEN 1 AND 120),
  skill_slug TEXT NOT NULL CHECK (length(skill_slug) BETWEEN 1 AND 80),
  name TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 120),
  short_description TEXT NOT NULL CHECK (length(short_description) BETWEEN 1 AND 600),
  long_description TEXT NOT NULL CHECK (length(long_description) <= 8000),
  categories_json TEXT NOT NULL CHECK (json_valid(categories_json) AND json_type(categories_json) = 'array'),
  -- Lower ranks are featured first; NULL is not featured.
  featured_rank INTEGER CHECK (featured_rank IS NULL OR featured_rank >= 0),
  status TEXT NOT NULL CHECK (status IN ('active', 'disabled')),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE (marketplace_id, publisher_namespace, skill_slug)
) WITHOUT ROWID;

CREATE TABLE marketplace_skill_versions (
  skill_version_id TEXT PRIMARY KEY NOT NULL
    CHECK (skill_version_id = skill_definition_id || '@' || semantic_version),
  skill_definition_id TEXT NOT NULL REFERENCES marketplace_skill_definitions(skill_definition_id),
  semantic_version TEXT NOT NULL CHECK (semantic_version GLOB '[0-9]*.[0-9]*.[0-9]*'),
  version_ordinal INTEGER NOT NULL CHECK (version_ordinal > 0),
  -- The Skill as installed: its own name, description, SKILL.md body and folder files.
  skill_name TEXT NOT NULL CHECK (length(trim(skill_name)) BETWEEN 1 AND 120),
  skill_description TEXT NOT NULL CHECK (length(trim(skill_description)) BETWEEN 1 AND 600),
  instructions_markdown TEXT NOT NULL CHECK (length(trim(instructions_markdown)) BETWEEN 1 AND 32000),
  files_json TEXT NOT NULL CHECK (json_valid(files_json) AND json_type(files_json) = 'array'),
  file_count INTEGER NOT NULL CHECK (file_count BETWEEN 0 AND 200),
  byte_size INTEGER NOT NULL CHECK (byte_size BETWEEN 0 AND 50000000),
  license_spdx TEXT NOT NULL,
  attribution TEXT NOT NULL CHECK (length(attribution) <= 4000),
  source_json TEXT NOT NULL CHECK (json_valid(source_json)),
  release_digest TEXT NOT NULL CHECK (length(release_digest) = 64),
  status TEXT NOT NULL CHECK (status IN ('published', 'withdrawn')),
  published_at INTEGER NOT NULL,
  UNIQUE (skill_definition_id, version_ordinal),
  UNIQUE (skill_definition_id, semantic_version)
) WITHOUT ROWID;

CREATE TABLE memory_mutation_proposals (
  proposal_id TEXT PRIMARY KEY NOT NULL,
  owner_id TEXT NOT NULL REFERENCES "user"("id"),
  conversation_id TEXT NOT NULL,
  agent_id TEXT NOT NULL,
  profile_version INTEGER NOT NULL CHECK (profile_version >= 1),
  client_operation_id TEXT NOT NULL,
  mutation_json TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending', 'approved', 'rejected')),
  result_memory_id TEXT,
  result_json TEXT,
  created_at INTEGER NOT NULL,
  resolved_at INTEGER, approval_claimed_at INTEGER,
  UNIQUE (owner_id, client_operation_id)
) WITHOUT ROWID;

CREATE TABLE memory_operations (
  owner_id TEXT NOT NULL REFERENCES "user"("id"),
  client_operation_id TEXT NOT NULL,
  memory_id TEXT NOT NULL, operation_kind TEXT, result_version INTEGER, intent_json TEXT, result_json TEXT,
  PRIMARY KEY (owner_id, client_operation_id)
) WITHOUT ROWID;

CREATE TABLE memory_records (
  memory_id TEXT PRIMARY KEY NOT NULL,
  owner_id TEXT NOT NULL REFERENCES "user"("id"),
  scope_kind TEXT NOT NULL CHECK (scope_kind IN ('agent-private', 'conversation-shared')),
  scope_id TEXT NOT NULL,
  content TEXT NOT NULL,
  source_message_id TEXT,
  version INTEGER NOT NULL CHECK (version >= 1),
  status TEXT NOT NULL CHECK (status IN ('active', 'retracted')),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
, creator_kind TEXT NOT NULL DEFAULT 'owner', creator_agent_id TEXT, creator_profile_version INTEGER, source_conversation_id TEXT, last_operation_id TEXT, provenance_json TEXT NOT NULL DEFAULT '[]', metadata_json TEXT NOT NULL
  DEFAULT '{"kind":"note"}' CHECK (json_valid(metadata_json))) WITHOUT ROWID;

CREATE VIRTUAL TABLE memory_records_fts USING fts5(
  memory_id UNINDEXED,
  owner_id UNINDEXED,
  scope_kind UNINDEXED,
  scope_id UNINDEXED,
  status UNINDEXED,
  version UNINDEXED,
  content,
  tokenize = 'unicode61 remove_diacritics 2'
);

CREATE TABLE memory_scope_revisions (
  owner_id TEXT NOT NULL REFERENCES "user"("id"),
  scope_kind TEXT NOT NULL CHECK (scope_kind IN ('agent-private', 'conversation-shared')),
  scope_id TEXT NOT NULL,
  content_revision INTEGER NOT NULL CHECK (content_revision >= 1),
  privacy_revision INTEGER NOT NULL CHECK (privacy_revision >= 0),
  exclude_before_created_at INTEGER,
  PRIMARY KEY (owner_id, scope_kind, scope_id)
) WITHOUT ROWID;

CREATE TABLE meta_attribution (
  user_id TEXT PRIMARY KEY REFERENCES "user"("id") ON DELETE CASCADE,
  fbp TEXT,
  fbc TEXT,
  updated_at INTEGER NOT NULL
);

CREATE TABLE meta_conversion_events (
  event_id TEXT PRIMARY KEY,
  created_at INTEGER NOT NULL
);

CREATE TABLE monetization_allowance_waits (
  workspace_id TEXT NOT NULL REFERENCES workspaces(workspace_id),
  conversation_id TEXT NOT NULL,
  owner_id TEXT NOT NULL,
  invocation_id TEXT NOT NULL,
  operation_key TEXT NOT NULL,
  created_at INTEGER NOT NULL, usage_unit TEXT NOT NULL DEFAULT 'execution.credit'
CHECK (
  length(usage_unit) BETWEEN 1 AND 128
    AND usage_unit GLOB '[a-z]*'
    AND usage_unit NOT GLOB '*[^a-z0-9._-]*'
), feature_key TEXT, required_entitlement_key TEXT,
  PRIMARY KEY (conversation_id, invocation_id, operation_key)
) WITHOUT ROWID;

CREATE TABLE monetization_funding_wakes (
  workspace_id TEXT NOT NULL REFERENCES workspaces(workspace_id),
  credit_identity_kind TEXT NOT NULL CHECK (
    credit_identity_kind IN ('configured-feature', 'retained-legacy')
  ),
  feature_key TEXT,
  required_entitlement_key TEXT,
  usage_unit TEXT NOT NULL CHECK (
    length(usage_unit) BETWEEN 1 AND 128
      AND usage_unit GLOB '[a-z]*'
      AND usage_unit NOT GLOB '*[^a-z0-9._-]*'
  ),
  source_position TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  CHECK (
    (credit_identity_kind = 'configured-feature' AND feature_key IS NOT NULL
      AND required_entitlement_key IS NOT NULL)
      OR (credit_identity_kind = 'retained-legacy' AND feature_key IS NULL
        AND required_entitlement_key IS NULL)
  )
);

CREATE TABLE monetization_rate_limit_windows (
  workspace_id TEXT NOT NULL REFERENCES workspaces(workspace_id),
  action TEXT NOT NULL,
  window_started_at INTEGER NOT NULL,
  request_count INTEGER NOT NULL CHECK (request_count >= 1),
  rejected_count INTEGER NOT NULL DEFAULT 0 CHECK (rejected_count >= 0),
  PRIMARY KEY (workspace_id, action)
) WITHOUT ROWID;

CREATE TABLE monetization_repair_commands (
  repair_id TEXT PRIMARY KEY NOT NULL,
  operation_id TEXT NOT NULL REFERENCES paid_work_operations(operation_id),
  action TEXT NOT NULL CHECK (action = 'retry-settlement'),
  state TEXT NOT NULL CHECK (state IN ('pending', 'completed', 'failed')),
  failure_code TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
) WITHOUT ROWID;

CREATE TABLE monetization_usage_facts (
  usage_fact_id TEXT PRIMARY KEY NOT NULL,
  workspace_id TEXT NOT NULL REFERENCES workspaces(workspace_id),
  operation_id TEXT NOT NULL REFERENCES paid_work_operations(operation_id),
  fact_kind TEXT NOT NULL CHECK (fact_kind IN ('inference', 'computer-runtime')),
  physical_identity TEXT NOT NULL,
  fact_fingerprint TEXT NOT NULL,
  measured_json TEXT NOT NULL,
  evidence_quality TEXT NOT NULL CHECK (
    evidence_quality IN ('provider-measured', 'application-observed', 'missing')
  ),
  observed_at INTEGER NOT NULL,
  UNIQUE (operation_id, physical_identity)
) WITHOUT ROWID;

CREATE TABLE notification_channel_link_tokens (
  token_hash TEXT PRIMARY KEY NOT NULL,
  user_id TEXT NOT NULL REFERENCES "user"("id"),
  kind TEXT NOT NULL CHECK (kind IN ('telegram')),
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  consumed_at INTEGER
, claim_id TEXT) WITHOUT ROWID;

CREATE TABLE notification_channels (
  user_id TEXT NOT NULL REFERENCES "user"("id"),
  kind TEXT NOT NULL CHECK (kind IN ('telegram')),
  address TEXT NOT NULL,
  display_name TEXT,
  status TEXT NOT NULL CHECK (status IN ('active', 'revoked')),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  last_notified_at INTEGER,
  PRIMARY KEY (user_id, kind)
) WITHOUT ROWID;

CREATE TABLE notification_preferences (
  user_id TEXT NOT NULL REFERENCES "user"("id"),
  notification_type TEXT NOT NULL CHECK (length(notification_type) BETWEEN 1 AND 64),
  enabled INTEGER NOT NULL CHECK (enabled IN (0, 1)),
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, notification_type)
) WITHOUT ROWID;

CREATE TABLE option_a_release_lock (
  singleton INTEGER PRIMARY KEY NOT NULL CHECK (singleton = 1),
  release_id TEXT NOT NULL,
  lease_token TEXT NOT NULL,
  lease_expires_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
) WITHOUT ROWID;

CREATE TABLE option_a_release_observations (
  release_id TEXT NOT NULL REFERENCES option_a_releases(release_id),
  stage_percentage INTEGER NOT NULL CHECK (stage_percentage IN (0, 5, 25, 50, 100)),
  observation_index INTEGER NOT NULL CHECK (observation_index >= 0),
  observed_deployment_id TEXT,
  candidate_version_id TEXT NOT NULL,
  stable_version_id TEXT NOT NULL,
  sample_count INTEGER NOT NULL CHECK (sample_count >= 0),
  request_count INTEGER NOT NULL CHECK (request_count >= 0),
  error_rate REAL,
  p95_latency_millis INTEGER,
  oldest_pending_age_millis INTEGER,
  uncertain_operation_count INTEGER,
  outcome TEXT NOT NULL CHECK (outcome IN ('healthy', 'unhealthy', 'missing-evidence')),
  observed_at INTEGER NOT NULL,
  PRIMARY KEY (release_id, stage_percentage, observation_index)
) WITHOUT ROWID;

CREATE TABLE option_a_release_request_samples (
  sample_id TEXT PRIMARY KEY NOT NULL,
  release_id TEXT NOT NULL REFERENCES option_a_releases(release_id),
  worker_version_id TEXT NOT NULL,
  observed_at INTEGER NOT NULL,
  duration_millis INTEGER NOT NULL CHECK (duration_millis >= 0),
  status_code INTEGER CHECK (status_code BETWEEN 100 AND 599),
  outcome TEXT NOT NULL CHECK (outcome IN ('attempted', 'completed', 'failed'))
) WITHOUT ROWID;

CREATE TABLE option_a_releases (
  release_id TEXT PRIMARY KEY NOT NULL,
  source_commit TEXT NOT NULL,
  baseline_source_commit TEXT NOT NULL,
  worker_script_name TEXT NOT NULL,
  classification TEXT NOT NULL CHECK (classification IN (
    'ApplicationCompatible', 'SchemaCompatibilityChange'
  )),
  candidate_version_id TEXT UNIQUE,
  stable_version_id TEXT,
  current_stage_percentage INTEGER NOT NULL DEFAULT 0 CHECK (
    current_stage_percentage IN (0, 5, 25, 50, 100)
  ),
  status TEXT NOT NULL CHECK (status IN (
    'uploading', 'observing', 'completed', 'rolled-back', 'failed'
  )),
  policy_json TEXT NOT NULL CHECK (json_valid(policy_json)),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
) WITHOUT ROWID;

CREATE TABLE owner_preferences (
  owner_id TEXT PRIMARY KEY NOT NULL REFERENCES "user"("id"),
  timezone TEXT NOT NULL DEFAULT 'UTC',
  language TEXT NOT NULL DEFAULT 'en',
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'soft-deleted')),
  deactivated_at INTEGER
, automatic_time_zone INTEGER NOT NULL DEFAULT 1, calendar_alert_minutes INTEGER DEFAULT 15) WITHOUT ROWID;

CREATE TABLE "owner_welcome_tours" (
  owner_id TEXT PRIMARY KEY NOT NULL REFERENCES "user"("id"),
  completed_at INTEGER,
  heard_from TEXT CHECK (heard_from IS NULL OR heard_from IN (
    'instagram', 'tiktok', 'threads', 'facebook', 'x', 'youtube', 'linkedin', 'google', 'friend', 'other'
  )),
  heard_from_other TEXT CHECK (heard_from_other IS NULL OR length(heard_from_other) BETWEEN 1 AND 100),
  occupation TEXT CHECK (occupation IS NULL OR occupation IN (
    'business-owner', 'employee', 'freelancer', 'developer', 'creator', 'student', 'other'
  )),
  occupation_other TEXT CHECK (occupation_other IS NULL OR length(occupation_other) BETWEEN 1 AND 100)
) WITHOUT ROWID;

CREATE TABLE owner_workspace_file_message_attachments (
  workspace_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  client_operation_id TEXT NOT NULL,
  position INTEGER NOT NULL CHECK (position BETWEEN 0 AND 9),
  attachment_id TEXT NOT NULL UNIQUE,
  file_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending', 'grant-active')),
  grant_id TEXT,
  display_name TEXT,
  media_type TEXT,
  byte_size INTEGER CHECK (byte_size IS NULL OR byte_size BETWEEN 1 AND 100000000),
  updated_at INTEGER NOT NULL, grant_version INTEGER CHECK (grant_version IS NULL OR grant_version >= 1), grant_activated_by_intent INTEGER CHECK (
    grant_activated_by_intent IS NULL OR grant_activated_by_intent IN (0, 1)
  ),
  PRIMARY KEY (workspace_id, user_id, client_operation_id, position),
  FOREIGN KEY (workspace_id, user_id, client_operation_id)
    REFERENCES owner_workspace_file_message_intents(workspace_id, user_id, client_operation_id),
  FOREIGN KEY (file_id, workspace_id) REFERENCES workspace_files(file_id, workspace_id),
  FOREIGN KEY (grant_id) REFERENCES workspace_file_grants(grant_id),
  CHECK (
    (status = 'pending' AND grant_id IS NULL AND display_name IS NULL
      AND media_type IS NULL AND byte_size IS NULL)
    OR (status = 'grant-active' AND grant_id IS NOT NULL AND display_name IS NOT NULL
      AND media_type IS NOT NULL AND byte_size IS NOT NULL)
  )
) WITHOUT ROWID;

CREATE TABLE owner_workspace_file_message_intents (
  workspace_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  owner_id TEXT NOT NULL,
  client_operation_id TEXT NOT NULL,
  conversation_id TEXT NOT NULL,
  content TEXT NOT NULL CHECK (length(content) BETWEEN 1 AND 20000),
  mentions_json TEXT NOT NULL,
  temporal_client_now INTEGER NOT NULL,
  temporal_time_zone TEXT NOT NULL,
  temporal_utc_offset_minutes INTEGER NOT NULL CHECK (
    temporal_utc_offset_minutes BETWEEN -840 AND 840
  ),
  reply_to_message_id TEXT,
  status TEXT NOT NULL CHECK (status IN ('pending', 'committed', 'failed')),
  failure_code TEXT CHECK (failure_code IN ('access-lost', 'destination-unavailable')),
  message_id TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  committed_at INTEGER,
  PRIMARY KEY (workspace_id, user_id, client_operation_id),
  FOREIGN KEY (workspace_id, user_id)
    REFERENCES workspace_memberships(workspace_id, user_id),
  FOREIGN KEY (workspace_id, conversation_id)
    REFERENCES workspace_conversations(workspace_id, conversation_id),
  CHECK (
    (status = 'pending' AND failure_code IS NULL AND message_id IS NULL AND committed_at IS NULL)
    OR (status = 'committed' AND failure_code IS NULL AND message_id IS NOT NULL
      AND committed_at IS NOT NULL)
    OR (status = 'failed' AND failure_code IS NOT NULL AND message_id IS NULL
      AND committed_at IS NULL)
  )
) WITHOUT ROWID;

CREATE TABLE "paid_work_operations" (
  operation_id TEXT PRIMARY KEY NOT NULL,
  workspace_id TEXT NOT NULL REFERENCES workspaces(workspace_id),
  work_kind TEXT NOT NULL CHECK (work_kind IN ('inference', 'computer-runtime', 'web-search')),
  request_fingerprint TEXT NOT NULL,
  state TEXT NOT NULL CHECK (state IN (
    'reservation-pending', 'allowance-blocked', 'reserved', 'executing',
    'settlement-pending', 'settled', 'released', 'reconciliation-required'
  )),
  reserved_quantity TEXT CHECK (
    reserved_quantity IS NULL OR (
      length(reserved_quantity) > 0 AND reserved_quantity NOT GLOB '*[^0-9]*'
    )
  ),
  reservation_mode TEXT NOT NULL DEFAULT 'exact'
    CHECK (reservation_mode IN ('exact', 'up-to-available')),
  reservation_maximum_quantity TEXT NOT NULL DEFAULT '0' CHECK (
    length(reservation_maximum_quantity) > 0
      AND reservation_maximum_quantity NOT GLOB '*[^0-9]*'
  ),
  reservation_minimum_quantity TEXT CHECK (
    reservation_minimum_quantity IS NULL OR reservation_minimum_quantity = '1'
  ),
  actual_quantity TEXT CHECK (
    actual_quantity IS NULL OR (length(actual_quantity) > 0 AND actual_quantity NOT GLOB '*[^0-9]*')
  ),
  rate_revision TEXT NOT NULL,
  required_entitlement_key TEXT,
  expected_source_position TEXT CHECK (
    expected_source_position IS NULL OR (
      length(expected_source_position) BETWEEN 1 AND 78
        AND expected_source_position NOT GLOB '*[^0-9]*'
        AND (expected_source_position = '0' OR substr(expected_source_position, 1, 1) <> '0')
    )
  ),
  reservation_id TEXT UNIQUE,
  reservation_expires_at INTEGER,
  settlement_id TEXT UNIQUE,
  settlement_kind TEXT CHECK (settlement_kind IS NULL OR settlement_kind IN ('usage', 'release')),
  release_evidence TEXT CHECK (
    release_evidence IS NULL OR release_evidence = 'provider-dispatch-not-attempted'
  ),
  failure_code TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  usage_unit TEXT CHECK (
    usage_unit IS NULL OR (
      length(usage_unit) BETWEEN 1 AND 128
        AND usage_unit GLOB '[a-z]*'
        AND usage_unit NOT GLOB '*[^a-z0-9._-]*'
    )
  ),
  feature_key TEXT,
  feature_revision TEXT,
  rating_metadata_json TEXT CHECK (
    rating_metadata_json IS NULL OR json_valid(rating_metadata_json)
  ),
  rating_evidence_json TEXT CHECK (
    rating_evidence_json IS NULL OR json_valid(rating_evidence_json)
  ),
  credit_protocol TEXT NOT NULL DEFAULT 'checkpoint-v2'
    CHECK (credit_protocol IN ('checkpoint-v2', 'native-v2')),
  admission_command_json TEXT CHECK (
    admission_command_json IS NULL OR json_valid(admission_command_json)
  ),
  admission_receipt_json TEXT CHECK (
    admission_receipt_json IS NULL OR json_valid(admission_receipt_json)
  ),
  CHECK (
    (credit_protocol = 'checkpoint-v2'
      AND reserved_quantity IS NOT NULL
      AND usage_unit IS NOT NULL
      AND required_entitlement_key IS NOT NULL
      AND expected_source_position IS NOT NULL
      AND admission_command_json IS NULL)
    OR (credit_protocol = 'native-v2'
      AND feature_key IS NOT NULL
      AND admission_command_json IS NOT NULL)
  ),
  CHECK (
    admission_receipt_json IS NULL OR (
      reserved_quantity IS NOT NULL
      AND reservation_id IS NOT NULL
      AND reservation_expires_at IS NOT NULL
      AND feature_revision IS NOT NULL
      AND usage_unit IS NOT NULL
      AND required_entitlement_key IS NOT NULL
      AND expected_source_position IS NOT NULL
    )
  ),
  CHECK (
    credit_protocol <> 'native-v2'
      OR state IN ('reservation-pending', 'allowance-blocked')
      OR admission_receipt_json IS NOT NULL
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

CREATE TABLE plugin_app_operations (
  user_id TEXT NOT NULL REFERENCES "user"(id),
  client_operation_id TEXT NOT NULL,
  operation TEXT NOT NULL CHECK (operation IN ('install', 'update', 'uninstall')),
  request_json TEXT NOT NULL,
  installation_id TEXT NOT NULL REFERENCES plugin_installations(installation_id),
  created_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, client_operation_id)
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
, approval_scope TEXT NOT NULL DEFAULT 'call'
  CHECK (approval_scope IN ('call', 'turn'))) WITHOUT ROWID;

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

CREATE TABLE plugin_bulk_grant_operations (
  workspace_id TEXT NOT NULL REFERENCES workspaces(workspace_id),
  client_operation_id TEXT NOT NULL,
  connection_id TEXT NOT NULL REFERENCES plugin_connections(connection_id),
  request_json TEXT NOT NULL,
  agent_ids_json TEXT NOT NULL,
  expected_revisions_json TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (workspace_id, client_operation_id)
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

CREATE TABLE plugin_connection_monitoring (
  connection_id TEXT PRIMARY KEY NOT NULL REFERENCES plugin_connections(connection_id),
  workspace_id TEXT NOT NULL REFERENCES workspaces(workspace_id),
  owner_user_id TEXT NOT NULL REFERENCES user(id),
  plugin_version_id TEXT NOT NULL,
  catalog_digest TEXT NOT NULL,
  provider_registration_id TEXT NOT NULL REFERENCES provider_registrations(provider_registration_id),
  provider_account_subject TEXT NOT NULL CHECK (length(provider_account_subject) BETWEEN 1 AND 300),
  connection_revision INTEGER NOT NULL CHECK (connection_revision BETWEEN 1 AND 2147483647),
  consent_version INTEGER NOT NULL CHECK (consent_version BETWEEN 1 AND 2147483647),
  desired_state TEXT NOT NULL CHECK (desired_state IN ('enabled', 'disabled')),
  last_operation_id TEXT NOT NULL CHECK (length(last_operation_id) BETWEEN 1 AND 160),
  created_at INTEGER NOT NULL CHECK (created_at >= 0),
  updated_at INTEGER NOT NULL CHECK (updated_at >= created_at),
  FOREIGN KEY (plugin_version_id, catalog_digest)
    REFERENCES plugin_version_event_catalogs(plugin_version_id, catalog_digest)
) WITHOUT ROWID;

CREATE TABLE plugin_connection_monitoring_operations (
  connection_id TEXT NOT NULL REFERENCES plugin_connections(connection_id),
  operation_id TEXT NOT NULL CHECK (length(operation_id) BETWEEN 1 AND 160),
  workspace_id TEXT NOT NULL REFERENCES workspaces(workspace_id),
  owner_user_id TEXT NOT NULL REFERENCES user(id),
  request_digest TEXT NOT NULL CHECK (
    length(request_digest) = 64 AND request_digest NOT GLOB '*[^0-9a-f]*'
  ),
  applied_version INTEGER NOT NULL CHECK (applied_version BETWEEN 0 AND 2147483647),
  created_at INTEGER NOT NULL CHECK (created_at >= 0),
  PRIMARY KEY (connection_id, operation_id)
) WITHOUT ROWID;

CREATE TABLE plugin_connection_monitoring_outbox (
  connection_id TEXT PRIMARY KEY NOT NULL REFERENCES plugin_connection_monitoring(connection_id),
  target_version INTEGER NOT NULL CHECK (target_version BETWEEN 1 AND 2147483647),
  status TEXT NOT NULL CHECK (status IN ('pending', 'acknowledged')),
  attempts INTEGER NOT NULL CHECK (attempts BETWEEN 0 AND 1000000),
  next_attempt_at INTEGER NOT NULL CHECK (next_attempt_at >= 0),
  last_reason TEXT CHECK (last_reason IS NULL OR last_reason IN (
    'platform-unavailable', 'source-unavailable', 'transport', 'authorization'
  )),
  updated_at INTEGER NOT NULL CHECK (updated_at >= 0)
) WITHOUT ROWID;

CREATE TABLE plugin_connection_monitoring_versions (
  connection_id TEXT NOT NULL REFERENCES plugin_connections(connection_id),
  consent_version INTEGER NOT NULL CHECK (consent_version BETWEEN 1 AND 2147483647),
  operation_id TEXT NOT NULL CHECK (length(operation_id) BETWEEN 1 AND 160),
  snapshot_json TEXT NOT NULL CHECK (
    length(CAST(snapshot_json AS BLOB)) BETWEEN 1 AND 16384 AND json_valid(snapshot_json)
    AND COALESCE(json_extract(snapshot_json, '$.connectionId') = connection_id
      AND json_extract(snapshot_json, '$.version') = consent_version, 0)
  ),
  PRIMARY KEY (connection_id, consent_version)
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
  updated_at INTEGER NOT NULL, selected_resource_id TEXT CHECK (
  selected_resource_id IS NULL OR length(selected_resource_id) BETWEEN 1 AND 300
), selected_resource_label TEXT CHECK (
  selected_resource_label IS NULL OR length(selected_resource_label) BETWEEN 1 AND 160
),
  UNIQUE (activation_id, client_operation_id)
) WITHOUT ROWID;

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
  updated_at INTEGER NOT NULL, logo_domain TEXT CHECK (
  logo_domain IS NULL OR (
    length(logo_domain) BETWEEN 4 AND 253
    AND logo_domain NOT GLOB '*[^a-z0-9.-]*'
    AND instr(logo_domain, '.') > 1
    AND logo_domain NOT LIKE '%.'
    AND logo_domain NOT LIKE '%..%'
  )
),
  UNIQUE (marketplace_id, publisher_namespace, plugin_slug)
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

CREATE TABLE plugin_gmail_mailboxes (
  connection_id TEXT PRIMARY KEY NOT NULL REFERENCES plugin_connections(connection_id),
  workspace_id TEXT NOT NULL REFERENCES workspaces(workspace_id),
  owner_user_id TEXT NOT NULL REFERENCES user(id),
  consent_version INTEGER NOT NULL CHECK(consent_version BETWEEN 1 AND 2147483647),
  connection_revision INTEGER NOT NULL CHECK(connection_revision BETWEEN 1 AND 2147483647),
  plugin_version_id TEXT NOT NULL,
  catalog_digest TEXT NOT NULL CHECK(length(catalog_digest)=64),
  binding_id TEXT NOT NULL CHECK(length(binding_id) BETWEEN 1 AND 64),
  watch_project_digest TEXT NOT NULL CHECK(length(watch_project_digest)=64),
  client_authority_digest TEXT NOT NULL CHECK(length(client_authority_digest)=64),
  mailbox_address TEXT NOT NULL CHECK(length(mailbox_address) BETWEEN 3 AND 320 AND mailbox_address=lower(mailbox_address)),
  watch_generation INTEGER NOT NULL CHECK(watch_generation BETWEEN 1 AND 2147483647),
  confirmed_at INTEGER NOT NULL CHECK(confirmed_at>=0),
  expires_at INTEGER NOT NULL CHECK(expires_at>confirmed_at),
  updated_at INTEGER NOT NULL CHECK(updated_at>=confirmed_at),
  FOREIGN KEY(plugin_version_id,catalog_digest) REFERENCES plugin_version_event_catalogs(plugin_version_id,catalog_digest)
) WITHOUT ROWID;

CREATE TABLE plugin_grant_revision_history (
  grant_id TEXT NOT NULL REFERENCES agent_plugin_grants(grant_id),
  revision INTEGER NOT NULL CHECK (revision >= 1),
  status TEXT NOT NULL CHECK (status IN ('active', 'revoked')),
  tools_json TEXT NOT NULL,
  recorded_at INTEGER NOT NULL,
  PRIMARY KEY (grant_id, revision)
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

CREATE TABLE "plugin_invocation_attempts" (
  attempt_id TEXT PRIMARY KEY NOT NULL,
  invocation_id TEXT NOT NULL REFERENCES plugin_invocations(invocation_id),
  attempt_number INTEGER NOT NULL CHECK (attempt_number >= 1),
  code_sandbox_id TEXT NOT NULL,
  code_sandbox_generation INTEGER NOT NULL CHECK (code_sandbox_generation >= 1),
  status TEXT NOT NULL CHECK (status IN ('starting', 'running', 'completed', 'failed', 'cancelled', 'timed-out', 'orphaned')),
  started_at INTEGER,
  deadline_at INTEGER NOT NULL,
  finished_at INTEGER,
  UNIQUE (invocation_id, attempt_number)
) WITHOUT ROWID;

CREATE TABLE plugin_invocation_audit (
  audit_id TEXT PRIMARY KEY NOT NULL,
  invocation_id TEXT NOT NULL REFERENCES plugin_invocations(invocation_id),
  tool_call_id TEXT REFERENCES plugin_tool_calls(tool_call_id),
  event_kind TEXT NOT NULL,
  safe_details_json TEXT NOT NULL,
  recorded_at INTEGER NOT NULL
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
  completed_at INTEGER, agent_work_id TEXT, logical_operation_id TEXT, logical_request_fingerprint TEXT,
  UNIQUE (agent_id, conversation_id, turn_id, native_tool_call_id)
) WITHOUT ROWID;

CREATE TABLE plugin_marketplaces (
  marketplace_id TEXT PRIMARY KEY NOT NULL,
  name TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 120),
  visibility TEXT NOT NULL CHECK (visibility = 'public'),
  trust_class TEXT NOT NULL CHECK (trust_class = 'supernala-curated'),
  status TEXT NOT NULL CHECK (status IN ('active', 'disabled')),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
) WITHOUT ROWID;

CREATE TABLE plugin_normalized_events (
  event_id TEXT PRIMARY KEY NOT NULL CHECK(length(event_id)=64),
  connection_id TEXT NOT NULL REFERENCES plugin_connections(connection_id),
  workspace_id TEXT NOT NULL REFERENCES workspaces(workspace_id),
  owner_user_id TEXT NOT NULL REFERENCES user(id),
  connection_revision INTEGER NOT NULL CHECK(connection_revision BETWEEN 1 AND 2147483647),
  consent_version INTEGER NOT NULL CHECK(consent_version BETWEEN 1 AND 2147483647),
  plugin_version_id TEXT NOT NULL,
  catalog_digest TEXT NOT NULL,
  source_generation INTEGER NOT NULL CHECK(source_generation BETWEEN 1 AND 2147483647),
  payload_digest TEXT NOT NULL CHECK(length(payload_digest)=64),
  payload_json TEXT CHECK(payload_json IS NULL OR (json_valid(payload_json) AND length(CAST(payload_json AS BLOB))<=65536)),
  observed_at INTEGER NOT NULL CHECK(observed_at>=0),
  published_at INTEGER NOT NULL CHECK(published_at>=0),
  expires_at INTEGER NOT NULL CHECK(expires_at>published_at),
  fanout_at INTEGER,
  purged_at INTEGER,
  CHECK((payload_json IS NULL AND purged_at IS NOT NULL) OR (payload_json IS NOT NULL AND purged_at IS NULL)),
  FOREIGN KEY(plugin_version_id,catalog_digest) REFERENCES plugin_version_event_catalogs(plugin_version_id,catalog_digest)
) WITHOUT ROWID;

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
  retirement_reason TEXT CHECK (retirement_reason IS NULL OR length(retirement_reason) BETWEEN 1 AND 160), material_origin TEXT NOT NULL DEFAULT 'deployment-environment'
    CHECK (material_origin IN (
      'deployment-environment', 'dynamic-registration', 'client-id-metadata-document'
    )),
  PRIMARY KEY (provider_registration_id, source_revision),
  UNIQUE (provider_registration_id, material_version),
  UNIQUE (provider_registration_id, declaration_id),
  CHECK (
    (status = 'active' AND retired_at IS NULL AND retirement_reason IS NULL)
    OR (status = 'retired' AND retired_at IS NOT NULL AND retirement_reason IS NOT NULL)
  )
) WITHOUT ROWID;

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

CREATE TABLE "plugin_oauth_runtime_attempts" (
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

CREATE TABLE "plugin_publication_intents" (
  publication_intent_id TEXT PRIMARY KEY NOT NULL,
  plugin_version_id TEXT NOT NULL UNIQUE REFERENCES plugin_versions(plugin_version_id),
  artifact_digest TEXT REFERENCES plugin_artifacts(artifact_digest),
  status TEXT NOT NULL CHECK (status IN ('pending', 'artifact-verified', 'published', 'failed')),
  attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  available_at INTEGER NOT NULL,
  last_failure_reason TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
, provider_registration_material_source_revision INTEGER
    CHECK (provider_registration_material_source_revision IS NULL
      OR provider_registration_material_source_revision >= 1)) WITHOUT ROWID;

CREATE TABLE plugin_remote_invocation_facts (
  tool_call_id TEXT PRIMARY KEY NOT NULL REFERENCES plugin_tool_calls(tool_call_id),
  invocation_id TEXT NOT NULL REFERENCES plugin_invocations(invocation_id),
  plugin_version_id TEXT NOT NULL REFERENCES plugin_versions(plugin_version_id),
  connection_id TEXT NOT NULL REFERENCES plugin_connections(connection_id),
  latency_millis INTEGER NOT NULL CHECK (latency_millis >= 0),
  outcome TEXT NOT NULL CHECK (outcome IN ('completed', 'failed', 'cancelled', 'uncertain')),
  observed_at INTEGER NOT NULL
) WITHOUT ROWID;

CREATE TABLE plugin_result_actions (
  action_id TEXT PRIMARY KEY NOT NULL,
  completed_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  purged_at INTEGER
);

CREATE TABLE plugin_result_files (
  action_id TEXT NOT NULL,
  revision TEXT NOT NULL,
  source_kind TEXT NOT NULL CHECK (source_kind IN ('action', 'program')),
  approval_id TEXT,
  workspace_id TEXT NOT NULL,
  agent_id TEXT NOT NULL,
  conversation_id TEXT NOT NULL,
  plugin_name TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending', 'published')),
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  result_bytes INTEGER NOT NULL,
  result_sha256 TEXT NOT NULL,
  content_bytes INTEGER NOT NULL,
  content_sha256 TEXT NOT NULL,
  metadata_bytes INTEGER,
  metadata_sha256 TEXT,
  PRIMARY KEY (action_id, revision)
);

CREATE TABLE plugin_service_event_deliveries (
  delivery_id TEXT PRIMARY KEY NOT NULL CHECK(length(delivery_id)=64),
  event_id TEXT NOT NULL REFERENCES plugin_normalized_events(event_id),
  subscription_id TEXT NOT NULL REFERENCES plugin_service_event_subscriptions(subscription_id),
  subscription_version INTEGER NOT NULL CHECK(subscription_version BETWEEN 1 AND 2147483647),
  service_id TEXT NOT NULL REFERENCES workspace_services(service_id),
  activation_epoch INTEGER CHECK(activation_epoch BETWEEN 0 AND 2147483647),
  state TEXT NOT NULL CHECK(state IN ('queued','delivering','admitted','skipped','cancelled','expired','reconciliation-required')),
  reason TEXT CHECK(reason IN ('paused','archived','budget','subscription-changed','source-unavailable','activation-changed','target-unavailable','admission-denied','expired','admission-unknown')),
  attempts INTEGER NOT NULL DEFAULT 0 CHECK(attempts BETWEEN 0 AND 20),
  lease_version INTEGER NOT NULL DEFAULT 0 CHECK(lease_version BETWEEN 0 AND 2147483647),
  lease_until INTEGER,
  next_attempt_at INTEGER NOT NULL CHECK(next_attempt_at>=0),
  invocation_id TEXT,
  created_at INTEGER NOT NULL CHECK(created_at>=0),
  updated_at INTEGER NOT NULL CHECK(updated_at>=created_at),
  UNIQUE(event_id,subscription_id),
  CHECK((state='admitted' AND invocation_id IS NOT NULL) OR (state<>'admitted' AND invocation_id IS NULL)),
  CHECK((state='delivering' AND lease_until IS NOT NULL) OR (state<>'delivering' AND lease_until IS NULL)),
  CHECK((state IN ('skipped','cancelled','expired','reconciliation-required') AND reason IS NOT NULL) OR (state NOT IN ('skipped','cancelled','expired','reconciliation-required') AND reason IS NULL))
) WITHOUT ROWID;

CREATE TABLE plugin_service_event_subscription_operations (
  subscription_id TEXT NOT NULL REFERENCES plugin_service_event_subscriptions(subscription_id),
  operation_id TEXT NOT NULL,
  request_digest TEXT NOT NULL CHECK (length(request_digest) = 64),
  applied_version INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (subscription_id, operation_id),
  FOREIGN KEY (subscription_id, applied_version)
    REFERENCES plugin_service_event_subscription_versions(subscription_id, subscription_version)
) WITHOUT ROWID;

CREATE TABLE plugin_service_event_subscription_versions (
  subscription_id TEXT NOT NULL REFERENCES plugin_service_event_subscriptions(subscription_id),
  subscription_version INTEGER NOT NULL CHECK (subscription_version BETWEEN 1 AND 2147483647),
  canonical_subscription_json TEXT NOT NULL CHECK (
    json_valid(canonical_subscription_json)
    AND length(CAST(canonical_subscription_json AS BLOB)) <= 16384
    AND COALESCE(json_extract(canonical_subscription_json, '$.id') = subscription_id, 0)
    AND COALESCE(json_extract(canonical_subscription_json, '$.version') = subscription_version, 0)
  ),
  created_at INTEGER NOT NULL,
  PRIMARY KEY (subscription_id, subscription_version)
) WITHOUT ROWID;

CREATE TABLE plugin_service_event_subscriptions (
  subscription_id TEXT PRIMARY KEY NOT NULL CHECK (length(subscription_id) = 64),
  workspace_id TEXT NOT NULL REFERENCES workspaces(workspace_id),
  owner_user_id TEXT NOT NULL REFERENCES user(id),
  service_id TEXT NOT NULL REFERENCES workspace_services(service_id),
  trigger_index INTEGER NOT NULL CHECK (trigger_index BETWEEN 0 AND 7),
  connection_id TEXT NOT NULL REFERENCES plugin_connections(connection_id),
  connection_revision INTEGER NOT NULL CHECK (connection_revision BETWEEN 1 AND 2147483647),
  plugin_version_id TEXT NOT NULL,
  catalog_digest TEXT NOT NULL,
  event_name TEXT NOT NULL CHECK (event_name = 'gmail.message.added'),
  reviewed_service_revision_id TEXT NOT NULL,
  subscription_version INTEGER NOT NULL CHECK (subscription_version BETWEEN 1 AND 2147483647),
  desired_state TEXT NOT NULL CHECK (desired_state IN ('active', 'paused', 'revoked')),
  state_digest TEXT NOT NULL CHECK (length(state_digest) = 64),
  created_at INTEGER NOT NULL CHECK (created_at >= 0),
  updated_at INTEGER NOT NULL CHECK (updated_at >= created_at),
  UNIQUE (service_id, trigger_index),
  FOREIGN KEY (plugin_version_id, catalog_digest)
    REFERENCES plugin_version_event_catalogs(plugin_version_id, catalog_digest)
) WITHOUT ROWID;

CREATE TABLE plugin_service_remote_invocation_facts (
  tool_call_id TEXT PRIMARY KEY NOT NULL REFERENCES plugin_service_tool_calls(tool_call_id),
  latency_millis INTEGER NOT NULL CHECK(latency_millis>=0),
  outcome TEXT NOT NULL CHECK(outcome IN ('completed','failed','cancelled')),
  observed_at INTEGER NOT NULL
);

CREATE TABLE plugin_service_tool_audit (
  audit_id TEXT PRIMARY KEY NOT NULL,
  tool_call_id TEXT NOT NULL REFERENCES plugin_service_tool_calls(tool_call_id),
  event_kind TEXT NOT NULL,
  safe_details_json TEXT NOT NULL CHECK(json_valid(safe_details_json)),
  recorded_at INTEGER NOT NULL
);

CREATE TABLE plugin_service_tool_bindings (
  service_id TEXT NOT NULL REFERENCES workspace_services(service_id),
  revision_id TEXT NOT NULL,
  alias TEXT NOT NULL,
  workspace_id TEXT NOT NULL REFERENCES workspaces(workspace_id),
  owner_user_id TEXT NOT NULL REFERENCES "user"(id),
  connection_id TEXT NOT NULL REFERENCES plugin_connections(connection_id),
  connection_revision INTEGER NOT NULL CHECK(connection_revision >= 1),
  plugin_version_id TEXT NOT NULL REFERENCES plugin_versions(plugin_version_id),
  activation_id TEXT NOT NULL REFERENCES workspace_plugin_activations(activation_id),
  activation_revision INTEGER NOT NULL CHECK(activation_revision >= 1),
  installation_id TEXT NOT NULL REFERENCES plugin_installations(installation_id),
  installation_revision INTEGER NOT NULL CHECK(installation_revision >= 1),
  catalog_snapshot_id TEXT NOT NULL REFERENCES plugin_catalog_snapshots(catalog_snapshot_id),
  tool_id TEXT NOT NULL,
  mcp_name TEXT NOT NULL,
  input_schema_json TEXT NOT NULL CHECK(json_valid(input_schema_json)),
  maximum_output_bytes INTEGER NOT NULL CHECK(maximum_output_bytes BETWEEN 1 AND 1048576),
  source_fingerprint TEXT NOT NULL CHECK(length(source_fingerprint) = 64),
  reviewed_at INTEGER NOT NULL CHECK(reviewed_at >= 0),
  PRIMARY KEY(service_id, revision_id, alias),
  FOREIGN KEY(catalog_snapshot_id,tool_id) REFERENCES plugin_catalog_tools(catalog_snapshot_id,tool_id)
) WITHOUT ROWID;

CREATE TABLE plugin_service_tool_calls (
  tool_call_id TEXT PRIMARY KEY NOT NULL,
  service_id TEXT NOT NULL REFERENCES workspace_services(service_id),
  workspace_id TEXT NOT NULL REFERENCES workspaces(workspace_id),
  revision_id TEXT NOT NULL,
  alias TEXT NOT NULL,
  source_invocation_id TEXT NOT NULL,
  call_index INTEGER NOT NULL CHECK(call_index BETWEEN 0 AND 127),
  connection_id TEXT NOT NULL REFERENCES plugin_connections(connection_id),
  plugin_version_id TEXT NOT NULL REFERENCES plugin_versions(plugin_version_id),
  catalog_snapshot_id TEXT NOT NULL,
  tool_id TEXT NOT NULL,
  call_fingerprint TEXT NOT NULL CHECK(length(call_fingerprint)=64),
  source_fingerprint TEXT NOT NULL CHECK(length(source_fingerprint)=64),
  generation INTEGER NOT NULL CHECK(generation BETWEEN 1 AND 2147483647),
  deadline_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  state TEXT NOT NULL CHECK(state IN ('prepared','dispatching','completed','uncertain','failed')),
  UNIQUE(service_id,source_invocation_id,call_index),
  FOREIGN KEY(service_id,revision_id,alias) REFERENCES plugin_service_tool_bindings(service_id,revision_id,alias),
  FOREIGN KEY(catalog_snapshot_id,tool_id) REFERENCES plugin_catalog_tools(catalog_snapshot_id,tool_id)
);

CREATE TABLE plugin_terminal_turns (
  agent_id TEXT NOT NULL,
  conversation_id TEXT NOT NULL,
  turn_id TEXT NOT NULL,
  completed_at INTEGER NOT NULL,
  PRIMARY KEY (agent_id, conversation_id, turn_id)
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
  updated_at INTEGER NOT NULL, runtime_tool_definition_json TEXT
  CHECK (runtime_tool_definition_json IS NULL OR
    (json_valid(runtime_tool_definition_json) AND length(runtime_tool_definition_json) <= 65536)),
  UNIQUE (invocation_id, ordinal)
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
, service_tool_call_id TEXT REFERENCES plugin_service_tool_calls(tool_call_id)) WITHOUT ROWID;

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
  outcome TEXT NOT NULL CHECK (outcome IN ('active', 'completed', 'failed', 'cancelled', 'uncertain')), service_tool_call_id TEXT REFERENCES plugin_service_tool_calls(tool_call_id),
  PRIMARY KEY (attempt_id, sandbox_kind, sandbox_generation)
) WITHOUT ROWID;

CREATE TABLE plugin_user_event_outbox (
  sequence INTEGER PRIMARY KEY AUTOINCREMENT,
  workspace_id TEXT NOT NULL,
  user_id TEXT NOT NULL
, change_kind TEXT NOT NULL DEFAULT 'all'
CHECK (change_kind IN ('all', 'installation', 'activation', 'connection', 'grant', 'approval', 'usage')));

CREATE TABLE plugin_version_event_catalogs (
  plugin_version_id TEXT PRIMARY KEY NOT NULL REFERENCES plugin_versions(plugin_version_id),
  reviewed_manifest_digest TEXT NOT NULL CHECK (
    length(reviewed_manifest_digest) = 64 AND reviewed_manifest_digest NOT GLOB '*[^0-9a-f]*'
  ),
  catalog_digest TEXT NOT NULL CHECK (
    length(catalog_digest) = 64 AND catalog_digest NOT GLOB '*[^0-9a-f]*'
  ),
  canonical_catalog_json TEXT NOT NULL CHECK (
    length(CAST(canonical_catalog_json AS BLOB)) BETWEEN 1 AND 16384
    AND json_valid(canonical_catalog_json)
    AND COALESCE(
      json_type(canonical_catalog_json, '$.pluginVersionId') = 'text'
      AND json_extract(canonical_catalog_json, '$.pluginVersionId') = plugin_version_id
      AND json_type(canonical_catalog_json, '$.events') = 'array'
      AND json_array_length(canonical_catalog_json, '$.events') BETWEEN 1 AND 16,
      0
    )
  ),
  reviewed_at INTEGER NOT NULL CHECK (reviewed_at >= 0),
  UNIQUE (plugin_version_id, catalog_digest)
) WITHOUT ROWID;

CREATE TABLE "plugin_versions" (
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

CREATE TABLE plugin_work_approvals (
  approval_id TEXT PRIMARY KEY NOT NULL REFERENCES plugin_approvals(approval_id),
  work_id TEXT NOT NULL
, protocol TEXT NOT NULL DEFAULT 'legacy'
  CHECK (protocol IN ('legacy', 'agent-work-v1'))) WITHOUT ROWID;

CREATE TABLE portal_artifact_publications (
  revision_id TEXT PRIMARY KEY NOT NULL REFERENCES artifact_revisions(revision_id),
  home_workspace_id TEXT NOT NULL REFERENCES workspaces(workspace_id),
  operation_identity TEXT NOT NULL,
  descriptor_json TEXT NOT NULL CHECK(json_valid(descriptor_json)),
  status TEXT NOT NULL CHECK(status IN ('preparing', 'active'))
) WITHOUT ROWID;

CREATE TABLE portal_canonical_mutation_intents (
  home_workspace_id TEXT NOT NULL,
  operation_id TEXT NOT NULL,
  portal_id TEXT NOT NULL,
  resource_id TEXT NOT NULL,
  fingerprint TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('pending', 'committed', 'fenced')),
  PRIMARY KEY(home_workspace_id, operation_id)
) WITHOUT ROWID;

CREATE TABLE portal_collaboration_routes (
  portal_id TEXT PRIMARY KEY NOT NULL,
  home_workspace_id TEXT NOT NULL REFERENCES workspaces(workspace_id),
  title TEXT NOT NULL,
  promotion_operation_id TEXT NOT NULL,
  promoting_user_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('promoting', 'shared', 'archived')),
  created_at INTEGER NOT NULL
);

CREATE TABLE "portal_item_manager_discovery" (
  user_id TEXT NOT NULL,
  home_workspace_id TEXT NOT NULL,
  item_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK(kind IN ('database', 'tracker', 'site', 'artifact-revision', 'form', 'design')),
  canonical_target TEXT NOT NULL,
  epoch INTEGER NOT NULL,
  active INTEGER NOT NULL,
  PRIMARY KEY(user_id, home_workspace_id, item_id)
) WITHOUT ROWID;

CREATE TABLE portal_member_discovery (
  user_id TEXT NOT NULL,
  portal_id TEXT NOT NULL,
  home_workspace_id TEXT NOT NULL,
  epoch INTEGER NOT NULL,
  active INTEGER NOT NULL,
  PRIMARY KEY(user_id, portal_id)
) WITHOUT ROWID;

CREATE TABLE portal_promotion_operations (
  user_id TEXT NOT NULL,
  operation_id TEXT NOT NULL,
  source_identity TEXT NOT NULL,
  portal_id TEXT NOT NULL REFERENCES portal_collaboration_routes(portal_id),
  PRIMARY KEY(user_id, operation_id)
) WITHOUT ROWID;

CREATE TABLE portal_request_windows (
  request_key TEXT PRIMARY KEY NOT NULL,
  minute INTEGER NOT NULL,
  request_count INTEGER NOT NULL CHECK (request_count >= 1)
) WITHOUT ROWID;

CREATE TABLE "portal_resource_bindings" (
  kind TEXT NOT NULL CHECK(kind IN ('database', 'tracker', 'site', 'artifact-revision', 'form', 'design')),
  canonical_target TEXT NOT NULL,
  home_workspace_id TEXT NOT NULL REFERENCES workspaces(workspace_id),
  portal_id TEXT NOT NULL REFERENCES portal_collaboration_routes(portal_id),
  resource_id TEXT NOT NULL,
  title TEXT NOT NULL,
  database_resource_id TEXT,
  status TEXT NOT NULL CHECK(status IN ('promoting', 'shared', 'archived')),
  PRIMARY KEY(kind, canonical_target),
  UNIQUE(portal_id, resource_id),
  CHECK(kind NOT IN ('form', 'design') OR database_resource_id IS NULL)
) WITHOUT ROWID;

CREATE TABLE portals (
  portal_id TEXT PRIMARY KEY NOT NULL,
  workspace_id TEXT NOT NULL REFERENCES workspaces(workspace_id),
  owner_user_id TEXT NOT NULL REFERENCES "user"(id),
  revision_id TEXT NOT NULL,
  visibility TEXT NOT NULL DEFAULT 'private' CHECK (visibility IN ('private', 'public')),
  policy_version INTEGER NOT NULL DEFAULT 1 CHECK (policy_version >= 1),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE (portal_id, revision_id, workspace_id),
  FOREIGN KEY (revision_id, workspace_id) REFERENCES artifact_revisions(revision_id, workspace_id)
) WITHOUT ROWID;

CREATE TABLE prompt_image_resolution_failures (
  agent_id TEXT NOT NULL,
  conversation_id TEXT NOT NULL,
  resolution_owner TEXT NOT NULL,
  file_id TEXT NOT NULL REFERENCES workspace_files(file_id),
  storage_key TEXT NOT NULL,
  accepted_byte_size INTEGER NOT NULL CHECK (accepted_byte_size > 0),
  media_type TEXT NOT NULL,
  resolver_version INTEGER NOT NULL,
  reason TEXT CHECK (reason IN ('too-large', 'storage', 'size-mismatch', 'timeout')),
  attempts INTEGER NOT NULL CHECK (attempts BETWEEN 1 AND 3),
  retry_after INTEGER,
  claim_token TEXT NOT NULL,
  PRIMARY KEY (agent_id, conversation_id, resolution_owner, file_id,
    storage_key, accepted_byte_size, media_type, resolver_version)
) WITHOUT ROWID;

CREATE TABLE "provider_registrations" (
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

CREATE TABLE push_device_presence (
  user_id TEXT PRIMARY KEY NOT NULL REFERENCES "user"("id"),
  endpoint TEXT,
  conversation_id TEXT,
  focused INTEGER NOT NULL CHECK (focused IN (0, 1)),
  reported_at INTEGER NOT NULL
) WITHOUT ROWID;

CREATE TABLE push_subscriptions (
  subscription_id TEXT PRIMARY KEY NOT NULL,
  user_id TEXT NOT NULL REFERENCES "user"("id"),
  endpoint TEXT NOT NULL,
  subscriber_key TEXT NOT NULL,
  auth_secret TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('active', 'revoked')),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  last_notified_at INTEGER,
  UNIQUE (user_id, endpoint)
) WITHOUT ROWID;

CREATE TABLE "rateLimit" (
  "id" TEXT PRIMARY KEY NOT NULL,
  "key" TEXT NOT NULL UNIQUE,
  "count" INTEGER NOT NULL,
  "lastRequest" INTEGER NOT NULL
);

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

CREATE TABLE resource_operation_receipts (
  workspace_id TEXT NOT NULL,
  operation_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK(kind IN ('design')),
  resource_id TEXT NOT NULL,
  portal_authority_fingerprint TEXT NOT NULL,
  result_json TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY(workspace_id, operation_id)
) WITHOUT ROWID;

CREATE TABLE result_only_finalization_calls (
  operation_id TEXT PRIMARY KEY NOT NULL,
  turn_id TEXT NOT NULL,
  owner_turn TEXT NOT NULL,
  workspace_id TEXT NOT NULL REFERENCES workspaces(workspace_id),
  agent_id TEXT NOT NULL,
  result_id TEXT NOT NULL,
  thread_name TEXT NOT NULL,
  logical_attempt TEXT NOT NULL,
  model_mark_seq INTEGER NOT NULL DEFAULT 0,
  observed_tokens INTEGER,
  provider_cost_json TEXT,
  admitted_at INTEGER NOT NULL,
  last_checked_at INTEGER,
  completed_at INTEGER,
  funding_purpose TEXT NOT NULL DEFAULT 'result-finalization'
    CHECK (funding_purpose IN ('result-finalization', 'work-preservation')),
  preservation_progress INTEGER NOT NULL DEFAULT 0
) WITHOUT ROWID;

CREATE TABLE retrieval_embedding_jobs (
  entity_kind TEXT NOT NULL CHECK (entity_kind IN ('memory', 'message')),
  entity_id TEXT NOT NULL,
  owner_id TEXT NOT NULL,
  conversation_id TEXT,
  scope_kind TEXT,
  scope_id TEXT,
  version INTEGER NOT NULL CHECK (version >= 1),
  operation TEXT NOT NULL CHECK (operation IN ('upsert', 'delete')),
  status TEXT NOT NULL CHECK (status IN ('pending', 'processing', 'completed')),
  attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  next_attempt_at INTEGER NOT NULL,
  completed_at INTEGER,
  PRIMARY KEY (entity_kind, entity_id, version, operation)
) WITHOUT ROWID;

CREATE TABLE "session" (
  "id" TEXT PRIMARY KEY NOT NULL,
  "expiresAt" INTEGER NOT NULL,
  "token" TEXT NOT NULL UNIQUE,
  "createdAt" INTEGER NOT NULL,
  "updatedAt" INTEGER NOT NULL,
  "ipAddress" TEXT,
  "userAgent" TEXT,
  "userId" TEXT NOT NULL REFERENCES "user"("id") ON DELETE CASCADE
);

CREATE TABLE site_authoring_sessions (
  session_id TEXT PRIMARY KEY,
  editor_workspace_id TEXT NOT NULL REFERENCES workspaces(workspace_id),
  editor_agent_id TEXT NOT NULL,
  editor_work_id TEXT NOT NULL,
  session_json TEXT NOT NULL CHECK(json_valid(session_json)),
  file_count INTEGER NOT NULL CHECK(file_count BETWEEN 1 AND 512),
  next_file INTEGER NOT NULL DEFAULT 0 CHECK(next_file BETWEEN 0 AND file_count),
  state TEXT NOT NULL DEFAULT 'preparing' CHECK(state IN ('preparing','ready')),
  CHECK((state='ready' AND next_file=file_count) OR (state='preparing' AND next_file<file_count))
);

CREATE TABLE site_capture_abandonments (
  workspace_id TEXT NOT NULL REFERENCES workspaces(workspace_id),
  site_id TEXT NOT NULL,
  capture_id TEXT NOT NULL CHECK(length(capture_id) = 64),
  client_operation_id TEXT NOT NULL,
  capture_prefix TEXT NOT NULL,
  completion_key TEXT NOT NULL,
  initiated_by_user_id TEXT NOT NULL,
  state TEXT NOT NULL CHECK(state IN ('fenced', 'planned', 'complete')),
  targets_json TEXT CHECK(targets_json IS NULL OR json_valid(targets_json)),
  target_cursor INTEGER NOT NULL DEFAULT 0 CHECK(target_cursor >= 0 AND target_cursor <= 515),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY(workspace_id, site_id, capture_id),
  CHECK((state = 'fenced' AND targets_json IS NULL AND target_cursor = 0) OR (state IN ('planned', 'complete') AND targets_json IS NOT NULL AND target_cursor <= json_array_length(targets_json))),
  CHECK(state <> 'complete' OR target_cursor = json_array_length(targets_json))
);

CREATE TABLE site_capture_canonical_claims (
  home_workspace_id TEXT NOT NULL,
  operation_id TEXT NOT NULL,
  site_id TEXT NOT NULL,
  capture_id TEXT NOT NULL CHECK(length(capture_id) = 64),
  PRIMARY KEY(home_workspace_id, operation_id)
);

CREATE TABLE site_delivery_tickets (
  ticket_digest TEXT PRIMARY KEY NOT NULL,
  workspace_id TEXT NOT NULL,
  site_id TEXT NOT NULL,
  scope_json TEXT NOT NULL CHECK(json_valid(scope_json)), 
  expires_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  FOREIGN KEY (workspace_id, site_id) REFERENCES workspace_sites(workspace_id, site_id)
);

CREATE TABLE site_design_revisions (
  site_id TEXT NOT NULL REFERENCES site_designs(site_id),
  revision INTEGER NOT NULL CHECK (revision >= 1),
  design_json TEXT NOT NULL,
  write_id TEXT NOT NULL,
  author_key TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (site_id, revision)
);

CREATE TABLE site_designs (
  site_id TEXT PRIMARY KEY NOT NULL REFERENCES workspace_sites(site_id),
  workspace_id TEXT NOT NULL REFERENCES workspaces(workspace_id),
  revision INTEGER NOT NULL CHECK (revision >= 1),
  template_id TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE site_hosting (
  site_id TEXT PRIMARY KEY REFERENCES workspace_sites(site_id),
  workspace_id TEXT NOT NULL REFERENCES workspaces(workspace_id),
  hostname TEXT NOT NULL UNIQUE,
  deployed INTEGER NOT NULL CHECK(deployed IN (0, 1)),
  live_revision_id TEXT REFERENCES site_revisions(revision_id),
  version INTEGER NOT NULL CHECK(version >= 1),
  updated_at INTEGER NOT NULL
);

CREATE TABLE site_operation_receipts (
  workspace_id TEXT NOT NULL REFERENCES workspaces(workspace_id),
  operation_id TEXT NOT NULL,
  site_id TEXT NOT NULL REFERENCES workspace_sites(site_id),
  actor_key TEXT NOT NULL,
  fingerprint TEXT NOT NULL,
  result_json TEXT NOT NULL CHECK(json_valid(result_json)),
  portal_authority_fingerprint TEXT,
  PRIMARY KEY(workspace_id, operation_id)
);

CREATE TABLE site_revisions (
  revision_id TEXT PRIMARY KEY,
  site_id TEXT NOT NULL REFERENCES workspace_sites(site_id),
  workspace_id TEXT NOT NULL REFERENCES workspaces(workspace_id),
  revision_json TEXT NOT NULL CHECK(json_valid(revision_json)),
  total_bytes INTEGER NOT NULL CHECK(total_bytes >= 0 AND total_bytes <= 100000000),
  created_at INTEGER NOT NULL
);

CREATE TABLE site_storage_objects (
  bucket_kind TEXT NOT NULL CHECK (bucket_kind IN ('delivery', 'capture')),
  object_key TEXT NOT NULL,
  workspace_id TEXT NOT NULL REFERENCES workspaces(workspace_id),
  site_id TEXT NOT NULL,
  byte_size INTEGER NOT NULL CHECK (byte_size >= 0),
  content_sha256 TEXT NOT NULL CHECK (length(content_sha256) = 64),
  status TEXT NOT NULL CHECK (status IN ('reserved', 'retained')),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL, abandoned_at INTEGER CHECK(abandoned_at IS NULL OR abandoned_at >= 0),
  PRIMARY KEY (bucket_kind, object_key)
);

CREATE TABLE site_view_tokens (
  token_hash TEXT PRIMARY KEY,
  site_id TEXT NOT NULL REFERENCES workspace_sites(site_id),
  workspace_id TEXT NOT NULL REFERENCES workspaces(workspace_id),
  reader_key TEXT NOT NULL,
  expires_at INTEGER NOT NULL
);

CREATE TABLE social_accounts (
  account_id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(workspace_id),
  platform TEXT NOT NULL CHECK (platform IN ('facebook-page', 'instagram', 'threads')),
  provider_account_id TEXT NOT NULL,
  metadata_json TEXT NOT NULL CHECK (json_valid(metadata_json)),
  credential_json TEXT NOT NULL CHECK (json_valid(credential_json)),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE (workspace_id, platform, provider_account_id)
);

CREATE TABLE social_media (
  file_id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(workspace_id),
  content_type TEXT NOT NULL,
  byte_length INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE "social_oauth_attempts" (
  state TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(workspace_id),
  user_id TEXT NOT NULL,
  session_digest TEXT NOT NULL,
  provider TEXT NOT NULL CHECK(provider IN ('facebook', 'instagram', 'threads')),
  expires_at INTEGER NOT NULL
);

CREATE TABLE social_posts (
  post_id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(workspace_id),
  record_json TEXT NOT NULL CHECK (json_valid(record_json)),
  created_at INTEGER NOT NULL
);

CREATE TABLE success_billing_operations (
  operation_id TEXT PRIMARY KEY NOT NULL,
  workspace_id TEXT NOT NULL REFERENCES workspaces(workspace_id),
  agent_id TEXT NOT NULL,
  work_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('inference', 'web-search', 'computer-runtime')),
  request_fingerprint TEXT NOT NULL,
  external_customer_id TEXT NOT NULL,
  feature_key TEXT NOT NULL,
  feature_revision TEXT NOT NULL,
  usage_unit TEXT NOT NULL,
  required_entitlement_key TEXT NOT NULL,
  admission_source_position TEXT NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('admitted', 'debit-pending', 'charged', 'absorbed')),
  outcome_json TEXT,
  actual_units TEXT,
  actual_charge TEXT,
  provider_cost_json TEXT,
  cost_resolution TEXT NOT NULL DEFAULT 'unresolved' CHECK (cost_resolution IN ('unresolved','known')),
  customer_charge TEXT,
  merchant_absorbed TEXT,
  absorption_reason TEXT,
  sapa_usage_id TEXT,
  admitted_at INTEGER NOT NULL,
  completed_at INTEGER,
  updated_at INTEGER NOT NULL, spend_allocation_id TEXT, spend_origin_json TEXT, spend_finalization_json TEXT, collection_mode TEXT NOT NULL
  DEFAULT 'exact' CHECK (collection_mode IN ('exact', 'up-to-available')),
  CHECK ((state = 'admitted' AND outcome_json IS NULL AND completed_at IS NULL)
    OR (state = 'debit-pending' AND outcome_json IS NOT NULL AND actual_charge IS NOT NULL AND completed_at IS NULL)
    OR (state IN ('charged', 'absorbed') AND outcome_json IS NOT NULL AND customer_charge IS NOT NULL AND merchant_absorbed IS NOT NULL AND completed_at IS NOT NULL))
) WITHOUT ROWID;

CREATE TABLE success_inference_rating (
  operation_id TEXT PRIMARY KEY REFERENCES success_billing_operations(operation_id),
  rating_metadata_json TEXT,
  admitted_at INTEGER NOT NULL,
  outcome_json TEXT CHECK (outcome_json IS NULL OR json_valid(outcome_json)),
  outcome_observed_at INTEGER,
  billing_recorded_at INTEGER,
  thread_name TEXT,
  model_turn TEXT,
  logical_attempt TEXT,
  model_mark_seq INTEGER,
  input_token_upper_bound INTEGER,
  max_output_tokens INTEGER,
  completion_evidence_json TEXT CHECK (completion_evidence_json IS NULL OR json_valid(completion_evidence_json)),
  last_checked_at INTEGER
);

CREATE TABLE tracker_collection_schemas (
  tracker_id TEXT NOT NULL REFERENCES trackers(tracker_id),
  revision INTEGER NOT NULL,
  collection TEXT NOT NULL,
  schema_json TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (tracker_id, revision, collection)
);

CREATE TABLE tracker_records (
  record_id TEXT PRIMARY KEY NOT NULL,
  tracker_id TEXT NOT NULL REFERENCES trackers(tracker_id),
  owner_id TEXT NOT NULL REFERENCES "user"("id"),
  collection TEXT NOT NULL,
  values_json TEXT NOT NULL,
  version INTEGER NOT NULL,
  client_operation_id TEXT NOT NULL,
  author_agent_id TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  deleted_at INTEGER
, creation_request_fingerprint TEXT, creation_result_json TEXT);

CREATE TABLE tracker_spec_operation_receipts (
  owner_id TEXT NOT NULL,
  operation_id TEXT NOT NULL,
  request_fingerprint TEXT NOT NULL,
  result_json TEXT NOT NULL,
  PRIMARY KEY (owner_id, operation_id)
);

CREATE TABLE tracker_spec_revisions (
  tracker_id TEXT NOT NULL REFERENCES trackers(tracker_id),
  revision INTEGER NOT NULL,
  spec_json TEXT NOT NULL,
  author_agent_id TEXT,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (tracker_id, revision)
);

CREATE TABLE tracker_update_receipts (
  tracker_id TEXT NOT NULL,
  client_operation_id TEXT NOT NULL,
  request_fingerprint TEXT NOT NULL,
  result_json TEXT NOT NULL,
  PRIMARY KEY (tracker_id, client_operation_id)
);

CREATE TABLE trackers (
  tracker_id TEXT PRIMARY KEY NOT NULL,
  owner_id TEXT NOT NULL REFERENCES "user"("id"),
  slug TEXT NOT NULL,
  revision INTEGER NOT NULL,
  creator_agent_id TEXT,
  conversation_id TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE "user" (
  "id" TEXT PRIMARY KEY NOT NULL,
  "name" TEXT NOT NULL,
  "email" TEXT NOT NULL UNIQUE,
  "emailVerified" INTEGER NOT NULL DEFAULT 0,
  "image" TEXT,
  "createdAt" INTEGER NOT NULL,
  "updatedAt" INTEGER NOT NULL
);

CREATE TABLE "verification" (
  "id" TEXT PRIMARY KEY NOT NULL,
  "identifier" TEXT NOT NULL,
  "value" TEXT NOT NULL,
  "expiresAt" INTEGER NOT NULL,
  "createdAt" INTEGER NOT NULL,
  "updatedAt" INTEGER NOT NULL
);

CREATE TABLE wasm_computer_output_exports (
  session_id TEXT NOT NULL,
  action_id TEXT NOT NULL,
  source_path TEXT NOT NULL,
  fingerprint TEXT NOT NULL,
  generation INTEGER NOT NULL,
  instruction_revision INTEGER NOT NULL,
  filesystem_revision INTEGER NOT NULL,
  captured_sha256 TEXT NOT NULL,
  byte_size INTEGER NOT NULL CHECK(byte_size >= 0),
  workspace_id TEXT NOT NULL,
  owner_id TEXT NOT NULL,
  agent_id TEXT NOT NULL,
  conversation_id TEXT NOT NULL,
  job_id TEXT NOT NULL,
  file_id TEXT REFERENCES workspace_files(file_id),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (session_id, action_id, source_path)
);

CREATE TABLE web_search_operations (
  operation_id TEXT PRIMARY KEY NOT NULL,
  workspace_id TEXT NOT NULL REFERENCES workspaces(workspace_id),
  agent_id TEXT NOT NULL,
  conversation_id TEXT NOT NULL,
  turn_id TEXT NOT NULL,
  native_tool_call_id TEXT NOT NULL,
  request_fingerprint TEXT NOT NULL,
  state TEXT NOT NULL CHECK (state IN (
    'admission-pending', 'reserved', 'dispatching', 'settlement-pending',
    'zero-settlement-pending', 'release-pending', 'completed', 'failed',
    'reconciliation-required', 'absorbed'
  )),
  execution_lease_id TEXT,
  execution_lease_expires_at INTEGER,
  result_json TEXT CHECK (result_json IS NULL OR json_valid(result_json)),
  failure_reason TEXT,
  provider_outcome TEXT CHECK (
    provider_outcome IS NULL OR provider_outcome IN (
      'usable-result', 'provider-rejected', 'timed-out', 'network', 'cancelled',
      'response-too-large', 'invalid-response', 'no-sources', 'lease-expired'
    )
  ),
  admitted_at INTEGER NOT NULL,
  dispatch_intent_at INTEGER,
  completed_at INTEGER,
  updated_at INTEGER NOT NULL, provider_expense_json TEXT,
  UNIQUE (workspace_id, agent_id, conversation_id, turn_id, native_tool_call_id),
  CHECK (
    (state = 'dispatching' AND execution_lease_id IS NOT NULL
      AND execution_lease_expires_at IS NOT NULL AND dispatch_intent_at IS NOT NULL)
    OR state <> 'dispatching'
  ),
  CHECK (state <> 'completed' OR result_json IS NOT NULL)
) WITHOUT ROWID;

CREATE TABLE web_search_orphan_release_claims (
  operation_id TEXT PRIMARY KEY NOT NULL REFERENCES paid_work_operations(operation_id),
  claimed_at INTEGER NOT NULL,
  release_completed_at INTEGER
) WITHOUT ROWID;

CREATE VIRTUAL TABLE work_memory_fts USING fts5(
  memory_id UNINDEXED, owner_id UNINDEXED, workspace_id UNINDEXED, agent_id UNINDEXED, content,
  tokenize = 'unicode61'
);

CREATE TABLE work_memory_search_records (
  memory_id TEXT PRIMARY KEY NOT NULL,
  owner_id TEXT NOT NULL,
  workspace_id TEXT NOT NULL,
  agent_id TEXT NOT NULL,
  revision INTEGER NOT NULL CHECK (revision >= 1),
  status TEXT NOT NULL CHECK (status IN ('active', 'retracted')),
  content TEXT NOT NULL,
  vector_id TEXT NOT NULL,
  embedding_complete INTEGER NOT NULL DEFAULT 0 CHECK (embedding_complete IN (0, 1)),
  UNIQUE(vector_id)
) WITHOUT ROWID;

CREATE TABLE work_memory_vector_deletions (
  memory_id TEXT NOT NULL,
  vector_id TEXT NOT NULL,
  PRIMARY KEY(memory_id, vector_id)
) WITHOUT ROWID;

CREATE VIRTUAL TABLE workspace_agent_profiles_fts USING fts5(
  agent_id UNINDEXED,
  workspace_id UNINDEXED,
  name,
  label,
  description,
  tokenize = 'unicode61 remove_diacritics 2'
);

CREATE TABLE workspace_agents (
  agent_id TEXT PRIMARY KEY NOT NULL REFERENCES agent_profiles(agent_id),
  workspace_id TEXT NOT NULL REFERENCES workspaces(workspace_id),
  UNIQUE (workspace_id, agent_id)
) WITHOUT ROWID;

CREATE TABLE workspace_billing_accounts (
  workspace_id TEXT PRIMARY KEY NOT NULL REFERENCES workspaces(workspace_id),
  external_customer_id TEXT NOT NULL UNIQUE,
  plan TEXT CHECK (plan IS NULL OR plan IN ('go', 'standard', 'plus')),
  plan_revision TEXT,
  plan_status TEXT NOT NULL DEFAULT 'unsubscribed'
    CHECK (plan_status IN ('unsubscribed', 'active', 'expired')),
  period_started_at INTEGER,
  period_ends_at INTEGER,
  billing_source_position TEXT NOT NULL DEFAULT '0',
  billing_evaluated_at INTEGER NOT NULL DEFAULT 0,
  billing_next_evaluation_at INTEGER,
  billing_change_checkpoint TEXT NOT NULL DEFAULT '0',
  billing_change_cursor TEXT,
  source_revision TEXT NOT NULL DEFAULT 'local-bootstrap-v1',
  billing_recovery_attempted_at INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL, billing_package_publication_generation TEXT
CHECK (billing_package_publication_generation IS NULL OR (
  length(billing_package_publication_generation) BETWEEN 1 AND 16
  AND billing_package_publication_generation GLOB '[1-9]*'
  AND billing_package_publication_generation NOT GLOB '*[^0-9]*'
)), billing_customer_missing_at INTEGER
CHECK (billing_customer_missing_at IS NULL OR billing_customer_missing_at >= 0),
  CHECK (
    period_started_at IS NULL OR period_ends_at IS NULL
      OR period_ends_at > period_started_at
  ),
  CHECK (
    (plan_status = 'unsubscribed' AND plan IS NULL AND plan_revision IS NULL
      AND period_started_at IS NULL AND period_ends_at IS NULL)
    OR (plan_status = 'active' AND plan IS NOT NULL
      AND period_started_at IS NOT NULL)
    OR (plan_status = 'expired' AND plan IS NOT NULL
      AND period_ends_at IS NOT NULL)
  )
) WITHOUT ROWID;

CREATE TABLE workspace_billing_customer_provisioning (
  workspace_id TEXT PRIMARY KEY NOT NULL REFERENCES workspaces(workspace_id),
  operation_id TEXT NOT NULL UNIQUE,
  external_customer_id TEXT NOT NULL UNIQUE,
  contact_email TEXT NOT NULL,
  contact_name TEXT NOT NULL CHECK (
    length(contact_name) BETWEEN 1 AND 200 AND length(trim(contact_name)) > 0
  ),
  state TEXT NOT NULL CHECK (state IN ('pending', 'completed')),
  provider_created INTEGER CHECK (provider_created IN (0, 1)),
  provider_replayed INTEGER CHECK (provider_replayed IN (0, 1)),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  CHECK (
    (state = 'pending' AND provider_created IS NULL AND provider_replayed IS NULL)
    OR (state = 'completed' AND provider_created IS NOT NULL AND provider_replayed IS NOT NULL)
  )
) WITHOUT ROWID;

CREATE TABLE "workspace_computer_allowance_waits" (
  workspace_id TEXT NOT NULL REFERENCES workspaces(workspace_id),
  provider_intent_id TEXT NOT NULL,
  runtime_session_id TEXT NOT NULL,
  agent_id TEXT,
  feature_key TEXT,
  usage_unit TEXT NOT NULL CHECK (
    length(usage_unit) BETWEEN 1 AND 128
      AND usage_unit GLOB '[a-z]*'
      AND usage_unit NOT GLOB '*[^a-z0-9._-]*'
  ),
  required_entitlement_key TEXT,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (workspace_id, provider_intent_id),
  FOREIGN KEY (workspace_id, agent_id) REFERENCES workspace_agents(workspace_id, agent_id)
) WITHOUT ROWID;

CREATE TABLE workspace_computer_dispatch_reservations (
  workspace_id TEXT NOT NULL,
  reservation_id TEXT NOT NULL,
  deletion_sequence INTEGER NOT NULL CHECK (deletion_sequence >= 0),
  runtime_generation INTEGER NOT NULL CHECK (runtime_generation >= 1),
  reserved_at INTEGER NOT NULL,
  PRIMARY KEY (workspace_id, reservation_id),
  FOREIGN KEY (workspace_id) REFERENCES workspaces(workspace_id)
) WITHOUT ROWID;

CREATE TABLE workspace_computer_file_associations (
  workspace_id TEXT NOT NULL,
  file_id TEXT NOT NULL,
  entry_id TEXT NOT NULL,
  entry_revision TEXT NOT NULL CHECK (
    length(entry_revision) = 64 AND entry_revision NOT GLOB '*[^a-f0-9]*'
  ),
  path_at_capture TEXT NOT NULL CHECK (length(path_at_capture) BETWEEN 1 AND 2048),
  content_sha256 TEXT NOT NULL CHECK (
    length(content_sha256) = 64 AND content_sha256 NOT GLOB '*[^a-f0-9]*'
  ),
  association_version INTEGER NOT NULL CHECK (association_version >= 1),
  created_at INTEGER NOT NULL,
  PRIMARY KEY (workspace_id, file_id),
  FOREIGN KEY (file_id, workspace_id) REFERENCES workspace_files(file_id, workspace_id)
) WITHOUT ROWID;

CREATE TABLE workspace_computer_file_grants (
  workspace_id TEXT NOT NULL,
  file_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('active', 'revoked')),
  version INTEGER NOT NULL CHECK (version >= 1),
  authorized_by_user_id TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (workspace_id, file_id),
  FOREIGN KEY (file_id, workspace_id) REFERENCES workspace_files(file_id, workspace_id),
  FOREIGN KEY (workspace_id, authorized_by_user_id)
    REFERENCES workspace_memberships(workspace_id, user_id)
) WITHOUT ROWID;

CREATE TABLE workspace_computer_financial_stop_receipts (
  operation_id TEXT PRIMARY KEY NOT NULL
    REFERENCES workspace_computer_funding_segments(operation_id),
  workspace_id TEXT NOT NULL REFERENCES workspaces(workspace_id),
  runtime_session_id TEXT NOT NULL,
  runtime_generation INTEGER NOT NULL CHECK (runtime_generation >= 1),
  stop_intent_id TEXT NOT NULL UNIQUE,
  stop_context_json TEXT NOT NULL CHECK (json_valid(stop_context_json)),
  interval_stopped_at INTEGER,
  provenance TEXT CHECK (provenance IS NULL OR provenance = 'confirmed-provider-stop'),
  state TEXT NOT NULL CHECK (state IN (
    'observation-pending', 'recorded', 'settlement-pending', 'settled',
    'reconciliation-required'
  )),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE (workspace_id, runtime_session_id, runtime_generation),
  CHECK (
    (state = 'observation-pending' AND interval_stopped_at IS NULL AND provenance IS NULL)
      OR (state IN ('recorded', 'settlement-pending', 'settled')
        AND interval_stopped_at IS NOT NULL AND provenance = 'confirmed-provider-stop')
      OR (state = 'reconciliation-required'
        AND ((interval_stopped_at IS NULL AND provenance IS NULL)
          OR (interval_stopped_at IS NOT NULL AND provenance = 'confirmed-provider-stop')))
  )
) WITHOUT ROWID;

CREATE TABLE workspace_computer_fresh_output_fences (
  workspace_id TEXT PRIMARY KEY NOT NULL REFERENCES workspaces(workspace_id),
  operation_id TEXT NOT NULL,
  created_at INTEGER NOT NULL
) WITHOUT ROWID;

CREATE TABLE workspace_computer_funding_segments (
  operation_id TEXT PRIMARY KEY NOT NULL,
  workspace_id TEXT NOT NULL REFERENCES workspaces(workspace_id),
  runtime_session_id TEXT NOT NULL,
  runtime_generation INTEGER NOT NULL CHECK (runtime_generation >= 1),
  segment_index INTEGER NOT NULL CHECK (segment_index >= 0),
  state TEXT NOT NULL CHECK (state IN (
    'planned', 'reserved', 'dispatch-intent', 'running', 'settlement-pending',
    'settled', 'released', 'reconciliation-required'
  )),
  planned_start_at INTEGER NOT NULL,
  reservation_expires_at INTEGER,
  interval_started_at INTEGER,
  funded_until INTEGER,
  interval_stopped_at INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL, rate_revision TEXT, credits_per_hour TEXT CHECK (
  credits_per_hour IS NULL OR (
    length(credits_per_hour) BETWEEN 1 AND 78
      AND credits_per_hour NOT GLOB '*[^0-9]*'
      AND credits_per_hour <> '0'
      AND substr(credits_per_hour, 1, 1) <> '0'
  )
), reserved_quantity TEXT CHECK (
  reserved_quantity IS NULL OR (
    length(reserved_quantity) > 0 AND reserved_quantity NOT GLOB '*[^0-9]*'
  )
), elapsed_runtime_millis TEXT CHECK (
  elapsed_runtime_millis IS NULL OR (
    length(elapsed_runtime_millis) > 0 AND elapsed_runtime_millis NOT GLOB '*[^0-9]*'
  )
), actual_runtime_quantity TEXT CHECK (
  actual_runtime_quantity IS NULL OR (
    length(actual_runtime_quantity) > 0 AND actual_runtime_quantity NOT GLOB '*[^0-9]*'
  )
), customer_charged_quantity TEXT CHECK (
  customer_charged_quantity IS NULL OR (
    length(customer_charged_quantity) > 0 AND customer_charged_quantity NOT GLOB '*[^0-9]*'
  )
), merchant_absorbed_quantity TEXT CHECK (
  merchant_absorbed_quantity IS NULL OR (
    length(merchant_absorbed_quantity) > 0 AND merchant_absorbed_quantity NOT GLOB '*[^0-9]*'
  )
),
  UNIQUE (workspace_id, runtime_session_id, runtime_generation, segment_index),
  CHECK (
    (interval_started_at IS NULL AND funded_until IS NULL)
    OR (interval_started_at IS NOT NULL AND funded_until > interval_started_at)
  ),
  CHECK (interval_stopped_at IS NULL OR interval_started_at IS NOT NULL),
  CHECK (interval_stopped_at IS NULL OR interval_stopped_at >= interval_started_at)
) WITHOUT ROWID;

CREATE TABLE "workspace_computer_output_artifact_publications" (
  workspace_id TEXT NOT NULL,
  job_id TEXT NOT NULL,
  output_index INTEGER NOT NULL CHECK (output_index BETWEEN 0 AND 9007199254740991),
  reference_id TEXT NOT NULL UNIQUE,
  grant_id TEXT NOT NULL REFERENCES workspace_file_grants(grant_id),
  grant_version INTEGER NOT NULL CHECK (grant_version >= 1),
  grant_activated_by_publication INTEGER NOT NULL CHECK (grant_activated_by_publication IN (0, 1)),
  status TEXT NOT NULL CHECK (status IN ('prepared', 'committed', 'failed')),
  message_id TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  committed_at INTEGER,
  PRIMARY KEY (workspace_id, job_id, output_index),
  FOREIGN KEY (workspace_id, job_id, output_index) REFERENCES "workspace_computer_output_exports"(workspace_id, job_id, output_index),
  FOREIGN KEY (reference_id) REFERENCES artifact_references(reference_id),
  CHECK ((status = 'prepared' AND message_id IS NULL AND committed_at IS NULL)
    OR (status = 'committed' AND message_id IS NOT NULL AND committed_at IS NOT NULL)
    OR (status = 'failed' AND message_id IS NULL AND committed_at IS NULL))
) WITHOUT ROWID;

CREATE TABLE "workspace_computer_output_exports" (
  workspace_id TEXT NOT NULL REFERENCES workspaces(workspace_id),
  job_id TEXT NOT NULL,
  attempt_id TEXT NOT NULL,
  output_index INTEGER NOT NULL CHECK (output_index BETWEEN 0 AND 9007199254740991),
  source_path TEXT NOT NULL CHECK (length(source_path) BETWEEN 1 AND 1024),
  captured_sha256 TEXT NOT NULL CHECK (length(captured_sha256) = 64 AND captured_sha256 NOT GLOB '*[^a-f0-9]*'),
  byte_size INTEGER NOT NULL CHECK (byte_size BETWEEN 1 AND 100000000),
  owner_id TEXT NOT NULL,
  agent_id TEXT NOT NULL,
  profile_version INTEGER NOT NULL CHECK (profile_version >= 1),
  conversation_id TEXT NOT NULL,
  file_id TEXT,
  attachment_id TEXT,
  conversation_grant_id TEXT,
  attached_message_id TEXT,
  status TEXT NOT NULL CHECK (status IN ('staged', 'accepted', 'attached')),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  entry_id TEXT,
  entry_revision TEXT CHECK (entry_revision IS NULL OR (length(entry_revision) = 64 AND entry_revision NOT GLOB '*[^a-f0-9]*')),
  PRIMARY KEY (workspace_id, job_id, output_index),
  UNIQUE (file_id),
  UNIQUE (attachment_id),
  FOREIGN KEY (workspace_id, owner_id) REFERENCES workspace_memberships(workspace_id, user_id),
  FOREIGN KEY (workspace_id, agent_id) REFERENCES workspace_agents(workspace_id, agent_id),
  FOREIGN KEY (workspace_id, conversation_id) REFERENCES workspace_conversations(workspace_id, conversation_id),
  FOREIGN KEY (file_id, workspace_id) REFERENCES workspace_files(file_id, workspace_id),
  FOREIGN KEY (conversation_grant_id) REFERENCES workspace_file_grants(grant_id),
  CHECK ((status = 'staged' AND file_id IS NULL AND attachment_id IS NULL AND conversation_grant_id IS NULL AND attached_message_id IS NULL)
    OR (status = 'accepted' AND file_id IS NOT NULL AND conversation_grant_id IS NULL AND attached_message_id IS NULL)
    OR (status = 'attached' AND file_id IS NOT NULL AND attachment_id IS NOT NULL AND conversation_grant_id IS NOT NULL AND attached_message_id IS NOT NULL))
) WITHOUT ROWID;

CREATE TABLE workspace_computer_snapshot_file_imports (
  workspace_id TEXT NOT NULL REFERENCES workspaces(workspace_id),
  client_operation_id TEXT NOT NULL,
  file_reference_id TEXT NOT NULL,
  agent_id TEXT NOT NULL,
  profile_version INTEGER NOT NULL CHECK (profile_version >= 1),
  file_id TEXT,
  status TEXT NOT NULL CHECK (status IN ('staged', 'accepted')),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (workspace_id, client_operation_id),
  FOREIGN KEY (file_reference_id)
    REFERENCES workspace_computer_snapshot_search_results(file_reference_id),
  FOREIGN KEY (workspace_id, agent_id)
    REFERENCES workspace_agents(workspace_id, agent_id),
  FOREIGN KEY (file_id, workspace_id)
    REFERENCES workspace_files(file_id, workspace_id),
  CHECK (
    (status = 'staged' AND file_id IS NULL)
    OR (status = 'accepted' AND file_id IS NOT NULL)
  )
);

CREATE TABLE workspace_computer_snapshot_reference_mappings (
  workspace_id TEXT NOT NULL,
  source_provider_id TEXT NOT NULL,
  source_snapshot_id TEXT NOT NULL CHECK (length(source_snapshot_id) BETWEEN 1 AND 2048),
  source_provider_path TEXT NOT NULL CHECK (length(source_provider_path) BETWEEN 1 AND 2048),
  source_byte_size INTEGER NOT NULL CHECK (source_byte_size BETWEEN 1 AND 100000000),
  target_provider_id TEXT NOT NULL,
  target_checkpoint_id TEXT NOT NULL CHECK (length(target_checkpoint_id) BETWEEN 1 AND 2048),
  target_provider_path TEXT NOT NULL CHECK (length(target_provider_path) BETWEEN 1 AND 2048),
  target_byte_size INTEGER NOT NULL CHECK (target_byte_size BETWEEN 1 AND 100000000),
  content_sha256 TEXT NOT NULL CHECK (
    length(content_sha256) = 64 AND content_sha256 NOT GLOB '*[^a-f0-9]*'
  ),
  migration_operation_id TEXT NOT NULL,
  source_fence_token TEXT NOT NULL CHECK (length(source_fence_token) BETWEEN 1 AND 2048),
  mapped_at INTEGER NOT NULL,
  PRIMARY KEY (
    workspace_id,
    source_provider_id,
    source_snapshot_id,
    source_provider_path,
    source_byte_size
  )
) WITHOUT ROWID;

CREATE TABLE workspace_computer_snapshot_search_results (
  workspace_id TEXT NOT NULL,
  client_operation_id TEXT NOT NULL,
  result_index INTEGER NOT NULL CHECK (result_index BETWEEN 0 AND 19),
  file_reference_id TEXT NOT NULL UNIQUE,
  provider_path TEXT NOT NULL CHECK (length(provider_path) BETWEEN 1 AND 2048),
  workspace_path TEXT NOT NULL CHECK (length(workspace_path) BETWEEN 1 AND 1024),
  byte_size INTEGER NOT NULL CHECK (byte_size BETWEEN 1 AND 100000000), content_sha256 TEXT CHECK (
    content_sha256 IS NULL OR
    (length(content_sha256) = 64 AND content_sha256 NOT GLOB '*[^a-f0-9]*')
  ), checkpoint_id TEXT, entry_id TEXT, entry_revision TEXT CHECK (
  entry_revision IS NULL OR
  (length(entry_revision) = 64 AND entry_revision NOT GLOB '*[^a-f0-9]*')
),
  PRIMARY KEY (workspace_id, client_operation_id, result_index),
  FOREIGN KEY (workspace_id, client_operation_id)
    REFERENCES workspace_computer_snapshot_searches(workspace_id, client_operation_id)
);

CREATE TABLE workspace_computer_snapshot_searches (
  workspace_id TEXT NOT NULL REFERENCES workspaces(workspace_id),
  client_operation_id TEXT NOT NULL,
  agent_id TEXT NOT NULL,
  profile_version INTEGER NOT NULL CHECK (profile_version >= 1),
  query TEXT NOT NULL CHECK (length(query) BETWEEN 1 AND 200),
  directory TEXT,
  result_limit INTEGER NOT NULL CHECK (result_limit BETWEEN 1 AND 20),
  provider_id TEXT NOT NULL,
  snapshot_id TEXT NOT NULL,
  snapshot_captured_at INTEGER NOT NULL,
  inventory_complete INTEGER NOT NULL CHECK (inventory_complete IN (0, 1)),
  result_limited INTEGER NOT NULL CHECK (result_limited IN (0, 1)),
  results_json TEXT NOT NULL CHECK (length(results_json) BETWEEN 2 AND 100000),
  status TEXT NOT NULL CHECK (status IN ('staged', 'completed')),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (workspace_id, client_operation_id),
  FOREIGN KEY (workspace_id, agent_id)
    REFERENCES workspace_agents(workspace_id, agent_id)
);

CREATE TABLE workspace_conversation_kinds (
  conversation_id TEXT PRIMARY KEY NOT NULL REFERENCES conversation_projections(conversation_id),
  workspace_id TEXT NOT NULL REFERENCES workspaces(workspace_id),
  kind TEXT NOT NULL CHECK (
    kind IN ('human-agent-direct', 'agent-agent-direct', 'group')
  )
) WITHOUT ROWID;

CREATE TABLE workspace_conversations (
  conversation_id TEXT PRIMARY KEY NOT NULL REFERENCES conversation_projections(conversation_id),
  workspace_id TEXT NOT NULL REFERENCES workspaces(workspace_id),
  UNIQUE (workspace_id, conversation_id)
) WITHOUT ROWID;

CREATE TABLE workspace_databases (
  database_id TEXT PRIMARY KEY NOT NULL,
  workspace_id TEXT NOT NULL REFERENCES workspaces(workspace_id),
  version INTEGER NOT NULL CHECK (version >= 1),
  metadata_json TEXT NOT NULL,
  last_operation_id TEXT NOT NULL,
  archived_at INTEGER,
  UNIQUE (workspace_id, database_id)
);

CREATE TABLE workspace_file_deletion_agent_wakes (
  workspace_id TEXT NOT NULL REFERENCES workspaces(workspace_id),
  deletion_sequence INTEGER NOT NULL,
  agent_id TEXT NOT NULL,
  delivered_at INTEGER,
  PRIMARY KEY (workspace_id, deletion_sequence, agent_id),
  FOREIGN KEY (workspace_id, deletion_sequence)
    REFERENCES workspace_file_deletion_outbox(workspace_id, deletion_sequence)
) WITHOUT ROWID;

CREATE TABLE workspace_file_deletion_outbox (
  workspace_id TEXT NOT NULL,
  deletion_sequence INTEGER NOT NULL CHECK (deletion_sequence >= 1),
  file_id TEXT NOT NULL,
  operation_id TEXT NOT NULL,
  entry_id TEXT,
  entry_revision TEXT CHECK (
    entry_revision IS NULL OR
    (length(entry_revision) = 64 AND entry_revision NOT GLOB '*[^a-f0-9]*')
  ),
  path_at_capture TEXT,
  content_sha256 TEXT,
  status TEXT NOT NULL CHECK (status IN ('pending', 'complete', 'conflict')),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (workspace_id, deletion_sequence),
  UNIQUE (workspace_id, operation_id),
  FOREIGN KEY (workspace_id, file_id)
    REFERENCES workspace_file_tombstones(workspace_id, file_id),
  CHECK (
    (entry_id IS NULL AND entry_revision IS NULL AND path_at_capture IS NULL AND content_sha256 IS NULL)
    OR
    (entry_id IS NOT NULL AND entry_revision IS NOT NULL AND path_at_capture IS NOT NULL AND content_sha256 IS NOT NULL)
  )
) WITHOUT ROWID;

CREATE TABLE workspace_file_folder_entries (
  workspace_id TEXT NOT NULL,
  file_id TEXT NOT NULL,
  folder_id TEXT NOT NULL,
  placed_at INTEGER NOT NULL,
  PRIMARY KEY (workspace_id, file_id),
  FOREIGN KEY (file_id, workspace_id) REFERENCES workspace_files(file_id, workspace_id),
  FOREIGN KEY (workspace_id, folder_id) REFERENCES workspace_file_folders(workspace_id, folder_id)
) WITHOUT ROWID;

CREATE TABLE workspace_file_folders (
  folder_id TEXT PRIMARY KEY NOT NULL,
  workspace_id TEXT NOT NULL REFERENCES workspaces(workspace_id),
  parent_folder_id TEXT,
  name TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 255),
  name_key TEXT NOT NULL CHECK (name_key = lower(name)),
  create_operation_id TEXT NOT NULL CHECK (length(create_operation_id) BETWEEN 1 AND 255),
  created_by_user_id TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  -- Soft deletion: set once every File inside the folder's subtree has a tombstone.
  delete_operation_id TEXT,
  deleted_at INTEGER,
  CHECK ((delete_operation_id IS NULL) = (deleted_at IS NULL)),
  CHECK (parent_folder_id IS NULL OR parent_folder_id <> folder_id),
  UNIQUE (workspace_id, folder_id),
  UNIQUE (workspace_id, create_operation_id),
  FOREIGN KEY (workspace_id, parent_folder_id)
    REFERENCES workspace_file_folders(workspace_id, folder_id),
  FOREIGN KEY (workspace_id, created_by_user_id)
    REFERENCES workspace_memberships(workspace_id, user_id)
);

CREATE TABLE workspace_file_grants (
  grant_id TEXT PRIMARY KEY NOT NULL,
  workspace_id TEXT NOT NULL,
  file_id TEXT NOT NULL,
  scope_kind TEXT NOT NULL CHECK (scope_kind IN ('agent', 'conversation')),
  agent_id TEXT,
  conversation_id TEXT,
  status TEXT NOT NULL CHECK (status IN ('active', 'revoked')),
  version INTEGER NOT NULL CHECK (version >= 1),
  created_by_kind TEXT NOT NULL CHECK (created_by_kind IN ('owner', 'agent')),
  created_by_user_id TEXT,
  created_by_agent_id TEXT,
  created_by_profile_version INTEGER CHECK (created_by_profile_version >= 1),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL, activation_share_intent_id TEXT
  REFERENCES workspace_file_share_intents(share_intent_id), activation_owner_attachment_id TEXT,
  FOREIGN KEY (file_id, workspace_id) REFERENCES workspace_files(file_id, workspace_id),
  FOREIGN KEY (workspace_id, agent_id) REFERENCES workspace_agents(workspace_id, agent_id),
  FOREIGN KEY (workspace_id, conversation_id)
    REFERENCES workspace_conversations(workspace_id, conversation_id),
  FOREIGN KEY (workspace_id, created_by_user_id)
    REFERENCES workspace_memberships(workspace_id, user_id),
  FOREIGN KEY (workspace_id, created_by_agent_id)
    REFERENCES workspace_agents(workspace_id, agent_id),
  CHECK (
    (scope_kind = 'agent' AND agent_id IS NOT NULL AND conversation_id IS NULL)
    OR
    (scope_kind = 'conversation' AND conversation_id IS NOT NULL AND agent_id IS NULL)
  ),
  CHECK (
    (created_by_kind = 'owner'
      AND created_by_user_id IS NOT NULL
      AND created_by_agent_id IS NULL
      AND created_by_profile_version IS NULL)
    OR
    (created_by_kind = 'agent'
      AND created_by_user_id IS NULL
      AND created_by_agent_id IS NOT NULL
      AND created_by_profile_version IS NOT NULL)
  )
) WITHOUT ROWID;

CREATE TABLE workspace_file_operational_usage (
  workspace_id TEXT PRIMARY KEY NOT NULL REFERENCES workspaces(workspace_id),
  accepted_bytes INTEGER NOT NULL DEFAULT 0 CHECK (accepted_bytes >= 0),
  reserved_bytes INTEGER NOT NULL DEFAULT 0 CHECK (reserved_bytes >= 0),
  updated_at INTEGER NOT NULL
) WITHOUT ROWID;

CREATE TABLE workspace_file_presentation_representations (
  file_id TEXT NOT NULL, workspace_id TEXT NOT NULL,
  representation_version INTEGER NOT NULL CHECK (representation_version = 1),
  format TEXT NOT NULL CHECK (format = 'presentation-json-v1'),
  storage_key TEXT NOT NULL, byte_size INTEGER NOT NULL CHECK (byte_size BETWEEN 1 AND 12000000),
  original_sha256 TEXT NOT NULL CHECK (length(original_sha256) = 64),
  created_at INTEGER NOT NULL,
  PRIMARY KEY (file_id, representation_version),
  FOREIGN KEY (file_id, workspace_id) REFERENCES workspace_files(file_id, workspace_id),
  FOREIGN KEY (file_id, representation_version) REFERENCES workspace_file_representations(file_id, version)
) WITHOUT ROWID;

CREATE TABLE workspace_file_processing_jobs (
  file_id TEXT PRIMARY KEY NOT NULL,
  workspace_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending', 'processing', 'completed', 'failed')),
  attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  available_at INTEGER NOT NULL,
  claimed_at INTEGER,
  failure_code TEXT CHECK (failure_code IN (
    'malformed-file',
    'encrypted-file',
    'processing-limit-exceeded',
    'processing-failed'
  )),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL, claim_token TEXT,
  FOREIGN KEY (file_id, workspace_id) REFERENCES workspace_files(file_id, workspace_id),
  CHECK (
    (status = 'pending' AND claimed_at IS NULL AND failure_code IS NULL)
    OR (status = 'processing' AND claimed_at IS NOT NULL AND failure_code IS NULL)
    OR (status = 'completed' AND claimed_at IS NULL AND failure_code IS NULL)
    OR (status = 'failed' AND claimed_at IS NULL AND failure_code IS NOT NULL)
  )
) WITHOUT ROWID;

CREATE TABLE workspace_file_publication_grants (
  portal_id TEXT NOT NULL,
  revision_id TEXT NOT NULL,
  workspace_id TEXT NOT NULL,
  asset_name TEXT NOT NULL,
  file_id TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('primary', 'image')),
  allow_download INTEGER NOT NULL CHECK (allow_download IN (0, 1)),
  PRIMARY KEY (portal_id, asset_name),
  FOREIGN KEY (portal_id, revision_id, workspace_id)
    REFERENCES portals(portal_id, revision_id, workspace_id),
  FOREIGN KEY (file_id, workspace_id) REFERENCES workspace_files(file_id, workspace_id),
  CHECK ((role = 'primary' AND asset_name = '$primary' AND allow_download = 1)
    OR (role = 'image' AND asset_name <> '$primary' AND allow_download = 0))
) WITHOUT ROWID;

CREATE TABLE workspace_file_representation_reservations (
  file_id TEXT NOT NULL,
  workspace_id TEXT NOT NULL,
  version INTEGER NOT NULL CHECK (version >= 1),
  byte_size INTEGER NOT NULL CHECK (byte_size > 0),
  configured_limit_bytes INTEGER NOT NULL CHECK (configured_limit_bytes > 0),
  status TEXT NOT NULL CHECK (status IN ('reserved', 'accepted')),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (file_id, version),
  FOREIGN KEY (file_id, workspace_id) REFERENCES workspace_files(file_id, workspace_id)
) WITHOUT ROWID;

CREATE TABLE workspace_file_representation_usage (
  workspace_id TEXT PRIMARY KEY NOT NULL REFERENCES workspaces(workspace_id),
  accepted_bytes INTEGER NOT NULL DEFAULT 0 CHECK (accepted_bytes >= 0),
  reserved_bytes INTEGER NOT NULL DEFAULT 0 CHECK (reserved_bytes >= 0),
  updated_at INTEGER NOT NULL
) WITHOUT ROWID;

CREATE TABLE workspace_file_representations (
  file_id TEXT NOT NULL,
  workspace_id TEXT NOT NULL,
  version INTEGER NOT NULL CHECK (version >= 1),
  representation_kind TEXT NOT NULL CHECK (representation_kind IN ('utf8-text', 'csv-text')),
  storage_key TEXT NOT NULL UNIQUE,
  byte_size INTEGER NOT NULL CHECK (byte_size BETWEEN 1 AND 10000000),
  character_count INTEGER NOT NULL CHECK (character_count >= 1),
  line_count INTEGER NOT NULL CHECK (line_count >= 1),
  csv_row_count INTEGER CHECK (csv_row_count >= 1),
  csv_cell_count INTEGER CHECK (csv_cell_count >= 1),
  created_at INTEGER NOT NULL, viewer_format TEXT CHECK (
    viewer_format IS NULL OR viewer_format IN ('spreadsheet-json-v1', 'spreadsheet-json-v2')
  ), viewer_storage_key TEXT, viewer_byte_size INTEGER CHECK (
    viewer_byte_size IS NULL OR viewer_byte_size BETWEEN 1 AND 10000000
  ), accounted_byte_size INTEGER
CHECK (accounted_byte_size IS NULL OR accounted_byte_size >= byte_size),
  PRIMARY KEY (file_id, version),
  FOREIGN KEY (file_id, workspace_id) REFERENCES workspace_files(file_id, workspace_id),
  CHECK (
    (representation_kind = 'utf8-text'
      AND csv_row_count IS NULL AND csv_cell_count IS NULL)
    OR
    (representation_kind = 'csv-text'
      AND csv_row_count IS NOT NULL AND csv_cell_count IS NOT NULL)
  )
) WITHOUT ROWID;

CREATE TABLE "workspace_file_share_intents" (
  share_intent_id TEXT PRIMARY KEY NOT NULL,
  workspace_id TEXT NOT NULL REFERENCES workspaces(workspace_id),
  owner_id TEXT NOT NULL,
  source_conversation_id TEXT NOT NULL,
  destination_conversation_id TEXT NOT NULL,
  file_id TEXT NOT NULL,
  sharing_agent_id TEXT NOT NULL,
  sharing_profile_version INTEGER NOT NULL CHECK (sharing_profile_version >= 1),
  client_operation_id TEXT NOT NULL,
  content TEXT NOT NULL CHECK (length(content) BETWEEN 0 AND 20000),
  status TEXT NOT NULL CHECK (status IN ('pending', 'grant-active', 'committed', 'failed')),
  failure_code TEXT CHECK (failure_code IN ('access-lost', 'destination-unavailable')),
  grant_id TEXT,
  grant_version INTEGER CHECK (grant_version >= 1),
  grant_activated_by_intent INTEGER CHECK (grant_activated_by_intent IN (0, 1)),
  display_name TEXT CHECK (display_name IS NULL OR length(display_name) BETWEEN 1 AND 255),
  media_type TEXT,
  byte_size INTEGER CHECK (byte_size IS NULL OR byte_size BETWEEN 0 AND 100000000),
  message_id TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  committed_at INTEGER,
  UNIQUE (workspace_id, sharing_agent_id, client_operation_id),
  FOREIGN KEY (workspace_id, owner_id)
    REFERENCES workspace_memberships(workspace_id, user_id),
  FOREIGN KEY (file_id, workspace_id)
    REFERENCES workspace_files(file_id, workspace_id),
  FOREIGN KEY (workspace_id, sharing_agent_id)
    REFERENCES workspace_agents(workspace_id, agent_id),
  FOREIGN KEY (workspace_id, source_conversation_id)
    REFERENCES workspace_conversations(workspace_id, conversation_id),
  FOREIGN KEY (workspace_id, destination_conversation_id)
    REFERENCES workspace_conversations(workspace_id, conversation_id),
  FOREIGN KEY (grant_id) REFERENCES workspace_file_grants(grant_id),
  CHECK (
    (status = 'pending'
      AND failure_code IS NULL
      AND grant_id IS NULL
      AND grant_version IS NULL
      AND grant_activated_by_intent IS NULL
      AND display_name IS NULL
      AND media_type IS NULL
      AND byte_size IS NULL
      AND message_id IS NULL
      AND committed_at IS NULL)
    OR
    (status IN ('grant-active', 'committed')
      AND failure_code IS NULL
      AND grant_id IS NOT NULL
      AND grant_version IS NOT NULL
      AND grant_activated_by_intent IS NOT NULL
      AND display_name IS NOT NULL
      AND media_type IS NOT NULL
      AND byte_size IS NOT NULL
      AND ((status = 'grant-active' AND message_id IS NULL AND committed_at IS NULL)
        OR (status = 'committed' AND message_id IS NOT NULL AND committed_at IS NOT NULL)))
    OR
    (status = 'failed' AND failure_code IS NOT NULL AND committed_at IS NULL)
  )
) WITHOUT ROWID;

CREATE TABLE workspace_file_spreadsheet_representations (
  file_id TEXT NOT NULL,
  workspace_id TEXT NOT NULL,
  representation_version INTEGER NOT NULL CHECK (representation_version = 3),
  format TEXT NOT NULL CHECK (format = 'spreadsheet-json-v3'),
  storage_key TEXT NOT NULL UNIQUE,
  byte_size INTEGER NOT NULL CHECK (byte_size BETWEEN 1 AND 10000000),
  importer_name TEXT NOT NULL CHECK (importer_name = 'nori'),
  importer_version TEXT NOT NULL CHECK (importer_version = '0.1.0'),
  original_sha256 TEXT NOT NULL CHECK (
    length(original_sha256) = 64 AND original_sha256 NOT GLOB '*[^a-f0-9]*'
  ),
  created_at INTEGER NOT NULL,
  PRIMARY KEY (file_id, representation_version),
  FOREIGN KEY (file_id, workspace_id) REFERENCES workspace_files(file_id, workspace_id),
  FOREIGN KEY (file_id, representation_version)
    REFERENCES workspace_file_representations(file_id, version)
) WITHOUT ROWID;

CREATE TABLE workspace_file_text_backfill_jobs (
  file_id TEXT NOT NULL,
  workspace_id TEXT NOT NULL,
  version INTEGER NOT NULL CHECK(version >= 1),
  storage_key TEXT NOT NULL,
  byte_size INTEGER NOT NULL CHECK(byte_size BETWEEN 1 AND 10000000),
  status TEXT NOT NULL CHECK(status IN ('pending', 'processing', 'completed', 'failed', 'obsolete')),
  attempts INTEGER NOT NULL DEFAULT 0 CHECK(attempts >= 0),
  available_at INTEGER NOT NULL,
  claimed_at INTEGER,
  claim_token TEXT,
  failure_reason TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY(file_id, version),
  FOREIGN KEY(file_id, workspace_id) REFERENCES workspace_files(file_id, workspace_id),
  CHECK((status = 'processing' AND claimed_at IS NOT NULL AND claim_token IS NOT NULL)
     OR (status <> 'processing' AND claimed_at IS NULL AND claim_token IS NULL))
) WITHOUT ROWID;

CREATE TABLE workspace_file_text_chunks (
  id INTEGER PRIMARY KEY,
  file_id TEXT NOT NULL,
  version INTEGER NOT NULL,
  ordinal INTEGER NOT NULL CHECK(ordinal >= 0),
  scope_key TEXT NOT NULL,
  byte_offset INTEGER NOT NULL CHECK(byte_offset >= 0),
  core_end INTEGER NOT NULL CHECK(core_end > byte_offset),
  content_base64 TEXT NOT NULL CHECK(length(content_base64) BETWEEN 4 AND 22192),
  search_text TEXT NOT NULL CHECK(length(CAST(search_text AS BLOB)) BETWEEN 1 AND 16644),
  UNIQUE(file_id, version, ordinal),
  FOREIGN KEY(file_id, version) REFERENCES workspace_file_text_indexes(file_id, version)
);

CREATE VIRTUAL TABLE workspace_file_text_fts USING fts5(
  scope_key, search_text,
  content = 'workspace_file_text_chunks', content_rowid = 'id',
  tokenize = 'trigram case_sensitive 1'
);

CREATE TABLE workspace_file_text_indexes (
  file_id TEXT NOT NULL,
  workspace_id TEXT NOT NULL,
  version INTEGER NOT NULL CHECK(version >= 1),
  scope_key TEXT NOT NULL UNIQUE,
  content_sha256 TEXT NOT NULL CHECK(length(content_sha256) = 64),
  byte_size INTEGER NOT NULL CHECK(byte_size BETWEEN 1 AND 10000000),
  chunk_count INTEGER NOT NULL CHECK(chunk_count BETWEEN 1 AND 612),
  ready INTEGER NOT NULL DEFAULT 0 CHECK(ready IN (0, 1)),
  PRIMARY KEY(file_id, version),
  FOREIGN KEY(file_id, workspace_id) REFERENCES workspace_files(file_id, workspace_id)
) WITHOUT ROWID;

CREATE TABLE workspace_file_tombstones (
  workspace_id TEXT NOT NULL,
  file_id TEXT NOT NULL,
  operation_id TEXT NOT NULL,
  deletion_version INTEGER NOT NULL CHECK (deletion_version >= 1),
  deleted_by_user_id TEXT NOT NULL,
  deleted_at INTEGER NOT NULL,
  PRIMARY KEY (workspace_id, file_id),
  UNIQUE (workspace_id, operation_id),
  FOREIGN KEY (file_id, workspace_id) REFERENCES workspace_files(file_id, workspace_id),
  FOREIGN KEY (workspace_id, deleted_by_user_id)
    REFERENCES workspace_memberships(workspace_id, user_id)
) WITHOUT ROWID;

CREATE TABLE workspace_file_usage (
  workspace_id TEXT PRIMARY KEY NOT NULL REFERENCES workspaces(workspace_id),
  accepted_bytes INTEGER NOT NULL DEFAULT 0 CHECK (accepted_bytes >= 0),
  reserved_bytes INTEGER NOT NULL DEFAULT 0 CHECK (reserved_bytes >= 0),
  limit_bytes INTEGER NOT NULL CHECK (limit_bytes IN (2000000000, 10000000000, 20000000000)),
  updated_at INTEGER NOT NULL
, limit_version INTEGER NOT NULL DEFAULT 0 CHECK (limit_version >= 0)) WITHOUT ROWID;

CREATE TABLE workspace_file_user_event_outbox (
  sequence INTEGER PRIMARY KEY AUTOINCREMENT,
  workspace_id TEXT NOT NULL REFERENCES workspaces(workspace_id),
  user_id TEXT NOT NULL,
  conversation_id TEXT,
  FOREIGN KEY (workspace_id, user_id)
    REFERENCES workspace_memberships(workspace_id, user_id),
  FOREIGN KEY (workspace_id, conversation_id)
    REFERENCES workspace_conversations(workspace_id, conversation_id)
);

CREATE TABLE "workspace_files" (
  file_id TEXT PRIMARY KEY NOT NULL,
  workspace_id TEXT NOT NULL REFERENCES workspaces(workspace_id),
  upload_operation_id TEXT NOT NULL,
  original_name TEXT NOT NULL CHECK (length(original_name) BETWEEN 1 AND 255),
  display_name TEXT NOT NULL CHECK (length(display_name) BETWEEN 1 AND 255),
  display_name_key TEXT NOT NULL CHECK (length(display_name_key) BETWEEN 1 AND 255),
  media_type TEXT NOT NULL CHECK (media_type IN (
    'application/octet-stream',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    'application/pdf',
    'image/jpeg',
    'image/png',
    'image/webp',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'text/csv',
    'text/plain',
    'text/markdown',
    'application/json',
    'application/xml',
    'text/xml',
    'text/html',
    'text/css',
    'text/javascript',
    'application/javascript',
    'text/typescript',
    'application/typescript'
  )),
  media_kind TEXT NOT NULL CHECK (media_kind IN (
    'pdf', 'image', 'document', 'spreadsheet', 'presentation', 'text', 'file'
  )),
  declared_byte_size INTEGER NOT NULL CHECK (
    declared_byte_size BETWEEN 1 AND 100000000
  ),
  accepted_byte_size INTEGER,
  storage_key TEXT,
  status TEXT NOT NULL CHECK (status IN (
    'uploading', 'processing', 'readable', 'upload-failed', 'processing-failed'
  )),
  failure_code TEXT CHECK (failure_code IN (
    'upload-expired',
    'upload-failed',
    'size-mismatch',
    'media-mismatch',
    'malformed-file',
    'encrypted-file',
    'processing-limit-exceeded',
    'processing-failed'
  )),
  representation_version INTEGER CHECK (representation_version >= 1),
  reservation_expires_at INTEGER,
  accepted_at INTEGER,
  created_by_user_id TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL, source_provenance TEXT NOT NULL DEFAULT 'user-upload'
CHECK (source_provenance IN ('user-upload', 'computer-export', 'agent-generated', 'system-generated')), operational_limit_bytes INTEGER
CHECK (operational_limit_bytes IS NULL OR operational_limit_bytes > 0), created_by_service_id TEXT, service_upload_sha256 TEXT,
  UNIQUE (file_id, workspace_id),
  UNIQUE (workspace_id, upload_operation_id),
  UNIQUE (workspace_id, display_name_key),
  UNIQUE (storage_key),
  FOREIGN KEY (workspace_id, created_by_user_id)
    REFERENCES workspace_memberships(workspace_id, user_id),
  CHECK (
    (status = 'uploading'
      AND accepted_byte_size IS NULL
      AND storage_key IS NULL
      AND failure_code IS NULL
      AND representation_version IS NULL
      AND reservation_expires_at IS NOT NULL
      AND accepted_at IS NULL)
    OR
    (status = 'upload-failed'
      AND accepted_byte_size IS NULL
      AND failure_code IN ('upload-expired', 'upload-failed', 'size-mismatch', 'media-mismatch')
      AND representation_version IS NULL
      AND reservation_expires_at IS NULL
      AND accepted_at IS NULL)
    OR
    (status = 'processing'
      AND accepted_byte_size BETWEEN 1 AND declared_byte_size
      AND storage_key IS NOT NULL
      AND failure_code IS NULL
      AND representation_version IS NULL
      AND reservation_expires_at IS NULL
      AND accepted_at IS NOT NULL)
    OR
    (status = 'readable'
      AND accepted_byte_size BETWEEN 1 AND declared_byte_size
      AND storage_key IS NOT NULL
      AND failure_code IS NULL
      AND representation_version >= 1
      AND reservation_expires_at IS NULL
      AND accepted_at IS NOT NULL)
    OR
    (status = 'processing-failed'
      AND accepted_byte_size BETWEEN 1 AND declared_byte_size
      AND storage_key IS NOT NULL
      AND failure_code IN (
        'malformed-file',
        'encrypted-file',
        'processing-limit-exceeded',
        'processing-failed'
      )
      AND representation_version IS NULL
      AND reservation_expires_at IS NULL
      AND accepted_at IS NOT NULL)
  )
) WITHOUT ROWID;

CREATE TABLE workspace_forms (
  form_id TEXT PRIMARY KEY NOT NULL,
  workspace_id TEXT NOT NULL REFERENCES workspaces(workspace_id),
  database_id TEXT NOT NULL UNIQUE REFERENCES workspace_databases(database_id),
  version INTEGER NOT NULL CHECK (version >= 1),
  status TEXT NOT NULL CHECK (status IN ('draft', 'open', 'closed', 'archived')),
  published_revision INTEGER,
  form_json TEXT NOT NULL,
  last_operation_id TEXT NOT NULL
);

CREATE TABLE workspace_memberships (
  workspace_id TEXT NOT NULL REFERENCES workspaces(workspace_id),
  user_id TEXT NOT NULL REFERENCES "user"("id"),
  role TEXT NOT NULL CHECK (role IN ('owner', 'member')),
  status TEXT NOT NULL CHECK (status IN ('active', 'removed')),
  version INTEGER NOT NULL CHECK (version >= 1),
  joined_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (workspace_id, user_id)
) WITHOUT ROWID;

CREATE TABLE workspace_message_search_candidates (
  search_id TEXT NOT NULL
    REFERENCES workspace_message_search_sessions(search_id) ON DELETE CASCADE,
  ordinal INTEGER NOT NULL CHECK (ordinal BETWEEN 0 AND 99),
  message_id TEXT NOT NULL,
  PRIMARY KEY (search_id, ordinal),
  UNIQUE (search_id, message_id)
) WITHOUT ROWID;

CREATE TABLE workspace_message_search_continuations (
  token TEXT PRIMARY KEY NOT NULL,
  search_id TEXT NOT NULL
    REFERENCES workspace_message_search_sessions(search_id) ON DELETE CASCADE,
  message_offset INTEGER NOT NULL CHECK (
    message_offset BETWEEN 20 AND 80 AND message_offset % 20 = 0
  ),
  UNIQUE (search_id, message_offset)
) WITHOUT ROWID;

CREATE VIRTUAL TABLE workspace_message_search_fts USING fts5(
  message_id UNINDEXED,
  conversation_id UNINDEXED,
  owner_id UNINDEXED,
  visible_content,
  tokenize = 'unicode61 remove_diacritics 2'
);

CREATE TABLE workspace_message_search_records (
  message_id TEXT PRIMARY KEY NOT NULL,
  conversation_id TEXT NOT NULL,
  owner_id TEXT NOT NULL,
  sequence INTEGER NOT NULL CHECK (sequence >= 1),
  author_kind TEXT NOT NULL CHECK (author_kind IN ('owner', 'agent', 'system')),
  author_id TEXT,
  author_profile_version INTEGER,
  visible_content TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  UNIQUE (conversation_id, sequence)
) WITHOUT ROWID;

CREATE TABLE workspace_message_search_sessions (
  search_id TEXT PRIMARY KEY NOT NULL,
  workspace_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  owner_id TEXT NOT NULL,
  query_fingerprint TEXT NOT NULL,
  candidate_count INTEGER NOT NULL CHECK (candidate_count BETWEEN 0 AND 100),
  capped INTEGER NOT NULL CHECK (capped IN (0, 1)),
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL CHECK (expires_at > created_at)
) WITHOUT ROWID;

CREATE TABLE workspace_message_search_state (
  conversation_id TEXT PRIMARY KEY NOT NULL,
  indexed_through_sequence INTEGER NOT NULL CHECK (indexed_through_sequence >= 0),
  updated_at INTEGER NOT NULL
) WITHOUT ROWID;

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

CREATE TABLE workspace_reference_directory_revisions (
  workspace_id TEXT PRIMARY KEY NOT NULL REFERENCES workspaces(workspace_id),
  revision INTEGER NOT NULL CHECK (revision >= 1)
) WITHOUT ROWID;

CREATE TABLE workspace_resource_user_event_outbox (
  sequence INTEGER PRIMARY KEY AUTOINCREMENT,
  workspace_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  resource_kind TEXT NOT NULL
    CHECK (resource_kind IN ('design', 'site', 'form', 'database', 'tracker')),
  resource_id TEXT NOT NULL
);

CREATE TABLE workspace_secrets (
  secret_id TEXT PRIMARY KEY NOT NULL,
  workspace_id TEXT NOT NULL REFERENCES workspaces(workspace_id),
  created_by_user_id TEXT NOT NULL,
  environment_name TEXT NOT NULL,
  label TEXT NOT NULL,
  version INTEGER NOT NULL CHECK (version BETWEEN 1 AND 999999999),
  encrypted_value_json TEXT NOT NULL CHECK (json_valid(encrypted_value_json)),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  revoked_at INTEGER, browser_origin TEXT DEFAULT NULL,
  FOREIGN KEY (workspace_id, created_by_user_id)
    REFERENCES workspace_memberships(workspace_id, user_id)
) WITHOUT ROWID;

CREATE TABLE workspace_service_administration_receipts (
  operation_id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(workspace_id),
  service_id TEXT NOT NULL REFERENCES workspace_services(service_id),
  fingerprint TEXT NOT NULL,
  action TEXT NOT NULL,
  actor_user_id TEXT NOT NULL REFERENCES "user"(id),
  actor_agent_id TEXT REFERENCES agent_profiles(agent_id),
  result_json TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE workspace_service_capability_grants (
  service_id TEXT NOT NULL REFERENCES workspace_services(service_id),
  revision_id TEXT NOT NULL,
  alias TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('database', 'tracker', 'calendar', 'file-read', 'file-upload', 'agent-invoke', 'plugin-tool')),
  target_id TEXT NOT NULL,
  operation TEXT NOT NULL,
  granted_by_user_id TEXT NOT NULL REFERENCES "user"(id),
  created_at INTEGER NOT NULL,
  revoked_at INTEGER,
  revocation_reason TEXT CHECK (revocation_reason IN ('owner', 'superseded', 'reauthorized')),
  PRIMARY KEY (service_id, revision_id, alias, kind, target_id, operation)
);

CREATE TABLE workspace_service_configuration (
  service_id TEXT PRIMARY KEY REFERENCES workspace_services(service_id),
  version INTEGER NOT NULL CHECK (version >= 1),
  values_json TEXT NOT NULL CHECK (json_valid(values_json)),
  operation_id TEXT NOT NULL,
  updated_at INTEGER NOT NULL
) WITHOUT ROWID;

CREATE TABLE workspace_service_event_activation (
  service_id TEXT PRIMARY KEY NOT NULL REFERENCES workspace_services(service_id),
  workspace_id TEXT NOT NULL REFERENCES workspaces(workspace_id),
  activation_epoch INTEGER NOT NULL CHECK (activation_epoch BETWEEN 0 AND 2147483647),
  desired_state TEXT NOT NULL CHECK (desired_state IN ('enabled','paused','archived')),
  updated_at INTEGER NOT NULL CHECK (updated_at >= 0)
) WITHOUT ROWID;

CREATE TABLE workspace_service_ingress_diagnostics (
  diagnostic_id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(workspace_id),
  service_id TEXT NOT NULL REFERENCES workspace_services(service_id),
  created_at INTEGER NOT NULL,
  result TEXT NOT NULL CHECK (result IN ('admitted','verification-rejected','invalid-request','body-too-large','request-timeout','service-unavailable','secret-unavailable','admission-conflict')),
  invocation_id TEXT,
  CHECK ((result = 'admitted') = (invocation_id IS NOT NULL))
);

CREATE TABLE workspace_service_ingress_policies (
  service_id TEXT PRIMARY KEY REFERENCES workspace_services(service_id),
  version INTEGER NOT NULL CHECK (version >= 1),
  policy_json TEXT NOT NULL,
  operation_id TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE workspace_service_ingress_secrets (
  secret_id TEXT PRIMARY KEY NOT NULL,
  workspace_id TEXT NOT NULL REFERENCES workspaces(workspace_id),
  service_id TEXT NOT NULL REFERENCES workspace_services(service_id),
  created_by_user_id TEXT NOT NULL REFERENCES "user"(id),
  version INTEGER NOT NULL CHECK (version BETWEEN 1 AND 999999999),
  encrypted_value_json TEXT NOT NULL CHECK (json_valid(encrypted_value_json)),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  revoked_at INTEGER
) WITHOUT ROWID;

CREATE TABLE workspace_service_setup_observations (
  service_id TEXT PRIMARY KEY REFERENCES workspace_services(service_id),
  first_verified_delivery_at INTEGER NOT NULL
) WITHOUT ROWID;

CREATE TABLE workspace_service_tool_grants (
  service_id TEXT NOT NULL REFERENCES workspace_services(service_id),
  tool_name TEXT NOT NULL,
  agent_id TEXT NOT NULL REFERENCES agent_profiles(agent_id),
  granted_by_user_id TEXT NOT NULL REFERENCES "user"(id),
  created_at INTEGER NOT NULL,
  revoked_at INTEGER,
  PRIMARY KEY (service_id, tool_name, agent_id)
);

CREATE TABLE workspace_services (
  service_id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(workspace_id),
  name TEXT NOT NULL,
  created_by_user_id TEXT NOT NULL REFERENCES "user"(id),
  creator_agent_id TEXT REFERENCES agent_profiles(agent_id),
  status TEXT NOT NULL CHECK (status IN ('active', 'archived')),
  endpoint_id TEXT NOT NULL UNIQUE,
  endpoint_version INTEGER NOT NULL DEFAULT 1 CHECK (endpoint_version >= 1),
  prior_endpoint_id TEXT UNIQUE,
  prior_endpoint_until INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  archived_at INTEGER,
  CHECK ((status = 'active' AND archived_at IS NULL) OR (status = 'archived' AND archived_at IS NOT NULL)),
  CHECK ((prior_endpoint_id IS NULL AND prior_endpoint_until IS NULL) OR (prior_endpoint_id IS NOT NULL AND prior_endpoint_until IS NOT NULL))
);

CREATE TABLE workspace_sites (
  site_id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(workspace_id),
  version INTEGER NOT NULL CHECK(version >= 1),
  status TEXT NOT NULL CHECK(status IN ('active', 'deleted')),
  head_revision_id TEXT,
  metadata_json TEXT NOT NULL CHECK(json_valid(metadata_json)),
  last_operation_id TEXT NOT NULL
);

CREATE TABLE workspace_skill_objects (
  workspace_id TEXT NOT NULL REFERENCES workspaces(workspace_id),
  content_sha256 TEXT NOT NULL CHECK (length(content_sha256) = 64),
  byte_size INTEGER NOT NULL CHECK (byte_size >= 0),
  status TEXT NOT NULL CHECK (status IN ('reserved', 'retained')),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (workspace_id, content_sha256)
) WITHOUT ROWID;

CREATE TABLE workspace_skill_versions (
  workspace_id TEXT NOT NULL,
  skill_id TEXT NOT NULL,
  version INTEGER NOT NULL CHECK (version > 0),
  name TEXT NOT NULL,
  description TEXT NOT NULL,
  instructions_markdown TEXT NOT NULL,
  files_json TEXT NOT NULL,
  file_count INTEGER NOT NULL CHECK (file_count >= 0),
  author_user_id TEXT NOT NULL,
  author_agent_id TEXT,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (workspace_id, skill_id, version),
  FOREIGN KEY (workspace_id, skill_id) REFERENCES workspace_skills(workspace_id, skill_id)
) WITHOUT ROWID;

CREATE TABLE workspace_skills (
  skill_id TEXT PRIMARY KEY NOT NULL,
  workspace_id TEXT NOT NULL REFERENCES workspaces(workspace_id),
  created_by_user_id TEXT NOT NULL REFERENCES "user"(id),
  client_operation_id TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
  name TEXT NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 120),
  description TEXT NOT NULL CHECK (length(trim(description)) BETWEEN 1 AND 600),
  instructions_markdown TEXT NOT NULL CHECK (length(trim(instructions_markdown)) BETWEEN 1 AND 32000),
  -- Original create payload is retained for truthful idempotent retries after later edits.
  create_content_json TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  deleted_at INTEGER, created_by_agent_id TEXT, files_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(files_json) AND json_type(files_json) = 'array'), updated_by_user_id TEXT, updated_by_agent_id TEXT, origin_skill_version_id TEXT
  REFERENCES marketplace_skill_versions(skill_version_id), origin_workspace_version INTEGER
  CHECK (origin_workspace_version IS NULL OR origin_workspace_version > 0),
  UNIQUE (workspace_id, client_operation_id)
);

CREATE TABLE workspaces (
  workspace_id TEXT PRIMARY KEY NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('personal')),
  status TEXT NOT NULL CHECK (status IN ('active', 'soft-deleted')),
  created_by_user_id TEXT NOT NULL REFERENCES "user"("id"),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE (created_by_user_id, kind)
) WITHOUT ROWID;

CREATE UNIQUE INDEX "account_provider_account_idx" ON "account" ("providerId", "accountId");

CREATE INDEX "account_userId_idx" ON "account" ("userId");

CREATE INDEX agent_action_receipt_outbox_pending
  ON agent_action_receipt_outbox (delivered_at, created_at, receipt_id);

CREATE UNIQUE INDEX agent_agent_direct_active_pair
  ON agent_agent_direct_conversations (workspace_id, first_agent_id, second_agent_id)
  WHERE status = 'active';

CREATE INDEX agent_browser_screenshot_grants_work
  ON agent_browser_screenshot_grants (agent_id, conversation_id, work_id, invocation_id);

CREATE INDEX agent_carousel_export_grants_work
  ON agent_carousel_export_grants (agent_id, conversation_id, work_id, invocation_id);

CREATE INDEX agent_image_generation_grants_work
  ON agent_image_generation_grants (agent_id, conversation_id, work_id, invocation_id);

CREATE INDEX agent_plugin_grants_active_workspace_agent
  ON agent_plugin_grants (workspace_id, agent_id, connection_id)
  WHERE status = 'active';

CREATE INDEX agent_profiles_owner_updated ON agent_profiles (owner_id, updated_at DESC);

CREATE INDEX agent_question_turn_recoveries_due
  ON agent_question_turn_recoveries (status, next_attempt_at, question_id);

CREATE UNIQUE INDEX agent_questions_open_tool_call
  ON agent_questions (agent_id, thread_id, invoking_turn_id, tool_call_id)
  WHERE thread_id IS NOT NULL AND invoking_turn_id IS NOT NULL AND tool_call_id IS NOT NULL;

CREATE INDEX agent_questions_owner_conversation
  ON agent_questions (owner_id, conversation_id, created_at DESC);

CREATE INDEX agent_questions_pending_admission_watermark
  ON agent_questions (
    owner_id,
    conversation_id,
    status,
    purpose,
    admission_owner_message_sequence
  );

CREATE INDEX agent_questions_work_id ON agent_questions(agent_work_id)
  WHERE agent_work_id IS NOT NULL;

CREATE INDEX application_user_event_outbox_sequence
  ON application_user_event_outbox (sequence);

CREATE INDEX artifact_references_recovery
  ON artifact_references (status, updated_at, reference_id)
  WHERE status = 'prepared';

CREATE INDEX bot_chat_operations_owner_conversation
  ON bot_chat_operations (owner_id, conversation_id);

CREATE INDEX calendar_authorization_attempts_expiry
  ON calendar_authorization_attempts (expires_at);

CREATE UNIQUE INDEX calendar_event_links_external
  ON calendar_event_links (integration_id, external_event_id);

CREATE INDEX calendar_event_user_event_outbox_sequence
  ON calendar_event_user_event_outbox (sequence);

CREATE INDEX calendar_events_alerting_series ON calendar_events(updated_at, event_id) WHERE recurrence_rule IS NOT NULL AND status = 'confirmed' AND alert_minutes_before IS NOT NULL;

CREATE UNIQUE INDEX calendar_events_creation_operation ON calendar_events(owner_id, client_operation_id);

CREATE INDEX calendar_events_owner_creator ON calendar_events(owner_id, creator_agent_id, starts_at);

CREATE INDEX calendar_events_owner_service ON calendar_events(owner_id, creator_service_id, starts_at);

CREATE INDEX calendar_events_owner_span ON calendar_events(owner_id, starts_at);

CREATE UNIQUE INDEX calendar_events_series_occurrence ON calendar_events(owner_id, series_event_id, original_starts_at) WHERE series_event_id IS NOT NULL;

CREATE UNIQUE INDEX calendar_integrations_owner_provider
  ON calendar_integrations (owner_id, provider);

CREATE INDEX calendar_integrations_sync_due ON calendar_integrations (status, synced_at);

CREATE INDEX carousels_owner_live ON carousels (owner_id, updated_at) WHERE deleted_at IS NULL;

CREATE INDEX carousels_workspace_kind_live
  ON carousels (workspace_id, owner_id, kind, updated_at)
  WHERE deleted_at IS NULL;

CREATE INDEX ceramic_search_completion_recovery ON ceramic_search_attempts (state, updated_at, operation_id);

CREATE INDEX conversation_message_search_scope
  ON conversation_message_search_records (owner_id, conversation_id, sequence DESC);

CREATE INDEX conversation_projections_active_owner_updated
  ON conversation_projections (owner_id, updated_at DESC, conversation_id)
  WHERE status = 'active';

CREATE INDEX conversation_projections_owner_updated
  ON conversation_projections (owner_id, updated_at DESC);

CREATE INDEX conversation_read_states_conversation
  ON conversation_read_states (conversation_id, owner_id);

CREATE UNIQUE INDEX dashboards_owner_slug ON dashboards (owner_id, slug);

CREATE INDEX database_records_live ON database_records(database_id, archived_at, record_id);

CREATE UNIQUE INDEX dataset_rows_creation_operation
  ON dataset_rows (owner_id, client_operation_id);

CREATE INDEX dataset_rows_owner_dataset_time
  ON dataset_rows (owner_id, dataset, recorded_at);

CREATE UNIQUE INDEX form_submissions_canonical_operation ON form_submissions(operation_id) WHERE portal_authority_fingerprint IS NOT NULL;

CREATE INDEX form_submissions_recent ON form_submissions(form_id, submitted_at, record_id);

CREATE UNIQUE INDEX human_agent_direct_active_pair
  ON human_agent_direct_conversations (workspace_id, user_id, agent_id)
  WHERE status = 'active';

CREATE INDEX image_generation_operations_recovery
  ON image_generation_operations (updated_at, operation_id)
  WHERE state IN ('reserved', 'dispatching', 'settlement-pending', 'failed');

CREATE INDEX image_generation_operations_turn_reuse
  ON image_generation_operations (conversation_id, agent_id, turn_id, reuse_key)
  WHERE result_json IS NOT NULL;

CREATE INDEX inference_absorption_release_receipts
  ON inference_absorption_release_audit (receipt_at, operation_id);

CREATE INDEX inference_policy_waits_created_at
  ON inference_policy_waits (created_at, conversation_id, invocation_id);

CREATE INDEX marketplace_skill_versions_current
  ON marketplace_skill_versions (skill_definition_id, status, version_ordinal DESC);

CREATE INDEX memory_mutation_proposals_owner_status
  ON memory_mutation_proposals (owner_id, status, created_at DESC);

CREATE INDEX memory_records_active_agent_recent
  ON memory_records (owner_id, scope_kind, scope_id, updated_at DESC, memory_id)
  WHERE status = 'active';

CREATE INDEX memory_records_owner_updated ON memory_records (owner_id, updated_at DESC);

CREATE INDEX memory_records_scope ON memory_records (owner_id, scope_kind, scope_id, status);

CREATE INDEX monetization_allowance_waits_by_workspace
  ON monetization_allowance_waits (workspace_id, created_at, conversation_id);

CREATE INDEX monetization_allowance_waits_by_workspace_unit
  ON monetization_allowance_waits
    (workspace_id, feature_key, usage_unit, required_entitlement_key, created_at, conversation_id);

CREATE UNIQUE INDEX monetization_funding_wakes_configured_identity
  ON monetization_funding_wakes
    (workspace_id, feature_key, usage_unit, required_entitlement_key)
  WHERE credit_identity_kind = 'configured-feature';

CREATE UNIQUE INDEX monetization_funding_wakes_legacy_identity
  ON monetization_funding_wakes (workspace_id, usage_unit)
  WHERE credit_identity_kind = 'retained-legacy';

CREATE INDEX monetization_usage_facts_operational_evidence
  ON monetization_usage_facts(evidence_quality, operation_id);

CREATE INDEX notification_channel_link_tokens_user
  ON notification_channel_link_tokens (user_id, kind, created_at);

CREATE UNIQUE INDEX notification_channels_active_address
  ON notification_channels(kind, address) WHERE status = 'active';

CREATE INDEX notification_channels_address
  ON notification_channels (kind, address, status);

CREATE INDEX option_a_release_observations_by_time
  ON option_a_release_observations (release_id, observed_at, stage_percentage);

CREATE INDEX option_a_release_request_samples_by_window
  ON option_a_release_request_samples (
    release_id, worker_version_id, observed_at, duration_millis
  );

CREATE INDEX owner_workspace_file_message_intents_recovery
  ON owner_workspace_file_message_intents (status, updated_at, client_operation_id)
  WHERE status = 'pending';

CREATE INDEX paid_work_operations_operational_state_updated
  ON paid_work_operations(state, updated_at);

CREATE INDEX paid_work_operations_recovery
  ON paid_work_operations (state, updated_at, workspace_id, operation_id);

CREATE INDEX plugin_approvals_pending_invocation_created
  ON plugin_approvals (invocation_id, created_at DESC)
  WHERE status = 'pending';

CREATE INDEX plugin_approvals_turn_reuse
  ON plugin_approvals (grant_id, connection_id, approval_scope, status);

CREATE INDEX plugin_auth_setup_attempts_activation
  ON plugin_auth_setup_attempts (activation_id, state, created_at);

CREATE INDEX plugin_connection_monitoring_outbox_due
  ON plugin_connection_monitoring_outbox(status, next_attempt_at, connection_id);

CREATE INDEX plugin_connection_monitoring_workspace
  ON plugin_connection_monitoring(workspace_id, desired_state, connection_id);

CREATE INDEX plugin_connections_activation_status
  ON plugin_connections (activation_id, status, created_at);

CREATE INDEX plugin_device_oauth_attempts_due
  ON plugin_device_oauth_attempts (next_poll_at, last_outcome);

CREATE INDEX plugin_event_outbox_pending
  ON plugin_event_outbox (delivered_at, sequence);

CREATE INDEX plugin_gmail_mailbox_push_sources ON plugin_gmail_mailboxes(watch_project_digest,mailbox_address,expires_at,connection_id);

CREATE UNIQUE INDEX plugin_installations_active_definition
  ON plugin_installations (user_id, plugin_definition_id)
  WHERE status = 'active';

CREATE UNIQUE INDEX plugin_invocation_attempts_disposable_sandbox
ON plugin_invocation_attempts(code_sandbox_id)
WHERE code_sandbox_id NOT GLOB 'work-session-*';

CREATE INDEX plugin_invocation_attempts_work_sandbox
ON plugin_invocation_attempts(code_sandbox_id, code_sandbox_generation);

CREATE UNIQUE INDEX plugin_invocations_logical_operation
  ON plugin_invocations (workspace_id, agent_id, conversation_id, logical_operation_id)
  WHERE logical_operation_id IS NOT NULL;

CREATE INDEX plugin_normalized_event_expiry ON plugin_normalized_events(expires_at,event_id) WHERE payload_json IS NOT NULL;

CREATE INDEX plugin_oauth_apps_workspace_provider
  ON plugin_oauth_apps (workspace_id, provider_registration_id, status, created_at);

CREATE INDEX plugin_oauth_provider_definitions_active_identity
  ON plugin_oauth_provider_definitions
    (status, provider, resource_identity, provider_definition_digest);

CREATE UNIQUE INDEX plugin_oauth_provider_definitions_digest_revision
  ON plugin_oauth_provider_definitions (provider_definition_digest, revision);

CREATE INDEX plugin_oauth_refresh_operations_connection_phase
  ON plugin_oauth_refresh_operations (connection_id, phase, updated_at);

CREATE INDEX plugin_oauth_registration_material_sources_active
  ON plugin_oauth_registration_material_sources
    (provider_registration_id, status, source_revision, material_version);

CREATE INDEX plugin_oauth_revocation_operations_phase
  ON plugin_oauth_revocation_operations (phase, updated_at, connection_id);

CREATE UNIQUE INDEX plugin_oauth_runtime_attempts_connection
  ON plugin_oauth_runtime_attempts (connection_id) WHERE connection_id IS NOT NULL;

CREATE INDEX plugin_oauth_runtime_attempts_phase
  ON plugin_oauth_runtime_attempts (phase, updated_at, oauth_attempt_id);

CREATE INDEX plugin_result_files_agent_listing
  ON plugin_result_files (workspace_id, agent_id, created_at DESC);

CREATE INDEX plugin_service_event_delivery_capacity ON plugin_service_event_deliveries(subscription_id,state);

CREATE INDEX plugin_service_event_delivery_due ON plugin_service_event_deliveries(state,next_attempt_at,delivery_id);

CREATE INDEX plugin_service_event_delivery_receipts ON plugin_service_event_deliveries(event_id,subscription_id,state);

CREATE INDEX plugin_service_event_owner_directory ON plugin_service_event_subscriptions(workspace_id, owner_user_id, service_id, trigger_index);

CREATE INDEX plugin_service_event_source_subscribers ON plugin_service_event_subscriptions(connection_id, desired_state, subscription_id);

CREATE INDEX plugin_service_tool_audit_history ON plugin_service_tool_audit(tool_call_id,recorded_at);

CREATE INDEX plugin_service_tool_bindings_source ON plugin_service_tool_bindings(connection_id, connection_revision, service_id);

CREATE INDEX plugin_service_tool_calls_history ON plugin_service_tool_calls(service_id,created_at,tool_call_id);

CREATE INDEX plugin_user_event_outbox_sequence
  ON plugin_user_event_outbox (sequence);

CREATE INDEX plugin_versions_installable
  ON plugin_versions (plugin_definition_id, status, release_date DESC);

CREATE INDEX plugin_versions_oauth_definition_authority
  ON plugin_versions
    (provider_definition_digest, provider_definition_revision, status, review_status);

CREATE INDEX plugin_versions_oauth_registration_authority
  ON plugin_versions
    (provider_registration_id, provider_registration_authority_revision);

CREATE INDEX plugin_work_approvals_protocol_work ON plugin_work_approvals(protocol, work_id);

CREATE INDEX plugin_work_approvals_work_id ON plugin_work_approvals(work_id);

CREATE INDEX portal_collaboration_home ON portal_collaboration_routes(home_workspace_id, portal_id);

CREATE INDEX portal_item_manager_discovery_active ON portal_item_manager_discovery(user_id, active, kind, item_id);

CREATE INDEX portal_member_discovery_active ON portal_member_discovery(user_id, active, portal_id);

CREATE INDEX portal_request_windows_expiry ON portal_request_windows(minute);

CREATE INDEX portal_resource_navigation ON portal_resource_bindings(portal_id, resource_id);

CREATE INDEX portals_owner ON portals(workspace_id, owner_user_id, status, created_at);

CREATE INDEX provider_registrations_oauth_authority
  ON provider_registrations
    (oauth_provider_definition_digest, oauth_provider_definition_revision,
     oauth_authority_revision, status);

CREATE INDEX push_subscriptions_user_status
  ON push_subscriptions (user_id, status, subscription_id);

CREATE UNIQUE INDEX result_finalization_owner_turn
  ON result_only_finalization_calls (workspace_id, owner_turn, agent_id)
  WHERE funding_purpose = 'result-finalization';

CREATE INDEX result_only_finalization_recovery
  ON result_only_finalization_calls (completed_at, last_checked_at, admitted_at, operation_id);

CREATE INDEX retrieval_embedding_jobs_pending
  ON retrieval_embedding_jobs (status, next_attempt_at, entity_kind, entity_id);

CREATE INDEX "session_userId_idx" ON "session" ("userId");

CREATE INDEX site_authoring_editor ON site_authoring_sessions(editor_workspace_id, editor_agent_id, editor_work_id);

CREATE INDEX site_capture_claim_reference ON site_capture_canonical_claims(home_workspace_id, site_id, capture_id);

CREATE UNIQUE INDEX site_capture_original_operation ON site_capture_abandonments(workspace_id, site_id, client_operation_id);

CREATE INDEX site_delivery_tickets_expiry ON site_delivery_tickets(expires_at);

CREATE INDEX site_designs_workspace ON site_designs (workspace_id);

CREATE INDEX site_revisions_capture_reference ON site_revisions(workspace_id, site_id, json_extract(revision_json, '$.source.captureId'));

CREATE INDEX site_revisions_history ON site_revisions(workspace_id, site_id, created_at, revision_id);

CREATE INDEX site_storage_workspace ON site_storage_objects(workspace_id, status);

CREATE INDEX site_view_tokens_expiry ON site_view_tokens(expires_at);

CREATE INDEX social_accounts_workspace ON social_accounts(workspace_id, account_id);

CREATE INDEX social_oauth_expiry ON social_oauth_attempts(expires_at);

CREATE INDEX social_posts_history ON social_posts(workspace_id, created_at DESC, post_id);

CREATE INDEX success_billing_absorbed_snapshot
  ON success_billing_operations(operation_id, admitted_at)
  WHERE state = 'absorbed';

CREATE INDEX success_billing_pending_debits ON success_billing_operations(updated_at, operation_id)
  WHERE state = 'debit-pending';

CREATE INDEX success_billing_unfinished_snapshot
  ON success_billing_operations(operation_id, admitted_at)
  WHERE state IN ('admitted', 'debit-pending');

CREATE INDEX success_inference_rating_recovery
  ON success_inference_rating (billing_recorded_at, last_checked_at, admitted_at, operation_id);

CREATE UNIQUE INDEX tracker_records_creation_operation
  ON tracker_records (tracker_id, client_operation_id);

CREATE INDEX tracker_records_live
  ON tracker_records (tracker_id, collection, created_at)
  WHERE deleted_at IS NULL;

CREATE INDEX tracker_records_owner ON tracker_records (owner_id, tracker_id);

CREATE UNIQUE INDEX trackers_owner_slug ON trackers (owner_id, slug);

CREATE INDEX "verification_identifier_idx" ON "verification" ("identifier");

CREATE INDEX wasm_computer_output_exports_file ON wasm_computer_output_exports(file_id);

CREATE INDEX web_search_operations_owner_attempts
  ON web_search_operations (workspace_id, admitted_at, state, operation_id);

CREATE INDEX web_search_operations_recovery
  ON web_search_operations (state, execution_lease_expires_at, updated_at, operation_id);

CREATE INDEX web_search_orphan_release_claims_pending
  ON web_search_orphan_release_claims (release_completed_at, claimed_at, operation_id);

CREATE INDEX work_memory_search_scope ON work_memory_search_records(owner_id, workspace_id, agent_id, status);

CREATE INDEX work_preservation_absorption
  ON result_only_finalization_calls (funding_purpose, completed_at, admitted_at);

CREATE UNIQUE INDEX work_preservation_progress
  ON result_only_finalization_calls (workspace_id, owner_turn, agent_id, preservation_progress)
  WHERE funding_purpose = 'work-preservation';

CREATE INDEX workspace_agents_workspace
  ON workspace_agents (workspace_id, agent_id);

CREATE INDEX workspace_computer_allowance_waits_funding
  ON workspace_computer_allowance_waits
    (workspace_id, feature_key, usage_unit, required_entitlement_key, created_at);

CREATE INDEX workspace_computer_file_grants_active
  ON workspace_computer_file_grants (workspace_id, status, file_id);

CREATE INDEX workspace_computer_financial_stop_receipts_recovery
  ON workspace_computer_financial_stop_receipts (state, updated_at, operation_id);

CREATE INDEX workspace_computer_funding_segments_recovery
  ON workspace_computer_funding_segments (state, updated_at, workspace_id, operation_id);

CREATE INDEX workspace_computer_output_exports_job ON workspace_computer_output_exports (workspace_id, job_id, output_index);

CREATE INDEX workspace_computer_segments_operational_state
ON workspace_computer_funding_segments(state, operation_id);

CREATE INDEX workspace_conversation_kinds_workspace_kind
  ON workspace_conversation_kinds (workspace_id, kind, conversation_id);

CREATE INDEX workspace_conversations_workspace
  ON workspace_conversations (workspace_id, conversation_id);

CREATE INDEX workspace_databases_workspace ON workspace_databases(workspace_id, archived_at, database_id);

CREATE INDEX workspace_file_folder_entries_folder
  ON workspace_file_folder_entries (workspace_id, folder_id);

CREATE UNIQUE INDEX workspace_file_folders_active_sibling_name
  ON workspace_file_folders (workspace_id, ifnull(parent_folder_id, ''), name_key)
  WHERE deleted_at IS NULL;

CREATE INDEX workspace_file_folders_parent
  ON workspace_file_folders (workspace_id, parent_folder_id, deleted_at);

CREATE INDEX workspace_file_grants_agent_fingerprint
  ON workspace_file_grants(agent_id)
  WHERE agent_id IS NOT NULL;

CREATE UNIQUE INDEX workspace_file_grants_agent_route
  ON workspace_file_grants (file_id, agent_id)
  WHERE scope_kind = 'agent';

CREATE INDEX workspace_file_grants_authorized_agent
  ON workspace_file_grants (workspace_id, agent_id, status, file_id)
  WHERE scope_kind = 'agent';

CREATE INDEX workspace_file_grants_authorized_conversation
  ON workspace_file_grants (workspace_id, conversation_id, status, file_id)
  WHERE scope_kind = 'conversation';

CREATE INDEX workspace_file_grants_conversation_fingerprint
  ON workspace_file_grants(conversation_id)
  WHERE conversation_id IS NOT NULL;

CREATE UNIQUE INDEX workspace_file_grants_conversation_route
  ON workspace_file_grants (file_id, conversation_id)
  WHERE scope_kind = 'conversation';

CREATE INDEX workspace_file_processing_jobs_ready
  ON workspace_file_processing_jobs (status, available_at, workspace_id, file_id);

CREATE INDEX workspace_file_representation_reservations_by_workspace
  ON workspace_file_representation_reservations (workspace_id, status, file_id, version);

CREATE INDEX workspace_file_representations_workspace
  ON workspace_file_representations (workspace_id, file_id, version);

CREATE INDEX workspace_file_share_intents_recovery
  ON workspace_file_share_intents (status, updated_at, share_intent_id)
  WHERE status IN ('pending', 'grant-active');

CREATE INDEX workspace_file_spreadsheet_representations_workspace
  ON workspace_file_spreadsheet_representations (workspace_id, file_id, representation_version);

CREATE INDEX workspace_file_text_backfill_ready
  ON workspace_file_text_backfill_jobs(status, available_at, file_id, version);

CREATE INDEX workspace_file_text_chunks_scope ON workspace_file_text_chunks(scope_key, byte_offset);

CREATE INDEX workspace_file_user_event_outbox_sequence
  ON workspace_file_user_event_outbox (sequence);

CREATE INDEX workspace_files_browse_name
  ON workspace_files (workspace_id, display_name_key, file_id);

CREATE INDEX workspace_files_operational_projection
ON workspace_files(workspace_id, source_provenance, status);

CREATE INDEX workspace_files_service_creator ON workspace_files(workspace_id, created_by_service_id, file_id) WHERE created_by_service_id IS NOT NULL;

CREATE INDEX workspace_files_workspace_status
  ON workspace_files (workspace_id, status, created_at, file_id);

CREATE INDEX workspace_forms_library ON workspace_forms(workspace_id, status, form_id);

CREATE INDEX workspace_memberships_user_status
  ON workspace_memberships (user_id, status, workspace_id);

CREATE INDEX workspace_message_search_scope
  ON workspace_message_search_records (owner_id, conversation_id, created_at DESC);

CREATE INDEX workspace_message_search_sessions_expiry
  ON workspace_message_search_sessions (expires_at);

CREATE UNIQUE INDEX workspace_secrets_active_name
  ON workspace_secrets (workspace_id, environment_name)
  WHERE revoked_at IS NULL;

CREATE INDEX workspace_secrets_workspace
  ON workspace_secrets (workspace_id, revoked_at, environment_name);

CREATE INDEX workspace_service_agent_tools ON workspace_service_tool_grants(agent_id, service_id, tool_name) WHERE revoked_at IS NULL;

CREATE INDEX workspace_service_current_capabilities ON workspace_service_capability_grants(service_id, revision_id, kind, target_id, operation) WHERE revoked_at IS NULL;

CREATE INDEX workspace_service_ingress_diagnostics_window ON workspace_service_ingress_diagnostics(workspace_id,service_id,created_at DESC,diagnostic_id DESC);

CREATE INDEX workspace_service_ingress_secret_scope ON workspace_service_ingress_secrets(service_id, revoked_at);

CREATE UNIQUE INDEX workspace_services_active_name ON workspace_services(workspace_id, name) WHERE status = 'active';

CREATE INDEX workspace_services_directory ON workspace_services(workspace_id, status, service_id);

CREATE INDEX workspace_sites_directory ON workspace_sites(workspace_id, status, site_id);

CREATE UNIQUE INDEX workspace_sites_scoped_identity ON workspace_sites(workspace_id, site_id);

CREATE INDEX workspace_skills_library ON workspace_skills (workspace_id, deleted_at, updated_at DESC, skill_id DESC);

CREATE INDEX workspace_skills_marketplace_origin
  ON workspace_skills (workspace_id, origin_skill_version_id)
  WHERE origin_skill_version_id IS NOT NULL;

CREATE UNIQUE INDEX workspace_skills_workspace_identity
  ON workspace_skills (workspace_id, skill_id);

CREATE VIEW success_billing_feature_metrics AS
SELECT operation_id, kind, feature_key, usage_unit, state, absorption_reason,
       actual_units, actual_charge, customer_charge, merchant_absorbed, outcome_json,
       provider_cost_json, cost_resolution, admitted_at, completed_at
FROM success_billing_operations;

CREATE TRIGGER agent_agent_direct_authorization_before_insert
BEFORE INSERT ON agent_agent_direct_conversations
WHEN NOT EXISTS (
  SELECT 1
  FROM workspace_conversation_kinds k
  JOIN workspace_agents first_agent
    ON first_agent.workspace_id = k.workspace_id
      AND first_agent.agent_id = new.first_agent_id
  JOIN workspace_agents second_agent
    ON second_agent.workspace_id = k.workspace_id
      AND second_agent.agent_id = new.second_agent_id
  WHERE k.conversation_id = new.conversation_id
    AND k.workspace_id = new.workspace_id
    AND k.kind = 'agent-agent-direct'
)
BEGIN
  SELECT RAISE(ABORT, 'Agent-Agent direct conversation is outside its authorized Workspace');
END;

CREATE TRIGGER agent_profile_workspace_after_insert
AFTER INSERT ON agent_profiles
BEGIN
  INSERT INTO workspace_agents (agent_id, workspace_id)
  VALUES (new.agent_id, new.owner_id);
END;

CREATE TRIGGER agent_question_turn_recovery_after_insert
AFTER INSERT ON agent_questions
WHEN (new.status IN ('answered', 'superseded') OR (new.status = 'dismissed' AND new.purpose = 'bot-onboarding'))
  AND new.invoking_turn_id IS NOT NULL
BEGIN
  INSERT OR IGNORE INTO agent_question_turn_recoveries
    (question_id, status, attempts, next_attempt_at, updated_at)
  VALUES (
    new.question_id,
    'pending',
    0,
    COALESCE(new.answered_at, new.superseded_at, unixepoch('subsec') * 1000),
    unixepoch('subsec') * 1000
  );
END;

CREATE TRIGGER agent_question_turn_recovery_after_resolution
AFTER UPDATE OF status, invoking_turn_id ON agent_questions
WHEN (new.status IN ('answered', 'superseded') OR (new.status = 'dismissed' AND new.purpose = 'bot-onboarding'))
  AND new.invoking_turn_id IS NOT NULL
BEGIN
  INSERT OR IGNORE INTO agent_question_turn_recoveries
    (question_id, status, attempts, next_attempt_at, updated_at)
  VALUES (
    new.question_id,
    'pending',
    0,
    COALESCE(new.answered_at, new.superseded_at, unixepoch('subsec') * 1000),
    unixepoch('subsec') * 1000
  );
END;

CREATE TRIGGER agent_web_fetch_operations_no_delete
BEFORE DELETE ON agent_web_fetch_operations
BEGIN
  SELECT RAISE(ABORT, 'agent web fetch operations are retained in v0');
END;

CREATE TRIGGER artifact_creation_operation_conflict
BEFORE UPDATE ON artifact_creation_operations
WHEN NEW.request_identity <> OLD.request_identity OR NEW.revision_id <> OLD.revision_id
BEGIN SELECT RAISE(ABORT, 'Artifact creation operation conflict'); END;

CREATE TRIGGER artifact_creation_operation_retained BEFORE DELETE ON artifact_creation_operations
BEGIN SELECT RAISE(ABORT, 'Artifact creation operations are retained'); END;

CREATE TRIGGER artifact_creation_source_match BEFORE INSERT ON artifact_creation_operations
WHEN NOT EXISTS (SELECT 1 FROM artifact_revisions r
  WHERE r.revision_id = NEW.revision_id AND r.workspace_id = NEW.workspace_id
  AND r.primary_file_id = json_extract(NEW.request_identity, '$[0]'))
BEGIN SELECT RAISE(ABORT, 'Artifact creation source conflict'); END;

CREATE TRIGGER artifact_references_before_delete
BEFORE DELETE ON artifact_references
BEGIN
  SELECT RAISE(ABORT, 'artifact references are retained in v0');
END;

CREATE TRIGGER artifact_references_before_immutable_update
BEFORE UPDATE OF artifact_id, revision_id, workspace_id, conversation_id, file_id,
  grant_id, display_name, media_type, byte_size, created_at
ON artifact_references
BEGIN
  SELECT RAISE(ABORT, 'artifact references pin an immutable revision placement');
END;

CREATE TRIGGER artifact_references_before_terminal_update
BEFORE UPDATE ON artifact_references
WHEN OLD.status IN ('committed', 'failed') AND (
  NEW.status <> OLD.status
  OR NEW.message_id IS NOT OLD.message_id
  OR NEW.committed_at IS NOT OLD.committed_at
)
BEGIN
  SELECT RAISE(ABORT, 'artifact reference terminal state is immutable');
END;

CREATE TRIGGER artifact_revision_image_declared BEFORE INSERT ON artifact_revision_images
WHEN NOT EXISTS (
  SELECT 1 FROM artifact_creation_operations operation,
    json_each(json_extract(operation.request_identity, '$[1]')) binding
  WHERE operation.revision_id = NEW.revision_id AND operation.workspace_id = NEW.workspace_id
    AND json_extract(binding.value, '$[0]') = NEW.asset_name
    AND json_extract(binding.value, '$[1]') = NEW.file_id
)
BEGIN SELECT RAISE(ABORT, 'Artifact image must belong to its immutable creation manifest'); END;

CREATE TRIGGER artifact_revision_images_no_delete BEFORE DELETE ON artifact_revision_images
BEGIN SELECT RAISE(ABORT, 'Artifact image bindings are retained'); END;

CREATE TRIGGER artifact_revision_images_no_update BEFORE UPDATE ON artifact_revision_images
BEGIN SELECT RAISE(ABORT, 'Artifact image bindings are immutable'); END;

CREATE TRIGGER artifact_revisions_before_delete
BEFORE DELETE ON artifact_revisions
BEGIN
  SELECT RAISE(ABORT, 'artifact revisions are retained in v0');
END;

CREATE TRIGGER artifact_revisions_before_update
BEFORE UPDATE ON artifact_revisions
BEGIN
  SELECT RAISE(ABORT, 'artifact revisions are immutable');
END;

CREATE TRIGGER artifacts_before_delete
BEFORE DELETE ON artifacts
BEGIN
  SELECT RAISE(ABORT, 'artifacts are retained in v0');
END;

CREATE TRIGGER ceramic_search_risk_claim AFTER INSERT ON ceramic_search_attempts
BEGIN
  UPDATE ceramic_search_risk_budgets SET booked_usd = booked_usd + NEW.maximum_usd
  WHERE budget_key = NEW.budget_key;
END;

CREATE TRIGGER ceramic_search_risk_reclaim AFTER UPDATE OF state ON ceramic_search_attempts
WHEN OLD.state = 'released' AND NEW.state = 'reserved'
BEGIN
  UPDATE ceramic_search_risk_budgets SET booked_usd = booked_usd + NEW.maximum_usd
  WHERE budget_key = NEW.budget_key;
END;

CREATE TRIGGER ceramic_search_risk_release AFTER UPDATE OF state ON ceramic_search_attempts
WHEN OLD.state = 'reserved' AND NEW.state = 'released'
BEGIN
  UPDATE ceramic_search_risk_budgets SET booked_usd = booked_usd - NEW.maximum_usd
  WHERE budget_key = NEW.budget_key;
END;

CREATE TRIGGER conversation_agent_agent_direct_after_soft_delete
AFTER UPDATE OF status ON conversation_projections
WHEN new.status = 'soft-deleted' AND old.status <> 'soft-deleted'
BEGIN
  UPDATE agent_agent_direct_conversations
  SET status = 'retired'
  WHERE conversation_id = new.conversation_id AND status = 'active';
END;

CREATE TRIGGER conversation_human_agent_direct_after_soft_delete
AFTER UPDATE OF status ON conversation_projections
WHEN new.status = 'soft-deleted' AND old.status <> 'soft-deleted'
BEGIN
  UPDATE human_agent_direct_conversations
  SET status = 'retired'
  WHERE conversation_id = new.conversation_id AND status = 'active';
END;

CREATE TRIGGER conversation_member_explicit_kind_after_insert
AFTER INSERT ON conversation_agent_projections
WHEN new.status = 'active'
BEGIN
  INSERT OR IGNORE INTO workspace_conversation_kinds
    (conversation_id, workspace_id, kind)
  SELECT
    c.conversation_id,
    wc.workspace_id,
    CASE WHEN c.kind = 'direct' THEN 'human-agent-direct' ELSE 'group' END
  FROM conversation_projections c
  JOIN workspace_conversations wc ON wc.conversation_id = c.conversation_id
  WHERE c.conversation_id = new.conversation_id;
END;

CREATE TRIGGER conversation_member_human_agent_direct_after_insert
AFTER INSERT ON conversation_agent_projections
WHEN
  new.status = 'active'
  AND (
    SELECT kind FROM conversation_projections
    WHERE conversation_id = new.conversation_id
  ) = 'direct'
BEGIN
  INSERT INTO human_agent_direct_conversations
    (conversation_id, workspace_id, user_id, agent_id, status)
  SELECT
    c.conversation_id,
    wc.workspace_id,
    c.owner_id,
    new.agent_id,
    'active'
  FROM conversation_projections c
  JOIN workspace_conversations wc ON wc.conversation_id = c.conversation_id
  WHERE c.conversation_id = new.conversation_id
    AND c.status <> 'soft-deleted';
END;

CREATE TRIGGER conversation_message_embedding_job_insert
AFTER INSERT ON conversation_message_search_records
BEGIN
  INSERT OR IGNORE INTO retrieval_embedding_jobs
    (entity_kind, entity_id, owner_id, conversation_id, version, operation,
     status, next_attempt_at)
  VALUES
    ('message', new.message_id, new.owner_id, new.conversation_id, 1, 'upsert',
     'pending', new.created_at);
END;

CREATE TRIGGER conversation_message_search_fts_delete
AFTER DELETE ON conversation_message_search_records
BEGIN
  DELETE FROM conversation_message_search_fts WHERE message_id = old.message_id;
END;

CREATE TRIGGER conversation_message_search_fts_insert
AFTER INSERT ON conversation_message_search_records
BEGIN
  INSERT INTO conversation_message_search_fts
    (message_id, conversation_id, owner_id, sequence, content)
  VALUES
    (new.message_id, new.conversation_id, new.owner_id, new.sequence, new.content);
END;

CREATE TRIGGER conversation_message_search_fts_update
AFTER UPDATE ON conversation_message_search_records
BEGIN
  DELETE FROM conversation_message_search_fts WHERE message_id = old.message_id;
  INSERT INTO conversation_message_search_fts
    (message_id, conversation_id, owner_id, sequence, content)
  VALUES
    (new.message_id, new.conversation_id, new.owner_id, new.sequence, new.content);
END;

CREATE TRIGGER conversation_projection_workspace_after_insert
AFTER INSERT ON conversation_projections
BEGIN
  INSERT INTO workspace_conversations (conversation_id, workspace_id)
  VALUES (new.conversation_id, new.owner_id);
END;

CREATE TRIGGER form_submission_original_immutable
BEFORE UPDATE OF original_json ON form_submissions
WHEN OLD.original_json IS NOT NEW.original_json
BEGIN
  SELECT RAISE(ABORT, 'accepted Form response original is immutable');
END;

CREATE TRIGGER historical_paid_work_no_success_operation BEFORE INSERT ON paid_work_operations
WHEN EXISTS (SELECT 1 FROM success_billing_operations WHERE operation_id=NEW.operation_id)
BEGIN SELECT RAISE(ABORT, 'historical_paid_work_success_operation_conflict'); END;

CREATE TRIGGER inference_runtime_evidence_immutable_delete
BEFORE DELETE ON inference_runtime_evidence
BEGIN
  SELECT RAISE(ABORT, 'inference runtime evidence is immutable');
END;

CREATE TRIGGER inference_runtime_evidence_immutable_update
BEFORE UPDATE ON inference_runtime_evidence
BEGIN
  SELECT RAISE(ABORT, 'inference runtime evidence is immutable');
END;

CREATE TRIGGER inference_runtime_policy_publications_immutable_delete
BEFORE DELETE ON inference_runtime_policy_publications
BEGIN
  SELECT RAISE(ABORT, 'inference runtime policy publication is immutable');
END;

CREATE TRIGGER inference_runtime_policy_publications_immutable_update
BEFORE UPDATE ON inference_runtime_policy_publications
BEGIN
  SELECT RAISE(ABORT, 'inference runtime policy publication is immutable');
END;

CREATE TRIGGER marketplace_skill_versions_content_immutable
BEFORE UPDATE ON marketplace_skill_versions
WHEN NOT (
  old.status = 'published' AND new.status = 'withdrawn'
  AND old.skill_version_id = new.skill_version_id
  AND old.skill_definition_id = new.skill_definition_id
  AND old.semantic_version = new.semantic_version
  AND old.version_ordinal = new.version_ordinal
  AND old.skill_name = new.skill_name
  AND old.skill_description = new.skill_description
  AND old.instructions_markdown = new.instructions_markdown
  AND old.files_json = new.files_json
  AND old.file_count = new.file_count
  AND old.byte_size = new.byte_size
  AND old.license_spdx = new.license_spdx
  AND old.attribution = new.attribution
  AND old.source_json = new.source_json
  AND old.release_digest = new.release_digest
  AND old.published_at = new.published_at
)
BEGIN
  SELECT RAISE(ABORT, 'marketplace skill versions are immutable and can only be withdrawn');
END;

CREATE TRIGGER marketplace_skill_versions_no_delete
BEFORE DELETE ON marketplace_skill_versions
BEGIN
  SELECT RAISE(ABORT, 'marketplace skill versions are retained');
END;

CREATE TRIGGER memory_embedding_job_insert
AFTER INSERT ON memory_records
WHEN new.status = 'active'
BEGIN
  INSERT OR IGNORE INTO retrieval_embedding_jobs
    (entity_kind, entity_id, owner_id, scope_kind, scope_id, version, operation,
     status, next_attempt_at)
  VALUES
    ('memory', new.memory_id, new.owner_id, new.scope_kind, new.scope_id,
     new.version, 'upsert', 'pending', new.updated_at);
END;

CREATE TRIGGER memory_embedding_job_update
AFTER UPDATE OF content, status, version ON memory_records
BEGIN
  INSERT OR IGNORE INTO retrieval_embedding_jobs
    (entity_kind, entity_id, owner_id, scope_kind, scope_id, version, operation,
     status, next_attempt_at)
  VALUES
    ('memory', old.memory_id, old.owner_id, old.scope_kind, old.scope_id,
     old.version, 'delete', 'pending', new.updated_at);
  INSERT OR IGNORE INTO retrieval_embedding_jobs
    (entity_kind, entity_id, owner_id, scope_kind, scope_id, version, operation,
     status, next_attempt_at)
  SELECT 'memory', new.memory_id, new.owner_id, new.scope_kind, new.scope_id,
         new.version, 'upsert', 'pending', new.updated_at
  WHERE new.status = 'active';
END;

CREATE TRIGGER memory_operation_requires_committed_version
BEFORE INSERT ON memory_operations
WHEN new.operation_kind IN ('save', 'correct', 'retract')
  AND NOT EXISTS (
    SELECT 1
    FROM memory_records
    WHERE owner_id = new.owner_id
      AND memory_id = new.memory_id
      AND version = new.result_version
      AND last_operation_id = new.client_operation_id
  )
BEGIN
  SELECT RAISE(ABORT, 'Memory operation has no matching committed record version');
END;

CREATE TRIGGER memory_records_fts_delete
AFTER DELETE ON memory_records
BEGIN
  DELETE FROM memory_records_fts WHERE memory_id = old.memory_id;
END;

CREATE TRIGGER memory_records_fts_insert
AFTER INSERT ON memory_records
BEGIN
  INSERT INTO memory_records_fts
    (memory_id, owner_id, scope_kind, scope_id, status, version, content)
  VALUES
    (new.memory_id, new.owner_id, new.scope_kind, new.scope_id, new.status, new.version, new.content);
END;

CREATE TRIGGER memory_records_fts_update
AFTER UPDATE ON memory_records
BEGIN
  DELETE FROM memory_records_fts WHERE memory_id = old.memory_id;
  INSERT INTO memory_records_fts
    (memory_id, owner_id, scope_kind, scope_id, status, version, content)
  VALUES
    (new.memory_id, new.owner_id, new.scope_kind, new.scope_id, new.status, new.version, new.content);
END;

CREATE TRIGGER memory_records_immutable_agent_owner_update
BEFORE UPDATE OF scope_kind, scope_id ON memory_records
WHEN new.scope_kind <> 'agent-private'
  OR new.scope_kind <> old.scope_kind
  OR new.scope_id <> old.scope_id
BEGIN
  SELECT RAISE(ABORT, 'Memory Agent ownership is immutable');
END;

CREATE TRIGGER memory_records_require_agent_owner_insert
BEFORE INSERT ON memory_records
WHEN new.scope_kind <> 'agent-private'
BEGIN
  SELECT RAISE(ABORT, 'Memory must belong to one Agent');
END;

CREATE TRIGGER memory_scope_revision_insert
AFTER INSERT ON memory_records
BEGIN
  INSERT INTO memory_scope_revisions
    (owner_id, scope_kind, scope_id, content_revision, privacy_revision,
     exclude_before_created_at)
  VALUES
    (new.owner_id, new.scope_kind, new.scope_id, 1,
     IIF(new.status = 'retracted', 1, 0),
     IIF(
       new.source_message_id IS NULL AND new.status = 'retracted',
       new.updated_at,
       NULL
     ))
  ON CONFLICT (owner_id, scope_kind, scope_id) DO UPDATE SET
    content_revision = content_revision + 1,
    privacy_revision = privacy_revision + IIF(new.status = 'retracted', 1, 0),
    exclude_before_created_at = IIF(
      new.source_message_id IS NOT NULL OR new.status != 'retracted',
      exclude_before_created_at,
      IIF(
        exclude_before_created_at IS NULL,
        new.updated_at,
        MAX(exclude_before_created_at, new.updated_at)
      )
    );
END;

CREATE TRIGGER memory_scope_revision_update
AFTER UPDATE OF content, status, version ON memory_records
BEGIN
  INSERT INTO memory_scope_revisions
    (owner_id, scope_kind, scope_id, content_revision, privacy_revision,
     exclude_before_created_at)
  VALUES
    (new.owner_id, new.scope_kind, new.scope_id, 1,
     IIF(old.status != 'retracted' AND new.status = 'retracted', 1, 0),
     IIF(
       new.source_message_id IS NULL AND
         (old.content != new.content OR (old.status != 'retracted' AND new.status = 'retracted')),
       new.updated_at,
       NULL
     ))
  ON CONFLICT (owner_id, scope_kind, scope_id) DO UPDATE SET
    content_revision = content_revision + 1,
    privacy_revision = privacy_revision +
      IIF(old.status != 'retracted' AND new.status = 'retracted', 1, 0),
    exclude_before_created_at = IIF(
      new.source_message_id IS NOT NULL OR
        (old.content = new.content AND (old.status = 'retracted' OR new.status != 'retracted')),
      exclude_before_created_at,
      IIF(
        exclude_before_created_at IS NULL,
        new.updated_at,
        MAX(exclude_before_created_at, new.updated_at)
      )
    );

  INSERT INTO conversation_message_access_exclusions
    (owner_id, message_id, invalidated_at, reason)
  SELECT new.owner_id,
         new.source_message_id,
         new.updated_at,
         IIF(
           old.status != 'retracted' AND new.status = 'retracted',
           'memory-retracted',
           'memory-corrected'
         )
  WHERE new.source_message_id IS NOT NULL AND
    (old.content != new.content OR (old.status != 'retracted' AND new.status = 'retracted'))
  ON CONFLICT (owner_id, message_id) DO UPDATE SET
    invalidated_at = MAX(invalidated_at, excluded.invalidated_at),
    reason = excluded.reason;
END;

CREATE TRIGGER monetization_repair_command_before_delete
BEFORE DELETE ON monetization_repair_commands
BEGIN
  SELECT RAISE(ABORT, 'Monetization repair command receipt is retained');
END;

CREATE TRIGGER monetization_repair_command_identity_before_update
BEFORE UPDATE ON monetization_repair_commands
WHEN old.repair_id <> new.repair_id
  OR old.operation_id <> new.operation_id
  OR old.action <> new.action
  OR old.created_at <> new.created_at
BEGIN
  SELECT RAISE(ABORT, 'Monetization repair command identity cannot change');
END;

CREATE TRIGGER notification_channels_after_account_soft_delete_insert
AFTER INSERT ON owner_preferences
WHEN new.status = 'soft-deleted'
BEGIN
  UPDATE notification_channels
  SET status = 'revoked', updated_at = COALESCE(new.deactivated_at, updated_at)
  WHERE user_id = new.owner_id AND status = 'active';
END;

CREATE TRIGGER notification_channels_after_account_soft_delete_update
AFTER UPDATE OF status ON owner_preferences
WHEN new.status = 'soft-deleted' AND old.status <> 'soft-deleted'
BEGIN
  UPDATE notification_channels
  SET status = 'revoked', updated_at = COALESCE(new.deactivated_at, updated_at)
  WHERE user_id = new.owner_id AND status = 'active';
END;

CREATE TRIGGER option_a_release_before_delete
BEFORE DELETE ON option_a_releases
BEGIN
  SELECT RAISE(ABORT, 'Option A release evidence is retained');
END;

CREATE TRIGGER option_a_release_identity_before_update
BEFORE UPDATE ON option_a_releases
WHEN old.release_id <> new.release_id
  OR old.source_commit <> new.source_commit
  OR old.baseline_source_commit <> new.baseline_source_commit
  OR old.worker_script_name <> new.worker_script_name
  OR old.classification <> new.classification
  OR (old.candidate_version_id IS NOT NULL
    AND old.candidate_version_id IS NOT new.candidate_version_id)
  OR (old.stable_version_id IS NOT NULL AND old.stable_version_id IS NOT new.stable_version_id)
  OR old.policy_json <> new.policy_json
  OR old.created_at <> new.created_at
BEGIN
  SELECT RAISE(ABORT, 'Option A release identity and policy cannot change');
END;

CREATE TRIGGER option_a_release_observation_before_delete
BEFORE DELETE ON option_a_release_observations
BEGIN
  SELECT RAISE(ABORT, 'Option A release observations are retained');
END;

CREATE TRIGGER option_a_release_observation_before_update
BEFORE UPDATE ON option_a_release_observations
BEGIN
  SELECT RAISE(ABORT, 'Option A release observations are immutable');
END;

CREATE TRIGGER owner_preferences_workspace_after_soft_delete_insert
AFTER INSERT ON owner_preferences
WHEN new.status = 'soft-deleted'
BEGIN
  UPDATE workspaces
  SET status = 'soft-deleted', updated_at = COALESCE(new.deactivated_at, updated_at)
  WHERE workspace_id = new.owner_id AND status = 'active';

  UPDATE workspace_memberships
  SET
    status = 'removed',
    version = version + 1,
    updated_at = COALESCE(new.deactivated_at, updated_at)
  WHERE workspace_id = new.owner_id AND user_id = new.owner_id AND status = 'active';
END;

CREATE TRIGGER owner_preferences_workspace_after_soft_delete_update
AFTER UPDATE OF status ON owner_preferences
WHEN new.status = 'soft-deleted' AND old.status <> 'soft-deleted'
BEGIN
  UPDATE workspaces
  SET status = 'soft-deleted', updated_at = COALESCE(new.deactivated_at, updated_at)
  WHERE workspace_id = new.owner_id AND status = 'active';

  UPDATE workspace_memberships
  SET
    status = 'removed',
    version = version + 1,
    updated_at = COALESCE(new.deactivated_at, updated_at)
  WHERE workspace_id = new.owner_id AND user_id = new.owner_id AND status = 'active';
END;

CREATE TRIGGER owner_workspace_file_message_attachments_before_delete
BEFORE DELETE ON owner_workspace_file_message_attachments
BEGIN
  SELECT RAISE(ABORT, 'owner workspace file message attachments are retained in v0');
END;

CREATE TRIGGER owner_workspace_file_message_intents_before_delete
BEFORE DELETE ON owner_workspace_file_message_intents
BEGIN
  SELECT RAISE(ABORT, 'owner workspace file message intents are retained in v0');
END;

CREATE TRIGGER plugin_approval_terminal_turn_fence
BEFORE INSERT ON plugin_approvals
WHEN EXISTS (
  SELECT 1 FROM plugin_invocations i JOIN plugin_terminal_turns terminal
    ON terminal.agent_id = i.agent_id AND terminal.conversation_id = i.conversation_id
    AND terminal.turn_id = i.turn_id
  WHERE i.invocation_id = NEW.invocation_id
)
BEGIN
  SELECT RAISE(ABORT, 'Plugin turn is terminal');
END;

CREATE TRIGGER plugin_auth_setup_attempt_retained
BEFORE DELETE ON plugin_auth_setup_attempts
BEGIN
  SELECT RAISE(ABORT, 'Plugin authentication setup attempts are retained');
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

CREATE TRIGGER plugin_bulk_grant_revision_fence
BEFORE UPDATE ON agent_plugin_grants
WHEN new.client_operation_id LIKE 'bulk-grant:%'
BEGIN
  SELECT RAISE(ABORT, 'Plugin bulk grant changed before save')
  WHERE NOT EXISTS (
    SELECT 1 FROM plugin_bulk_grant_operations operation
    WHERE operation.workspace_id = old.workspace_id
      AND operation.connection_id = old.connection_id
      AND new.client_operation_id = 'bulk-grant:' || operation.client_operation_id || ':' || old.agent_id
      AND json_type(operation.expected_revisions_json, '$."' || old.agent_id || '"') = 'integer'
      AND old.revision = json_extract(operation.expected_revisions_json, '$."' || old.agent_id || '"')
      AND new.revision = old.revision + 1
  );
END;

CREATE TRIGGER plugin_bulk_grant_scope_fence
BEFORE INSERT ON plugin_bulk_grant_operations
BEGIN
  SELECT RAISE(ABORT, 'Plugin bulk grant scope changed before save')
  WHERE EXISTS (
    SELECT 1 FROM json_each(new.agent_ids_json) target
    WHERE NOT EXISTS (
      SELECT 1 FROM agent_profiles profile
      WHERE profile.agent_id = target.value
        AND profile.owner_id = new.workspace_id AND profile.status = 'active'
    )
  ) OR (
    json_extract(new.request_json, '$.scope') = 'all'
    AND (SELECT count(*) FROM agent_profiles
         WHERE owner_id = new.workspace_id AND status = 'active') != json_array_length(new.agent_ids_json)
  );
END;

CREATE TRIGGER plugin_connection_auth_credential_retained
BEFORE DELETE ON plugin_connection_auth_credentials
BEGIN
  SELECT RAISE(ABORT, 'Plugin Connection authentication credentials are retained');
END;

CREATE TRIGGER plugin_connection_monitoring_versions_no_delete
BEFORE DELETE ON plugin_connection_monitoring_versions
BEGIN
  SELECT RAISE(ABORT, 'Monitoring intent revisions are retained');
END;

CREATE TRIGGER plugin_connection_monitoring_versions_no_update
BEFORE UPDATE ON plugin_connection_monitoring_versions
BEGIN
  SELECT RAISE(ABORT, 'Monitoring intent revisions are immutable');
END;

CREATE TRIGGER plugin_curated_logo_default_after_insert
AFTER INSERT ON plugin_definitions
WHEN new.marketplace_id = 'supernala-public'
  AND new.publisher_namespace = 'supernala'
  AND new.publisher_trust = 'supernala-curated'
  AND new.logo_domain IS NULL
  AND new.plugin_slug IN (
    'atlassian', 'atlassian-api-token', 'buffer', 'canva', 'cloudflare', 'github', 'gmail', 'gmail-send',
    'linear', 'maple', 'notion', 'resend', 'resend-api', 'slack'
  )
BEGIN
  UPDATE plugin_definitions
  SET logo_domain = CASE new.plugin_slug
    WHEN 'atlassian' THEN 'atlassian.com'
    WHEN 'atlassian-api-token' THEN 'atlassian.com'
    WHEN 'buffer' THEN 'buffer.com'
    WHEN 'canva' THEN 'canva.com'
    WHEN 'cloudflare' THEN 'cloudflare.com'
    WHEN 'github' THEN 'github.com'
    WHEN 'gmail' THEN 'gmail.com'
    WHEN 'gmail-send' THEN 'gmail.com'
    WHEN 'linear' THEN 'linear.app'
    WHEN 'maple' THEN 'maple.dev'
    WHEN 'notion' THEN 'notion.so'
    WHEN 'resend' THEN 'resend.com'
    WHEN 'resend-api' THEN 'resend.com'
    WHEN 'slack' THEN 'slack.com'
  END
  WHERE plugin_definition_id = new.plugin_definition_id;
END;

CREATE TRIGGER plugin_default_allow_after_grant_insert
AFTER INSERT ON agent_plugin_grants
WHEN new.grant_id = 'default-grant:' || new.agent_id || ':' || new.connection_id
  AND new.status = 'active' AND new.revision = 1
BEGIN
  INSERT INTO plugin_tool_policies
    (grant_id, tool_id, policy, policy_revision, created_at, updated_at)
  SELECT new.grant_id, tool.tool_id, 'allow', 1, new.granted_at, new.granted_at
  FROM plugin_catalog_tools tool WHERE tool.catalog_snapshot_id = new.catalog_snapshot_id;
  INSERT INTO plugin_grant_revision_history (grant_id, revision, status, tools_json, recorded_at)
  SELECT new.grant_id, 1, 'active',
    (SELECT json_group_array(json_object('toolId', policy.tool_id,
      'policy', policy.policy, 'policyRevision', policy.policy_revision))
     FROM (SELECT tool_id, policy, policy_revision FROM plugin_tool_policies
       WHERE grant_id = new.grant_id ORDER BY tool_id) policy), new.granted_at;
END;

CREATE TRIGGER plugin_default_grants_after_agent_insert
AFTER INSERT ON agent_profiles WHEN new.status = 'active'
BEGIN
  INSERT OR IGNORE INTO agent_plugin_grants
    (grant_id, workspace_id, agent_id, connection_id, catalog_snapshot_id,
     status, revision, client_operation_id, granted_at, revoked_at, updated_at)
  SELECT 'default-grant:' || new.agent_id || ':' || connection.connection_id,
    activation.workspace_id, new.agent_id, connection.connection_id, version.catalog_snapshot_id,
    'active', 1, 'default-grant:' || new.agent_id || ':' || connection.connection_id,
    MAX(new.created_at, connection.created_at), NULL, MAX(new.created_at, connection.created_at)
  FROM plugin_connections connection
  JOIN workspace_plugin_activations activation ON activation.activation_id = connection.activation_id
  JOIN plugin_installations installation ON installation.installation_id = activation.installation_id
  JOIN plugin_versions version ON version.plugin_version_id = installation.plugin_version_id
  JOIN plugin_definitions definition ON definition.plugin_definition_id = version.plugin_definition_id
  JOIN workspace_memberships membership ON membership.workspace_id = activation.workspace_id
    AND membership.user_id = new.owner_id AND membership.role = 'owner'
    AND membership.status = 'active'
  WHERE connection.status = 'ready' AND activation.status = 'active'
    AND installation.status = 'active' AND definition.status = 'active' AND version.status = 'published'
    AND version.review_status = 'approved';
END;

CREATE TRIGGER plugin_default_grants_after_connection_ready
AFTER UPDATE OF status ON plugin_connections
WHEN new.status = 'ready' AND old.status <> 'ready'
BEGIN
  INSERT OR IGNORE INTO agent_plugin_grants
    (grant_id, workspace_id, agent_id, connection_id, catalog_snapshot_id,
     status, revision, client_operation_id, granted_at, revoked_at, updated_at)
  SELECT 'default-grant:' || profile.agent_id || ':' || new.connection_id,
    activation.workspace_id, profile.agent_id, new.connection_id, version.catalog_snapshot_id,
    'active', 1, 'default-grant:' || profile.agent_id || ':' || new.connection_id,
    MAX(profile.created_at, new.updated_at), NULL, MAX(profile.created_at, new.updated_at)
  FROM workspace_plugin_activations activation
  JOIN plugin_installations installation ON installation.installation_id = activation.installation_id
  JOIN plugin_versions version ON version.plugin_version_id = installation.plugin_version_id
  JOIN plugin_definitions definition ON definition.plugin_definition_id = version.plugin_definition_id
  JOIN workspace_memberships membership ON membership.workspace_id = activation.workspace_id
    AND membership.role = 'owner' AND membership.status = 'active'
  JOIN agent_profiles profile ON profile.owner_id = membership.user_id AND profile.status = 'active'
  WHERE activation.activation_id = new.activation_id AND activation.status = 'active'
    AND installation.status = 'active' AND definition.status = 'active' AND version.status = 'published'
    AND version.review_status = 'approved';
END;

CREATE TRIGGER plugin_default_grants_after_ready_connection_insert
AFTER INSERT ON plugin_connections WHEN new.status = 'ready'
BEGIN
  INSERT OR IGNORE INTO agent_plugin_grants
    (grant_id, workspace_id, agent_id, connection_id, catalog_snapshot_id,
     status, revision, client_operation_id, granted_at, revoked_at, updated_at)
  SELECT 'default-grant:' || profile.agent_id || ':' || new.connection_id,
    activation.workspace_id, profile.agent_id, new.connection_id, version.catalog_snapshot_id,
    'active', 1, 'default-grant:' || profile.agent_id || ':' || new.connection_id,
    MAX(profile.created_at, new.created_at), NULL, MAX(profile.created_at, new.created_at)
  FROM workspace_plugin_activations activation
  JOIN plugin_installations installation ON installation.installation_id = activation.installation_id
  JOIN plugin_versions version ON version.plugin_version_id = installation.plugin_version_id
  JOIN plugin_definitions definition ON definition.plugin_definition_id = version.plugin_definition_id
  JOIN workspace_memberships membership ON membership.workspace_id = activation.workspace_id
    AND membership.role = 'owner' AND membership.status = 'active'
  JOIN agent_profiles profile ON profile.owner_id = membership.user_id AND profile.status = 'active'
  WHERE activation.activation_id = new.activation_id AND activation.status = 'active'
    AND installation.status = 'active' AND definition.status = 'active' AND version.status = 'published'
    AND version.review_status = 'approved';
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

CREATE TRIGGER plugin_oauth_app_retained
BEFORE DELETE ON plugin_oauth_apps
BEGIN
  SELECT RAISE(ABORT, 'Workspace OAuth apps are retained');
END;

CREATE TRIGGER plugin_oauth_connection_credential_retained
BEFORE DELETE ON plugin_oauth_connection_credentials
BEGIN
  SELECT RAISE(ABORT, 'OAuth Connection credential authority is retained');
END;

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

CREATE TRIGGER plugin_oauth_definition_terminalizes_material_sources
AFTER UPDATE OF status ON plugin_oauth_provider_definitions
WHEN old.status = 'active' AND new.status = 'revoked'
BEGIN
  UPDATE plugin_oauth_registration_material_sources
  SET status = 'retired', updated_at = new.updated_at, retired_at = new.updated_at,
      retirement_reason = 'provider-definition-revoked'
  WHERE provider_definition_digest = new.provider_definition_digest AND status = 'active';
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

CREATE TRIGGER plugin_oauth_material_source_retained
BEFORE DELETE ON plugin_oauth_registration_material_sources
BEGIN SELECT RAISE(ABORT, 'OAuth material sources are retained'); END;

CREATE TRIGGER plugin_oauth_refresh_operation_retained
BEFORE DELETE ON plugin_oauth_refresh_operations
BEGIN
  SELECT RAISE(ABORT, 'OAuth refresh operations are retained');
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

CREATE TRIGGER plugin_oauth_revocation_retained
BEFORE DELETE ON plugin_oauth_revocation_operations
BEGIN
  SELECT RAISE(ABORT, 'OAuth revocation operations are retained');
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

CREATE TRIGGER plugin_oauth_runtime_attempt_retained
BEFORE DELETE ON plugin_oauth_runtime_attempts
BEGIN SELECT RAISE(ABORT, 'OAuth runtime attempts are retained'); END;

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

CREATE TRIGGER plugin_openapi_version_requires_staging
BEFORE INSERT ON plugin_versions
WHEN new.runtime_kind = 'managed-openapi' AND new.status <> 'publishing'
BEGIN SELECT RAISE(ABORT, 'OpenAPI Plugin version must be staged before publication'); END;

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

CREATE TRIGGER plugin_records_retained_no_delete_connection
BEFORE DELETE ON plugin_connections
BEGIN
  SELECT RAISE(ABORT, 'Plugin Connections are retained in v0');
END;

CREATE TRIGGER plugin_records_retained_no_delete_installation
BEFORE DELETE ON plugin_installations
BEGIN
  SELECT RAISE(ABORT, 'Plugin installations are retained in v0');
END;

CREATE TRIGGER plugin_records_retained_no_delete_invocation
BEFORE DELETE ON plugin_invocations
BEGIN
  SELECT RAISE(ABORT, 'Plugin invocations are retained in v0');
END;

CREATE TRIGGER plugin_service_event_subscription_operations_no_delete BEFORE DELETE ON plugin_service_event_subscription_operations
BEGIN SELECT RAISE(ABORT, 'Plugin Service subscription operations are retained'); END;

CREATE TRIGGER plugin_service_event_subscription_operations_no_update BEFORE UPDATE ON plugin_service_event_subscription_operations
BEGIN SELECT RAISE(ABORT, 'Plugin Service subscription operations are immutable'); END;

CREATE TRIGGER plugin_service_event_subscription_versions_no_delete BEFORE DELETE ON plugin_service_event_subscription_versions
BEGIN SELECT RAISE(ABORT, 'Plugin Service subscription history is retained'); END;

CREATE TRIGGER plugin_service_event_subscription_versions_no_update BEFORE UPDATE ON plugin_service_event_subscription_versions
BEGIN SELECT RAISE(ABORT, 'Plugin Service subscription history is immutable'); END;

CREATE TRIGGER plugin_service_usage_event_scope BEFORE INSERT ON plugin_usage_events
WHEN NEW.service_tool_call_id IS NOT NULL AND (
 NEW.agent_id IS NOT NULL OR NEW.invocation_id IS NOT NULL OR NOT EXISTS (
 SELECT 1 FROM plugin_service_tool_calls call WHERE call.tool_call_id=NEW.service_tool_call_id
 AND call.workspace_id=NEW.workspace_id AND call.plugin_version_id=NEW.plugin_version_id AND call.connection_id=NEW.connection_id))
BEGIN SELECT RAISE(ABORT,'invalid Service Plugin usage scope'); END;

CREATE TRIGGER plugin_service_usage_interval_scope BEFORE INSERT ON plugin_usage_intervals
WHEN NEW.service_tool_call_id IS NOT NULL AND (NEW.agent_id IS NOT NULL OR NOT EXISTS (
 SELECT 1 FROM plugin_service_tool_calls call WHERE call.tool_call_id=NEW.service_tool_call_id
 AND call.workspace_id=NEW.workspace_id AND call.plugin_version_id=NEW.plugin_version_id))
BEGIN SELECT RAISE(ABORT,'invalid Service Plugin interval scope'); END;

CREATE TRIGGER plugin_terminal_turn_cancel_approvals
AFTER INSERT ON plugin_terminal_turns
BEGIN
  UPDATE plugin_approvals SET status = 'cancelled', decided_at = NEW.completed_at
  WHERE status = 'pending' AND NOT EXISTS (
    SELECT 1 FROM plugin_work_approvals work
    WHERE work.approval_id = plugin_approvals.approval_id
  ) AND invocation_id IN (
    SELECT invocation_id FROM plugin_invocations
    WHERE agent_id = NEW.agent_id AND conversation_id = NEW.conversation_id
      AND turn_id = NEW.turn_id
  );
  UPDATE plugin_tool_calls SET dispatch_status = 'cancelled', updated_at = NEW.completed_at
  WHERE dispatch_status IN ('approval-required', 'reserved') AND NOT EXISTS (
    SELECT 1 FROM plugin_approvals approval
    JOIN plugin_work_approvals work ON work.approval_id = approval.approval_id
    WHERE approval.tool_call_id = plugin_tool_calls.tool_call_id
  ) AND invocation_id IN (
    SELECT invocation_id FROM plugin_invocations
    WHERE agent_id = NEW.agent_id AND conversation_id = NEW.conversation_id
      AND turn_id = NEW.turn_id
  );
  UPDATE plugin_invocations SET status = 'cancelled', completed_at = NEW.completed_at
  WHERE status IN ('admitted', 'running', 'awaiting-approval')
    AND agent_id = NEW.agent_id AND conversation_id = NEW.conversation_id
    AND turn_id = NEW.turn_id
    AND NOT EXISTS (
      SELECT 1 FROM plugin_approvals approval
      JOIN plugin_work_approvals work ON work.approval_id = approval.approval_id
      WHERE approval.invocation_id = plugin_invocations.invocation_id
    );
END;

CREATE TRIGGER plugin_tool_call_runtime_definition_immutable
BEFORE UPDATE OF runtime_tool_definition_json ON plugin_tool_calls
WHEN OLD.runtime_tool_definition_json IS NOT NEW.runtime_tool_definition_json
BEGIN
  SELECT RAISE(ABORT, 'Plugin runtime tool definition is immutable');
END;

CREATE TRIGGER plugin_user_event_activation_after_change
AFTER UPDATE ON workspace_plugin_activations
BEGIN
  INSERT INTO plugin_user_event_outbox (workspace_id, user_id, change_kind)
  SELECT new.workspace_id, i.user_id, 'activation' FROM plugin_installations i
  WHERE i.installation_id = new.installation_id;
END;

CREATE TRIGGER plugin_user_event_activation_after_insert
AFTER INSERT ON workspace_plugin_activations
BEGIN
  INSERT INTO plugin_user_event_outbox (workspace_id, user_id, change_kind)
  SELECT new.workspace_id, i.user_id, 'activation' FROM plugin_installations i
  WHERE i.installation_id = new.installation_id;
END;

CREATE TRIGGER plugin_user_event_approval_after_insert
AFTER INSERT ON plugin_approvals
BEGIN
  INSERT INTO plugin_user_event_outbox (workspace_id, user_id, change_kind)
  SELECT new.workspace_id, user_id, 'approval' FROM workspace_memberships
  WHERE workspace_id = new.workspace_id AND role = 'owner' AND status = 'active';
END;

CREATE TRIGGER plugin_user_event_approval_after_update
AFTER UPDATE ON plugin_approvals
WHEN new.status <> old.status OR new.resumed_at IS NOT old.resumed_at
BEGIN
  INSERT INTO plugin_user_event_outbox (workspace_id, user_id, change_kind)
  SELECT new.workspace_id, user_id, 'approval' FROM workspace_memberships
  WHERE workspace_id = new.workspace_id AND role = 'owner' AND status = 'active';
END;

CREATE TRIGGER plugin_user_event_connection_after_insert
AFTER INSERT ON plugin_connections
BEGIN
  INSERT INTO plugin_user_event_outbox (workspace_id, user_id, change_kind)
  SELECT a.workspace_id, i.user_id, 'connection'
  FROM workspace_plugin_activations a
  JOIN plugin_installations i ON i.installation_id = a.installation_id
  WHERE a.activation_id = new.activation_id;
END;

CREATE TRIGGER plugin_user_event_connection_after_update
AFTER UPDATE ON plugin_connections
WHEN new.revision <> old.revision OR new.status <> old.status
BEGIN
  INSERT INTO plugin_user_event_outbox (workspace_id, user_id, change_kind)
  SELECT a.workspace_id, i.user_id, 'connection'
  FROM workspace_plugin_activations a
  JOIN plugin_installations i ON i.installation_id = a.installation_id
  WHERE a.activation_id = new.activation_id;
END;

CREATE TRIGGER plugin_user_event_grant_after_insert
AFTER INSERT ON agent_plugin_grants
BEGIN
  INSERT INTO plugin_user_event_outbox (workspace_id, user_id, change_kind)
  SELECT new.workspace_id, user_id, 'grant' FROM workspace_memberships
  WHERE workspace_id = new.workspace_id AND role = 'owner' AND status = 'active';
END;

CREATE TRIGGER plugin_user_event_grant_after_update
AFTER UPDATE ON agent_plugin_grants
WHEN new.revision <> old.revision OR new.status <> old.status
BEGIN
  INSERT INTO plugin_user_event_outbox (workspace_id, user_id, change_kind)
  SELECT new.workspace_id, user_id, 'grant' FROM workspace_memberships
  WHERE workspace_id = new.workspace_id AND role = 'owner' AND status = 'active';
END;

CREATE TRIGGER plugin_user_event_installation_after_insert
AFTER INSERT ON plugin_installations
BEGIN
  INSERT INTO plugin_user_event_outbox (workspace_id, user_id, change_kind)
  SELECT workspace_id, user_id, 'installation' FROM workspace_memberships
  WHERE user_id = new.user_id AND role = 'owner' AND status = 'active';
END;

CREATE TRIGGER plugin_user_event_installation_after_update
AFTER UPDATE ON plugin_installations
WHEN new.revision <> old.revision OR new.status <> old.status
BEGIN
  INSERT INTO plugin_user_event_outbox (workspace_id, user_id, change_kind)
  SELECT workspace_id, user_id, 'installation' FROM workspace_memberships
  WHERE user_id = new.user_id AND role = 'owner' AND status = 'active';
END;

CREATE TRIGGER plugin_user_event_usage_after_insert
AFTER INSERT ON plugin_usage_events
BEGIN
  INSERT INTO plugin_user_event_outbox (workspace_id, user_id, change_kind)
  SELECT new.workspace_id, user_id, 'usage' FROM workspace_memberships
  WHERE workspace_id = new.workspace_id AND role = 'owner' AND status = 'active';
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
BEGIN SELECT RAISE(ABORT, 'Plugin version authentication authority is immutable'); END;

CREATE TRIGGER plugin_version_auth_strategy_immutable
BEFORE UPDATE ON plugin_versions
WHEN old.status IN ('published', 'revoked') AND (
  old.auth_profile IS NOT new.auth_profile
  OR old.auth_definition_digest IS NOT new.auth_definition_digest
  OR old.auth_definition_revision IS NOT new.auth_definition_revision)
BEGIN SELECT RAISE(ABORT, 'Published Plugin authentication strategy is immutable'); END;

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

CREATE TRIGGER plugin_version_event_catalogs_no_delete
BEFORE DELETE ON plugin_version_event_catalogs
BEGIN
  SELECT RAISE(ABORT, 'Plugin event catalogs are retained');
END;

CREATE TRIGGER plugin_version_event_catalogs_no_update
BEFORE UPDATE ON plugin_version_event_catalogs
BEGIN
  SELECT RAISE(ABORT, 'Plugin event catalogs are immutable');
END;

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
    OR (new.runtime_kind = 'managed-remote-mcp' AND new.auth_profile = 'mcp-oauth'
      AND new.authentication_kind = 'oauth' AND new.provider_registration_id IS NOT NULL
      AND new.provider_registration_authority_revision IS NOT NULL
      AND new.provider_definition_digest IS NOT NULL AND new.provider_definition_revision IS NOT NULL
      AND (new.requested_scopes_json <> '[]' OR (
        new.requested_scopes_json = '[]' AND EXISTS (
          SELECT 1 FROM provider_registrations scope_registration
          JOIN plugin_oauth_provider_definitions scope_definition
            ON scope_definition.provider_definition_digest = new.provider_definition_digest
           AND scope_definition.revision = new.provider_definition_revision
          WHERE scope_registration.provider_registration_id = new.provider_registration_id
            AND scope_registration.registration_mode = 'platform-pre-registered'
            AND scope_registration.oauth_provider_definition_digest = scope_definition.provider_definition_digest
            AND scope_registration.oauth_provider_definition_revision = scope_definition.revision
            AND json_extract(scope_definition.canonical_definition_json, '$.scopeAuthority') = 'registered-app-permissions'))))
    OR (new.runtime_kind = 'managed-remote-mcp' AND new.auth_profile = 'mcp-oauth'
      AND new.authentication_kind = 'oauth' AND new.provider_registration_id IS NOT NULL
      AND new.provider_registration_authority_revision IS NULL
      AND new.provider_definition_digest IS NOT NULL AND new.provider_definition_revision IS NOT NULL
      AND new.requested_scopes_json = '[]' AND EXISTS (
        SELECT 1 FROM provider_registrations scope_registration
        JOIN plugin_oauth_provider_definitions scope_definition
          ON scope_definition.provider_definition_digest = new.provider_definition_digest
         AND scope_definition.revision = new.provider_definition_revision
        JOIN plugin_auth_strategy_definitions scope_auth
          ON scope_auth.auth_definition_digest = new.auth_definition_digest
         AND scope_auth.revision = new.auth_definition_revision
        WHERE scope_registration.provider_registration_id = new.provider_registration_id
          AND scope_registration.registration_mode = 'dynamic'
          AND scope_registration.approved_scopes_json = '[]'
          AND scope_definition.scopes_json = '[]'
          AND json_extract(scope_definition.canonical_definition_json, '$.scopeAuthority') = 'registered-app-permissions'
          AND scope_auth.profile = 'mcp-oauth'
          AND json_extract(scope_auth.canonical_definition_json, '$.clientRegistration.kind') = 'dynamic'
          AND json_extract(scope_auth.canonical_definition_json, '$.providerRegistrationId') = new.provider_registration_id
          AND json_extract(scope_auth.canonical_definition_json, '$.providerDefinitionDigest') = new.provider_definition_digest))
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

CREATE TRIGGER portal_identity_immutable
BEFORE UPDATE OF portal_id, workspace_id, owner_user_id, revision_id, created_at ON portals
BEGIN SELECT RAISE(ABORT, 'Portal snapshot identity is immutable'); END;

CREATE TRIGGER portal_no_delete BEFORE DELETE ON portals
BEGIN SELECT RAISE(ABORT, 'Portals are soft deleted'); END;

CREATE TRIGGER portal_policy_transition
BEFORE UPDATE OF visibility, policy_version, status, updated_at ON portals
WHEN OLD.status <> 'active' OR NEW.policy_version <> OLD.policy_version + 1 OR NEW.updated_at < OLD.updated_at
BEGIN SELECT RAISE(ABORT, 'Portal policy must advance monotonically from active state'); END;

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

CREATE TRIGGER provider_registration_oauth_retained
BEFORE DELETE ON provider_registrations
WHEN old.oauth_provider_definition_digest IS NOT NULL
BEGIN
  SELECT RAISE(ABORT, 'OAuth Provider Registrations are retained');
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

CREATE TRIGGER publication_grant_no_delete BEFORE DELETE ON workspace_file_publication_grants
BEGIN SELECT RAISE(ABORT, 'Publication grants are retained under parent policy'); END;

CREATE TRIGGER publication_grant_no_update BEFORE UPDATE ON workspace_file_publication_grants
BEGIN SELECT RAISE(ABORT, 'Publication grant bindings are immutable'); END;

CREATE TRIGGER push_subscriptions_after_account_soft_delete_insert
AFTER INSERT ON owner_preferences
WHEN new.status = 'soft-deleted'
BEGIN
  UPDATE push_subscriptions
  SET status = 'revoked', updated_at = COALESCE(new.deactivated_at, updated_at)
  WHERE user_id = new.owner_id AND status = 'active';
END;

CREATE TRIGGER push_subscriptions_after_account_soft_delete_update
AFTER UPDATE OF status ON owner_preferences
WHEN new.status = 'soft-deleted' AND old.status <> 'soft-deleted'
BEGIN
  UPDATE push_subscriptions
  SET status = 'revoked', updated_at = COALESCE(new.deactivated_at, updated_at)
  WHERE user_id = new.owner_id AND status = 'active';
END;

CREATE TRIGGER site_authoring_immutable BEFORE UPDATE ON site_authoring_sessions
WHEN new.session_id IS NOT old.session_id OR new.editor_workspace_id IS NOT old.editor_workspace_id
  OR new.editor_agent_id IS NOT old.editor_agent_id OR new.editor_work_id IS NOT old.editor_work_id
  OR new.session_json IS NOT old.session_json OR new.file_count IS NOT old.file_count
  OR new.next_file < old.next_file OR (old.state='ready' AND new.state != 'ready')
BEGIN
  SELECT RAISE(ABORT, 'site authoring selection is immutable');
END;

CREATE TRIGGER site_authoring_retain BEFORE DELETE ON site_authoring_sessions
BEGIN
  SELECT RAISE(ABORT, 'site authoring session is retained');
END;

CREATE TRIGGER site_capture_abandonment_before_delete
BEFORE DELETE ON site_capture_abandonments
BEGIN
  SELECT RAISE(ABORT, 'site capture abandonment is retained');
END;

CREATE TRIGGER site_capture_abandonment_before_insert
BEFORE INSERT ON site_capture_abandonments
BEGIN
  SELECT RAISE(ABORT, 'site capture is referenced') WHERE EXISTS (
    SELECT 1 FROM site_revisions WHERE workspace_id = new.workspace_id AND site_id = new.site_id
      AND json_extract(revision_json, '$.source.captureId') = new.capture_id
  );
  SELECT RAISE(ABORT, 'site operation is committed') WHERE EXISTS (
    SELECT 1 FROM site_operation_receipts WHERE workspace_id = new.workspace_id AND operation_id = new.client_operation_id
  );
  SELECT RAISE(ABORT, 'site capture provenance is unverified') WHERE EXISTS (
    SELECT 1 FROM site_revisions WHERE workspace_id = new.workspace_id AND site_id = new.site_id
      AND (json_extract(revision_json, '$.source.kind') IS NULL
        OR json_extract(revision_json, '$.source.kind') NOT IN ('computer', 'html-artifact')
        OR (json_extract(revision_json, '$.source.kind') = 'computer'
          AND (json_type(revision_json, '$.source.captureId') IS NOT 'text'
            OR length(json_extract(revision_json, '$.source.captureId')) <> 64
            OR json_extract(revision_json, '$.source.captureId') GLOB '*[^0-9a-f]*')))
  );
  SELECT RAISE(ABORT, 'site capture has canonical recovery') WHERE EXISTS (
    SELECT 1 FROM site_capture_canonical_claims claim
    LEFT JOIN portal_canonical_mutation_intents intent ON intent.home_workspace_id = claim.home_workspace_id AND intent.operation_id = claim.operation_id
    WHERE claim.home_workspace_id = new.workspace_id AND claim.site_id = new.site_id AND claim.capture_id = new.capture_id
      AND (intent.status IS NULL OR intent.status <> 'fenced')
  );
END;

CREATE TRIGGER site_capture_abandonment_identity_before_update
BEFORE UPDATE ON site_capture_abandonments
WHEN old.workspace_id <> new.workspace_id OR old.site_id <> new.site_id OR old.capture_id <> new.capture_id
  OR old.client_operation_id <> new.client_operation_id OR old.capture_prefix <> new.capture_prefix OR old.completion_key <> new.completion_key
  OR old.initiated_by_user_id <> new.initiated_by_user_id OR old.created_at <> new.created_at
  OR (old.targets_json IS NOT NULL AND old.targets_json IS NOT new.targets_json)
  OR new.target_cursor < old.target_cursor
  OR NOT (old.state = new.state OR (old.state = 'fenced' AND new.state = 'planned') OR (old.state = 'planned' AND new.state = 'complete'))
BEGIN
  SELECT RAISE(ABORT, 'site capture abandonment is permanent');
END;

CREATE TRIGGER site_capture_claim_before_delete
BEFORE DELETE ON site_capture_canonical_claims
BEGIN
  SELECT RAISE(ABORT, 'site capture claim is retained');
END;

CREATE TRIGGER site_capture_claim_before_insert
BEFORE INSERT ON site_capture_canonical_claims
WHEN EXISTS (SELECT 1 FROM site_capture_abandonments WHERE workspace_id = new.home_workspace_id AND site_id = new.site_id AND capture_id = new.capture_id)
BEGIN
  SELECT RAISE(ABORT, 'site capture is abandoned');
END;

CREATE TRIGGER site_capture_claim_identity_before_update
BEFORE UPDATE ON site_capture_canonical_claims
BEGIN
  SELECT RAISE(ABORT, 'site capture claim is immutable');
END;

CREATE TRIGGER site_capture_private_receipt_before_insert
BEFORE INSERT ON site_operation_receipts
WHEN EXISTS (SELECT 1 FROM site_capture_abandonments WHERE workspace_id=new.workspace_id AND site_id=new.site_id AND client_operation_id=new.operation_id)
BEGIN
  SELECT RAISE(ABORT, 'site capture is abandoned');
END;

CREATE TRIGGER site_capture_revision_before_insert
BEFORE INSERT ON site_revisions
WHEN EXISTS (SELECT 1 FROM site_capture_abandonments abandonment WHERE abandonment.workspace_id = new.workspace_id
  AND abandonment.site_id = new.site_id AND abandonment.capture_id = json_extract(new.revision_json, '$.source.captureId'))
BEGIN
  SELECT RAISE(ABORT, 'site capture is abandoned');
END;

CREATE TRIGGER site_storage_abandoned_after_update
AFTER UPDATE OF abandoned_at ON site_storage_objects
WHEN old.abandoned_at IS NULL AND new.abandoned_at IS NOT NULL
BEGIN
  UPDATE workspace_file_usage SET
    accepted_bytes = accepted_bytes - CASE WHEN old.status = 'retained' THEN old.byte_size ELSE 0 END,
    reserved_bytes = reserved_bytes - CASE WHEN old.status = 'reserved' THEN old.byte_size ELSE 0 END,
    updated_at = new.updated_at
  WHERE workspace_id = old.workspace_id;
END;

CREATE TRIGGER site_storage_abandoned_before_insert
BEFORE INSERT ON site_storage_objects
WHEN EXISTS (SELECT 1 FROM site_capture_abandonments abandonment WHERE abandonment.workspace_id = new.workspace_id AND abandonment.site_id = new.site_id
  AND ((new.bucket_kind = 'capture' AND new.object_key >= abandonment.capture_prefix || '/' AND new.object_key < abandonment.capture_prefix || '0')
    OR (new.bucket_kind = 'delivery' AND new.object_key = abandonment.completion_key)))
BEGIN
  SELECT RAISE(ABORT, 'site capture is abandoned');
END;

CREATE TRIGGER site_storage_abandoned_before_update
BEFORE UPDATE ON site_storage_objects
WHEN (old.abandoned_at IS NOT NULL AND (new.abandoned_at IS NOT old.abandoned_at OR new.status <> old.status))
  OR (old.abandoned_at IS NULL AND new.abandoned_at IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM site_capture_abandonments abandonment WHERE abandonment.workspace_id = old.workspace_id AND abandonment.site_id = old.site_id
      AND abandonment.state IN ('planned', 'complete')
      AND ((old.bucket_kind = 'capture' AND old.object_key >= abandonment.capture_prefix || '/' AND old.object_key < abandonment.capture_prefix || '0')
        OR (old.bucket_kind = 'delivery' AND old.object_key = abandonment.completion_key))
  ))
BEGIN
  SELECT RAISE(ABORT, 'site storage abandonment requires a permanent operation fence');
END;

CREATE TRIGGER site_storage_admit_before_insert
BEFORE INSERT ON site_storage_objects
WHEN NOT EXISTS (SELECT 1 FROM site_storage_objects WHERE bucket_kind = new.bucket_kind AND object_key = new.object_key)
BEGIN
  SELECT RAISE(ABORT, 'site storage requires an active workspace')
  WHERE NOT EXISTS (SELECT 1 FROM workspaces WHERE workspace_id = new.workspace_id AND status = 'active');
  SELECT RAISE(ABORT, 'site storage quota exceeded')
  WHERE NOT EXISTS (
    SELECT 1 FROM workspace_file_usage WHERE workspace_id = new.workspace_id
      AND new.byte_size <= limit_bytes - accepted_bytes - reserved_bytes
  );
END;

CREATE TRIGGER site_storage_identity_before_update
BEFORE UPDATE ON site_storage_objects
WHEN old.bucket_kind <> new.bucket_kind OR old.object_key <> new.object_key
  OR old.workspace_id <> new.workspace_id OR old.site_id <> new.site_id
  OR old.byte_size <> new.byte_size OR old.content_sha256 <> new.content_sha256
  OR old.created_at <> new.created_at
BEGIN
  SELECT RAISE(ABORT, 'site storage identity is immutable');
END;

CREATE TRIGGER site_storage_no_delete
BEFORE DELETE ON site_storage_objects
BEGIN
  SELECT RAISE(ABORT, 'site storage requires explicit reference-checked abandonment');
END;

CREATE TRIGGER site_storage_reserve_after_insert
AFTER INSERT ON site_storage_objects
BEGIN
  UPDATE workspace_file_usage SET reserved_bytes = reserved_bytes + new.byte_size, updated_at = new.updated_at
  WHERE workspace_id = new.workspace_id;
END;

CREATE TRIGGER site_storage_retain_after_update
AFTER UPDATE OF status ON site_storage_objects
WHEN old.status = 'reserved' AND new.status = 'retained'
BEGIN
  UPDATE workspace_file_usage
  SET accepted_bytes = accepted_bytes + new.byte_size, reserved_bytes = reserved_bytes - new.byte_size, updated_at = new.updated_at
  WHERE workspace_id = new.workspace_id;
END;

CREATE TRIGGER site_storage_state_before_update
BEFORE UPDATE OF status ON site_storage_objects
WHEN old.status <> new.status AND NOT (old.status = 'reserved' AND new.status = 'retained')
BEGIN
  SELECT RAISE(ABORT, 'invalid site storage transition');
END;

CREATE TRIGGER success_billing_no_historical_operation BEFORE INSERT ON success_billing_operations
WHEN EXISTS (SELECT 1 FROM paid_work_operations WHERE operation_id=NEW.operation_id)
BEGIN SELECT RAISE(ABORT, 'success_billing_historical_operation_conflict'); END;

CREATE TRIGGER user_event_account_preferences_after_insert
AFTER INSERT ON owner_preferences
BEGIN
  INSERT INTO application_user_event_outbox (workspace_id, user_id, payload_kind)
  VALUES (new.owner_id, new.owner_id, 'account-preferences');
END;

CREATE TRIGGER user_event_account_preferences_after_update
AFTER UPDATE ON owner_preferences
WHEN new.timezone <> old.timezone
  OR new.automatic_time_zone <> old.automatic_time_zone
  OR new.language <> old.language
  OR new.status <> old.status
BEGIN
  INSERT INTO application_user_event_outbox (workspace_id, user_id, payload_kind)
  VALUES (new.owner_id, new.owner_id, 'account-preferences');
END;

CREATE TRIGGER user_event_agent_profile_after_insert
AFTER INSERT ON agent_profiles
BEGIN
  INSERT INTO application_user_event_outbox (workspace_id, user_id, payload_kind)
  VALUES (new.owner_id, new.owner_id, 'agent-profiles');
END;

CREATE TRIGGER user_event_agent_profile_after_update
AFTER UPDATE ON agent_profiles
WHEN new.version <> old.version
BEGIN
  INSERT INTO application_user_event_outbox (workspace_id, user_id, payload_kind)
  VALUES (new.owner_id, new.owner_id, 'agent-profiles');
END;

CREATE TRIGGER user_event_calendar_event_after_insert AFTER INSERT ON calendar_events
BEGIN
  INSERT INTO calendar_event_user_event_outbox(workspace_id, user_id) VALUES (new.owner_id, new.owner_id);
END;

CREATE TRIGGER user_event_calendar_event_after_update AFTER UPDATE ON calendar_events WHEN new.version <> old.version
BEGIN
  INSERT INTO calendar_event_user_event_outbox(workspace_id, user_id) VALUES (new.owner_id, new.owner_id);
END;

CREATE TRIGGER user_event_calendar_integration_after_delete
AFTER DELETE ON calendar_integrations
BEGIN
  INSERT INTO calendar_event_user_event_outbox (workspace_id, user_id)
  VALUES (old.owner_id, old.owner_id);
END;

CREATE TRIGGER user_event_calendar_integration_after_insert
AFTER INSERT ON calendar_integrations
BEGIN
  INSERT INTO calendar_event_user_event_outbox (workspace_id, user_id)
  VALUES (new.owner_id, new.owner_id);
END;

CREATE TRIGGER user_event_calendar_integration_after_update
AFTER UPDATE ON calendar_integrations
WHEN new.status <> old.status OR new.synced_at IS NOT old.synced_at
BEGIN
  INSERT INTO calendar_event_user_event_outbox (workspace_id, user_id)
  VALUES (new.owner_id, new.owner_id);
END;

CREATE TRIGGER user_event_database_after_insert
AFTER INSERT ON workspace_databases
BEGIN
  INSERT INTO workspace_resource_user_event_outbox
    (workspace_id, user_id, resource_kind, resource_id)
  SELECT new.workspace_id, membership.user_id, 'database', new.database_id
    FROM workspace_memberships membership
   WHERE membership.workspace_id = new.workspace_id AND membership.status = 'active';
END;

CREATE TRIGGER user_event_database_after_update
AFTER UPDATE ON workspace_databases
WHEN new.version <> old.version OR new.archived_at IS NOT old.archived_at
BEGIN
  INSERT INTO workspace_resource_user_event_outbox
    (workspace_id, user_id, resource_kind, resource_id)
  SELECT new.workspace_id, membership.user_id, 'database', new.database_id
    FROM workspace_memberships membership
   WHERE membership.workspace_id = new.workspace_id AND membership.status = 'active';
END;

CREATE TRIGGER user_event_database_record_after_insert
AFTER INSERT ON database_records
BEGIN
  INSERT INTO workspace_resource_user_event_outbox
    (workspace_id, user_id, resource_kind, resource_id)
  SELECT database.workspace_id, membership.user_id, 'database', new.database_id
    FROM workspace_databases database
    JOIN workspace_memberships membership
      ON membership.workspace_id = database.workspace_id AND membership.status = 'active'
   WHERE database.database_id = new.database_id;
END;

CREATE TRIGGER user_event_database_record_after_update
AFTER UPDATE ON database_records
WHEN new.record_json <> old.record_json OR new.archived_at IS NOT old.archived_at
BEGIN
  INSERT INTO workspace_resource_user_event_outbox
    (workspace_id, user_id, resource_kind, resource_id)
  SELECT database.workspace_id, membership.user_id, 'database', new.database_id
    FROM workspace_databases database
    JOIN workspace_memberships membership
      ON membership.workspace_id = database.workspace_id AND membership.status = 'active'
   WHERE database.database_id = new.database_id;
END;

CREATE TRIGGER user_event_design_after_insert
AFTER INSERT ON carousels
WHEN new.workspace_id IS NOT NULL
BEGIN
  INSERT INTO workspace_resource_user_event_outbox
    (workspace_id, user_id, resource_kind, resource_id)
  VALUES (new.workspace_id, new.owner_id, 'design', new.carousel_id);
END;

CREATE TRIGGER user_event_design_after_update
AFTER UPDATE ON carousels
WHEN new.workspace_id IS NOT NULL
  AND (new.revision <> old.revision OR new.deleted_at IS NOT old.deleted_at)
BEGIN
  INSERT INTO workspace_resource_user_event_outbox
    (workspace_id, user_id, resource_kind, resource_id)
  VALUES (new.workspace_id, new.owner_id, 'design', new.carousel_id);
END;

CREATE TRIGGER user_event_form_after_insert
AFTER INSERT ON workspace_forms
BEGIN
  INSERT INTO workspace_resource_user_event_outbox
    (workspace_id, user_id, resource_kind, resource_id)
  SELECT new.workspace_id, membership.user_id, 'form', new.form_id
    FROM workspace_memberships membership
   WHERE membership.workspace_id = new.workspace_id AND membership.status = 'active';
END;

CREATE TRIGGER user_event_form_after_update
AFTER UPDATE ON workspace_forms
WHEN new.version <> old.version OR new.status <> old.status
BEGIN
  INSERT INTO workspace_resource_user_event_outbox
    (workspace_id, user_id, resource_kind, resource_id)
  SELECT new.workspace_id, membership.user_id, 'form', new.form_id
    FROM workspace_memberships membership
   WHERE membership.workspace_id = new.workspace_id AND membership.status = 'active';
END;

CREATE TRIGGER user_event_memory_after_insert
AFTER INSERT ON memory_records
BEGIN
  INSERT INTO application_user_event_outbox (workspace_id, user_id, payload_kind)
  VALUES (new.owner_id, new.owner_id, 'memories');
END;

CREATE TRIGGER user_event_memory_after_update
AFTER UPDATE ON memory_records
WHEN new.version <> old.version
BEGIN
  INSERT INTO application_user_event_outbox (workspace_id, user_id, payload_kind)
  VALUES (new.owner_id, new.owner_id, 'memories');
END;

CREATE TRIGGER user_event_memory_proposal_after_insert
AFTER INSERT ON memory_mutation_proposals
BEGIN
  INSERT INTO application_user_event_outbox (workspace_id, user_id, payload_kind)
  VALUES (new.owner_id, new.owner_id, 'memories');
END;

CREATE TRIGGER user_event_memory_proposal_after_resolution
AFTER UPDATE OF status ON memory_mutation_proposals
WHEN new.status <> old.status
BEGIN
  INSERT INTO application_user_event_outbox (workspace_id, user_id, payload_kind)
  VALUES (new.owner_id, new.owner_id, 'memories');
END;

CREATE TRIGGER user_event_site_after_insert
AFTER INSERT ON workspace_sites
BEGIN
  INSERT INTO workspace_resource_user_event_outbox
    (workspace_id, user_id, resource_kind, resource_id)
  SELECT new.workspace_id, membership.user_id, 'site', new.site_id
    FROM workspace_memberships membership
   WHERE membership.workspace_id = new.workspace_id AND membership.status = 'active';
END;

CREATE TRIGGER user_event_site_after_update
AFTER UPDATE ON workspace_sites
WHEN new.version <> old.version
BEGIN
  INSERT INTO workspace_resource_user_event_outbox
    (workspace_id, user_id, resource_kind, resource_id)
  SELECT new.workspace_id, membership.user_id, 'site', new.site_id
    FROM workspace_memberships membership
   WHERE membership.workspace_id = new.workspace_id AND membership.status = 'active';
END;

CREATE TRIGGER user_event_tracker_after_insert
AFTER INSERT ON database_trackers
BEGIN
  INSERT INTO workspace_resource_user_event_outbox
    (workspace_id, user_id, resource_kind, resource_id)
  SELECT new.workspace_id, membership.user_id, 'tracker', new.tracker_id
    FROM workspace_memberships membership
   WHERE membership.workspace_id = new.workspace_id AND membership.status = 'active';
END;

CREATE TRIGGER user_event_tracker_after_update
AFTER UPDATE ON database_trackers
WHEN new.revision <> old.revision OR new.archived_at IS NOT old.archived_at
BEGIN
  INSERT INTO workspace_resource_user_event_outbox
    (workspace_id, user_id, resource_kind, resource_id)
  SELECT new.workspace_id, membership.user_id, 'tracker', new.tracker_id
    FROM workspace_memberships membership
   WHERE membership.workspace_id = new.workspace_id AND membership.status = 'active';
END;

CREATE TRIGGER user_event_workspace_file_after_insert
AFTER INSERT ON workspace_files
BEGIN
  INSERT INTO workspace_file_user_event_outbox (workspace_id, user_id, conversation_id)
  SELECT new.workspace_id, membership.user_id, NULL
  FROM workspace_memberships membership
  WHERE membership.workspace_id = new.workspace_id AND membership.status = 'active';
END;

CREATE TRIGGER user_event_workspace_file_after_update
AFTER UPDATE ON workspace_files
WHEN new.status <> old.status
  OR new.updated_at <> old.updated_at
BEGIN
  INSERT INTO workspace_file_user_event_outbox (workspace_id, user_id, conversation_id)
  SELECT new.workspace_id, membership.user_id, NULL
  FROM workspace_memberships membership
  WHERE membership.workspace_id = new.workspace_id AND membership.status = 'active';
END;

CREATE TRIGGER user_event_workspace_file_grant_after_insert
AFTER INSERT ON workspace_file_grants
WHEN new.scope_kind = 'conversation'
BEGIN
  INSERT INTO workspace_file_user_event_outbox (workspace_id, user_id, conversation_id)
  SELECT new.workspace_id, membership.user_id, new.conversation_id
  FROM workspace_memberships membership
  WHERE membership.workspace_id = new.workspace_id AND membership.status = 'active';
END;

CREATE TRIGGER user_event_workspace_file_grant_after_update
AFTER UPDATE ON workspace_file_grants
WHEN new.scope_kind = 'conversation'
  AND (new.status <> old.status OR new.version <> old.version)
BEGIN
  INSERT INTO workspace_file_user_event_outbox (workspace_id, user_id, conversation_id)
  SELECT new.workspace_id, membership.user_id, new.conversation_id
  FROM workspace_memberships membership
  WHERE membership.workspace_id = new.workspace_id AND membership.status = 'active';
END;

CREATE TRIGGER user_event_workspace_membership_after_insert
AFTER INSERT ON workspace_memberships
BEGIN
  INSERT INTO application_user_event_outbox (workspace_id, user_id, payload_kind)
  VALUES (new.workspace_id, new.user_id, 'workspace-membership');
END;

CREATE TRIGGER user_event_workspace_membership_after_update
AFTER UPDATE ON workspace_memberships
WHEN new.version <> old.version
BEGIN
  INSERT INTO application_user_event_outbox (workspace_id, user_id, payload_kind)
  VALUES (new.workspace_id, new.user_id, 'workspace-membership');
END;

CREATE TRIGGER user_personal_workspace_after_insert
AFTER INSERT ON "user"
BEGIN
  INSERT INTO workspaces
    (workspace_id, kind, status, created_by_user_id, created_at, updated_at)
  VALUES
    (
      new.id,
      'personal',
      'active',
      new.id,
      CASE
        WHEN typeof(new."createdAt") IN ('integer', 'real') THEN CAST(new."createdAt" AS INTEGER)
        ELSE CAST(strftime('%s', new."createdAt") AS INTEGER) * 1000
          + CAST(substr(strftime('%f', new."createdAt"), 4, 3) AS INTEGER)
      END,
      CASE
        WHEN typeof(new."updatedAt") IN ('integer', 'real') THEN CAST(new."updatedAt" AS INTEGER)
        ELSE CAST(strftime('%s', new."updatedAt") AS INTEGER) * 1000
          + CAST(substr(strftime('%f', new."updatedAt"), 4, 3) AS INTEGER)
      END
    );

  INSERT INTO workspace_memberships
    (workspace_id, user_id, role, status, version, joined_at, updated_at)
  VALUES
    (
      new.id,
      new.id,
      'owner',
      'active',
      1,
      CASE
        WHEN typeof(new."createdAt") IN ('integer', 'real') THEN CAST(new."createdAt" AS INTEGER)
        ELSE CAST(strftime('%s', new."createdAt") AS INTEGER) * 1000
          + CAST(substr(strftime('%f', new."createdAt"), 4, 3) AS INTEGER)
      END,
      CASE
        WHEN typeof(new."updatedAt") IN ('integer', 'real') THEN CAST(new."updatedAt" AS INTEGER)
        ELSE CAST(strftime('%s', new."updatedAt") AS INTEGER) * 1000
          + CAST(substr(strftime('%f', new."updatedAt"), 4, 3) AS INTEGER)
      END
    );
END;

CREATE TRIGGER web_search_operations_authoritative_owner
  BEFORE INSERT ON web_search_operations
  WHEN NOT EXISTS (SELECT 1 FROM paid_work_operations WHERE operation_id = NEW.operation_id)
    AND NOT EXISTS (SELECT 1 FROM success_billing_operations
      WHERE operation_id = NEW.operation_id AND kind = 'web-search')
  BEGIN
    SELECT RAISE(ABORT, 'web search operation requires a retained paid owner');
  END;

CREATE TRIGGER work_memory_search_insert AFTER INSERT ON work_memory_search_records
WHEN new.status = 'active' BEGIN
  INSERT INTO work_memory_fts(memory_id, owner_id, workspace_id, agent_id, content)
    VALUES(new.memory_id, new.owner_id, new.workspace_id, new.agent_id, new.content);
END;

CREATE TRIGGER work_memory_search_update AFTER UPDATE OF content, status, revision ON work_memory_search_records BEGIN
  DELETE FROM work_memory_fts WHERE memory_id = old.memory_id;
  INSERT INTO work_memory_fts(memory_id, owner_id, workspace_id, agent_id, content)
    SELECT new.memory_id, new.owner_id, new.workspace_id, new.agent_id, new.content WHERE new.status = 'active';
END;

CREATE TRIGGER workspace_agent_profiles_fts_profile_delete
AFTER DELETE ON agent_profiles
BEGIN
  DELETE FROM workspace_agent_profiles_fts WHERE agent_id = old.agent_id;
END;

CREATE TRIGGER workspace_agent_profiles_fts_profile_insert
AFTER INSERT ON agent_profiles
WHEN new.status = 'active'
BEGIN
  DELETE FROM workspace_agent_profiles_fts WHERE agent_id = new.agent_id;
  INSERT INTO workspace_agent_profiles_fts
    (agent_id, workspace_id, name, label, description)
  SELECT new.agent_id, workspace_agent.workspace_id, new.name,
    COALESCE(new.label, ''), new.description
  FROM workspace_agents workspace_agent
  WHERE workspace_agent.agent_id = new.agent_id;
END;

CREATE TRIGGER workspace_agent_profiles_fts_profile_update
AFTER UPDATE ON agent_profiles
BEGIN
  DELETE FROM workspace_agent_profiles_fts WHERE agent_id = old.agent_id;
  INSERT INTO workspace_agent_profiles_fts
    (agent_id, workspace_id, name, label, description)
  SELECT new.agent_id, workspace_agent.workspace_id, new.name,
    COALESCE(new.label, ''), new.description
  FROM workspace_agents workspace_agent
  WHERE workspace_agent.agent_id = new.agent_id AND new.status = 'active';
END;

CREATE TRIGGER workspace_agent_profiles_fts_workspace_delete
AFTER DELETE ON workspace_agents
BEGIN
  DELETE FROM workspace_agent_profiles_fts WHERE agent_id = old.agent_id;
END;

CREATE TRIGGER workspace_agent_profiles_fts_workspace_insert
AFTER INSERT ON workspace_agents
BEGIN
  DELETE FROM workspace_agent_profiles_fts WHERE agent_id = new.agent_id;
  INSERT INTO workspace_agent_profiles_fts
    (agent_id, workspace_id, name, label, description)
  SELECT profile.agent_id, new.workspace_id, profile.name,
    COALESCE(profile.label, ''), profile.description
  FROM agent_profiles profile
  WHERE profile.agent_id = new.agent_id AND profile.status = 'active';
END;

CREATE TRIGGER workspace_billing_account_after_workspace_insert
AFTER INSERT ON workspaces
BEGIN
  INSERT INTO workspace_billing_accounts
    (workspace_id, external_customer_id, updated_at)
  VALUES
    (new.workspace_id, 'workspace:' || new.workspace_id, new.created_at);
END;

CREATE TRIGGER workspace_billing_account_storage_limit_after_update
AFTER UPDATE OF plan, plan_status ON workspace_billing_accounts
BEGIN
  UPDATE workspace_file_usage
  SET limit_bytes = CASE
        WHEN new.plan_status <> 'active' THEN 2000000000
        WHEN new.plan = 'plus' THEN 20000000000
        WHEN new.plan = 'standard' THEN 10000000000
        ELSE 2000000000
      END,
      updated_at = new.updated_at
  WHERE workspace_id = new.workspace_id;
END;

CREATE TRIGGER workspace_billing_customer_provisioning_before_delete
BEFORE DELETE ON workspace_billing_customer_provisioning
BEGIN
  SELECT RAISE(ABORT, 'Workspace billing Customer provisioning receipt is retained');
END;

CREATE TRIGGER workspace_billing_customer_provisioning_immutable_request_before_update
BEFORE UPDATE ON workspace_billing_customer_provisioning
WHEN old.workspace_id <> new.workspace_id
  OR old.operation_id <> new.operation_id
  OR old.external_customer_id <> new.external_customer_id
  OR old.contact_email <> new.contact_email
  OR old.contact_name <> new.contact_name
  OR old.created_at <> new.created_at
BEGIN
  SELECT RAISE(ABORT, 'Workspace billing Customer provisioning request is immutable');
END;

CREATE TRIGGER workspace_computer_dispatch_reservations_no_delete
BEFORE DELETE ON workspace_computer_dispatch_reservations
BEGIN
  SELECT RAISE(ABORT, 'workspace computer dispatch reservations are retained in v0');
END;

CREATE TRIGGER workspace_computer_file_grants_no_delete
BEFORE DELETE ON workspace_computer_file_grants
BEGIN
  SELECT RAISE(ABORT, 'Workspace Computer file grants are retained in v0');
END;

CREATE TRIGGER workspace_computer_financial_stop_receipt_before_delete
BEFORE DELETE ON workspace_computer_financial_stop_receipts
BEGIN
  SELECT RAISE(ABORT, 'Workspace Computer financial stop receipt is retained');
END;

CREATE TRIGGER workspace_computer_financial_stop_receipt_identity_before_update
BEFORE UPDATE ON workspace_computer_financial_stop_receipts
WHEN old.operation_id <> new.operation_id
  OR old.workspace_id <> new.workspace_id
  OR old.runtime_session_id <> new.runtime_session_id
  OR old.runtime_generation <> new.runtime_generation
  OR old.stop_intent_id <> new.stop_intent_id
  OR old.stop_context_json <> new.stop_context_json
  OR (old.interval_stopped_at IS NOT NULL
    AND old.interval_stopped_at IS NOT new.interval_stopped_at)
  OR (old.provenance IS NOT NULL AND old.provenance IS NOT new.provenance)
  OR old.created_at <> new.created_at
BEGIN
  SELECT RAISE(ABORT, 'Workspace Computer financial stop receipt identity cannot change');
END;

CREATE TRIGGER workspace_computer_fresh_output_fence_artifact_commit
BEFORE UPDATE OF status ON artifact_references
WHEN new.status = 'committed' AND old.status <> 'committed'
  AND EXISTS (
    SELECT 1 FROM workspace_computer_fresh_output_fences fence
    JOIN workspace_computer_output_exports export
      ON export.workspace_id = new.workspace_id AND export.file_id = new.file_id
    JOIN workspace_files file
      ON file.workspace_id = new.workspace_id AND file.file_id = new.file_id
    WHERE fence.workspace_id = new.workspace_id
      AND substr(file.upload_operation_id, 1,
        length('workspace-computer-output:fresh:' || fence.operation_id || ':')) <>
        'workspace-computer-output:fresh:' || fence.operation_id || ':'
  )
BEGIN
  SELECT RAISE(ABORT, 'legacy computer output is fenced');
END;

CREATE TRIGGER workspace_computer_fresh_output_fence_export_accept
BEFORE UPDATE OF status ON workspace_computer_output_exports
WHEN new.status IN ('accepted', 'attached') AND new.status <> old.status
  AND EXISTS (
    SELECT 1 FROM workspace_computer_fresh_output_fences fence
    WHERE fence.workspace_id = new.workspace_id
      AND NOT EXISTS (
        SELECT 1 FROM workspace_files file
        WHERE file.workspace_id = new.workspace_id AND file.file_id = new.file_id
          AND file.upload_operation_id =
            'workspace-computer-output:fresh:' || fence.operation_id || ':' || new.job_id || ':' || new.output_index
      )
  )
BEGIN
  SELECT RAISE(ABORT, 'legacy computer output is fenced');
END;

CREATE TRIGGER workspace_computer_fresh_output_fence_file_accept
BEFORE UPDATE OF status ON workspace_files
WHEN new.source_provenance = 'computer-export'
  AND old.status = 'uploading' AND new.status IN ('processing', 'readable')
  AND EXISTS (
    SELECT 1 FROM workspace_computer_fresh_output_fences fence
    WHERE fence.workspace_id = new.workspace_id
      AND substr(new.upload_operation_id, 1,
        length('workspace-computer-output:fresh:' || fence.operation_id || ':')) <>
        'workspace-computer-output:fresh:' || fence.operation_id || ':'
  )
BEGIN
  SELECT RAISE(ABORT, 'legacy computer output is fenced');
END;

CREATE TRIGGER workspace_computer_fresh_output_fence_file_insert
BEFORE INSERT ON workspace_files
WHEN new.source_provenance = 'computer-export'
  AND EXISTS (
    SELECT 1 FROM workspace_computer_fresh_output_fences fence
    WHERE fence.workspace_id = new.workspace_id
      AND substr(new.upload_operation_id, 1,
        length('workspace-computer-output:fresh:' || fence.operation_id || ':')) <>
        'workspace-computer-output:fresh:' || fence.operation_id || ':'
  )
BEGIN
  SELECT RAISE(ABORT, 'legacy computer output is fenced');
END;

CREATE TRIGGER workspace_computer_funding_segment_no_overlap_before_start
BEFORE UPDATE OF interval_started_at, funded_until ON workspace_computer_funding_segments
WHEN new.interval_started_at IS NOT NULL AND new.funded_until IS NOT NULL
BEGIN
  SELECT RAISE(ABORT, 'Workspace Computer funded runtime intervals cannot overlap')
  WHERE EXISTS (
    SELECT 1 FROM workspace_computer_funding_segments retained
    WHERE retained.workspace_id = new.workspace_id
      AND retained.runtime_session_id = new.runtime_session_id
      AND retained.runtime_generation = new.runtime_generation
      AND retained.operation_id <> new.operation_id
      AND retained.interval_started_at IS NOT NULL
      AND retained.funded_until IS NOT NULL
      AND new.interval_started_at < retained.funded_until
      AND retained.interval_started_at < new.funded_until
  );
END;

CREATE TRIGGER workspace_computer_output_artifact_publications_before_delete
BEFORE DELETE ON workspace_computer_output_artifact_publications
BEGIN
  SELECT RAISE(ABORT, 'workspace computer output Artifact publications are retained in v0');
END;

CREATE TRIGGER workspace_computer_output_exports_before_delete
BEFORE DELETE ON workspace_computer_output_exports
BEGIN
  SELECT RAISE(ABORT, 'workspace computer output exports are retained in v0');
END;

CREATE TRIGGER workspace_computer_snapshot_file_imports_no_delete
BEFORE DELETE ON workspace_computer_snapshot_file_imports
BEGIN
  SELECT RAISE(ABORT, 'workspace computer snapshot file imports are retained in v0');
END;

CREATE TRIGGER workspace_computer_snapshot_reference_mappings_no_delete
BEFORE DELETE ON workspace_computer_snapshot_reference_mappings
BEGIN
  SELECT RAISE(ABORT, 'workspace computer snapshot reference mapping cannot be deleted');
END;

CREATE TRIGGER workspace_computer_snapshot_reference_mappings_no_update
BEFORE UPDATE ON workspace_computer_snapshot_reference_mappings
BEGIN
  SELECT RAISE(ABORT, 'workspace computer snapshot reference mapping is immutable');
END;

CREATE TRIGGER workspace_computer_snapshot_search_results_no_delete
BEFORE DELETE ON workspace_computer_snapshot_search_results
BEGIN
  SELECT RAISE(ABORT, 'workspace computer snapshot search results are retained in v0');
END;

CREATE TRIGGER workspace_computer_snapshot_searches_no_delete
BEFORE DELETE ON workspace_computer_snapshot_searches
BEGIN
  SELECT RAISE(ABORT, 'workspace computer snapshot searches are retained in v0');
END;

CREATE TRIGGER workspace_file_grant_no_tombstone_insert
BEFORE INSERT ON workspace_file_grants
WHEN EXISTS (
  SELECT 1 FROM workspace_file_tombstones tombstone
  WHERE tombstone.workspace_id = new.workspace_id AND tombstone.file_id = new.file_id
)
BEGIN
  SELECT RAISE(ABORT, 'deleted workspace file cannot gain a grant');
END;

CREATE TRIGGER workspace_file_grant_no_tombstone_reactivation
BEFORE UPDATE OF status ON workspace_file_grants
WHEN new.status = 'active' AND EXISTS (
  SELECT 1 FROM workspace_file_tombstones tombstone
  WHERE tombstone.workspace_id = new.workspace_id AND tombstone.file_id = new.file_id
)
BEGIN
  SELECT RAISE(ABORT, 'deleted workspace file cannot reactivate a grant');
END;

CREATE TRIGGER workspace_file_immutable_fields_before_update
BEFORE UPDATE ON workspace_files
WHEN old.file_id <> new.file_id
  OR old.workspace_id <> new.workspace_id
  OR old.upload_operation_id <> new.upload_operation_id
  OR old.original_name <> new.original_name
  OR ((old.media_type <> new.media_type OR old.media_kind <> new.media_kind)
    AND NOT (
      old.source_provenance = 'computer-export'
      AND old.status = 'uploading'
      AND old.accepted_at IS NULL
      AND old.accepted_byte_size IS NULL
      AND old.storage_key IS NULL
      AND new.status = 'processing'
      AND new.accepted_at IS NOT NULL
      AND new.accepted_byte_size = old.declared_byte_size
      AND new.storage_key IS NOT NULL
      AND new.media_type = 'application/octet-stream'
      AND new.media_kind = 'file'
    ))
  OR old.declared_byte_size <> new.declared_byte_size
  OR old.created_by_user_id <> new.created_by_user_id
  OR old.source_provenance <> new.source_provenance
  OR old.operational_limit_bytes IS NOT new.operational_limit_bytes
  OR old.created_at <> new.created_at
BEGIN
  SELECT RAISE(ABORT, 'workspace file immutable fields cannot change');
END;

CREATE TRIGGER workspace_file_no_delete
BEFORE DELETE ON workspace_files
BEGIN
  SELECT RAISE(ABORT, 'workspace files are retained in v0');
END;

CREATE TRIGGER workspace_file_operational_usage_after_accept
AFTER UPDATE OF status ON workspace_files
WHEN old.status = 'uploading' AND new.status = 'processing'
  AND new.source_provenance <> 'user-upload'
BEGIN
  UPDATE workspace_file_operational_usage
  SET reserved_bytes = reserved_bytes - old.declared_byte_size,
      accepted_bytes = accepted_bytes + new.accepted_byte_size,
      updated_at = new.updated_at
  WHERE workspace_id = new.workspace_id;
END;

CREATE TRIGGER workspace_file_operational_usage_after_upload_failure
AFTER UPDATE OF status ON workspace_files
WHEN old.status = 'uploading' AND new.status = 'upload-failed'
  AND new.source_provenance <> 'user-upload'
BEGIN
  UPDATE workspace_file_operational_usage
  SET reserved_bytes = reserved_bytes - old.declared_byte_size,
      updated_at = new.updated_at
  WHERE workspace_id = new.workspace_id;
END;

CREATE TRIGGER workspace_file_operational_usage_after_workspace_insert
AFTER INSERT ON workspaces
BEGIN
  INSERT INTO workspace_file_operational_usage
    (workspace_id, accepted_bytes, reserved_bytes, updated_at)
  VALUES (new.workspace_id, 0, 0, new.updated_at);

  INSERT INTO workspace_file_representation_usage
    (workspace_id, accepted_bytes, reserved_bytes, updated_at)
  VALUES (new.workspace_id, 0, 0, new.updated_at);
END;

CREATE TRIGGER workspace_file_processing_job_after_accept
AFTER UPDATE OF status ON workspace_files
WHEN old.status <> 'processing' AND new.status = 'processing'
BEGIN
  INSERT INTO workspace_file_processing_jobs
    (file_id, workspace_id, status, attempts, available_at, claimed_at,
     failure_code, created_at, updated_at)
  VALUES
    (new.file_id, new.workspace_id, 'pending', 0, new.updated_at, NULL,
     NULL, new.updated_at, new.updated_at)
  ON CONFLICT (file_id) DO UPDATE SET
    status = 'pending',
    available_at = excluded.available_at,
    claimed_at = NULL,
    failure_code = NULL,
    updated_at = excluded.updated_at;
END;

CREATE TRIGGER workspace_file_representation_after_insert
AFTER INSERT ON workspace_file_representations
BEGIN
  UPDATE workspace_file_representation_reservations
  SET status = 'accepted', updated_at = new.created_at
  WHERE file_id = new.file_id AND version = new.version AND status = 'reserved';

  UPDATE workspace_file_representation_usage
  SET reserved_bytes = reserved_bytes - (
        SELECT byte_size FROM workspace_file_representation_reservations
        WHERE file_id = new.file_id AND version = new.version
      ),
      accepted_bytes = accepted_bytes + (
        SELECT byte_size FROM workspace_file_representation_reservations
        WHERE file_id = new.file_id AND version = new.version
      ),
      updated_at = new.created_at
  WHERE workspace_id = new.workspace_id;
END;

CREATE TRIGGER workspace_file_representation_before_insert
BEFORE INSERT ON workspace_file_representations
WHEN NOT EXISTS (
  SELECT 1 FROM workspace_file_representations existing
  WHERE existing.file_id = new.file_id AND existing.version = new.version
)
BEGIN
  SELECT RAISE(ABORT, 'workspace file representation requires reserved aggregate growth')
  WHERE NOT EXISTS (
    SELECT 1 FROM workspace_file_representation_reservations reservation
    WHERE reservation.file_id = new.file_id
      AND reservation.workspace_id = new.workspace_id
      AND reservation.version = new.version
      AND reservation.status = 'reserved'
       AND reservation.byte_size = new.accounted_byte_size
  );
END;

CREATE TRIGGER workspace_file_representation_reservation_after_insert
AFTER INSERT ON workspace_file_representation_reservations
BEGIN
  UPDATE workspace_file_representation_usage
  SET reserved_bytes = reserved_bytes + new.byte_size,
      updated_at = new.updated_at
  WHERE workspace_id = new.workspace_id;
END;

CREATE TRIGGER workspace_file_representation_reservation_before_insert
BEFORE INSERT ON workspace_file_representation_reservations
BEGIN
  SELECT RAISE(ABORT, 'workspace file representation aggregate limit exceeded')
  WHERE NOT EXISTS (
      SELECT 1 FROM workspace_file_representation_reservations existing
      WHERE existing.file_id = new.file_id AND existing.version = new.version
    )
    AND COALESCE((
      SELECT accepted_bytes + reserved_bytes + new.byte_size > new.configured_limit_bytes
      FROM workspace_file_representation_usage
      WHERE workspace_id = new.workspace_id
    ), new.byte_size > new.configured_limit_bytes);
END;

CREATE TRIGGER workspace_file_representation_reservation_immutable_before_update
BEFORE UPDATE ON workspace_file_representation_reservations
WHEN old.file_id <> new.file_id
  OR old.workspace_id <> new.workspace_id
  OR old.version <> new.version
  OR old.byte_size <> new.byte_size
  OR old.configured_limit_bytes <> new.configured_limit_bytes
  OR old.created_at <> new.created_at
  OR (old.status = 'accepted' AND new.status <> 'accepted')
BEGIN
  SELECT RAISE(ABORT, 'workspace file representation reservation is immutable');
END;

CREATE TRIGGER workspace_file_reservation_after_insert
AFTER INSERT ON workspace_files
BEGIN
  UPDATE workspace_file_usage
  SET reserved_bytes = reserved_bytes + new.declared_byte_size,
      updated_at = new.updated_at
  WHERE workspace_id = new.workspace_id;
  INSERT INTO workspace_file_operational_usage
    (workspace_id, accepted_bytes, reserved_bytes, updated_at)
  VALUES (new.workspace_id, 0, 0, new.updated_at)
  ON CONFLICT (workspace_id) DO NOTHING;
  UPDATE workspace_file_operational_usage
  SET reserved_bytes = reserved_bytes + CASE
        WHEN new.source_provenance <> 'user-upload' THEN new.declared_byte_size ELSE 0 END,
      updated_at = new.updated_at
  WHERE workspace_id = new.workspace_id;
END;

CREATE TRIGGER workspace_file_reservation_before_insert
BEFORE INSERT ON workspace_files
BEGIN
  SELECT RAISE(ABORT, 'workspace files must begin as upload reservations')
  WHERE new.status <> 'uploading';
  SELECT RAISE(ABORT, 'workspace file reservation requires an active workspace')
  WHERE NOT EXISTS (
    SELECT 1 FROM workspaces
    WHERE workspace_id = new.workspace_id AND status = 'active'
  );
  SELECT RAISE(ABORT, 'workspace file reservation requires current paid access')
  WHERE NOT EXISTS (
    SELECT 1 FROM workspace_billing_accounts billing
    WHERE billing.workspace_id = new.workspace_id
      AND billing.plan_status = 'active' AND billing.plan IS NOT NULL
      AND billing.period_started_at IS NOT NULL
      AND billing.period_started_at <= new.created_at
      AND (billing.period_ends_at IS NULL OR billing.period_ends_at > new.created_at)
  );
  SELECT RAISE(ABORT, 'workspace file quota exceeded')
  WHERE COALESCE((
    SELECT accepted_bytes + reserved_bytes + new.declared_byte_size > limit_bytes
    FROM workspace_file_usage WHERE workspace_id = new.workspace_id
  ), 1);
END;

CREATE TRIGGER workspace_file_service_creator_immutable
BEFORE UPDATE OF created_by_service_id, service_upload_sha256 ON workspace_files
WHEN old.created_by_service_id IS NOT new.created_by_service_id OR old.service_upload_sha256 IS NOT new.service_upload_sha256
BEGIN
  SELECT RAISE(ABORT, 'Immutable Service File creator');
END;

CREATE TRIGGER workspace_file_service_creator_insert
BEFORE INSERT ON workspace_files
WHEN new.created_by_service_id IS NOT NULL AND (new.source_provenance <> 'system-generated' OR new.service_upload_sha256 IS NULL OR length(new.service_upload_sha256) <> 64 OR new.service_upload_sha256 GLOB '*[^0-9a-f]*')
BEGIN
  SELECT RAISE(ABORT, 'Service File requires system-generated provenance');
END;

CREATE TRIGGER workspace_file_share_intents_before_delete
BEFORE DELETE ON workspace_file_share_intents
BEGIN
  SELECT RAISE(ABORT, 'workspace file share intents are retained in v0');
END;

CREATE TRIGGER workspace_file_spreadsheet_representations_before_delete
BEFORE DELETE ON workspace_file_spreadsheet_representations
BEGIN
  SELECT RAISE(ABORT, 'Nori spreadsheet representations are retained in v0');
END;

CREATE TRIGGER workspace_file_spreadsheet_representations_before_update
BEFORE UPDATE ON workspace_file_spreadsheet_representations
BEGIN
  SELECT RAISE(ABORT, 'Nori spreadsheet representations are immutable');
END;

CREATE TRIGGER workspace_file_status_transition_before_update
BEFORE UPDATE OF status ON workspace_files
WHEN old.status <> new.status AND NOT (
  (old.status = 'uploading' AND new.status IN ('processing', 'upload-failed'))
  OR (old.status = 'processing' AND new.status IN ('readable', 'processing-failed'))
  OR (old.status = 'processing-failed' AND new.status = 'processing')
)
BEGIN
  SELECT RAISE(ABORT, 'invalid workspace file status transition');
END;

CREATE TRIGGER workspace_file_text_chunks_delete AFTER DELETE ON workspace_file_text_chunks BEGIN
  INSERT INTO workspace_file_text_fts(workspace_file_text_fts, rowid, scope_key, search_text)
  VALUES('delete', old.id, old.scope_key, old.search_text);
END;

CREATE TRIGGER workspace_file_text_chunks_insert AFTER INSERT ON workspace_file_text_chunks BEGIN
  INSERT INTO workspace_file_text_fts(rowid, scope_key, search_text) VALUES(new.id, new.scope_key, new.search_text);
END;

CREATE TRIGGER workspace_file_text_chunks_update AFTER UPDATE ON workspace_file_text_chunks BEGIN
  INSERT INTO workspace_file_text_fts(workspace_file_text_fts, rowid, scope_key, search_text)
  VALUES('delete', old.id, old.scope_key, old.search_text);
  INSERT INTO workspace_file_text_fts(rowid, scope_key, search_text) VALUES(new.id, new.scope_key, new.search_text);
END;

CREATE TRIGGER workspace_file_usage_after_accept
AFTER UPDATE OF status ON workspace_files
WHEN old.status = 'uploading' AND new.status = 'processing'
BEGIN
  UPDATE workspace_file_usage
  SET reserved_bytes = reserved_bytes - old.declared_byte_size,
      accepted_bytes = accepted_bytes + new.accepted_byte_size,
      updated_at = new.updated_at
  WHERE workspace_id = new.workspace_id;
END;

CREATE TRIGGER workspace_file_usage_after_upload_failure
AFTER UPDATE OF status ON workspace_files
WHEN old.status = 'uploading' AND new.status = 'upload-failed'
BEGIN
  UPDATE workspace_file_usage
  SET reserved_bytes = reserved_bytes - old.declared_byte_size,
      updated_at = new.updated_at
  WHERE workspace_id = new.workspace_id;
END;

CREATE TRIGGER workspace_file_usage_after_workspace_insert
AFTER INSERT ON workspaces
BEGIN
  INSERT INTO workspace_file_usage
    (workspace_id, accepted_bytes, reserved_bytes, limit_bytes, updated_at)
  VALUES
    (new.workspace_id, 0, 0, 2000000000, new.updated_at);
END;

CREATE TRIGGER workspace_message_search_fts_delete
AFTER DELETE ON workspace_message_search_records
BEGIN
  DELETE FROM workspace_message_search_fts WHERE message_id = old.message_id;
END;

CREATE TRIGGER workspace_message_search_fts_insert
AFTER INSERT ON workspace_message_search_records
BEGIN
  INSERT INTO workspace_message_search_fts
    (message_id, conversation_id, owner_id, visible_content)
  VALUES
    (new.message_id, new.conversation_id, new.owner_id, new.visible_content);
END;

CREATE TRIGGER workspace_message_search_fts_update
AFTER UPDATE ON workspace_message_search_records
BEGIN
  DELETE FROM workspace_message_search_fts WHERE message_id = old.message_id;
  INSERT INTO workspace_message_search_fts
    (message_id, conversation_id, owner_id, visible_content)
  VALUES
    (new.message_id, new.conversation_id, new.owner_id, new.visible_content);
END;

CREATE TRIGGER workspace_reference_directory_agent_delete
AFTER DELETE ON workspace_agents
BEGIN
  UPDATE workspace_reference_directory_revisions SET revision = revision + 1
  WHERE workspace_id = old.workspace_id;
END;

CREATE TRIGGER workspace_reference_directory_agent_insert
AFTER INSERT ON workspace_agents
BEGIN
  UPDATE workspace_reference_directory_revisions SET revision = revision + 1
  WHERE workspace_id = new.workspace_id;
END;

CREATE TRIGGER workspace_reference_directory_agent_move
AFTER UPDATE ON workspace_agents
BEGIN
  UPDATE workspace_reference_directory_revisions SET revision = revision + 1
  WHERE workspace_id IN (old.workspace_id, new.workspace_id);
END;

CREATE TRIGGER workspace_reference_directory_conversation_update
AFTER UPDATE OF title, purpose, version, kind, status ON conversation_projections
BEGIN
  UPDATE workspace_reference_directory_revisions SET revision = revision + 1
  WHERE workspace_id IN (
    SELECT workspace_id FROM workspace_conversations WHERE conversation_id = new.conversation_id
  );
END;

CREATE TRIGGER workspace_reference_directory_group_delete
AFTER DELETE ON workspace_conversations
BEGIN
  UPDATE workspace_reference_directory_revisions SET revision = revision + 1
  WHERE workspace_id = old.workspace_id;
END;

CREATE TRIGGER workspace_reference_directory_group_insert
AFTER INSERT ON workspace_conversations
BEGIN
  UPDATE workspace_reference_directory_revisions SET revision = revision + 1
  WHERE workspace_id = new.workspace_id;
END;

CREATE TRIGGER workspace_reference_directory_group_move
AFTER UPDATE ON workspace_conversations
BEGIN
  UPDATE workspace_reference_directory_revisions SET revision = revision + 1
  WHERE workspace_id IN (old.workspace_id, new.workspace_id);
END;

CREATE TRIGGER workspace_reference_directory_profile_update
AFTER UPDATE OF name, label, description, version, status ON agent_profiles
BEGIN
  UPDATE workspace_reference_directory_revisions SET revision = revision + 1
  WHERE workspace_id IN (SELECT workspace_id FROM workspace_agents WHERE agent_id = new.agent_id);
END;

CREATE TRIGGER workspace_reference_directory_workspace_insert
AFTER INSERT ON workspaces
BEGIN
  INSERT INTO workspace_reference_directory_revisions (workspace_id, revision)
  VALUES (new.workspace_id, 1);
END;

CREATE TRIGGER workspace_skill_content_requires_version
BEFORE UPDATE OF name, description, instructions_markdown, files_json ON workspace_skills
WHEN new.version = old.version AND (new.name <> old.name OR new.description <> old.description
  OR new.instructions_markdown <> old.instructions_markdown OR new.files_json <> old.files_json)
BEGIN
  SELECT RAISE(ABORT, 'workspace skill content changes require a new version');
END;

CREATE TRIGGER workspace_skill_objects_admit_before_insert
BEFORE INSERT ON workspace_skill_objects
WHEN NOT EXISTS (SELECT 1 FROM workspace_skill_objects WHERE workspace_id = new.workspace_id AND content_sha256 = new.content_sha256)
BEGIN
  SELECT RAISE(ABORT, 'workspace skill storage requires an active workspace')
  WHERE NOT EXISTS (SELECT 1 FROM workspaces WHERE workspace_id = new.workspace_id AND status = 'active');
  SELECT RAISE(ABORT, 'workspace skill storage quota exceeded')
  WHERE NOT EXISTS (
    SELECT 1 FROM workspace_file_usage WHERE workspace_id = new.workspace_id
      AND new.byte_size <= limit_bytes - accepted_bytes - reserved_bytes
  );
END;

CREATE TRIGGER workspace_skill_objects_identity_before_update
BEFORE UPDATE ON workspace_skill_objects
WHEN old.workspace_id <> new.workspace_id OR old.content_sha256 <> new.content_sha256
  OR old.byte_size <> new.byte_size OR old.created_at <> new.created_at
BEGIN
  SELECT RAISE(ABORT, 'workspace skill storage identity is immutable');
END;

CREATE TRIGGER workspace_skill_objects_no_delete
BEFORE DELETE ON workspace_skill_objects
BEGIN
  SELECT RAISE(ABORT, 'workspace skill storage requires explicit reference-checked purge');
END;

CREATE TRIGGER workspace_skill_objects_reserve_after_insert
AFTER INSERT ON workspace_skill_objects
BEGIN
  UPDATE workspace_file_usage SET reserved_bytes = reserved_bytes + new.byte_size, updated_at = new.updated_at
  WHERE workspace_id = new.workspace_id;
END;

CREATE TRIGGER workspace_skill_objects_retain_after_update
AFTER UPDATE OF status ON workspace_skill_objects
WHEN old.status = 'reserved' AND new.status = 'retained'
BEGIN
  UPDATE workspace_file_usage
  SET accepted_bytes = accepted_bytes + new.byte_size, reserved_bytes = reserved_bytes - new.byte_size, updated_at = new.updated_at
  WHERE workspace_id = new.workspace_id;
END;

CREATE TRIGGER workspace_skill_objects_state_before_update
BEFORE UPDATE OF status ON workspace_skill_objects
WHEN old.status <> new.status AND NOT (old.status = 'reserved' AND new.status = 'retained')
BEGIN
  SELECT RAISE(ABORT, 'invalid workspace skill storage transition');
END;

CREATE TRIGGER workspace_skill_version_after_insert
AFTER INSERT ON workspace_skills
BEGIN
  INSERT INTO workspace_skill_versions
    (workspace_id, skill_id, version, name, description, instructions_markdown, files_json, file_count, author_user_id, author_agent_id, created_at)
  VALUES (new.workspace_id, new.skill_id, new.version, new.name, new.description, new.instructions_markdown,
    new.files_json, json_array_length(new.files_json), new.created_by_user_id, new.created_by_agent_id, new.updated_at);
END;

CREATE TRIGGER workspace_skill_version_after_update
AFTER UPDATE OF version ON workspace_skills
WHEN new.version <> old.version
BEGIN
  INSERT INTO workspace_skill_versions
    (workspace_id, skill_id, version, name, description, instructions_markdown, files_json, file_count, author_user_id, author_agent_id, created_at)
  VALUES (new.workspace_id, new.skill_id, new.version, new.name, new.description, new.instructions_markdown,
    new.files_json, json_array_length(new.files_json), coalesce(new.updated_by_user_id, new.created_by_user_id),
    new.updated_by_agent_id, new.updated_at);
END;

CREATE TRIGGER workspace_skill_versions_immutable
BEFORE UPDATE ON workspace_skill_versions
BEGIN
  SELECT RAISE(ABORT, 'workspace skill versions are immutable');
END;

CREATE TRIGGER workspace_skill_versions_no_delete
BEFORE DELETE ON workspace_skill_versions
BEGIN
  SELECT RAISE(ABORT, 'workspace skill versions are retained');
END;

CREATE TRIGGER workspace_storage_limit_version_after_update
AFTER UPDATE OF limit_bytes ON workspace_file_usage
WHEN old.limit_bytes <> new.limit_bytes
BEGIN
  UPDATE workspace_file_usage SET limit_version = old.limit_version + 1 WHERE workspace_id = new.workspace_id;
END;
