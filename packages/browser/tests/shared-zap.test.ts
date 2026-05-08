import { describe, it, expect } from 'vitest';
import {
  encodeZapMessage,
  decodeZapMessage,
  createZapManager,
  hasZapTool,
  handleZapMessage,
  setZapRequestHandler,
  zapCallTool,
  zapListResources,
  zapReadResource,
  zapListPrompts,
  zapGetPrompt,
  ZAP_MAGIC,
  MSG_HANDSHAKE,
  MSG_HANDSHAKE_OK,
  MSG_REQUEST,
  MSG_RESPONSE,
  MSG_PING,
  MSG_PONG,
  DEFAULT_ZAP_PORTS,
  ZAP_RECONNECT_DELAY,
  ZAP_DISCOVERY_TIMEOUT,
} from '../src/shared/zap';

// ---------------------------------------------------------------------------
// Protocol Constants
// ---------------------------------------------------------------------------

describe('Protocol constants', () => {
  it('ZAP_MAGIC is [0x5A, 0x41, 0x50, 0x01]', () => {
    expect(ZAP_MAGIC).toEqual(new Uint8Array([0x5A, 0x41, 0x50, 0x01]));
  });

  it('message types have correct values', () => {
    expect(MSG_HANDSHAKE).toBe(0x01);
    expect(MSG_HANDSHAKE_OK).toBe(0x02);
    expect(MSG_REQUEST).toBe(0x10);
    expect(MSG_RESPONSE).toBe(0x11);
    expect(MSG_PING).toBe(0xFE);
    expect(MSG_PONG).toBe(0xFF);
  });

  it('DEFAULT_ZAP_PORTS is correct', () => {
    expect(DEFAULT_ZAP_PORTS).toEqual([9999, 9998, 9997, 9996, 9995]);
  });

  it('timing constants are defined', () => {
    expect(ZAP_RECONNECT_DELAY).toBe(3000);
    expect(ZAP_DISCOVERY_TIMEOUT).toBe(2000);
  });
});

// ---------------------------------------------------------------------------
// Encode / Decode
// ---------------------------------------------------------------------------

describe('encodeZapMessage', () => {
  it('produces correct binary format', () => {
    const buf = encodeZapMessage(MSG_REQUEST, { hello: 'world' });
    const arr = new Uint8Array(buf);

    // Magic bytes
    expect(arr[0]).toBe(0x5A);
    expect(arr[1]).toBe(0x41);
    expect(arr[2]).toBe(0x50);
    expect(arr[3]).toBe(0x01);

    // Type byte
    expect(arr[4]).toBe(MSG_REQUEST);

    // Length (big-endian 4 bytes)
    const view = new DataView(buf);
    const length = view.getUint32(5, false);
    const json = new TextDecoder().decode(new Uint8Array(buf, 9));
    expect(length).toBe(json.length);

    // Payload
    expect(JSON.parse(json)).toEqual({ hello: 'world' });
  });

  it('handles empty payload', () => {
    const buf = encodeZapMessage(MSG_PING, {});
    const decoded = decodeZapMessage(buf);
    expect(decoded).not.toBeNull();
    expect(decoded!.type).toBe(MSG_PING);
    expect(decoded!.payload).toEqual({});
  });

  it('handles unicode payload', () => {
    const payload = { text: 'Hello' };
    const buf = encodeZapMessage(MSG_REQUEST, payload);
    const decoded = decodeZapMessage(buf);
    expect(decoded!.payload.text).toBe('Hello');
  });

  it('handles nested objects', () => {
    const payload = {
      method: 'tools/call',
      params: {
        name: 'fs',
        arguments: { action: 'read', path: '/tmp/test.txt' },
      },
    };
    const buf = encodeZapMessage(MSG_REQUEST, payload);
    const decoded = decodeZapMessage(buf);
    expect(decoded!.payload).toEqual(payload);
  });
});

describe('decodeZapMessage', () => {
  it('round-trips encode/decode', () => {
    const original = { id: 'req-1', method: 'tools/list', params: {} };
    const buf = encodeZapMessage(MSG_REQUEST, original);
    const decoded = decodeZapMessage(buf);
    expect(decoded).not.toBeNull();
    expect(decoded!.type).toBe(MSG_REQUEST);
    expect(decoded!.payload).toEqual(original);
  });

  it('returns null for too-short buffer', () => {
    const buf = new ArrayBuffer(5);
    expect(decodeZapMessage(buf)).toBeNull();
  });

  it('returns null for wrong magic bytes', () => {
    const buf = new ArrayBuffer(20);
    const arr = new Uint8Array(buf);
    arr[0] = 0xFF; arr[1] = 0xFF; arr[2] = 0xFF; arr[3] = 0xFF;
    expect(decodeZapMessage(buf)).toBeNull();
  });

  it('returns null for empty buffer', () => {
    const buf = new ArrayBuffer(0);
    expect(decodeZapMessage(buf)).toBeNull();
  });

  it('handles all message types', () => {
    for (const type of [MSG_HANDSHAKE, MSG_HANDSHAKE_OK, MSG_REQUEST, MSG_RESPONSE, MSG_PING, MSG_PONG]) {
      const buf = encodeZapMessage(type, { test: true });
      const decoded = decodeZapMessage(buf);
      expect(decoded!.type).toBe(type);
    }
  });
});

// ---------------------------------------------------------------------------
// ZapManager
// ---------------------------------------------------------------------------

describe('createZapManager', () => {
  it('returns correct initial state', () => {
    const mgr = createZapManager();
    expect(mgr.state.connected).toBe(false);
    expect(mgr.state.mcps).toEqual([]);
    expect(mgr.state.extensionId).toMatch(/^hanzo-ext-/);
    expect(mgr.connections.size).toBe(0);
    expect(mgr.pendingRequests.size).toBe(0);
    expect(mgr.requestIdCounter).toBe(0);
  });

  it('extension ID has correct format', () => {
    const mgr = createZapManager();
    expect(mgr.state.extensionId).toMatch(/^hanzo-ext-[a-z0-9]+$/);
  });
});

// ---------------------------------------------------------------------------
// hasZapTool
// ---------------------------------------------------------------------------

describe('hasZapTool', () => {
  it('returns true when tool exists', () => {
    const mgr = createZapManager();
    mgr.state.mcps.push({ id: 'mcp-1', name: 'Test', url: 'ws://localhost:9999', tools: ['fs', 'exec'] });
    expect(hasZapTool(mgr, 'fs')).toBe(true);
    expect(hasZapTool(mgr, 'exec')).toBe(true);
  });

  it('returns false when tool does not exist', () => {
    const mgr = createZapManager();
    mgr.state.mcps.push({ id: 'mcp-1', name: 'Test', url: 'ws://localhost:9999', tools: ['fs'] });
    expect(hasZapTool(mgr, 'nonexistent')).toBe(false);
  });

  it('returns false with empty mcps', () => {
    const mgr = createZapManager();
    expect(hasZapTool(mgr, 'fs')).toBe(false);
  });

  it('searches across multiple MCPs', () => {
    const mgr = createZapManager();
    mgr.state.mcps.push({ id: 'mcp-1', name: 'A', url: 'ws://localhost:9999', tools: ['fs'] });
    mgr.state.mcps.push({ id: 'mcp-2', name: 'B', url: 'ws://localhost:9998', tools: ['exec'] });
    expect(hasZapTool(mgr, 'exec')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// handleZapMessage
// ---------------------------------------------------------------------------

describe('handleZapMessage', () => {
  function makeMgr() {
    const mgr = createZapManager();
    mgr.state.mcps.push({
      id: 'mcp-1',
      name: 'Test MCP',
      url: 'ws://localhost:9999',
      tools: ['fs', 'exec', 'memory'],
    });
    mgr.state.connected = true;
    return mgr;
  }

  it('returns false for unknown actions', () => {
    const mgr = makeMgr();
    const result = handleZapMessage('unknown.action', {}, () => {}, mgr, 'Chrome', '1.0');
    expect(result).toBe(false);
  });

  it('zap.status returns connection info', () => {
    const mgr = makeMgr();
    let response: any;
    handleZapMessage('zap.status', {}, (r: any) => { response = r; }, mgr, 'Chrome', '1.0');
    expect(response.success).toBe(true);
    expect(response.zap.connected).toBe(true);
    expect(response.zap.mcps).toHaveLength(1);
    expect(response.zap.mcps[0].toolCount).toBe(3);
  });

  it('zap.listTools returns flattened tool list', () => {
    const mgr = makeMgr();
    let response: any;
    handleZapMessage('zap.listTools', {}, (r: any) => { response = r; }, mgr, 'Chrome', '1.0');
    expect(response.success).toBe(true);
    expect(response.tools).toHaveLength(3);
    expect(response.tools[0]).toEqual({ name: 'fs', mcpId: 'mcp-1', mcpName: 'Test MCP' });
  });

  it('zap.callTool with missing name returns error', () => {
    const mgr = makeMgr();
    let response: any;
    handleZapMessage('zap.callTool', {}, (r: any) => { response = r; }, mgr, 'Chrome', '1.0');
    expect(response.success).toBe(false);
    expect(response.error).toContain('Missing tool name');
  });

  it('zap.readResource with missing uri returns error', () => {
    const mgr = makeMgr();
    let response: any;
    handleZapMessage('zap.readResource', { mcpId: 'mcp-1' }, (r: any) => { response = r; }, mgr, 'Chrome', '1.0');
    expect(response.success).toBe(false);
    expect(response.error).toContain('Missing uri');
  });

  it('zap.getPrompt with missing name returns error', () => {
    const mgr = makeMgr();
    let response: any;
    handleZapMessage('zap.getPrompt', { mcpId: 'mcp-1' }, (r: any) => { response = r; }, mgr, 'Chrome', '1.0');
    expect(response.success).toBe(false);
    expect(response.error).toContain('Missing prompt name');
  });

  it('zap.listResources with no MCP returns error', () => {
    const mgr = createZapManager(); // no MCPs connected
    let response: any;
    handleZapMessage('zap.listResources', {}, (r: any) => { response = r; }, mgr, 'Chrome', '1.0');
    expect(response.success).toBe(false);
    expect(response.error).toContain('No MCP connected');
  });

  it('zap.listPrompts with no MCP returns error', () => {
    const mgr = createZapManager();
    let response: any;
    handleZapMessage('zap.listPrompts', {}, (r: any) => { response = r; }, mgr, 'Chrome', '1.0');
    expect(response.success).toBe(false);
    expect(response.error).toContain('No MCP connected');
  });

  it('all zap.* actions return true (handled)', () => {
    const mgr = makeMgr();
    const noop = () => {};
    for (const action of ['zap.status', 'zap.listTools', 'zap.callTool', 'zap.listResources', 'zap.readResource', 'zap.listPrompts', 'zap.getPrompt', 'zap.discover', 'zap.connect']) {
      const handled = handleZapMessage(action, { name: 'test', uri: 'test', url: 'ws://localhost:9999' }, noop, mgr, 'Chrome', '1.0');
      expect(handled).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// setZapRequestHandler — closes the loop for ZAP-server-initiated RPC
// (the 2-process architecture where Python hanzo-mcps push browser
// actions TO the extension over the same socket).
// ---------------------------------------------------------------------------

describe('setZapRequestHandler', () => {
  it('attaches the handler onto the manager', () => {
    const mgr = createZapManager();
    expect(mgr.requestHandler).toBeUndefined();
    const handler = async () => ({ ok: true });
    setZapRequestHandler(mgr, handler);
    expect(mgr.requestHandler).toBe(handler);
  });

  it('replaces an existing handler', () => {
    const mgr = createZapManager();
    const a = async () => 'a';
    const b = async () => 'b';
    setZapRequestHandler(mgr, a);
    setZapRequestHandler(mgr, b);
    expect(mgr.requestHandler).toBe(b);
  });

  it('clears the handler when undefined', () => {
    const mgr = createZapManager();
    setZapRequestHandler(mgr, async () => null);
    setZapRequestHandler(mgr, undefined);
    expect(mgr.requestHandler).toBeUndefined();
  });
});
