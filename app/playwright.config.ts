import { defineConfig, devices } from '@playwright/test';
import { env } from './e2e/env';

const CI = !!process.env.CI;

export default defineConfig({
  testDir: 'e2e',
  globalSetup: './e2e/global-setup.ts',
  fullyParallel: true,
  forbidOnly: CI,
  retries: CI ? 1 : 0,
  workers: CI ? 2 : undefined,
  reporter: [['html', { open: 'never' }], CI ? ['github'] : ['list']],
  use: {
    baseURL: 'http://localhost:4173',
    trace: 'on-first-retry',
  },
  projects: [{ name: 'Pixel 7', use: { ...devices['Pixel 7'] } }],
  webServer: {
    // Mode e2e reads no .env file, and dist-e2e leaves a production build in dist untouched.
    command:
      'npx vite build --mode e2e --outDir dist-e2e && npx vite preview --outDir dist-e2e --port 4173 --strictPort',
    url: 'http://localhost:4173',
    reuseExistingServer: false,
    env: {
      VITE_SUPABASE_URL: env.supabaseUrl,
      VITE_SUPABASE_ANON_KEY: env.anonKey,
    },
  },
});
