import { test, expect } from './fixtures';

/**
 * End-to-end tests for the login + chat flow.
 *
 * These tests exercise the real Hanzo IAM OAuth2 flow using the z@hanzo.ai
 * test account. They verify:
 *   1. Login tab opens correctly
 *   2. Password auth succeeds
 *   3. Token is stored and user info is fetched
 *   4. Chat sends a message to a Zen model via api.hanzo.ai
 *
 * Requirements:
 *   - IAM at api.hanzo.ai / hanzo.id must be reachable
 *   - LLM gateway at api.hanzo.ai must be reachable
 *   - Extension must be built: npm run build
 *   - HANZO_E2E_PASSWORD in the environment
 *
 * The password comes from the environment and nowhere else. Written into this
 * file it would be a live credential published in every clone of the repo, and
 * a test that reads one from disk is a test that teaches everyone to keep one
 * there. Absent, these skip: `e2e/turn.spec.ts` already proves the surface
 * against a seeded identity, so nothing here is the only cover for anything.
 */

const TEST_USER = 'z';
const TEST_EMAIL = 'z@hanzo.ai';
const PASSWORD = process.env.HANZO_E2E_PASSWORD;

// Live IAM/LLM access, and a credential this machine was given.
const descFn = process.env.CI || !PASSWORD ? test.describe.skip : test.describe;

descFn('Auth + Chat', () => {
  test('login via tab-based OAuth flow and verify user stored', async ({ context, extensionId }) => {
    const sidebar = await context.newPage();
    await sidebar.goto(`chrome-extension://${extensionId}/sidebar.html`);
    await sidebar.waitForTimeout(500);

    // Switch to chat tab — signed out, the shell shows the sign-in card.
    await sidebar.locator('[data-tab="chat"]').click();
    const chat = sidebar.locator('#chat');
    await expect(chat).toContainText('Sign in to Hanzo AI');

    // Click "Sign in" — this sends auth.login to the background,
    // which opens a new tab to hanzo.id/oauth/authorize
    const [authPage] = await Promise.all([
      context.waitForEvent('page'),
      chat.getByRole('button', { name: 'Sign in' }).click(),
    ]);

    // Wait for the Hanzo IAM login page to load
    await authPage.waitForLoadState('networkidle');
    const authUrl = authPage.url();
    expect(authUrl).toContain('hanzo.id');

    // Fill in credentials on the Hanzo IAM login page
    // IAM uses a form with username + password inputs
    const usernameInput = authPage.locator('input[name="username"], input#input');
    const passwordInput = authPage.locator('input[name="password"], input[type="password"]');

    if (await usernameInput.isVisible({ timeout: 5000 }).catch(() => false)) {
      await usernameInput.fill(TEST_USER);
      await passwordInput.fill(PASSWORD!);

      // Submit the form
      const submitBtn = authPage.locator('button[type="submit"], .login-button, button:has-text("Sign In"), button:has-text("Sign in")');
      await submitBtn.click();

      // Wait for redirect — the background script should catch the callback URL
      // and close this tab automatically
      await authPage.waitForEvent('close', { timeout: 30_000 }).catch(() => {
        // Tab might not close if redirect is to a real page
      });
    } else {
      // If no form visible, IAM might have a different UI — skip
      test.skip(true, 'IAM login form not found');
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
    // /v1/iam/account should have returned name and email
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
    const tokenResult = await sidebar.evaluate(async (password: string) => {
      try {
        const resp = await fetch('https://api.hanzo.ai/v1/iam/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            application: 'hanzo-browser',
            organization: 'hanzo',
            username: 'z',
            password,
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
    }, PASSWORD!);

    expect(tokenResult.success).toBe(true);

    // Reload to pick up the token
    await sidebar.reload();
    await sidebar.waitForTimeout(1000);

    // Switch to chat tab
    await sidebar.locator('[data-tab="chat"]').click();

    // Signed in, the shell shows the composer.
    const field = sidebar.locator('[data-slot="composer-field"]');
    await expect(field).toBeVisible({ timeout: 5000 });

    // Pick a Zen model if the account's catalog offers one.
    const picker = sidebar.getByRole('combobox');
    await picker.click();
    const zen = sidebar.locator('[data-slot="command-item"]', { hasText: /zen/i }).first();
    if (await zen.isVisible().catch(() => false)) await zen.click();
    else await sidebar.keyboard.press('Escape');

    // Type a message and send.
    await field.fill('Hello, say "pong" and nothing else.');
    await field.press('Enter');

    // The answer arrives as an assistant turn with text in it.
    const answer = sidebar.locator('[data-slot="message"][data-role="assistant"]').first();
    await expect(answer).toBeVisible({ timeout: 30_000 });
    await expect(answer).not.toBeEmpty({ timeout: 30_000 });
  });
});
