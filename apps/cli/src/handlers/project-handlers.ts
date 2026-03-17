import type { Db } from '@zarb/storage';
import {
  ProjectRepository, SiteRepository, SiteCredentialRepository, LocalRepoRepository,
  SelectorCacheRepository,
} from '@zarb/storage';
import type { Router } from '../router.js';
import { readBody, ok, notFound, badRequest, serverError, parseQuery } from '../router.js';
import { scanAndCache } from '../services/selector-scan.js';
import { execSync } from 'node:child_process';
import { existsSync, statSync } from 'node:fs';

type PR = import('@zarb/storage').ProjectRow;
type SR = import('@zarb/storage').SiteRow;
type CR = import('@zarb/storage').SiteCredentialRow;
type RR = import('@zarb/storage').LocalRepoRow;

function toProject(r: PR) { return { id: r.id, name: r.name, description: r.description ?? undefined, createdAt: r.created_at, updatedAt: r.updated_at }; }
function toSite(r: SR) { return { id: r.id, projectId: r.project_id, name: r.name, baseUrl: r.base_url, createdAt: r.created_at, updatedAt: r.updated_at }; }
function toCred(r: CR) { return { id: r.id, siteId: r.site_id, label: r.label, authType: r.auth_type, loginUrl: r.login_url ?? undefined, username: r.username ?? undefined, isDefault: false, createdAt: r.created_at }; }
function toRepo(r: RR) { return { id: r.id, projectId: r.project_id, name: r.name, path: r.path, description: r.description ?? undefined, testOutputDir: r.test_output_dir ?? undefined, baseBranch: r.base_branch ?? undefined, createdAt: r.created_at, updatedAt: r.updated_at }; }

export function registerProjectRoutes(router: Router, db: Db): void {
  const projects = new ProjectRepository(db);
  const sites = new SiteRepository(db);
  const creds = new SiteCredentialRepository(db);
  const repos = new LocalRepoRepository(db);
  const selectorCache = new SelectorCacheRepository(db);

  // --- Projects ---
  router.get('/projects', (_req, res) => {
    ok(res, projects.list().map(toProject));
  });

  router.post('/projects', async (req, res) => {
    try {
      const body = await readBody<{ name: string; description?: string }>(req);
      if (!body.name?.trim()) { badRequest(res, 'INVALID_INPUT', 'name is required'); return; }
      const input: import('@zarb/storage').SaveProjectInput = { name: body.name.trim() };
      if (body.description !== undefined) input.description = body.description;
      ok(res, toProject(projects.create(input)));
    } catch { serverError(res, 'Failed to create project'); }
  });

  router.get('/projects/:projectId', (_req, res, params) => {
    const row = projects.findById(params['projectId'] ?? '');
    if (!row) { notFound(res, 'PROJECT_NOT_FOUND', 'Project not found'); return; }
    ok(res, { ...toProject(row), sites: sites.findByProjectId(row.id).map(toSite), repos: repos.findByProjectId(row.id).map(toRepo) });
  });

  router.put('/projects/:projectId', async (req, res, params) => {
    try {
      const id = params['projectId'] ?? '';
      if (!projects.findById(id)) { notFound(res, 'PROJECT_NOT_FOUND', 'Project not found'); return; }
      const body = await readBody<{ name?: string; description?: string }>(req);
      projects.update(id, body);
      ok(res, toProject(projects.findById(id)!));
    } catch { serverError(res, 'Failed to update project'); }
  });

  router.delete('/projects/:projectId', (_req, res, params) => {
    const id = params['projectId'] ?? '';
    if (!projects.findById(id)) { notFound(res, 'PROJECT_NOT_FOUND', 'Project not found'); return; }
    // cascade: delete sites (and their credentials), repos
    for (const site of sites.findByProjectId(id)) {
      for (const cred of creds.findBySiteId(site.id)) creds.delete(cred.id);
      sites.delete(site.id);
    }
    for (const repo of repos.findByProjectId(id)) repos.delete(repo.id);
    projects.delete(id);
    ok(res, { deleted: true });
  });

  // --- Sites ---
  router.get('/projects/:projectId/sites', (_req, res, params) => {
    ok(res, sites.findByProjectId(params['projectId'] ?? '').map(toSite));
  });

  router.post('/projects/:projectId/sites', async (req, res, params) => {
    try {
      const projectId = params['projectId'] ?? '';
      if (!projects.findById(projectId)) { notFound(res, 'PROJECT_NOT_FOUND', 'Project not found'); return; }
      const body = await readBody<{ name: string; baseUrl: string; description?: string }>(req);
      if (!body.name?.trim() || !body.baseUrl?.trim()) { badRequest(res, 'INVALID_INPUT', 'name and baseUrl are required'); return; }
      const input: import('@zarb/storage').SaveSiteInput = { projectId, name: body.name.trim(), baseUrl: body.baseUrl.trim() };
      ok(res, toSite(sites.create(input)));
    } catch { serverError(res, 'Failed to create site'); }
  });

  router.put('/projects/:projectId/sites/:siteId', async (req, res, params) => {
    try {
      const id = params['siteId'] ?? '';
      if (!sites.findById(id)) { notFound(res, 'SITE_NOT_FOUND', 'Site not found'); return; }
      const body = await readBody<{ name?: string; baseUrl?: string; description?: string }>(req);
      sites.update(id, body);
      ok(res, toSite(sites.findById(id)!));
    } catch { serverError(res, 'Failed to update site'); }
  });

  router.delete('/projects/:projectId/sites/:siteId', (_req, res, params) => {
    const id = params['siteId'] ?? '';
    if (!sites.findById(id)) { notFound(res, 'SITE_NOT_FOUND', 'Site not found'); return; }
    for (const cred of creds.findBySiteId(id)) creds.delete(cred.id);
    sites.delete(id);
    ok(res, { deleted: true });
  });

  // --- Credentials ---
  router.get('/projects/:projectId/sites/:siteId/credentials', (_req, res, params) => {
    ok(res, creds.findBySiteId(params['siteId'] ?? '').map(toCred));
  });

  router.post('/projects/:projectId/sites/:siteId/credentials', async (req, res, params) => {
    try {
      const siteId = params['siteId'] ?? '';
      if (!sites.findById(siteId)) { notFound(res, 'SITE_NOT_FOUND', 'Site not found'); return; }
      const body = await readBody<import('@zarb/storage').SaveCredentialInput>(req);
      if (!body.label?.trim()) { badRequest(res, 'INVALID_INPUT', 'label is required'); return; }
      ok(res, toCred(creds.create({ ...body, siteId })));
    } catch { serverError(res, 'Failed to create credential'); }
  });

  router.put('/projects/:projectId/sites/:siteId/credentials/:credId', async (req, res, params) => {
    try {
      const id = params['credId'] ?? '';
      if (!creds.findById(id)) { notFound(res, 'CREDENTIAL_NOT_FOUND', 'Credential not found'); return; }
      const body = await readBody<Partial<import('@zarb/storage').SaveCredentialInput>>(req);
      creds.update(id, body);
      ok(res, toCred(creds.findById(id)!));
    } catch { serverError(res, 'Failed to update credential'); }
  });

  router.delete('/projects/:projectId/sites/:siteId/credentials/:credId', (_req, res, params) => {
    const id = params['credId'] ?? '';
    if (!creds.findById(id)) { notFound(res, 'CREDENTIAL_NOT_FOUND', 'Credential not found'); return; }
    creds.delete(id);
    ok(res, { deleted: true });
  });

  // --- Local Repos ---
  router.get('/projects/:projectId/repos', (_req, res, params) => {
    ok(res, repos.findByProjectId(params['projectId'] ?? '').map(toRepo));
  });

  router.post('/projects/:projectId/repos', async (req, res, params) => {
    try {
      const projectId = params['projectId'] ?? '';
      if (!projects.findById(projectId)) { notFound(res, 'PROJECT_NOT_FOUND', 'Project not found'); return; }
      const body = await readBody<{ name: string; path: string; description?: string; testOutputDir?: string; baseBranch?: string }>(req);
      if (!body.name?.trim() || !body.path?.trim()) { badRequest(res, 'INVALID_INPUT', 'name and path are required'); return; }
      const repoInput: import('@zarb/storage').SaveLocalRepoInput = { projectId, name: body.name.trim(), path: body.path.trim() };
      if (body.description !== undefined) repoInput.description = body.description;
      if (body.testOutputDir !== undefined) repoInput.testOutputDir = body.testOutputDir;
      if (body.baseBranch !== undefined) repoInput.baseBranch = body.baseBranch;
      ok(res, toRepo(repos.create(repoInput)));
    } catch { serverError(res, 'Failed to create repo'); }
  });

  router.put('/projects/:projectId/repos/:repoId', async (req, res, params) => {
    try {
      const id = params['repoId'] ?? '';
      if (!repos.findById(id)) { notFound(res, 'REPO_NOT_FOUND', 'Repo not found'); return; }
      const body = await readBody<{ name?: string; path?: string; description?: string; testOutputDir?: string; baseBranch?: string }>(req);
      repos.update(id, body);
      ok(res, toRepo(repos.findById(id)!));
    } catch { serverError(res, 'Failed to update repo'); }
  });

  router.delete('/projects/:projectId/repos/:repoId', (_req, res, params) => {
    const id = params['repoId'] ?? '';
    if (!repos.findById(id)) { notFound(res, 'REPO_NOT_FOUND', 'Repo not found'); return; }
    repos.delete(id);
    ok(res, { deleted: true });
  });

  // GET /projects/:projectId/repos/:repoId/git-info — list branches
  router.get('/projects/:projectId/repos/:repoId/git-info', (_req, res, params) => {
    const repo = repos.findById(params['repoId'] ?? '');
    if (!repo) { notFound(res, 'REPO_NOT_FOUND', 'Repo not found'); return; }
    try {
      const raw = execSync('git branch -a --format=%(refname:short)', { cwd: repo.path, timeout: 5000 }).toString();
      const branches = raw.split('\n').map(b => b.trim()).filter(Boolean)
        .map(b => b.replace(/^origin\//, ''))
        .filter((b, i, arr) => arr.indexOf(b) === i && b !== 'HEAD');
      const currentRaw = execSync('git rev-parse --abbrev-ref HEAD', { cwd: repo.path, timeout: 3000 }).toString().trim();
      ok(res, { branches, current: currentRaw, isGit: true });
    } catch {
      ok(res, { branches: [], current: '', isGit: false });
    }
  });

  // POST /utils/validate-path — check if a local path exists and is a directory
  router.post('/utils/validate-path', async (req, res) => {
    try {
      const body = await readBody<{ path: string }>(req);
      if (!body.path) { badRequest(res, 'MISSING_PATH', 'path required'); return; }
      const exists = existsSync(body.path);
      const isDir = exists && statSync(body.path).isDirectory();
      let isGit = false;
      if (isDir) {
        try { execSync('git rev-parse --git-dir', { cwd: body.path, timeout: 3000, stdio: 'ignore' }); isGit = true; } catch { /* not git */ }
      }
      ok(res, { exists, isDir, isGit });
    } catch { serverError(res, 'Validation failed'); }
  });

  // --- Selector cache ---
  // GET /projects/:projectId/sites/:siteId/selectors?repoId=...&type=suite|scenario|tag|testcase
  router.get('/projects/:projectId/sites/:siteId/selectors', (req, res, params) => {
    const q = parseQuery(req);
    const siteId = params['siteId'] ?? '';
    const repoId = q['repoId'];
    const type = q['type'] as import('@zarb/storage').SelectorType | undefined;
    if (!repoId) { badRequest(res, 'MISSING_REPO_ID', 'repoId query param required'); return; }
    ok(res, selectorCache.find(siteId, repoId, type));
  });

  // POST /projects/:projectId/sites/:siteId/selectors/scan  { repoId }
  router.post('/projects/:projectId/sites/:siteId/selectors/scan', async (req, res, params) => {
    try {
      const siteId = params['siteId'] ?? '';
      const body = await readBody<{ repoId: string }>(req);
      if (!body.repoId) { badRequest(res, 'MISSING_REPO_ID', 'repoId required'); return; }
      const repo = repos.findById(body.repoId);
      if (!repo) { notFound(res, 'REPO_NOT_FOUND', 'Repo not found'); return; }
      const result = scanAndCache(repo.path, siteId, body.repoId, selectorCache);
      ok(res, result);
    } catch { serverError(res, 'Scan failed'); }
  });

  // POST /projects/:projectId/repos/:repoId/selectors/scan  (no siteId required)
  router.post('/projects/:projectId/repos/:repoId/selectors/scan', async (req, res, params) => {
    try {
      const repoId = params['repoId'] ?? '';
      const repo = repos.findById(repoId);
      if (!repo) { notFound(res, 'REPO_NOT_FOUND', 'Repo not found'); return; }
      const result = scanAndCache(repo.path, '', repoId, selectorCache);
      ok(res, result);
    } catch { serverError(res, 'Scan failed'); }
  });

  // GET /projects/:projectId/repos/:repoId/selectors
  router.get('/projects/:projectId/repos/:repoId/selectors', (req, res, params) => {
    const p = parseQuery(req);
    const type = p['type'];
    ok(res, selectorCache.find('', params['repoId'] ?? '', type as import('@zarb/storage').SelectorType | undefined));
  });

  // GET /projects/:projectId/selectors  (no siteId/repoId required)
  router.get('/projects/:projectId/selectors', (req, res, _params) => {
    const p = parseQuery(req);
    const type = p['type'] as import('@zarb/storage').SelectorType | undefined;
    const rows = type
      ? selectorCache.db_findByType(type)
      : selectorCache.db_findAll();
    ok(res, rows);
  });
}
