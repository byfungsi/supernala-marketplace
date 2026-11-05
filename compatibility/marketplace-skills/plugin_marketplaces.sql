CREATE TABLE plugin_marketplaces (
  marketplace_id TEXT PRIMARY KEY NOT NULL,
  name TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 120),
  visibility TEXT NOT NULL CHECK (visibility = 'public'),
  trust_class TEXT NOT NULL CHECK (trust_class = 'supernala-curated'),
  status TEXT NOT NULL CHECK (status IN ('active', 'disabled')),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
) WITHOUT ROWID;

INSERT INTO plugin_marketplaces
  (marketplace_id, name, visibility, trust_class, status, created_at, updated_at)
VALUES
  ('supernala-public', 'Supernala Marketplace', 'public', 'supernala-curated', 'active', 0, 0);
