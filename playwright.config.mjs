import { defineConfig, devices } from '@playwright/test';
const BASE = process.env.BASE_URL || 'http://localhost:8080/';
export default defineConfig({
  testDir: 'tests',
  timeout: 150000,
  workers: 3,
  reporter: [['list']],
  use: { baseURL: BASE },
  webServer: process.env.BASE_URL ? undefined : { command: 'node tools/serve.mjs public 8080', url: 'http://localhost:8080/', reuseExistingServer: true },
  projects: [
    { name: 'iphone14', use: { ...devices['iPhone 14'] } },
    { name: 'pixel7', use: { ...devices['Pixel 7'] } },
    { name: 'desktop', use: { browserName: 'chromium', viewport: { width: 1440, height: 900 } } },
  ],
});
