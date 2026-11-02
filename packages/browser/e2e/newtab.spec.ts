import { test, expect } from './fixtures';

/**
 * The answer surface — the extension's new tab: the shared composer, the
 * sources, model and mode as the quiet line of words under its frame, top
 * stories and a rail.
 *
 * Driven in a real Chromium with the built extension loaded, so this asserts the
 * shipped bundle rather than the source. It selects on `@hanzo/ui/chat`'s own
 * `data-slot` contract — never on class names, which belong to the design
 * system and change with it.
 */

/** A small, fixed catalog in the gateway's own shape, so the picker's contents
 *  are the test's to state. The embedding model is there to be left out. */
const CATALOG = {
  data: [
    { id: 'enso-auto', name: 'Enso', family: 'enso', owned_by: 'hanzo', class: 'ours', outputs: ['text'] },
    { id: 'zen-coder', name: 'Zen Coder', family: 'zen', owned_by: 'zenlm', class: 'ours', outputs: ['text'] },
    { id: 'zen-embedding', name: 'Zen Embedding', family: 'zen', owned_by: 'zenlm', class: 'ours', outputs: ['embeddings'] },
  ],
};

test.describe('answer surface', () => {
  test('draws the shared composer and responds to it', async ({ context, extensionId }) => {
    const page = await context.newPage();
    const problems: string[] = [];
    page.on('console', (m) => m.type() === 'error' && problems.push(m.text()));
    page.on('pageerror', (e) => problems.push(String(e)));

    await page.route('https://catalog.hanzo.ai/v1/models', (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(CATALOG) }),
    );
    // Telemetry is not this page's: a build made without EVENT_INGEST_KEY is
    // refused by the event plane, and that refusal is not a defect here.
    await page.route('https://api.hanzo.ai/v1/event', (route) => route.fulfill({ status: 202, body: '' }));

    await page.goto(`chrome-extension://${extensionId}/newtab.html`);

    // The composer is the shared shell: one field in one frame.
    const frame = page.locator('[data-slot="composer"]');
    const field = page.locator('[data-slot="composer-field"]');
    const send = page.locator('[data-slot="composer-send"]');
    await expect(field).toBeVisible();
    await expect(field).toHaveAttribute('placeholder', 'Ask anything');
    await expect(field).toHaveCSS('resize', 'none');

    // Everything this surface adds is a word UNDER the frame, none inside it.
    const foot = page.locator('[data-slot="composer-foot"]');
    await expect(frame.locator('[data-slot="composer-chip"], [data-slot="mode"], [data-slot="model-picker"]')).toHaveCount(0);

    // The sources, as chips — the six the surface offers.
    const chips = foot.locator('[data-slot="composer-chip"]');
    await expect(chips).toHaveText(['@web', '@news', '@academic', '@github', '@reddit', '@x']);

    // The rail is NOT the shell's Sidebar — see answer-rail.test.ts. The shell
    // has no collapsed presentation and its SidebarIconButton cannot carry
    // `aria-expanded`, which is the contract this rail is tested on.
    await expect(page.locator('aside.ae-sidebar button.ae-new')).toContainText('New thread');

    // Send is not there until there is something to send: its place is empty.
    await expect(send).toHaveAttribute('aria-disabled', 'true');
    await expect(send.locator('..')).toHaveCSS('opacity', '0');
    await field.fill('what does the composer weigh');
    await expect(send).not.toHaveAttribute('aria-disabled', 'true');
    await expect(send.locator('..')).toHaveCSS('opacity', '1');

    // A chip toggles on and back off.
    await chips.first().click();
    await expect(chips.first()).toHaveAttribute('aria-pressed', 'true');
    await chips.first().click();
    await expect(chips.first()).toHaveAttribute('aria-pressed', 'false');

    // The mode is a word that opens its list: four, in escalating effort, each
    // with its line. Deep is gone (it was Research with the dials up; cloud
    // folded them into one Research mode). Search is the default.
    const mode = foot.locator('[data-slot="mode"]');
    await expect(mode).toHaveText('Search');
    const choose = async (name: string) => {
      await mode.click();
      const options = page.locator('[data-slot="choices"] [role="option"]');
      await expect(options).toHaveCount(4);
      await options.filter({ has: page.getByText(name, { exact: true }) }).click();
      await expect(mode).toHaveText(name);
    };
    await mode.click();
    await expect(page.locator('[data-slot="choices"] [role="option"]')).toContainText([
      'ChatStraight to the model',
      'SearchFast grounded answer',
      'NewsRecency-biased',
      'ResearchPlans, reads sources, synthesizes',
    ]);
    await page.keyboard.press('Escape');
    await choose('Research');

    // Chat goes straight to the model, so it offers nothing to source from.
    await choose('Chat');
    await expect(chips).toHaveCount(0);
    await choose('Search');
    await expect(chips).toHaveCount(6);

    // The model starts on Enso, the catalog's own default, and the picker offers
    // what can chat and nothing the catalog did not supply.
    const picker = foot.locator('[data-slot="model-picker"]');
    await expect(picker).toHaveText('Enso');
    // The open half loads when the picker is first pointed at.
    await picker.hover();
    await picker.click();
    const options = page.locator('[data-slot="model-picker-option"]');
    await expect(options.first()).toBeVisible();
    const names = await options.evaluateAll((els) => els.map((el) => el.getAttribute('aria-label')?.split(',')[0]));
    expect(names).toContain('Enso');
    expect(names).toContain('Zen Coder');
    expect(names).not.toContain('Zen Embedding');
    await options.filter({ has: page.getByText('Zen Coder', { exact: true }) }).click();
    await expect(picker).toHaveText('Zen Coder');

    // The field grows with its content instead of scrolling.
    const one = await field.evaluate((el) => el.clientHeight);
    await field.fill('a\nb\nc\nd\ne');
    await expect.poll(async () => field.evaluate((el) => el.clientHeight)).toBeGreaterThan(one);

    expect(problems).toEqual([]);
    await page.screenshot({ path: 'test-results/answer-surface.png', fullPage: true });
  });
});
