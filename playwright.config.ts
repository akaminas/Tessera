import { defineConfig, devices } from '@playwright/test';

/**
 * End-to-end tests run against a real backend (never mocked).
 * E2E_BASE_URL defaults to a local preview build; set it to the GitHub Pages URL
 * to test the deployed site. See tests/e2e/README.md.
 */
const baseURL = process.env.E2E_BASE_URL || 'http://localhost:4173/Tessera/';

export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 90_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list']],
  use: {
    baseURL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: process.env.E2E_BASE_URL
    ? undefined
    : { command: 'npm run build && npx vite preview --port 4173 --strictPort', url: baseURL, reuseExistingServer: true, timeout: 240_000 },
});
