import { test, expect } from './fixtures';

test.describe('Sidebar', () => {
  test('loads and shows auth gate when not logged in', async ({ context, extensionId }) => {
    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/sidebar.html`);

    // Auth section should be visible
    const authSection = page.locator('#auth-section');
    await expect(authSection).toBeVisible();

    // Auth button should be present
    const authBtn = page.locator('#auth-btn');
    await expect(authBtn).toBeVisible();
    await expect(authBtn).toContainText('Sign in with Hanzo');
  });

  test('tab bar is hidden before auth', async ({ context, extensionId }) => {
    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/sidebar.html`);

    const tabBar = page.locator('#tab-bar');
    await expect(tabBar).toHaveClass(/hidden/);
  });

  test('has chat, tools, and settings tabs', async ({ context, extensionId }) => {
    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/sidebar.html`);

    // Tabs should exist in the DOM
    await expect(page.locator('[data-tab="chat"]')).toBeAttached();
    await expect(page.locator('[data-tab="tools"]')).toBeAttached();
    await expect(page.locator('[data-tab="settings"]')).toBeAttached();
  });

  test('chat tab has model selector and input', async ({ context, extensionId }) => {
    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/sidebar.html`);

    // Chat UI elements should exist
    await expect(page.locator('#model-select')).toBeAttached();
    await expect(page.locator('#chat-input')).toBeAttached();
    await expect(page.locator('#send-btn')).toBeAttached();
  });

  test('model selector has default options', async ({ context, extensionId }) => {
    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/sidebar.html`);

    const options = page.locator('#model-select option');
    const count = await options.count();
    expect(count).toBeGreaterThanOrEqual(2);

    // Should include Claude and GPT models
    const values = await options.allTextContents();
    const allText = values.join(' ');
    expect(allText).toContain('GPT');
    expect(allText).toContain('Claude');
  });

  test('tools tab has ZAP status', async ({ context, extensionId }) => {
    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/sidebar.html`);

    await expect(page.locator('#mcp-status')).toBeAttached();
    await expect(page.locator('#mcp-tools')).toBeAttached();
    await expect(page.locator('#agent-count')).toBeAttached();
    await expect(page.locator('#tab-fs')).toBeAttached();
    await expect(page.locator('#gpu-status')).toBeAttached();
  });

  test('settings tab has account and connection config', async ({ context, extensionId }) => {
    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/sidebar.html`);

    // Settings elements should exist
    await expect(page.locator('#user-name')).toBeAttached();
    await expect(page.locator('#user-email')).toBeAttached();
    await expect(page.locator('#logout-btn')).toBeAttached();
    await expect(page.locator('#mcp-port-setting')).toBeAttached();
    await expect(page.locator('#cdp-port-setting')).toBeAttached();
    await expect(page.locator('#zap-ports-setting')).toBeAttached();
    await expect(page.locator('#save-settings')).toBeAttached();
  });

  test('settings has links to console, billing, docs', async ({ context, extensionId }) => {
    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/sidebar.html`);

    const links = page.locator('.settings-links a');
    const hrefs = await links.evaluateAll(els => els.map((el: HTMLAnchorElement) => el.href));
    expect(hrefs).toContain('https://console.hanzo.ai/');
    expect(hrefs).toContain('https://billing.hanzo.ai/');
    expect(hrefs).toContain('https://docs.hanzo.ai/');
  });

  test('chat welcome message shows on load', async ({ context, extensionId }) => {
    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/sidebar.html`);

    const welcome = page.locator('.chat-welcome');
    await expect(welcome).toBeAttached();
    await expect(welcome).toContainText('Hanzo Cloud');
  });

  test('launch agent button exists', async ({ context, extensionId }) => {
    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/sidebar.html`);

    const launchBtn = page.locator('#launch-agent');
    await expect(launchBtn).toBeAttached();
    await expect(launchBtn).toContainText('Launch Agent');
  });
});
