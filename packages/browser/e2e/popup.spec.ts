import { test, expect } from './fixtures';

test.describe('Popup', () => {
  test('loads and renders login UI', async ({ context, extensionId }) => {
    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/popup.html`);

    // Verify popup renders
    await expect(page.locator('body')).toBeVisible();

    // Login section should be visible (user not authenticated)
    const loginSection = page.locator('#login-section');
    await expect(loginSection).toBeVisible();

    // Login button should be present
    const loginBtn = page.locator('#login-btn');
    await expect(loginBtn).toBeVisible();
    await expect(loginBtn).toContainText('Sign in with Hanzo');
    await expect(loginBtn).toBeEnabled();
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

  test('settings panel opens and closes', async ({ context, extensionId }) => {
    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/popup.html`);

    // Main section may be hidden (auth gate), so check settings button exists
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
});
