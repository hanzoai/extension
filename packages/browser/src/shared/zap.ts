/**
 * The extension on this machine's ZAP router — the one place both backgrounds
 * start it, and the one place popup and sidebar ask about it.
 *
 * Kept in `storage.local` (never `storage.sync`: the pairing belongs to this
 * machine's router and means nothing on another):
 *   zapPairing  the code the user pasted, `ws://127.0.0.1:<port>/#<token>`
 *   zapName     this install's node name, `<engine>-<4 hex>`, minted once
 *
 * Messages:
 *   zap.status            → { connected, paired, providerId, caps, error }
 *   zap.pair   { code }   → pair with the router that minted `code`
 *   zap.unpair            → forget the pairing and disconnect
 */

import { ensureZap, newZapState, parsePairing, setPairing, type ZapOpts, type ZapState } from './socket.js';

export interface ZapStorage {
  get(keys: string[]): Promise<Record<string, any>>;
  set(items: Record<string, any>): Promise<void>;
  remove(key: string): Promise<void>;
}

export interface Zap {
  state: ZapState;
  /** Reconcile now — the keep-alive alarm calls this after a worker restart. */
  tick(): void;
  /** Answer a zap.* message. Returns true if it was one. */
  handle(action: string, request: any, sendResponse: (r: any) => void): boolean;
}

export const PAIR_HELP = 'Only for a browser that cannot start a native host (snap, Flatpak): run `hanzo-mcp pair` on this computer and paste the code it prints.';

export function startZap(opts: ZapOpts & { engine: string; storage: ZapStorage }): Zap {
  const state = newZapState('');
  let ready = false;

  const loaded = (async () => {
    const s = await opts.storage.get(['zapPairing', 'zapName']);
    let name: string = s.zapName;
    if (!name) {
      const id = crypto.getRandomValues(new Uint8Array(2));
      name = `${opts.engine}-${Array.from(id, (b) => b.toString(16).padStart(2, '0')).join('')}`;
      await opts.storage.set({ zapName: name });
    }
    state.providerId = `browser/${name}`;
    state.pairing = typeof s.zapPairing === 'string' ? parsePairing(s.zapPairing) : null;
    ready = true;
    ensureZap(state, opts);
  })();

  return {
    state,
    tick() {
      if (ready) ensureZap(state, opts);
    },
    handle(action, request, sendResponse) {
      switch (action) {
        case 'zap.status':
          sendResponse({
            success: true,
            zap: {
              connected: state.connected,
              transport: state.socket?.kind ?? '',
              native: state.native,
              paired: !!state.pairing,
              providerId: state.providerId,
              caps: state.caps,
              error: state.error,
            },
          });
          return true;
        case 'zap.pair': {
          const code = String(request?.code ?? '').trim();
          const pairing = parsePairing(code);
          if (!pairing) {
            sendResponse({ success: false, error: `Not a pairing code. ${PAIR_HELP}` });
            return true;
          }
          void loaded
            .then(() => opts.storage.set({ zapPairing: code }))
            .then(() => {
              setPairing(state, pairing, opts);
              sendResponse({ success: true });
            });
          return true;
        }
        case 'zap.unpair':
          void loaded
            .then(() => opts.storage.remove('zapPairing'))
            .then(() => {
              setPairing(state, null, opts);
              sendResponse({ success: true });
            });
          return true;
        default:
          return false;
      }
    },
  };
}
