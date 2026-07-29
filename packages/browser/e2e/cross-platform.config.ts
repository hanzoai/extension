import { defineConfig, devices } from '@playwright/test'
import path from 'path'

const chromeExtPath = path.resolve(__dirname, '../../../dist/chrome')

/**
 * Cross-platform E2E test config.
 *
 * Tests core browser tool functionality (DOM interaction, navigation,
 * screenshots, evaluate, fill, click) across Chrome, Firefox, and WebKit
 * to ensure 100% parity.
 *
 * The parity tests validate raw browser capabilities that the extension
 * must replicate — they run on plain browsers, NOT with extensions loaded.
 * Extension-specific tests (popup, sidebar, CDP bridge) live in the
 * default playwright.config.ts and only run on Chrome (Playwright
 * limitation: can't load extensions in Firefox/WebKit).
 *
 * Run all:   npx playwright test --config=e2e/cross-platform.config.ts
 * Run one:   npx playwright test --config=e2e/cross-platform.config.ts --project=firefox
 */
export default defineConfig({
  testDir: '.',
  testMatch: ['browser-tool-parity.spec.ts', 'cross-platform-*.spec.ts'],
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 2 : 4,
  reporter: process.env.CI
    ? [['html', { open: 'never' }], ['github'], ['json', { outputFile: 'cross-platform-results.json' }]]
    : 'html',
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
    // ── Desktop browsers ──
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'firefox',
      use: { ...devices['Desktop Firefox'] },
    },
    {
      name: 'webkit',
      use: { ...devices['Desktop Safari'] },
    },
    // ── Chrome with extension loaded (extension-specific tests) ──
    {
      name: 'chrome-extension',
      testMatch: ['popup.spec.ts', 'sidebar.spec.ts', 'auth-chat.spec.ts'],
      use: {
        launchOptions: {
          args: [
            `--disable-extensions-except=${chromeExtPath}`,
            `--load-extension=${chromeExtPath}`,
            '--no-first-run',
            '--disable-default-apps',
          ],
        },
      },
    },
    // ── Mobile ──
    {
      name: 'mobile-chrome',
      use: { ...devices['Pixel 7'] },
    },
    {
      name: 'mobile-safari',
      use: { ...devices['iPhone 14'] },
    },
  ],
})
