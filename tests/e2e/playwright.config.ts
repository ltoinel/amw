import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './browser',
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['list'], ['github']] : 'list',
  use: {
    trace: 'retain-on-failure'
  },
  outputDir: '../../test-results/e2e-browser',
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } }
  ]
});
