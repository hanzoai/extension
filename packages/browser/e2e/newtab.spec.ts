import { test, expect } from './fixtures';

/**
 * The answer surface — the extension's new tab, and the design reference for
 * the whole search convergence: a centred composer, source pills, mode tabs, a
 * model picker, top stories and a thin rail.
 *
 * Driven in a real Chromium with the built extension loaded, so this asserts
 * the shipped bundle rather than the source.
 */

test.describe('answer surface', () => {
  test('draws the reference surface and responds to it', async ({ context, extensionId }) => {
    const page = await context.newPage();
    const problems: string[] = [];
    page.on('console', (m) => m.type() === 'error' && problems.push(m.text()));
    page.on('pageerror', (e) => problems.push(String(e)));

    await page.goto(`chrome-extension://${extensionId}/newtab.html`);

    // The composer.
    const field = page.locator('textarea.ae-input');
    await expect(field).toBeVisible();
    await expect(page.locator('button.ae-send')).toBeVisible();

    // Source pills — the six the surface offers.
    const pills = page.locator('button.ae-chip');
    await expect(pills).toHaveCount(6);
    await expect(pills).toHaveText(['@web', '@news', '@academic', '@github', '@reddit', '@x']);

    // Mode tabs. Four, in escalating effort — Deep is gone (it was Research
    // with the dials up; cloud folded them into one Research mode).
    const modes = page.locator('button.ae-mode');
    await expect(modes).toHaveCount(4);
    await expect(modes).toHaveText(['Chat', 'Search', 'News', 'Research']);
    await expect(modes.nth(1)).toHaveClass(/on/); // Search is the default

    // The rail.
    await expect(page.locator('aside.ae-sidebar button.ae-new')).toContainText('New thread');
    await expect(page.locator('aside.ae-sidebar button.ae-signin')).toBeVisible();

    // Send is inert until there is something to send.
    await expect(page.locator('button.ae-send')).toBeDisabled();
    await field.fill('what does the composer weigh');
    await expect(page.locator('button.ae-send')).toBeEnabled();

    // A pill toggles on and back off.
    await pills.first().click();
    await expect(pills.first()).toHaveClass(/on/);
    await pills.first().click();
    await expect(pills.first()).not.toHaveClass(/on/);

    // A mode tab moves the selection — exactly one is ever on.
    await modes.nth(3).click();
    await expect(modes.nth(3)).toHaveClass(/on/);
    await expect(page.locator('button.ae-mode.on')).toHaveCount(1);

    // Chat goes straight to the model, so it offers nothing to source from.
    await modes.first().click();
    await expect(pills).toHaveCount(0);
    await modes.nth(1).click();
    await expect(pills).toHaveCount(6);

    // The model picker opens, filters, and closes on an outside click.
    const picker = page.locator('button.ae-picker-btn');
    await expect(picker).toBeVisible();
    await picker.click();
    await expect(page.locator('.ae-picker-menu')).toBeVisible();
    await expect(page.locator('.ae-model-row').first()).toContainText('Auto');
    await page.locator('input.ae-picker-filter').fill('zzz-no-such-model');
    await expect(page.locator('.ae-model-row')).toHaveCount(1); // Auto is always offered
    await page.locator('h1, .ae-hero').first().click({ position: { x: 2, y: 2 } });
    await expect(page.locator('.ae-picker-menu')).toHaveCount(0);

    // The field grows with its content instead of scrolling.
    const one = await field.evaluate((el) => el.clientHeight);
    await field.fill('a\nb\nc\nd\ne');
    await expect.poll(async () => field.evaluate((el) => el.clientHeight)).toBeGreaterThan(one);

    expect(problems).toEqual([]);
    await page.screenshot({ path: 'e2e/.artifacts/answer-surface.png', fullPage: true });
  });
});
