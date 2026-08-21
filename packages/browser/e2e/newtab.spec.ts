import { test, expect } from './fixtures';

/**
 * The answer surface — the extension's new tab: a centred composer, mode tabs,
 * source pills, a model picker, top stories and a rail.
 *
 * Driven in a real Chromium with the built extension loaded, so this asserts the
 * shipped bundle rather than the source. It selects on `@hanzo/ui/chat`'s own
 * `data-slot` contract, and on the `data-mode` / `data-source` attributes this
 * surface adds for its toolbar — never on class names, which belong to the
 * design system and change with it.
 */

/** A small, fixed catalog, so the picker's contents are the test's to state. */
const CATALOG = {
  data: [
    { id: 'enso-1', name: 'Enso', description: 'Router' },
    { id: 'zen-coder', name: 'Zen Coder', description: 'Code' },
  ],
  families: [
    { id: 'enso', name: 'Enso', models: ['enso-1'] },
    { id: 'zen5', name: 'Zen 5', models: ['zen-coder'] },
  ],
};

test.describe('answer surface', () => {
  test('draws the reference surface and responds to it', async ({ context, extensionId }) => {
    const page = await context.newPage();
    const problems: string[] = [];
    page.on('console', (m) => m.type() === 'error' && problems.push(m.text()));
    page.on('pageerror', (e) => problems.push(String(e)));

    await page.route('https://catalog.hanzo.ai/v1/models', (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(CATALOG) }),
    );

    await page.goto(`chrome-extension://${extensionId}/newtab.html`);

    // The composer is the shared shell: one field, one send control.
    const field = page.locator('[data-slot="composer-field"]');
    const send = page.locator('[data-slot="composer-send"]');
    await expect(field).toBeVisible();
    await expect(send).toBeVisible();

    // Source pills — the six the surface offers.
    const pills = page.locator('[data-source]');
    await expect(pills).toHaveCount(6);
    await expect(pills).toHaveText(['@web', '@news', '@academic', '@github', '@reddit', '@x']);

    // Mode tabs. Four, in escalating effort — Deep is gone (it was Research
    // with the dials up; cloud folded them into one Research mode).
    const modes = page.locator('[data-mode]');
    await expect(modes).toHaveCount(4);
    await expect(modes).toHaveText(['Chat', 'Search', 'News', 'Research']);
    await expect(modes.nth(1)).toHaveAttribute('data-on', 'true'); // Search is the default

    // The rail is NOT the shell's Sidebar — see answer-rail.test.ts. The shell
    // has no collapsed presentation and its SidebarIconButton cannot carry
    // `aria-expanded`, which is the contract this rail is tested on.
    await expect(page.locator('aside.ae-sidebar button.ae-new')).toContainText('New thread');

    // Send is inert until there is something to send. @hanzo/ui's Button is a
    // pressable, so the disabled state is ARIA, not the DOM attribute.
    await expect(send).toHaveAttribute('aria-disabled', 'true');
    await field.fill('what does the composer weigh');
    await expect(send).not.toHaveAttribute('aria-disabled', 'true');

    // A pill toggles on and back off.
    await pills.first().click();
    await expect(pills.first()).toHaveAttribute('data-on', 'true');
    await pills.first().click();
    await expect(pills.first()).not.toHaveAttribute('data-on', 'true');

    // A mode tab moves the selection — exactly one is ever on.
    await modes.nth(3).click();
    await expect(modes.nth(3)).toHaveAttribute('data-on', 'true');
    await expect(page.locator('[data-mode][data-on="true"]')).toHaveCount(1);

    // Chat goes straight to the model, so it offers nothing to source from.
    await modes.first().click();
    await expect(pills).toHaveCount(0);
    await modes.nth(1).click();
    await expect(pills).toHaveCount(6);

    // The picker offers the catalog it was given, grouped by family, and
    // nothing the catalog did not supply.
    const picker = page.getByRole('combobox');
    await expect(picker).toBeVisible();
    await picker.click();
    // Selected by slot, not by `role="option"`: the shared Command emits none,
    // even though its trigger declares `role="combobox"` and `aria-expanded`.
    const options = page.locator('[data-slot="command-item"]');
    // Family order is the shared picker's own (house first, then alphabetical),
    // which is why the router is not pinned at the top: nothing can pin an entry.
    await expect(options).toHaveText(['Enso', 'Auto', 'Zen Coder']);
    await options.nth(2).click();
    await expect(picker).toContainText('Zen Coder');

    // The field grows with its content instead of scrolling.
    const one = await field.evaluate((el) => el.clientHeight);
    await field.fill('a\nb\nc\nd\ne');
    await expect.poll(async () => field.evaluate((el) => el.clientHeight)).toBeGreaterThan(one);

    expect(problems).toEqual([]);
    await page.screenshot({ path: 'test-results/answer-surface.png', fullPage: true });
  });
});
