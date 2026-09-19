import { test as base, chromium, type BrowserContext } from '@playwright/test';
import path from 'path';

const extensionPath = path.resolve(__dirname, '../../../dist/chrome');

// Custom fixture that launches a persistent browser context with the extension loaded.
//
// The `chromium` channel is the full browser, and its headless mode loads
// extensions; the default headless shell does not. So the suite runs on a
// runner with no display, and `--headed` still opens the window.
export const test = base.extend<{
  context: BrowserContext;
  extensionId: string;
}>({
  context: async ({ headless }, use) => {
    const context = await chromium.launchPersistentContext('', {
      channel: 'chromium',
      headless,
      args: [
        `--disable-extensions-except=${extensionPath}`,
        `--load-extension=${extensionPath}`,
        '--no-first-run',
        '--disable-default-apps',
        '--disable-gpu',
      ],
    });
    await use(context);
    await context.close();
  },

  extensionId: async ({ context }, use) => {
    // Wait for the service worker to register
    let [background] = context.serviceWorkers();
    if (!background) {
      background = await context.waitForEvent('serviceworker');
    }

    // Extract extension ID from service worker URL
    // URL format: chrome-extension://<id>/background.js
    const extensionId = background.url().split('/')[2];
    await use(extensionId);
  },
});

export { expect } from '@playwright/test';
