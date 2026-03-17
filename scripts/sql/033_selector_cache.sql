-- Migration 033: test_selector_cache

CREATE TABLE IF NOT EXISTS test_selector_cache (
  id         TEXT PRIMARY KEY,
  site_id    TEXT NOT NULL REFERENCES sites(id),
  repo_id    TEXT NOT NULL REFERENCES local_repos(id),
  type       TEXT NOT NULL,   -- suite | scenario | tag | testcase
  value      TEXT NOT NULL,
  source     TEXT NOT NULL,   -- scan | history
  last_seen  TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(site_id, repo_id, type, value)
);

CREATE INDEX IF NOT EXISTS idx_selector_cache_lookup ON test_selector_cache(site_id, repo_id, type);
