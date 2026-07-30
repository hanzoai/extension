import { test, expect } from './fixtures';

test.describe('Popup', () => {
  test('shows login section when not authenticated', async ({ context, extensionId }) => {
    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/popup.html`);

    // Login section visible (user not authenticated)
    const loginSection = page.locator('#login-section');
    await expect(loginSection).toBeVisible();

    // Login button should be present
    const loginBtn = page.locator('#login-btn');
    await expect(loginBtn).toBeVisible();
    await expect(loginBtn).toContainText('Sign in');
    await expect(loginBtn).toBeEnabled();
  });

  test('main section visible without auth (tools work without login)', async ({ context, extensionId }) => {
    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/popup.html`);

    // Wait for JS to initialize
    await page.waitForTimeout(500);

    // Main section always visible (tools work without auth)
    const mainSection = page.locator('#main-section');
    await expect(mainSection).toBeVisible();
  });

  test('shows feature toggles', async ({ context, extensionId }) => {
    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/popup.html`);

    // Feature toggle checkboxes should exist
    for (const id of ['source-maps', 'webgpu-ai', 'browser-control', 'tab-filesystem']) {
      const checkbox = page.locator(`#${id}`);
      await expect(checkbox).toBeAttached();
    }
  });

  test('has connection status indicators', async ({ context, extensionId }) => {
    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/popup.html`);

    // Status indicators should be present
    await expect(page.locator('#zap-status')).toBeAttached();
    await expect(page.locator('#mcp-status')).toBeAttached();
    await expect(page.locator('#cdp-status')).toBeAttached();
    await expect(page.locator('#gpu-status')).toBeAttached();
  });

  test('settings button exists in main section', async ({ context, extensionId }) => {
    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/popup.html`);

    const settingsBtn = page.locator('#open-settings');
    await expect(settingsBtn).toBeAttached();
  });

  test('has correct extension branding', async ({ context, extensionId }) => {
    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/popup.html`);

    // Title should be Hanzo AI
    await expect(page).toHaveTitle(/Hanzo/);

    // Logo/branding should be present
    const header = page.locator('.popup-header, header, h1, .brand');
    await expect(header.first()).toBeVisible();
  });

  test('open panel button exists', async ({ context, extensionId }) => {
    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/popup.html`);

    const openPanel = page.locator('#open-panel');
    await expect(openPanel).toBeAttached();
  });

  test('on-page overlay toggle exists', async ({ context, extensionId }) => {
    // 1.9.3 killed the on-page FAB (#open-page-overlay). The on-page surface
    // is now controlled by the #overlay-enabled checkbox (overlay vs new
    // tab) and opened via the single #open-panel button.
    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/popup.html`);

    const overlayEnabled = page.locator('#overlay-enabled');
    await expect(overlayEnabled).toBeAttached();
    await expect(overlayEnabled).toBeChecked();
  });

  test('toggles on-page overlay on a live webpage', async ({ context, extensionId }) => {
    const targetPage = await context.newPage();
    await targetPage.goto('https://example.com', { waitUntil: 'domcontentloaded' });
    await expect(targetPage.locator('body')).toBeVisible();

    // Content script mounts hidden overlay root.
    await expect(targetPage.locator('#hanzo-page-overlay-root')).toHaveCount(1);

    const popupPage = await context.newPage();
    await popupPage.goto(`chrome-extension://${extensionId}/popup.html`);

    // #open-panel resolves the active tab and relays page.overlay.show to
    // its content script. In this harness the popup is itself the active
    // tab (a privileged chrome-extension:// page), so the active-tab lookup
    // can never reach example.com — drive the same relay the button sends,
    // explicitly targeted, and let background + content script do the rest.
    const openPanelBtn = popupPage.locator('#open-panel');
    await expect(openPanelBtn).toBeVisible();
    await popupPage.evaluate(async () => {
      const tabs = await chrome.tabs.query({ url: 'https://example.com/' });
      await chrome.runtime.sendMessage({
        action: 'page.overlay.show',
        tabId: tabs[0]?.id,
        side: 'right',
        width: 'default',
      });
    });

    await targetPage.bringToFront();
    const overlayRoot = targetPage.locator('#hanzo-page-overlay-root');
    await expect(overlayRoot).toHaveAttribute('data-enabled', 'true');
    await expect(overlayRoot).toHaveAttribute('data-open', 'true');
    await expect(targetPage.locator('#hanzo-page-overlay-root .hanzo-page-panel')).toBeVisible();
  });
});
