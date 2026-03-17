-- Migration 030: projects, sites, site_credentials, local_repos

CREATE TABLE IF NOT EXISTS projects (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  description TEXT,
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sites (
  id          TEXT PRIMARY KEY,
  project_id  TEXT NOT NULL REFERENCES projects(id),
  name        TEXT NOT NULL,
  base_url    TEXT NOT NULL,
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS site_credentials (
  id                TEXT PRIMARY KEY,
  site_id           TEXT NOT NULL REFERENCES sites(id),
  label             TEXT NOT NULL,
  auth_type         TEXT NOT NULL DEFAULT 'userpass',
  login_url         TEXT,
  username_selector TEXT,
  password_selector TEXT,
  submit_selector   TEXT,
  username          TEXT,
  password          TEXT,
  cookies_json      TEXT,
  headers_json      TEXT,
  sort_order        INTEGER NOT NULL DEFAULT 0,
  created_at        TEXT NOT NULL,
  updated_at        TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS local_repos (
  id              TEXT PRIMARY KEY,
  project_id      TEXT NOT NULL REFERENCES projects(id),
  name            TEXT NOT NULL,
  path            TEXT NOT NULL,
  description     TEXT,
  test_output_dir TEXT,
  created_at      TEXT NOT NULL,
  updated_at      TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_sites_project_id ON sites(project_id);
CREATE INDEX IF NOT EXISTS idx_site_credentials_site_id ON site_credentials(site_id, sort_order);
CREATE INDEX IF NOT EXISTS idx_local_repos_project_id ON local_repos(project_id);
