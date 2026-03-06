import { test, expect } from './fixtures';

/**
 * End-to-end tests for the login + chat flow.
 *
 * These tests exercise the real Casdoor OAuth2 flow using the z@hanzo.ai
 * test account. They verify:
 *   1. Login tab opens correctly
 *   2. Password auth succeeds
 *   3. Token is stored and user info is fetched
 *   4. Chat sends a message to a Zen model via llm.hanzo.ai
 *
 * Requirements:
 *   - IAM at iam.hanzo.ai / hanzo.id must be reachable
 *   - LLM gateway at llm.hanzo.ai must be reachable
 *   - Extension must be built: npm run build
 */

const TEST_USER = 'z';
const TEST_EMAIL = 'z@hanzo.ai';

// These tests require live IAM/LLM access — skip in CI
const descFn = process.env.CI ? test.describe.skip : test.describe;

descFn('Auth + Chat', () => {
  test('login via tab-based OAuth flow and verify user stored', async ({ context, extensionId }) => {
    const sidebar = await context.newPage();
    await sidebar.goto(`chrome-extension://${extensionId}/sidebar.html`);
    await sidebar.waitForTimeout(500);

    // Switch to chat tab — should show login prompt
    await sidebar.locator('[data-tab="chat"]').click();
    const loginPrompt = sidebar.locator('#chat-login-prompt');
    await expect(loginPrompt).toBeVisible();

    // Click "Sign in" — this sends auth.login to the background,
    // which opens a new tab to hanzo.id/login/oauth/authorize
    const [authPage] = await Promise.all([
      context.waitForEvent('page'),
      sidebar.locator('#auth-btn').click(),
    ]);

    // Wait for the Casdoor login page to load
    await authPage.waitForLoadState('networkidle');
    const authUrl = authPage.url();
    expect(authUrl).toContain('hanzo.id');

    // Fill in credentials on the Casdoor login page
    // Casdoor uses a form with username + password inputs
    const usernameInput = authPage.locator('input[name="username"], input#input');
    const passwordInput = authPage.locator('input[name="password"], input[type="password"]');

    if (await usernameInput.isVisible({ timeout: 5000 }).catch(() => false)) {
      await usernameInput.fill(TEST_USER);
      await passwordInput.fill('***REMOVED***');

      // Submit the form
      const submitBtn = authPage.locator('button[type="submit"], .login-button, button:has-text("Sign In"), button:has-text("Sign in")');
      await submitBtn.click();

      // Wait for redirect — the background script should catch the callback URL
      // and close this tab automatically
      await authPage.waitForEvent('close', { timeout: 30_000 }).catch(() => {
        // Tab might not close if redirect is to a real page
      });
    } else {
      // If no form visible, Casdoor might have a different UI — skip
      test.skip(true, 'Casdoor login form not found');
    }

    // Back on sidebar — verify auth state
    await sidebar.waitForTimeout(2000);

    // Check storage for the access token
    const tokenStored = await sidebar.evaluate(() => {
      return new Promise(resolve => {
        chrome.storage.local.get(['hanzo_iam_access_token', 'hanzo_iam_user'], (result) => {
          resolve({
            hasToken: !!result.hanzo_iam_access_token,
            user: result.hanzo_iam_user,
          });
        });
      });
    }) as any;

    expect(tokenStored.hasToken).toBe(true);
    expect(tokenStored.user).toBeTruthy();
    // /api/get-account should have returned name and email
    if (tokenStored.user) {
      expect(tokenStored.user.name).toBeTruthy();
      expect(tokenStored.user.email).toBe(TEST_EMAIL);
    }
  });

  test('chat with Zen model after login', async ({ context, extensionId }) => {
    const sidebar = await context.newPage();
    await sidebar.goto(`chrome-extension://${extensionId}/sidebar.html`);

    // Inject a mock token to skip the login flow
    await sidebar.evaluate(() => {
      return new Promise<void>(resolve => {
        // We need a real token for this test
        chrome.storage.local.set({
          hanzo_iam_access_token: 'test-will-be-replaced',
          hanzo_iam_user: { name: 'Test', email: 'z@hanzo.ai' },
        }, resolve);
      });
    });

    // Get a real token via direct API call
    const tokenResult = await sidebar.evaluate(async () => {
      try {
        const resp = await fetch('https://iam.hanzo.ai/api/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            application: 'app-hanzo',
            organization: 'hanzo',
            username: 'z',
            password: '***REMOVED***',
            type: 'token',
          }),
        });
        const data = await resp.json();
        if (data.status === 'ok' && data.data) {
          // Store the real token
          await new Promise<void>(resolve => {
            chrome.storage.local.set({ hanzo_iam_access_token: data.data }, resolve);
          });
          return { success: true };
        }
        return { success: false, error: data.msg };
      } catch (e: any) {
        return { success: false, error: e.message };
      }
    });

    expect(tokenResult.success).toBe(true);

    // Reload to pick up the token
    await sidebar.reload();
    await sidebar.waitForTimeout(1000);

    // Switch to chat tab
    await sidebar.locator('[data-tab="chat"]').click();

    // Login prompt should be hidden, composer should be visible
    const composer = sidebar.locator('#chat-composer');
    await expect(composer).not.toHaveClass(/hidden/, { timeout: 5000 });

    // Select a Zen model
    const modelSelect = sidebar.locator('#model-select');
    const options = await modelSelect.locator('option').allTextContents();
    const zenOption = options.find(o => o.toLowerCase().includes('zen'));
    if (zenOption) {
      await modelSelect.selectOption({ label: zenOption });
    }

    // Type a message and send
    const chatInput = sidebar.locator('#chat-input');
    await chatInput.fill('Hello, say "pong" and nothing else.');
    await sidebar.locator('#send-btn').click();

    // Wait for a response (the assistant message should appear)
    const assistantMsg = sidebar.locator('.message.assistant');
    await expect(assistantMsg.first()).toBeVisible({ timeout: 30_000 });

    // Verify response contains text
    const responseText = await assistantMsg.first().textContent();
    expect(responseText).toBeTruthy();
    expect(responseText!.length).toBeGreaterThan(0);
  });
});
