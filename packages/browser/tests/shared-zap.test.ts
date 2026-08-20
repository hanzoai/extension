import { describe, it, expect } from 'vitest';
import { handleZapMessage } from '../src/shared/zap';
import type { NativeZapState } from '../src/shared/native-zap';

function state(over: Partial<NativeZapState> = {}): NativeZapState {
  return {
    connected: false,
    port: null,
    providerId: 'browser:chrome/dbc/default',
    caps: [],
    ...over,
  };
}

describe('handleZapMessage', () => {
  it('returns false for actions it does not own', () => {
    expect(handleZapMessage('unknown.action', () => {}, state())).toBe(false);
    expect(handleZapMessage('zap.discover', () => {}, state())).toBe(false);
  });

  it('zap.status reports the router-verified registration', () => {
    let response: any;
    const handled = handleZapMessage('zap.status', (r) => { response = r; }, state({
      connected: true,
      caps: ['browser.tabs', 'browser.navigate'],
    }));
    expect(handled).toBe(true);
    expect(response.success).toBe(true);
    expect(response.zap.connected).toBe(true);
    expect(response.zap.providerId).toBe('browser:chrome/dbc/default');
    expect(response.zap.caps).toEqual(['browser.tabs', 'browser.navigate']);
  });

  it('an unregistered browser reports nothing reachable', () => {
    let response: any;
    handleZapMessage('zap.status', (r) => { response = r; }, state());
    expect(response.zap.connected).toBe(false);
    expect(response.zap.caps).toEqual([]);
  });
});
