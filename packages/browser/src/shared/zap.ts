/**
 * ZAP surface for the extension's own pages — what popup and sidebar may ask
 * the background about this browser's standing on the local zapd router.
 *
 * The answer comes from `NativeZapState`, which the reconciler keeps in step
 * with the router's registry, so every field here is something the router
 * itself asserted.
 */

import type { NativeZapState } from './native-zap.js';

/** Handle zap.* messages from sidebar/popup. Returns true if handled. */
export function handleZapMessage(
  action: string,
  sendResponse: (r: any) => void,
  state: NativeZapState,
): boolean {
  if (action !== 'zap.status') return false;
  sendResponse({
    success: true,
    zap: {
      connected: state.connected,
      providerId: state.providerId,
      caps: state.caps,
    },
  });
  return true;
}
