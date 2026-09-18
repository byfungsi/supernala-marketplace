-- Never expire a publication lock: an old publisher may still have external writes in flight.
CREATE TABLE marketplace_release_attempts (
  attempt_id TEXT PRIMARY KEY NOT NULL,
  merge_commit TEXT NOT NULL,
  release_ordinal INTEGER NOT NULL UNIQUE CHECK (release_ordinal >= 0 AND release_ordinal <= 9007199254740991),
  set_digest TEXT,
  status TEXT NOT NULL CHECK (status IN ('preparing', 'approved', 'publishing', 'completed', 'abandoned')),
  created_at INTEGER NOT NULL
);

CREATE UNIQUE INDEX marketplace_single_active_release
ON marketplace_release_attempts ((1))
WHERE status IN ('preparing', 'approved', 'publishing');
