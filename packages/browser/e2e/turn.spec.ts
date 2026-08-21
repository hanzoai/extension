import { test, expect } from './fixtures';

/**
 * One whole turn in the real sidebar: type, send, watch it stream, land at the
 * bottom.
 *
 * A unit test proves almost nothing about this surface. The chat is
 * `@hanzo/ui/chat` on the gui runtime, inside an MV3 extension page under a
 * `script-src 'self'` policy, driven by a service worker — none of which a jsdom
 * render exercises. So this runs the built extension in Chrome.
 *
 * Only the two things outside the extension are stood in for: the identity
 * (a token seeded into extension storage, which the background's real
 * `getValidAccessToken` then accepts) and the model (a scripted SSE body on the
 * real `/v1/chat/completions` URL). Everything between them — the composer, the
 * Enter rule, the stream reader, the markdown split, the thread's follow — is
 * the shipped code.
 */

const MODELS = [
  { id: 'zen-coder', name: 'Zen Coder' },
  { id: 'zen-omni', name: 'Zen Omni' },
];

/** Enough prose to overflow a 800px-tall sidebar, so following is observable. */
const REPLY = [
  '# Anchoring\n\n',
  'The thread follows a streaming answer to the bottom.\n\n',
  ...Array.from({ length: 24 }, (_, i) => `Line ${i + 1} of the streamed answer.\n\n`),
  'Here is a fenced block:\n\n```ts\nexport const pong = () => "pong";\n```\n',
];

const sse = (chunks: string[]) =>
  chunks
    .map((c) => `data: ${JSON.stringify({ choices: [{ delta: { content: c } }] })}\n\n`)
    .join('') + 'data: [DONE]\n\n';

test.describe('a turn in the sidebar', () => {
  test('types, sends, streams, and stays at the bottom', async ({ context, extensionId }) => {
    const page = await context.newPage();
    await page.setViewportSize({ width: 400, height: 800 });

    // The model list and the completion. Both are the real URLs the shipped
    // code calls; only the bodies are scripted.
    await page.route('https://api.hanzo.ai/v1/models', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ data: MODELS.map((m) => ({ ...m, object: 'model' })) }),
      }),
    );
    await page.route('https://api.hanzo.ai/v1/chat/completions', (route) =>
      route.fulfill({
        status: 200,
        headers: { 'content-type': 'text/event-stream' },
        body: sse(REPLY),
      }),
    );

    await page.goto(`chrome-extension://${extensionId}/sidebar.html`);

    // Seed an identity. The background's real token check only asks whether a
    // token exists and has not expired, so this exercises the true code path.
    await page.evaluate(
      (expiresAt) =>
        new Promise<void>((resolve) =>
          chrome.storage.local.set(
            {
              hanzo_iam_access_token: 'e2e-token',
              hanzo_iam_expires_at: expiresAt,
              hanzo_iam_user: { name: 'E2E', email: 'z@hanzo.ai' },
            },
            () => resolve(),
          ),
        ),
      Date.now() + 3_600_000,
    );
    await page.reload();

    const composer = page.locator('[data-slot="composer"]');
    await expect(composer).toBeVisible({ timeout: 15_000 });
    await page.screenshot({ path: 'test-results/sidebar-idle.png' });

    const field = page.locator('[data-slot="composer-field"]');
    const send = page.locator('[data-slot="composer-send"]');
    const turns = page.locator('[data-slot="message"]');

    // An empty thread says so, as a system turn — not a hand-drawn welcome card.
    await expect(turns).toHaveCount(1);
    await expect(turns).toHaveAttribute('data-role', 'system');

    // Send is dead until there is something other than whitespace to send.
    await expect(send).toBeDisabled();
    await field.fill('   ');
    await expect(send).toBeDisabled();

    // Shift+Enter writes a newline instead of sending.
    await field.fill('first line');
    await field.press('Shift+Enter');
    await field.pressSequentially('second line');
    expect(await field.inputValue()).toContain('\n');
    await expect(turns).toHaveCount(1); // still only the empty-thread notice

    // Enter sends.
    await field.fill('Say pong.');
    await expect(send).toBeEnabled();
    await field.press('Enter');

    // The question is a user turn; the answer is an assistant turn.
    await expect(turns).toHaveCount(2, { timeout: 15_000 });
    await expect(turns.nth(0)).toHaveAttribute('data-role', 'user');
    await expect(turns.nth(0)).toContainText('Say pong.');
    await expect(turns.nth(1)).toHaveAttribute('data-role', 'assistant');

    // The stream lands: markdown became real elements, and the fenced block
    // became the shell's Code, not a paragraph of backticks. `#` renders as h2 —
    // the document's own title is the page, so a heading in prose starts below it.
    const answer = turns.nth(1);
    await expect(answer.locator('h2')).toHaveText('Anchoring', { timeout: 20_000 });
    await expect(answer).toContainText('Line 24 of the streamed answer.');
    const code = answer.locator('[data-slot="code"]');
    await expect(code).toContainText('export const pong');
    await expect(code).toContainText('ts'); // the language label the shell adds
    await expect(answer).not.toContainText('```');

    // The draft is cleared and the composer is live again.
    expect(await field.inputValue()).toBe('');

    // Scroll anchoring: the thread followed the answer down rather than sitting
    // at the top of a screenful of new text.
    const atBottom = await page
      .locator('[data-slot="thread"]')
      .evaluate((el) => el.scrollHeight - el.scrollTop - el.clientHeight);
    expect(atBottom).toBeLessThanOrEqual(48); // SLACK
    await page.screenshot({ path: 'test-results/sidebar-turn.png' });

    // And the top of the thread: the question sits inside the column's gutter
    // rather than against the edge. `Thread` drops its own padding when the
    // reading-measure cap is off, so the surface supplies it.
    const thread = page.locator('[data-slot="thread"]');
    await thread.evaluate((el) => {
      el.scrollTop = 0;
    });
    await page.waitForFunction(
      () => (document.querySelector('[data-slot="thread"]') as HTMLElement).scrollTop === 0,
    );
    const bubble = page.locator('[data-bubble="true"]');
    const [right, width] = await Promise.all([
      bubble.evaluate((el) => el.getBoundingClientRect().right),
      page.evaluate(() => window.innerWidth),
    ]);
    expect(width - right).toBeGreaterThanOrEqual(8);
    await page.screenshot({ path: 'test-results/sidebar-top.png' });
  });
});
