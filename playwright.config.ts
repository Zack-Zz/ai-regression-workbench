import { defineConfig, devices } from '@playwright/test';

// Allow overriding ports via env vars to avoid conflicts in CI or when
// local services are already running on the defaults.
const API_PORT = Number(process.env['E2E_API_PORT'] ?? 3919);
const UI_PORT = Number(process.env['E2E_UI_PORT'] ?? 5174);

// Ensure localhost traffic bypasses any HTTP proxy (e.g. system proxy set via
// http_proxy env var). Without this, Playwright's webServer URL probes go
// through the proxy, get a non-connection-refused response, and incorrectly
// treat the server as "already available" before Vite has started.
process.env['NO_PROXY'] = 'localhost,127.0.0.1';
process.env['no_proxy'] = 'localhost,127.0.0.1';

export default defineConfig({
  testDir: './apps/local-ui/e2e',
  timeout: 30_000,
  retries: 0,
  use: {
    baseURL: `http://localhost:${String(UI_PORT)}`,
    headless: true,
    // Bypass proxy for browser requests to localhost as well.
    proxy: { server: 'http://localhost', bypass: 'localhost,127.0.0.1' },
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'firefox', use: { ...devices['Desktop Firefox'] } },
    { name: 'webkit', use: { ...devices['Desktop Safari'] } },
  ],
  webServer: [
    {
      command: `node scripts/e2e-server.mjs`,
      url: `http://localhost:${String(API_PORT)}/doctor`,
      env: { ...process.env, E2E_API_PORT: String(API_PORT) } as Record<string, string>,
      reuseExistingServer: !process.env['CI'],
      timeout: 15_000,
      stdout: 'pipe',
    },
    {
      // Pass port via VITE_PORT env var — vite.config.ts reads it.
      // env must include parent process.env (especially PATH) so pnpm is found.
      command: `pnpm --filter @zarb/local-ui run dev`,
      url: `http://localhost:${String(UI_PORT)}`,
      env: { ...process.env, VITE_PORT: String(UI_PORT), E2E_API_PORT: String(API_PORT) } as Record<string, string>,
      reuseExistingServer: !process.env['CI'],
      timeout: 30_000,
      stdout: 'pipe',
    },
  ],
});
