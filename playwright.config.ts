import { defineConfig, devices } from '@playwright/test';

/**
 * End-to-end tests. The smoke suite (tests/e2e/smoke.spec.ts) needs no Supabase account: it checks public pages and route protection against placeholder
 * credentials, because the middleware redirects a request without a session before any network call. Flows that need a signed-in user are in tests/e2e/auth.spec.ts
 * and run only when E2E_EMAIL and E2E_PASSWORD (a real test user in a NON-production project) are set.
 */
/** Set E2E_CHROMIUM_PATH to use an already-installed Chromium instead of the one `npx playwright install` downloads. */
const executablePath = process.env.E2E_CHROMIUM_PATH;
const PORT = Number(process.env.E2E_PORT ?? 3100);
export default defineConfig({
  testDir: './tests/e2e',
  testMatch: '**/*.spec.ts',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: { baseURL: `http://localhost:${PORT}`, trace: 'on-first-retry', launchOptions: executablePath ? { executablePath, args: ['--no-sandbox'] } : {} },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'] } },
    { name: 'mobile', use: { ...devices['Pixel 7'] } },
  ],
  webServer: {
    command: `npx next dev -p ${PORT}`,
    url: `http://localhost:${PORT}/login`,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    env: {
      NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL ?? 'http://127.0.0.1:54321',
      NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? 'sb_publishable_placeholder_key_for_e2e_only',
    },
  },
});
