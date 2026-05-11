/**
 * Multi-browser routing through the CDP bridge server.
 *
 * The bridge is the SINGLE entrypoint for hanzo-mcp / Playwright clients.
 * When two extensions register against the same bridge (e.g. Chrome AND
 * Firefox both running locally), the user must be able to route a command
 * to a specific browser via `{ ...command, browser: 'firefox' }`. This
 * suite asserts that resolution works deterministically.
 *
 * The bridge exposes `assignClientId`, `resolveClient`, and the public
 * `browser({ action, browser })` action namespace. We exercise those
 * directly with mocked WebSocket clients so we never hit a real port.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { CDPBridgeServer } from '../src/cdp-bridge-server';

// jsdom's `WebSocket` doesn't behave like the `ws` server expects, so we
// use the real ws lib but on a unique port per test to avoid contention.
import { WebSocket } from 'ws';

let server: CDPBridgeServer;
const PORTS_BASE = 39220; // unique band so CI doesn't collide with prod 9223
let portCursor = PORTS_BASE;
function nextPort(): number {
  return portCursor++;
}

beforeEach(() => {
  // Server created per-test with fresh port.
});

afterEach(() => {
  if (server) {
    server.close();
    server = undefined as any;
  }
});

/**
 * Spin up a real CDPBridgeServer and connect a fake "extension" client
 * over WebSocket. The fake client immediately registers and then echoes
 * any command back as the result. Returns the connected client so the
 * test can drive responses.
 */
async function setupBridgeWithClient(
  browser: string,
): Promise<{ port: number; client: WebSocket; opened: Promise<void> }> {
  const port = nextPort();
  server = new CDPBridgeServer(port);
  // Give the WS server one tick to start listening.
  await new Promise((r) => setTimeout(r, 50));

  const client = new WebSocket(`ws://localhost:${port}/cdp`);
  const opened = new Promise<void>((resolve) => client.on('open', () => resolve()));
  await opened;

  client.send(JSON.stringify({
    type: 'register',
    role: 'cdp-provider',
    browser,
    capabilities: ['navigate'],
  }));
  // One tick for register to land.
  await new Promise((r) => setTimeout(r, 30));

  // Echo back any command as a successful result so the test doesn't time out.
  client.on('message', (raw) => {
    const msg = JSON.parse(raw.toString());
    if (msg.id !== undefined && msg.method) {
      client.send(JSON.stringify({
        id: msg.id,
        result: { __echoed: { method: msg.method, params: msg.params } },
      }));
    }
  });

  return { port, client, opened };
}

describe('CDPBridgeServer.assignClientId', () => {
  it('first client of a browser type gets its bare name', async () => {
    const { client } = await setupBridgeWithClient('chrome');
    // Internal: the server stores by browser name. Verify via list_browsers.
    const result = await server.browser({ action: 'list_browsers' });
    expect(result.browsers).toHaveLength(1);
    expect(result.browsers[0].id).toBe('chrome');
    expect(result.browsers[0].browser).toBe('chrome');
    client.close();
  });

  it('second client of same browser type gets a -2 suffix', async () => {
    const { client: c1 } = await setupBridgeWithClient('chrome');
    // Open a second connection registered as `chrome`.
    const port = (server as any).httpPort;
    const c2 = new WebSocket(`ws://localhost:${port}/cdp`);
    await new Promise<void>((resolve) => c2.on('open', () => resolve()));
    c2.send(JSON.stringify({
      type: 'register',
      role: 'cdp-provider',
      browser: 'chrome',
      capabilities: ['navigate'],
    }));
    await new Promise((r) => setTimeout(r, 30));

    const result = await server.browser({ action: 'list_browsers' });
    expect(result.browsers).toHaveLength(2);
    const ids = result.browsers.map((b: any) => b.id).sort();
    expect(ids).toEqual(['chrome', 'chrome-2']);

    c1.close();
    c2.close();
  });

  it('different browser types each get their bare names', async () => {
    const { client: chromeClient } = await setupBridgeWithClient('chrome');
    const port = (server as any).httpPort;
    const ffClient = new WebSocket(`ws://localhost:${port}/cdp`);
    await new Promise<void>((resolve) => ffClient.on('open', () => resolve()));
    ffClient.send(JSON.stringify({
      type: 'register',
      role: 'cdp-provider',
      browser: 'firefox',
      capabilities: ['navigate'],
    }));
    await new Promise((r) => setTimeout(r, 30));
    ffClient.on('message', (raw) => {
      const msg = JSON.parse(raw.toString());
      if (msg.id !== undefined && msg.method) {
        ffClient.send(JSON.stringify({
          id: msg.id,
          result: { __echoed: { method: msg.method, browser: 'firefox' } },
        }));
      }
    });

    const result = await server.browser({ action: 'list_browsers' });
    const ids = result.browsers.map((b: any) => b.id).sort();
    expect(ids).toEqual(['chrome', 'firefox']);

    chromeClient.close();
    ffClient.close();
  });
});

describe('CDPBridgeServer.browser routing', () => {
  it('routes by browser=firefox to the firefox client', async () => {
    const { client: chromeClient } = await setupBridgeWithClient('chrome');
    const port = (server as any).httpPort;
    const ffClient = new WebSocket(`ws://localhost:${port}/cdp`);
    await new Promise<void>((resolve) => ffClient.on('open', () => resolve()));
    ffClient.send(JSON.stringify({
      type: 'register',
      role: 'cdp-provider',
      browser: 'firefox',
      capabilities: ['navigate'],
    }));
    await new Promise((r) => setTimeout(r, 30));
    ffClient.on('message', (raw) => {
      const msg = JSON.parse(raw.toString());
      if (msg.id !== undefined && msg.method) {
        ffClient.send(JSON.stringify({
          id: msg.id,
          result: { __echoed: { method: msg.method, browser: 'firefox' } },
        }));
      }
    });

    const result = await server.browser({
      action: 'navigate',
      browser: 'firefox',
      url: 'https://example.com',
    });

    // Result should come from firefox echoer, not chrome's.
    expect(result.__echoed.browser).toBe('firefox');
    expect(result.__echoed.method).toBe('Page.navigate');

    chromeClient.close();
    ffClient.close();
  });

  it('routes by chrome-2 unique ID to the second chrome client', async () => {
    const { client: c1 } = await setupBridgeWithClient('chrome');
    const port = (server as any).httpPort;
    // c1 already echoes generically; install a label-specific echoer on c2.
    const c2 = new WebSocket(`ws://localhost:${port}/cdp`);
    await new Promise<void>((resolve) => c2.on('open', () => resolve()));
    c2.send(JSON.stringify({
      type: 'register',
      role: 'cdp-provider',
      browser: 'chrome',
      capabilities: ['navigate'],
    }));
    await new Promise((r) => setTimeout(r, 30));
    c2.on('message', (raw) => {
      const msg = JSON.parse(raw.toString());
      if (msg.id !== undefined && msg.method) {
        c2.send(JSON.stringify({
          id: msg.id,
          result: { __echoed: { method: msg.method, label: 'chrome-2' } },
        }));
      }
    });

    const result = await server.browser({
      action: 'navigate',
      browser: 'chrome-2',
      url: 'https://example.com',
    });
    expect(result.__echoed.label).toBe('chrome-2');

    c1.close();
    c2.close();
  });

  it('throws on unknown browser target', async () => {
    const { client } = await setupBridgeWithClient('chrome');
    await expect(
      server.browser({ action: 'navigate', browser: 'safari', url: 'x' }),
    ).rejects.toThrow(/Browser "safari" not connected/);
    client.close();
  });

  it('list_browsers returns count and details', async () => {
    const { client } = await setupBridgeWithClient('chrome');
    const result = await server.browser({ action: 'list_browsers' });
    expect(result.count).toBe(1);
    expect(result.browsers).toEqual([
      { id: 'chrome', browser: 'chrome', capabilities: ['navigate'] },
    ]);
    client.close();
  });

  it('default routing (no browser specified) picks the first registered client', async () => {
    const { client } = await setupBridgeWithClient('firefox');
    const result = await server.browser({
      action: 'navigate',
      url: 'https://example.com',
    });
    expect(result.__echoed.method).toBe('Page.navigate');
    client.close();
  });
});

describe('CDPBridgeServer.evaluate result unwrapping', () => {
  it('passes awaitPromise: true to Runtime.evaluate', async () => {
    const { client } = await setupBridgeWithClient('chrome');
    let receivedParams: any = null;
    // Replace generic echoer with a custom one that captures params.
    client.removeAllListeners('message');
    client.on('message', (raw) => {
      const msg = JSON.parse(raw.toString());
      if (msg.id !== undefined && msg.method === 'Runtime.evaluate') {
        receivedParams = msg.params;
        client.send(JSON.stringify({
          id: msg.id,
          result: { result: { value: 42, type: 'number' } },
        }));
      }
    });

    const result = await server.browser({
      action: 'evaluate',
      code: '1 + 1',
    });

    expect(receivedParams.awaitPromise).toBe(true);
    expect(receivedParams.returnByValue).toBe(true);
    // unwrapEvaluateResult unwraps {result: {value: 42}} to 42.
    expect(result.result).toBe(42);
    client.close();
  });

  it('unwraps an empty {} (Promise drop) to undefined', async () => {
    const { client } = await setupBridgeWithClient('chrome');
    client.removeAllListeners('message');
    client.on('message', (raw) => {
      const msg = JSON.parse(raw.toString());
      if (msg.id !== undefined && msg.method === 'Runtime.evaluate') {
        client.send(JSON.stringify({ id: msg.id, result: {} }));
      }
    });

    const result = await server.browser({ action: 'evaluate', code: 'foo()' });
    expect(result.result).toBeUndefined();
    client.close();
  });
});
