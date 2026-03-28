import { test, expect } from './fixtures';

test.describe('Sidebar', () => {
  test('loads and shows tab bar immediately (no auth gate)', async ({ context, extensionId }) => {
    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/sidebar.html`);

    // Tab bar should be visible (tools work without login)
    const tabBar = page.locator('#tab-bar');
    await expect(tabBar).toBeVisible();
  });

  test('defaults to chat tab when not authenticated', async ({ context, extensionId }) => {
    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/sidebar.html`);

    // Wait for JS to initialize
    await page.waitForTimeout(500);

    // Chat tab should be active by default (shows login prompt for unauthenticated)
    const chatTab = page.locator('#tab-chat');
    await expect(chatTab).toBeVisible();
  });

  test('chat tab shows login prompt when not authenticated', async ({ context, extensionId }) => {
    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/sidebar.html`);

    // Switch to chat tab
    await page.locator('[data-tab="chat"]').click();

    // Login prompt should be visible in chat area
    const loginPrompt = page.locator('#chat-login-prompt');
    await expect(loginPrompt).toBeVisible();

    // Should mention Zen AI models
    await expect(loginPrompt).toContainText('Zen AI models');

    // Sign in button should be present
    const authBtn = page.locator('#auth-btn');
    await expect(authBtn).toBeVisible();
    await expect(authBtn).toContainText('Sign in');

    const signupBtn = page.locator('#signup-btn');
    await expect(signupBtn).toBeVisible();
    await expect(signupBtn).toContainText('Create account');

    // Should have link to docs
    const docsLink = loginPrompt.locator('a[href="https://docs.hanzo.ai"]');
    await expect(docsLink).toBeAttached();
  });

  test('chat composer is hidden when not authenticated', async ({ context, extensionId }) => {
    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/sidebar.html`);

    // Switch to chat tab
    await page.locator('[data-tab="chat"]').click();

    // Chat composer (input area) should be hidden
    const chatComposer = page.locator('#chat-composer');
    await expect(chatComposer).toHaveClass(/hidden/);
  });

  test('has chat, tools, and settings tabs', async ({ context, extensionId }) => {
    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/sidebar.html`);

    // Tabs should exist in the DOM
    await expect(page.locator('[data-tab="chat"]')).toBeAttached();
    await expect(page.locator('[data-tab="tools"]')).toBeAttached();
    await expect(page.locator('[data-tab="settings"]')).toBeAttached();
  });

  test('tab switching works', async ({ context, extensionId }) => {
    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/sidebar.html`);
    await page.waitForTimeout(500);

    // Click chat tab
    await page.locator('[data-tab="chat"]').click();
    await expect(page.locator('#tab-chat')).toBeVisible();
    await expect(page.locator('#tab-tools')).toHaveClass(/hidden/);

    // Click tools tab
    await page.locator('[data-tab="tools"]').click();
    await expect(page.locator('#tab-tools')).toBeVisible();
    await expect(page.locator('#tab-chat')).toHaveClass(/hidden/);

    // Click settings tab
    await page.locator('[data-tab="settings"]').click();
    await expect(page.locator('#tab-settings')).toBeVisible();
    await expect(page.locator('#tab-tools')).toHaveClass(/hidden/);
  });

  test('chat tab has model selector and input', async ({ context, extensionId }) => {
    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/sidebar.html`);

    // Chat UI elements should exist
    await expect(page.locator('#model-select')).toBeAttached();
    await expect(page.locator('#rag-enabled')).toBeAttached();
    await expect(page.locator('#tab-context-enabled')).toBeAttached();
    await expect(page.locator('#rag-status')).toBeAttached();
    await expect(page.locator('#chat-input')).toBeAttached();
    await expect(page.locator('#send-btn')).toBeAttached();
  });

  test('model selector has models (public API, no auth required)', async ({ context, extensionId }) => {
    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/sidebar.html`);

    const select = page.locator('#model-select');
    await expect(select).toBeAttached();

    // Wait for models to load from public API (or fall back to hardcoded defaults)
    await page.waitForTimeout(2000);

    const options = page.locator('#model-select option');
    const count = await options.count();
    // At least 1 option must exist (default/fallback); API may not be reachable in CI
    expect(count).toBeGreaterThanOrEqual(1);
  });

  test('tools tab has ZAP status and MCP info', async ({ context, extensionId }) => {
    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/sidebar.html`);

    await expect(page.locator('#mcp-status')).toBeAttached();
    await expect(page.locator('#mcp-tools')).toBeAttached();
    await expect(page.locator('#mcp-tool-list')).toBeAttached();
    await expect(page.locator('#agent-count')).toBeAttached();
    await expect(page.locator('#tab-fs')).toBeAttached();
    await expect(page.locator('#hanzo-node-status')).toBeAttached();
    await expect(page.locator('#hanzo-mcp-status')).toBeAttached();
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
    await expect(page.locator('#rag-use-zap')).toBeAttached();
    await expect(page.locator('#rag-include-tab-context')).toBeAttached();
    await expect(page.locator('#rag-top-k')).toBeAttached();
    await expect(page.locator('#rag-kb')).toBeAttached();
    await expect(page.locator('#rag-endpoint')).toBeAttached();
    await expect(page.locator('#rag-api-key')).toBeAttached();
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
