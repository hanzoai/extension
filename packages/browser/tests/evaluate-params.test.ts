import { beforeEach, describe, expect, it } from 'vitest';

/**
 * Runtime.evaluate carries exactly the three fields of the evaluate rule.
 *
 * The Chrome path used to spread the caller's whole param bag into the CDP
 * call. CDP validates Runtime.evaluate strictly and owns a `timeout` field of
 * type double, so a client sending its own transport-level timeout — null by
 * default in the MCP tool schema — produced:
 *
 *   Failed to deserialize params.timeout - BINDINGS: double value expected
 *
 * on every single evaluate, while the identical call succeeded on Firefox,
 * which consumes timeout as its own wait budget and forwards nothing. Same
 * caller JS, opposite outcomes — the exact parity the transport promises.
 */

const sent: { method: string; params: any }[] = [];

beforeEach(() => {
  sent.length = 0;
  (globalThis as any).chrome = {
    runtime: { lastError: undefined, id: 'test' },
    debugger: {
      onEvent: { addListener() {} },
      onDetach: { addListener() {} },
      attach: (_d: unknown, _v: string, cb: () => void) => cb(),
      detach: (_d: unknown, cb: () => void) => cb(),
      sendCommand: (_t: unknown, method: string, params: any, cb: (r: any) => void) => {
        sent.push({ method, params });
        cb({ result: { value: 'ok' } });
      },
    },
    storage: { local: { get: async () => ({}), set: async () => {} } },
    tabs: { query: async () => [{ id: 7, active: true }] },
  };
});

async function evaluate(params: Record<string, unknown>) {
  const { CDPBridge } = await import('../src/browser-dispatch.js');
  await new CDPBridge().dispatchMethod('Runtime.evaluate', { tabId: 7, ...params });
  return sent.find((c) => c.method === 'Runtime.evaluate')!.params;
}

describe('Runtime.evaluate params', () => {
  it('drops a caller timeout instead of handing CDP a null double', async () => {
    const params = await evaluate({ expression: '1 + 1', timeout: null });
    expect(params).not.toHaveProperty('timeout');
    expect(params).toEqual({ expression: '1 + 1', returnByValue: true, awaitPromise: true });
  });

  it('drops every caller key, whatever it is named', async () => {
    const params = await evaluate({
      code: 'document.title',
      timeout: 30000,
      tab_id: 'tab-7',
      selector: '#x',
      returnByValue: false,
    });
    expect(Object.keys(params).sort()).toEqual(['awaitPromise', 'expression', 'returnByValue']);
    // returnByValue is ours, not the caller's — a false from outside would
    // return a remote object handle the caller cannot read.
    expect(params.returnByValue).toBe(true);
  });

  it('accepts the code-param aliases the evaluate rule defines', async () => {
    for (const key of ['expression', 'code', 'script', 'js']) {
      sent.length = 0;
      const params = await evaluate({ [key]: 'window.name' });
      expect(params.expression, key).toContain('window.name');
    }
  });
});
