import http from 'http';
import type { AddressInfo } from 'net';
import type { Page } from '@playwright/test';
import { test, expect } from './fixtures';

/**
 * The agent loop, end to end, in Chromium with the built extension:
 * snapshot → act by ref → read → annotate, through the same dispatcher the
 * zapd router calls (the extension page reaches it with runtime message
 * `drive`). A consent modal covers the page first, so the covered-click
 * refusal is exercised against real layout, not a mock.
 */

const FIXTURE = `<!doctype html>
<html><head><title>Ref fixture</title><style>
  body { margin: 0; font: 16px sans-serif }
  #consent { position: fixed; inset: 0; background: rgba(0,0,0,.4); z-index: 10 }
  #consent div { background: #fff; margin: 120px auto; width: 300px; padding: 16px }
  main { padding: 16px }
  iframe { width: 300px; height: 80px; border: 0 }
</style></head><body>
<div id="consent"><div>We use cookies. <button id="accept">Accept all</button></div></div>
<main>
  <h1>Newsletter</h1>
  <p id="status">Not subscribed</p>
  <form id="f"><label for="email">Email</label> <input id="email" type="email"> <button type="submit">Subscribe</button></form>
  <label><input type="checkbox" id="terms"> I agree</label>
  <select id="freq" aria-label="Frequency"><option value="d">Daily</option><option value="w">Weekly</option></select>
  <x-card></x-card>
  <iframe id="frame" title="Inner" srcdoc="<button onclick=&quot;document.body.dataset.hit=1&quot;>Frame button</button>"></iframe>
  <h2>Archive</h2><p>Past issues live here.</p>
</main>
<script>
  document.getElementById('accept').onclick = () => document.getElementById('consent').remove();
  document.getElementById('f').onsubmit = (e) => {
    e.preventDefault();
    document.getElementById('status').textContent = 'Subscribed ' + document.getElementById('email').value;
  };
  customElements.define('x-card', class extends HTMLElement {
    constructor() {
      super();
      const root = this.attachShadow({ mode: 'open' });
      root.innerHTML = '<button>Shadow action</button>';
      root.querySelector('button').onclick = () => { this.dataset.hit = '1'; };
    }
  });
</script>
</body></html>`;

let server: http.Server;
let origin: string;

test.beforeAll(async () => {
  server = http.createServer((_req, res) => {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end(FIXTURE);
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

test.afterAll(async () => {
  await new Promise((resolve) => server.close(resolve));
});

function refOf(tree: string, pattern: RegExp): string {
  const line = tree.split('\n').find((l) => pattern.test(l));
  const m = line && /\[ref=(e\d+)\]/.exec(line);
  if (!m) throw new Error(`no ref for ${pattern} in:\n${tree}`);
  return `@${m[1]}`;
}

/** Send one engine method to `tabId` from an extension page, as the popup or sidebar would. */
function driver(ext: Page, tabId: number) {
  return (method: string, params: Record<string, unknown> = {}) =>
    ext.evaluate(
      ([m, p]) => chrome.runtime.sendMessage({ action: 'drive', method: m, params: p }),
      [method, { tabId, ...params }] as const,
    ) as Promise<{ success: boolean; result?: any; error?: string }>;
}

test('snapshot → click by ref → read, with a covering modal and stale refs', async ({ context, extensionId }) => {
  const target = await context.newPage();
  await target.goto(`${origin}/`);
  const ext = await context.newPage();
  await ext.goto(`chrome-extension://${extensionId}/popup.html`);
  const tabId = await ext.evaluate(async (o) => (await chrome.tabs.query({})).find((t) => t.url?.startsWith(o))!.id!, origin);
  const drive = driver(ext, tabId);

  const snap = await drive('hanzo.snapshot', { interactive: true });
  expect(snap.success, snap.error).toBe(true);
  const tree: string = snap.result.tree;
  expect(tree).toMatch(/^- button "Accept all" \[ref=e\d+\]$/m);
  expect(tree).toMatch(/^- textbox "Email" \[ref=e\d+\]$/m);
  expect(tree).toMatch(/^- checkbox "I agree" \[ref=e\d+\]$/m);
  expect(tree).toMatch(/^- combobox "Frequency" \[ref=e\d+\]: Daily$/m);
  expect(tree).toMatch(/^- button "Shadow action" \[ref=e\d+\]$/m);
  expect(tree).toMatch(/^- button "Frame button" \[ref=e\d+\]$/m);

  // The modal covers the form: refused early, naming the cover.
  const subscribe = refOf(tree, /button "Subscribe"/);
  const covered = await drive('hanzo.act', { op: 'click', selector: subscribe });
  expect(covered.success).toBe(false);
  expect(covered.error).toMatch(/\(button "Subscribe"\) is covered by <div#consent> "We use cookies\. Accept all" at \(\d+, \d+\)\. .*run snapshot again/);
  await expect(target.locator('#status')).toHaveText('Not subscribed');

  const accept = refOf(tree, /"Accept all"/);
  expect((await drive('hanzo.act', { op: 'click', selector: accept })).success).toBe(true);
  await expect(target.locator('#consent')).toHaveCount(0);

  // The refs of elements that survived still work; the removed button's does not.
  expect((await drive('hanzo.act', { op: 'fill', selector: refOf(tree, /textbox "Email"/), text: 'a@b.co' })).success).toBe(true);
  const clicked = await drive('hanzo.act', { op: 'click', selector: subscribe });
  expect(clicked.success, clicked.error).toBe(true);
  await expect(target.locator('#status')).toHaveText('Subscribed a@b.co');
  const stale = await drive('hanzo.act', { op: 'click', selector: accept });
  expect(stale.error).toMatch(/Stale ref @e\d+: its element is no longer in the page\. Run snapshot again/);

  expect((await drive('hanzo.act', { op: 'check', selector: refOf(tree, /checkbox "I agree"/) })).result).toEqual({ checked: true, changed: true });
  await expect(target.locator('#terms')).toBeChecked();
  expect((await drive('hanzo.act', { op: 'select', selector: refOf(tree, /"Frequency"/), value: 'Weekly' })).result)
    .toEqual({ selected: { value: 'w', label: 'Weekly' } });
  await expect(target.locator('#freq')).toHaveValue('w');
  expect((await drive('hanzo.act', { op: 'click', selector: refOf(tree, /"Shadow action"/) })).success).toBe(true);
  await expect(target.locator('x-card')).toHaveAttribute('data-hit', '1');
  expect((await drive('hanzo.act', { op: 'click', selector: refOf(tree, /"Frame button"/) })).success).toBe(true);
  await expect(target.frameLocator('#frame').locator('body')).toHaveAttribute('data-hit', '1');
  expect((await drive('hanzo.act', { op: 'text', selector: '#status' })).result).toEqual({ text: 'Subscribed a@b.co' });

  const read = await drive('hanzo.read');
  expect(read.success, read.error).toBe(true);
  expect(read.result.title).toBe('Ref fixture');
  expect(read.result.markdown).toContain('# Newsletter\n\nSubscribed a@b.co');
  expect((await drive('hanzo.read', { outline: true })).result.markdown).toBe('# Newsletter\n## Archive');
  expect((await drive('hanzo.read', { filter: 'past issues' })).result.markdown).toBe('## Archive\n\nPast issues live here.');

  const shot = await drive('hanzo.annotate');
  expect(shot.success, shot.error).toBe(true);
  expect(Buffer.from(shot.result.data, 'base64').subarray(1, 4).toString()).toBe('PNG');
  expect(shot.result.legend).toContainEqual(`[${subscribe.slice(2)}] ${subscribe} button "Subscribe"`);

  // A new document starts a new ref table: old refs are refused, new ones continue past them.
  const nav = await drive('hanzo.navigate', { url: `${origin}/again` });
  expect(nav.result).toMatchObject({ url: `${origin}/again`, title: 'Ref fixture', loaded: true });
  expect((await drive('hanzo.act', { op: 'click', selector: subscribe })).error).toMatch(/Unknown ref .*Run snapshot again/);
  const fresh = (await drive('hanzo.snapshot', { interactive: true })).result.tree;
  expect(Number(refOf(fresh, /"Accept all"/).slice(2))).toBeGreaterThan(Number(subscribe.slice(2)));

  // wait: for text that appears, then a timeout that says what it waited for.
  await target.evaluate(() => setTimeout(() => { document.body.insertAdjacentHTML('beforeend', '<p>Welcome back</p>'); }, 300));
  expect((await drive('hanzo.wait', { text: 'Welcome back', timeout: 5000 })).result).toMatchObject({ met: true });
  expect((await drive('hanzo.wait', { selector: '#never', timeout: 300 })).error).toMatch(/Timed out after 300ms waiting for #never to be visible/);
});
