/**
 * page.js: the snapshot → ref engine's page half.
 *
 * shared/drive.ts injects this file into a tab's isolated world on first use
 * (scripting.executeScript files), then calls `__hanzoPage(request)` there.
 * The isolated world outlives each call, so the ref table does too, until the
 * document goes away. The page's own scripts cannot see or call any of it.
 */

import { act, boxes, probe, snapshot } from './shared/snapshot.js';
import { read } from './shared/read.js';

/** A page call from shared/drive.ts: `op` plus that op's own fields, typed there at the wire boundary. */
function run(req: any): Record<string, unknown> {
  switch (req.op) {
    case 'snapshot': return snapshot(req);
    case 'read': return read(req);
    case 'boxes': return boxes(req.base);
    case 'probe': return probe(req);
    default: return act(req);
  }
}

const g = globalThis as any;
// Injected twice (a navigation race), the first engine and its refs stay.
g.__hanzoPage ??= (req: any) => {
  try {
    return { ok: true, ...run(req) };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
};
