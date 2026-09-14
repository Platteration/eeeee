import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './browser-tests',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: 0,
  workers: process.env.CI ? 2 : undefined,
  reporter: 'list',
  use: { baseURL: 'http://127.0.0.1:8000', trace: 'retain-on-failure' },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'firefox', use: { ...devices['Desktop Firefox'] } },
    { name: 'mobile-webkit', use: { ...devices['iPhone 13'] } },
  ],
  webServer: {
    command: 'node tools/serve.js',
    url: 'http://127.0.0.1:8000',
    reuseExistingServer: !process.env.CI,
  },
});
