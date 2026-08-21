import { test, expect } from './fixtures';

/**
 * The sidebar, driven in a real Chrome with the extension loaded.
 *
 * Chat is `@hanzo/ui/chat`, so the chat assertions select on the shell's own
 * `data-slot` contract rather than on ids this page used to write by hand. That
 * is the point of adopting the shell: the same selectors hold on every Hanzo
 * surface, and a class or an id churning inside the design system does not
 * silently pass a test that has stopped looking at anything.
 */

const open = async (context, extensionId: string) => {
  const page = await context.newPage();
  await page.setViewportSize({ width: 400, height: 800 });
  await page.goto(`chrome-extension://${extensionId}/sidebar.html`);
  return page;
};

test.describe('Sidebar', () => {
  test('loads and shows tab bar immediately (no auth gate)', async ({ context, extensionId }) => {
    const page = await open(context, extensionId);
    await expect(page.locator('#tab-bar')).toBeVisible();
  });

  test('defaults to chat tab', async ({ context, extensionId }) => {
    const page = await open(context, extensionId);
    await expect(page.locator('#tab-chat')).toBeVisible();
  });

  test('chat renders the shared shell, mounted once', async ({ context, extensionId }) => {
    const page = await open(context, extensionId);
    // One mount node, one React root, one composer — the invariant the sidebar
    // lost the last time two implementations raced for the same container.
    await expect(page.locator('#chat')).toHaveCount(1);
    await expect(page.locator('#chat > *')).toHaveCount(1);
  });

  test('chat asks for sign-in, and offers no composer, when signed out', async ({
    context,
    extensionId,
  }) => {
    const page = await open(context, extensionId);
    await page.locator('[data-tab="chat"]').click();

    const chat = page.locator('#chat');
    await expect(chat).toContainText('Sign in to Hanzo AI');
    await expect(chat).toContainText('Zen AI models');
    await expect(chat.getByRole('button', { name: 'Sign in' })).toBeVisible();
    await expect(chat.getByRole('button', { name: 'Create account' })).toBeVisible();
    await expect(chat.locator('a[href="https://docs.hanzo.ai"]')).toBeAttached();

    // Signed out there is nothing to type into: the composer is not rendered.
    await expect(page.locator('[data-slot="composer"]')).toHaveCount(0);
  });

  test('has chat, tools, and settings tabs', async ({ context, extensionId }) => {
    const page = await open(context, extensionId);
    await expect(page.locator('[data-tab="chat"]')).toBeAttached();
    await expect(page.locator('[data-tab="tools"]')).toBeAttached();
    await expect(page.locator('[data-tab="settings"]')).toBeAttached();
  });

  test('tab switching works', async ({ context, extensionId }) => {
    const page = await open(context, extensionId);

    await page.locator('[data-tab="chat"]').click();
    await expect(page.locator('#tab-chat')).toBeVisible();
    await expect(page.locator('#tab-tools')).toHaveClass(/hidden/);

    await page.locator('[data-tab="tools"]').click();
    await expect(page.locator('#tab-tools')).toBeVisible();
    await expect(page.locator('#tab-chat')).toHaveClass(/hidden/);

    await page.locator('[data-tab="settings"]').click();
    await expect(page.locator('#tab-settings')).toBeVisible();
    await expect(page.locator('#tab-tools')).toHaveClass(/hidden/);
  });

  test('the settings default-model select is filled from the catalog', async ({
    context,
    extensionId,
  }) => {
    const page = await open(context, extensionId);
    // Auto is always there — it is the router, always valid — and it is written
    // in exactly one place, so an empty select would mean the catalog never ran.
    await expect(page.locator('#default-model option')).not.toHaveCount(0);
    await expect(page.locator('#default-model')).toContainText('Auto');
  });

  test('tools tab has ZAP status and MCP info', async ({ context, extensionId }) => {
    const page = await open(context, extensionId);
    await expect(page.locator('#mcp-status')).toBeAttached();
    await expect(page.locator('#mcp-tools')).toBeAttached();
    await expect(page.locator('#mcp-tool-list')).toBeAttached();
    await expect(page.locator('#agent-count')).toBeAttached();
    await expect(page.locator('#tab-fs')).toBeAttached();
    await expect(page.locator('#hanzo-node-status')).toBeAttached();
    await expect(page.locator('#hanzo-mcp-status')).toBeAttached();
  });

  test('settings tab has account and connection config', async ({ context, extensionId }) => {
    const page = await open(context, extensionId);
    await expect(page.locator('#user-name')).toBeAttached();
    await expect(page.locator('#user-email')).toBeAttached();
    await expect(page.locator('#logout-btn')).toBeAttached();
    await expect(page.locator('#mcp-port-setting')).toBeAttached();
    await expect(page.locator('#cdp-port-setting')).toBeAttached();
    await expect(page.locator('#node-port-setting')).toBeAttached();
    await expect(page.locator('#rag-include-tab-context')).toBeAttached();
    await expect(page.locator('#rag-top-k')).toBeAttached();
    await expect(page.locator('#rag-kb')).toBeAttached();
    await expect(page.locator('#rag-endpoint')).toBeAttached();
    await expect(page.locator('#rag-api-key')).toBeAttached();
    await expect(page.locator('#save-settings')).toBeAttached();
  });

  test('settings has links to console, billing, docs', async ({ context, extensionId }) => {
    const page = await open(context, extensionId);
    const links = page.locator('.settings-links a');
    const hrefs = await links.evaluateAll((els) => els.map((el: HTMLAnchorElement) => el.href));
    expect(hrefs).toContain('https://console.hanzo.ai/');
    expect(hrefs).toContain('https://billing.hanzo.ai/');
    expect(hrefs).toContain('https://docs.hanzo.ai/');
  });

  test('launch agent button exists', async ({ context, extensionId }) => {
    const page = await open(context, extensionId);
    const launchBtn = page.locator('#launch-agent');
    await expect(launchBtn).toBeAttached();
    await expect(launchBtn).toContainText('Launch Agent');
  });
});
