import { defineConfig } from '@playwright/test';
import path from 'path';

const extensionPath = path.resolve(__dirname, '../../../dist/chrome');

export default defineConfig({
  testDir: '.',
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: 1,
  reporter: process.env.CI ? [['html', { open: 'never' }], ['github']] : 'html',
  timeout: 60_000,
  expect: {
    timeout: 10_000,
  },
  use: {
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'on-first-retry',
  },
  projects: [
    {
      name: 'chromium-extension',
      use: {
        // Chrome extension requires persistent context with extension loaded
        launchOptions: {
          args: [
            `--disable-extensions-except=${extensionPath}`,
            `--load-extension=${extensionPath}`,
            '--no-first-run',
            '--disable-default-apps',
          ],
        },
      },
    },
  ],
});
