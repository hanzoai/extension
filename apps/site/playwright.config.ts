import { createServer } from 'node:net';
import { defineConfig, devices } from '@playwright/test';

// The suite tests the Vite server it starts, on a port the OS hands it, and never
// one it finds already running: a fixed port 3000 with reuse on once ran every
// test against another app that held the port.
//
// Playwright loads this file again in each worker, and a worker inherits the
// runner's environment, so the runner picks the port and the workers read it.
process.env.SITE_TEST_PORT ||= String(await freePort());
const port = process.env.SITE_TEST_PORT;
const url = `http://127.0.0.1:${port}`;

export default defineConfig({
  testDir: './tests',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: 'html',
  use: {
    baseURL: url,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: {
    // --strictPort exits instead of moving to the next port; --no-open keeps
    // the dev config's `open: true` from opening a browser tab on every run.
    command: `pnpm run dev --host 127.0.0.1 --port ${port} --strictPort --no-open`,
    url,
    reuseExistingServer: false,
  },
});

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const probe = createServer();
    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const address = probe.address();
      probe.close(() =>
        typeof address === 'object' && address
          ? resolve(address.port)
          : reject(new Error('the OS gave no port')),
      );
    });
  });
}
