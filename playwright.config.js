import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  timeout: 30000,
  fullyParallel: false,
  workers: 1,
  reporter: 'list',
  outputDir: 'test-artifacts',
  use: {
    baseURL: 'http://127.0.0.1:4000',
    trace: 'off',
    video: 'off',
    screenshot: 'off',
    viewport: { width: 360, height: 640 }
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] }
    }
  ]
});
