/**
 * The background half of the snapshot → ref engine: one router, both browsers.
 *
 * browser-dispatch.ts (Chrome) and background-firefox.ts hand every method in
 * DRIVE here with their API namespace (`chrome` / `browser`). Everything page-
 * side runs in page.js, injected into the tab's isolated world with
 * scripting.executeScript, so Chrome, Firefox and Safari act on a page with
 * the same code and no debugger attach.
 *
 *   hanzo.navigate  {url}                                   open and wait for load
 *   hanzo.snapshot  {interactive, compact, depth, selector, urls}
 *   hanzo.act       {op, selector, text, key, value, attribute, dx, dy}
 *   hanzo.read      {outline, filter}                       page as markdown
 *   hanzo.wait      {selector | text, state, timeout}       or, with neither, load
 *   hanzo.annotate  {maxWidth, quality}                     screenshot with [N] = @eN
 */

import { detail, shrink, toBase64, toBlob } from './shrink.js';

export const DRIVE = new Set(['hanzo.navigate', 'hanzo.snapshot', 'hanzo.act', 'hanzo.read', 'hanzo.wait', 'hanzo.annotate']);

type Params = Record<string, unknown>;
type Result = Record<string, any>;

/** An answer from the page engine itself, as opposed to a failure to reach it. */
class PageError extends Error {}

// Wire params arrive as strings (native-zap decodes every value as UTF-8), so
// each is read once, here, at the boundary.
const str = (v: unknown): string | undefined => (v === undefined || v === null || v === '' ? undefined : String(v));
const flag = (v: unknown): boolean => v === true || v === 1 || (typeof v === 'string' && /^(true|1)$/i.test(v));
const num = (v: unknown): number | undefined => {
  const n = v === undefined || v === null || v === '' ? NaN : Number(v);
  return Number.isFinite(n) ? n : undefined;
};
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Highest ref handed out per tab, so a new document never reuses an old document's refs. */
const last = new Map<number, number>();

export async function drive(api: any, tabId: number, method: string, p: Params): Promise<Result> {
  switch (method) {
    case 'hanzo.navigate':
      return navigate(api, tabId, str(p.url));
    case 'hanzo.snapshot': {
      const { last: n, ...out } = await page(api, tabId, {
        op: 'snapshot', interactive: flag(p.interactive), compact: flag(p.compact),
        depth: num(p.depth), selector: str(p.selector), urls: flag(p.urls), base: last.get(tabId),
      });
      last.set(tabId, n);
      return out;
    }
    case 'hanzo.act':
      return page(api, tabId, {
        op: str(p.op), selector: str(p.selector), text: p.text === undefined ? undefined : String(p.text),
        key: str(p.key), value: str(p.value), attribute: str(p.attribute), dx: num(p.dx), dy: num(p.dy),
      });
    case 'hanzo.read':
      return page(api, tabId, { op: 'read', outline: flag(p.outline), filter: str(p.filter) });
    case 'hanzo.wait':
      return wait(api, tabId, p);
    case 'hanzo.annotate':
      return annotate(api, tabId, p);
  }
  throw new Error(`drive: unknown method ${method}`);
}

/** Resolve once the tab has finished loading, or after `ms` regardless. */
async function settle(api: any, tabId: number, ms = 5000): Promise<void> {
  const end = Date.now() + ms;
  while ((await api.tabs.get(tabId)).status !== 'complete' && Date.now() < end) await sleep(100);
}

async function inject(api: any, tabId: number, req: Params): Promise<Result | null> {
  const [res] = await api.scripting.executeScript({
    target: { tabId },
    func: (r: any) => {
      const f = (globalThis as any).__hanzoPage;
      return f ? f(r) : null;
    },
    args: [JSON.parse(JSON.stringify(req))],
  });
  if (res?.error) throw new Error(String(res.error));
  return res?.result ?? null;
}

/** Call the page engine, injecting page.js the first time a document needs it. */
async function page(api: any, tabId: number, req: Params): Promise<Result> {
  await settle(api, tabId);
  const call = async () => {
    const out = await inject(api, tabId, req);
    if (out) return out;
    await api.scripting.executeScript({ target: { tabId }, files: ['page.js'] });
    return inject(api, tabId, req);
  };
  let out: Result | null;
  try {
    out = await call();
  } catch {
    // The frame was replaced mid-call (a navigation): once more, on the new document.
    await settle(api, tabId);
    out = await call();
  }
  if (!out) throw new Error('The page did not answer: browser pages (chrome://, about:, the extension store) cannot be scripted.');
  const { ok, error, ...rest } = out;
  if (!ok) throw new PageError(error);
  return rest;
}

async function navigate(api: any, tabId: number, url: string | undefined): Promise<Result> {
  if (!url) throw new Error('url required');
  const before = await api.tabs.get(tabId);
  const target = new URL(url, before.url || undefined);
  const hashOnly = before.url && target.hash && target.href.split('#')[0] === String(before.url).split('#')[0];
  if (hashOnly) {
    await api.tabs.update(tabId, { url: target.href });
  } else {
    const loaded = new Promise<void>((resolve) => {
      const done = () => { clearTimeout(timer); api.tabs.onUpdated.removeListener(on); resolve(); };
      const on = (id: number, info: { status?: string }) => { if (id === tabId && info.status === 'complete') done(); };
      const timer = setTimeout(done, 30_000);
      api.tabs.onUpdated.addListener(on);
    });
    await api.tabs.update(tabId, { url: target.href });
    await loaded;
  }
  const t = await api.tabs.get(tabId);
  return { url: t.url, title: t.title, loaded: t.status === 'complete' };
}

async function wait(api: any, tabId: number, p: Params): Promise<Result> {
  const timeout = num(p.timeout) ?? 10_000;
  const start = Date.now();
  const req = { op: 'probe', selector: str(p.selector), text: str(p.text), state: str(p.state) };
  if (!req.selector && !req.text) {
    await settle(api, tabId, timeout);
    return { loaded: (await api.tabs.get(tabId)).status === 'complete', waited: Date.now() - start };
  }
  const what = req.text ? `text ${JSON.stringify(req.text)}` : req.selector;
  for (;;) {
    try {
      if ((await page(api, tabId, req)).met) return { met: true, waited: Date.now() - start };
    } catch (e) {
      if (e instanceof PageError) throw e; // the page answered: a bad selector or a dead ref
    }
    if (Date.now() - start > timeout) {
      throw new Error(`Timed out after ${timeout}ms waiting for ${what} to be ${req.state === 'hidden' ? 'hidden' : 'visible'}.`);
    }
    await sleep(100);
  }
}

/** The tab's visible pixels. captureVisibleTab shoots a window's active tab, so a background tab is raised for the shot. */
async function capture(api: any, tabId: number): Promise<string> {
  const tab = await api.tabs.get(tabId);
  let restore: number | undefined;
  if (!tab.active) {
    const [prev] = await api.tabs.query({ active: true, windowId: tab.windowId });
    restore = prev?.id;
    await api.tabs.update(tabId, { active: true });
    await sleep(100);
  }
  try {
    const url: string = await api.tabs.captureVisibleTab(tab.windowId, { format: 'png' });
    if (!url) throw new Error('captureVisibleTab returned nothing');
    return url.replace(/^data:image\/\w+;base64,/, '');
  } finally {
    if (restore !== undefined) await api.tabs.update(restore, { active: true }).catch(() => {});
  }
}

const INK = '#e11d48';

/** A screenshot with every on-screen interactive ref boxed and numbered: label N is ref @eN. */
async function annotate(api: any, tabId: number, p: Params): Promise<Result> {
  const { last: n, boxes, width } = await page(api, tabId, { op: 'boxes', base: last.get(tabId) });
  last.set(tabId, n);
  const png = await capture(api, tabId);
  const bitmap = await createImageBitmap(toBlob(png, 'image/png'));
  const s = bitmap.width / width;
  const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
  const ctx = canvas.getContext('2d')!;
  ctx.drawImage(bitmap, 0, 0);
  bitmap.close();
  ctx.lineWidth = Math.max(1, 2 * s);
  ctx.font = `bold ${Math.round(11 * s)}px sans-serif`;
  ctx.textBaseline = 'top';
  for (const b of boxes as Array<{ ref: string; x: number; y: number; w: number; h: number }>) {
    const [x, y, w, h] = [b.x * s, b.y * s, b.w * s, b.h * s];
    const tag = b.ref.slice(1);
    const tw = ctx.measureText(tag).width + 6 * s;
    const th = 15 * s;
    const ty = y >= th ? y - th : y;
    ctx.strokeStyle = INK;
    ctx.strokeRect(x, y, w, h);
    ctx.fillStyle = INK;
    ctx.fillRect(x, ty, tw, th);
    ctx.fillStyle = '#fff';
    ctx.fillText(tag, x + 3 * s, ty + 2 * s);
  }
  const drawn = await toBase64(await canvas.convertToBlob({ type: 'image/png' }));
  const { quality, max } = detail(p);
  const data = max > 0 ? await shrink(drawn, max, quality || 70) : drawn;
  return {
    data,
    format: max > 0 ? 'jpeg' : 'png',
    legend: (boxes as Array<{ ref: string; label: string }>).map((b) => `[${b.ref.slice(1)}] @${b.ref} ${b.label}`),
  };
}

/**
 * runtime.onMessage `{action: 'drive', method, params}`: the extension's own
 * pages drive a tab through the same dispatcher the zapd router calls. A web
 * page's content script is refused: it must not steer other tabs.
 */
export async function driveMessage(
  api: any,
  sender: { url?: string },
  request: { method?: string; params?: Params },
  dispatch: (method: string, params: Params) => Promise<any>,
): Promise<Result> {
  if (!String(sender?.url || '').startsWith(api.runtime.getURL(''))) {
    return { success: false, error: 'drive answers extension pages only' };
  }
  if (!request.method || !DRIVE.has(request.method)) {
    return { success: false, error: `drive: unknown method ${request.method}` };
  }
  try {
    return { success: true, result: await dispatch(request.method, request.params || {}) };
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : String(e) };
  }
}
