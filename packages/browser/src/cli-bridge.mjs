#!/usr/bin/env node
/**
 * Hanzo Browser Extension CLI Bridge
 * 
 * Exposes an OpenAI-compatible HTTP endpoint at http://127.0.0.1:3695/v1
 * that communicates with the Hanzo browser extension over ZAP (/run/user/1000/zap/zapd.sock)
 * to run inference on your active ChatGPT Plus plan or other connected sessions.
 * 
 * Usage:
 *   node packages/browser/src/cli-bridge.mjs
 *   dev --ext "your prompt"
 */

import http from 'http';
import net from 'net';

const PORT = 3695;
const ZAP_SOCK = process.env.XDG_RUNTIME_DIR
  ? `${process.env.XDG_RUNTIME_DIR}/zap/zapd.sock`
  : `/run/user/${process.getuid?.() ?? 1000}/zap/zapd.sock`;

const enc = new TextEncoder();
const dec = new TextDecoder();

function putU16(a, n) { a.push(n & 0xff, (n >> 8) & 0xff); }
function putStr(a, s) {
  const b = enc.encode(s);
  putU16(a, b.length);
  for (let i = 0; i < b.length; i++) a.push(b[i]);
}

function encodeFrame(t, from, to, payload = new Uint8Array(0)) {
  const f = enc.encode(from), d = enc.encode(to);
  const len = 11 + f.length + d.length + payload.length;
  const b = new Uint8Array(4 + len);
  const v = new DataView(b.buffer);
  v.setUint32(0, len, true);
  v.setUint8(4, t);
  v.setUint16(5, 0, true);
  v.setUint16(7, f.length, true);
  v.setUint16(9, d.length, true);
  v.setUint32(11, payload.length, true);
  b.set(f, 15);
  b.set(d, 15 + f.length);
  b.set(payload, 15 + f.length + d.length);
  return b;
}

function decodeFrame(b) {
  const v = new DataView(b.buffer, b.byteOffset, b.byteLength);
  const fl = v.getUint16(7, true), tl = v.getUint16(9, true);
  return {
    t: v.getUint8(4),
    from: dec.decode(b.subarray(15, 15 + fl)),
    to: dec.decode(b.subarray(15 + fl, 15 + fl + tl)),
    payload: b.slice(15 + fl + tl)
  };
}

function encodeHello(role, brand, caps) {
  const a = [role];
  putStr(a, brand);
  putU16(a, caps.length);
  for (const c of caps) putStr(a, c);
  putU16(a, 0);
  return new Uint8Array(a);
}

function encodeCmd(method, params = {}) {
  const a = [];
  putStr(a, method);
  const entries = Object.entries(params);
  putU16(a, entries.length);
  for (const [k, v] of entries) {
    putStr(a, k);
    const vb = enc.encode(typeof v === 'string' ? v : JSON.stringify(v));
    a.push(vb.length & 0xff, (vb.length >> 8) & 0xff, (vb.length >> 16) & 0xff, (vb.length >> 24) & 0xff);
    for (let i = 0; i < vb.length; i++) a.push(vb[i]);
  }
  return new Uint8Array(a);
}

function decodeProviders(p) {
  const dv = new DataView(p.buffer, p.byteOffset, p.byteLength);
  let o = 0;
  const str = () => {
    const n = dv.getUint16(o, true); o += 2;
    const s = dec.decode(p.subarray(o, o + n)); o += n;
    return s;
  };
  const n = dv.getUint16(o, true); o += 2;
  const out = [];
  for (let i = 0; i < n; i++) {
    const id = str();
    const role = dv.getUint8(o); o += 1;
    const brand = str();
    const nc = dv.getUint16(o, true); o += 2;
    const caps = [];
    for (let c = 0; c < nc; c++) caps.push(str());
    const na = dv.getUint16(o, true); o += 2;
    const attrs = {};
    for (let j = 0; j < na; j++) { const k = str(); attrs[k] = str(); }
    out.push({ id, role, brand, caps, attrs });
  }
  return out;
}

// ZAP Client to interact with browser extension
class ZapClient {
  constructor() {
    this.socket = null;
    this.myId = 'cli/dev-bridge';
    this.connected = false;
    this.pendingRequests = new Map(); // requestId -> { resolve, reject }
    this.browserNodeId = null;
  }

  async connect() {
    return new Promise((resolve, reject) => {
      this.socket = net.connect(ZAP_SOCK);

      this.socket.on('connect', () => {
        // Send HELLO
        this.socket.write(encodeFrame(1, this.myId, '', encodeHello(0, 'hanzo', [])));
      });

      this.socket.on('data', (data) => {
        const frame = decodeFrame(new Uint8Array(data));
        if (frame.t === 2) { // WELCOME
          this.myId = frame.to;
          this.connected = true;
          // Discover browser node
          this.socket.write(encodeFrame(3, this.myId, ''));
          resolve();
        } else if (frame.t === 4) { // PROVIDERS
          const list = decodeProviders(frame.payload);
          const browserNode = list.find(p => p.id.startsWith('browser/'));
          if (browserNode) {
            this.browserNodeId = browserNode.id;
            console.log(`[Bridge] Discovered browser node: ${this.browserNodeId}`);
          }
        } else if (frame.t === 17) { // RESPONSE
          const text = dec.decode(frame.payload);
          const pending = this.pendingRequests.get('current');
          if (pending) {
            this.pendingRequests.delete('current');
            pending.resolve(text);
          }
        } else if (frame.t === 7) { // ERROR
          const errText = dec.decode(frame.payload);
          const pending = this.pendingRequests.get('current');
          if (pending) {
            this.pendingRequests.delete('current');
            pending.reject(new Error(errText));
          }
        }
      });

      this.socket.on('error', (err) => {
        this.connected = false;
        reject(err);
      });

      this.socket.on('close', () => {
        this.connected = false;
      });
    });
  }

  async sendBrowserCommand(method, params = {}, timeoutMs = 60000) {
    if (!this.connected) {
      await this.connect();
    }

    if (!this.browserNodeId) {
      // Query providers again
      this.socket.write(encodeFrame(3, this.myId, ''));
      await new Promise(r => setTimeout(r, 200));
    }

    const targetNode = this.browserNodeId || 'browser/dgx/chrome-c71c';

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pendingRequests.delete('current');
        reject(new Error(`ZAP command '${method}' timed out after ${timeoutMs}ms`));
      }, timeoutMs);

      this.pendingRequests.set('current', {
        resolve: (val) => { clearTimeout(timer); resolve(val); },
        reject: (err) => { clearTimeout(timer); reject(err); }
      });

      // Send ROUTE frame (type 16)
      this.socket.write(encodeFrame(16, this.myId, targetNode, encodeCmd(method, params)));
    });
  }
}

const zap = new ZapClient();

const server = http.createServer(async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    res.writeHead(200);
    return res.end();
  }

  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);

  // Status check
  if (url.pathname === '/' || url.pathname === '/status') {
    let session = null;
    try {
      const rawSession = await zap.sendBrowserCommand('chatgpt.session', {}, 3000);
      session = JSON.parse(rawSession);
    } catch {}

    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({
      status: 'ok',
      service: 'hanzo-extension-bridge',
      active_model: 'chatgpt-web',
      zap_connected: zap.connected,
      browser_node: zap.browserNodeId,
      session
    }));
  }

  // Model list
  if (url.pathname === '/v1/models') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    const modelsList = [
      {
        slug: 'chatgpt-web',
        display_name: 'ChatGPT Web (Plus)',
        description: 'Connected ChatGPT Plus browser session',
        supported_reasoning_levels: [],
        shell_type: 'standard',
        visibility: 'list',
        supported_in_api: true,
        priority: 1,
        support_verbosity: false
      },
      {
        slug: 'ext',
        display_name: 'Extension Active Model',
        description: 'Active session in Hanzo extension',
        supported_reasoning_levels: [],
        shell_type: 'standard',
        visibility: 'list',
        supported_in_api: true,
        priority: 2,
        support_verbosity: false
      },
      {
        slug: 'enso-auto',
        display_name: 'Enso Auto (Extension)',
        description: 'Enso Auto routed via extension',
        supported_reasoning_levels: [],
        shell_type: 'standard',
        visibility: 'list',
        supported_in_api: true,
        priority: 3,
        support_verbosity: false
      }
    ];
    return res.end(JSON.stringify({
      object: 'list',
      data: modelsList.map(m => ({ id: m.slug, object: 'model', owned_by: 'hanzo-extension' })),
      models: modelsList
    }));
  }

  // Responses API endpoint (for dev / codex-core wire_api = "responses")
  if (url.pathname === '/v1/responses') {
    if (req.method !== 'POST') {
      res.writeHead(405, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ error: { message: 'Method not allowed' } }));
    }

    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', async () => {
      try {
        const payload = JSON.parse(body || '{}');

        // Extract prompt and history from payload.input or payload.messages
        let prompt = '';
        const messages = [];

        if (Array.isArray(payload.input)) {
          for (const item of payload.input) {
            if (item.type === 'message') {
              let text = '';
              if (typeof item.content === 'string') {
                text = item.content;
              } else if (Array.isArray(item.content)) {
                text = item.content
                  .map(c => (typeof c === 'string' ? c : c.text || c.input_text || ''))
                  .filter(Boolean)
                  .join('\n');
              }
              if (text) {
                messages.push({ role: item.role || 'user', content: text });
                if (item.role === 'user') prompt = text;
              }
            } else if (item.type === 'function_call_output') {
              messages.push({ role: 'tool', content: String(item.output || '') });
            }
          }
        } else if (Array.isArray(payload.messages)) {
          for (const m of payload.messages) {
            messages.push(m);
            if (m.role === 'user') prompt = typeof m.content === 'string' ? m.content : JSON.stringify(m.content);
          }
        }

        if (!prompt && messages.length > 0) {
          prompt = messages[messages.length - 1].content;
        }

        console.log(`[Bridge /v1/responses] Prompt received (${prompt.length} chars). Dispatching to ChatGPT Plus in Chrome...`);

        const rawResponse = await zap.sendBrowserCommand('chatgpt.complete', {
          prompt,
          messages: JSON.stringify(messages)
        }, 90000);

        let resultText = '';
        try {
          const parsed = JSON.parse(rawResponse);
          resultText = parsed.content || parsed.result?.content || parsed.message || rawResponse;
        } catch {
          resultText = rawResponse;
        }

        console.log(`[Bridge /v1/responses] ChatGPT completed response (${resultText.length} chars)`);

        const respId = `resp-${Date.now()}`;
        const msgId = `msg-${Date.now()}`;

        res.writeHead(200, {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          'Connection': 'keep-alive'
        });

        // 1. response.created
        res.write(`event: response.created\ndata: ${JSON.stringify({
          type: 'response.created',
          response: { id: respId, model: 'chatgpt-web' }
        })}\n\n`);

        // 2. response.output_item.done
        res.write(`event: response.output_item.done\ndata: ${JSON.stringify({
          type: 'response.output_item.done',
          item: {
            type: 'message',
            role: 'assistant',
            id: msgId,
            content: [{ type: 'output_text', text: resultText }]
          }
        })}\n\n`);

        // 3. response.completed
        res.write(`event: response.completed\ndata: ${JSON.stringify({
          type: 'response.completed',
          response: {
            id: respId,
            usage: {
              input_tokens: Math.ceil(prompt.length / 4),
              output_tokens: Math.ceil(resultText.length / 4),
              total_tokens: Math.ceil((prompt.length + resultText.length) / 4)
            }
          }
        })}\n\n`);

        res.end();
      } catch (err) {
        console.error('[Bridge /v1/responses] Error handling responses request:', err.message);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({
          error: {
            message: err.message || 'Bridge error',
            type: 'bridge_error'
          }
        }));
      }
    });
    return;
  }

  // Chat completions endpoint
  if (url.pathname === '/v1/chat/completions') {
    if (req.method !== 'POST') {
      res.writeHead(405, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ error: { message: 'Method not allowed' } }));
    }

    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', async () => {
      try {
        const payload = JSON.parse(body || '{}');
        const messages = payload.messages || [];
        const isStream = Boolean(payload.stream);

        // Extract last user prompt
        const lastUserMsg = [...messages].reverse().find(m => m.role === 'user');
        const prompt = lastUserMsg ? (typeof lastUserMsg.content === 'string' ? lastUserMsg.content : JSON.stringify(lastUserMsg.content)) : '';

        console.log(`[Bridge] Prompt received (${prompt.length} chars). Dispatching to ChatGPT Plus in Chrome...`);

        const rawResponse = await zap.sendBrowserCommand('chatgpt.complete', {
          prompt,
          messages: JSON.stringify(messages)
        }, 90000);

        let resultText = '';
        try {
          const parsed = JSON.parse(rawResponse);
          resultText = parsed.content || parsed.result?.content || parsed.message || rawResponse;
        } catch {
          resultText = rawResponse;
        }

        console.log(`[Bridge] ChatGPT completed response (${resultText.length} chars)`);

        const completionId = `chatcmpl-ext-${Date.now()}`;
        const created = Math.floor(Date.now() / 1000);

        if (isStream) {
          res.writeHead(200, {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache',
            'Connection': 'keep-alive'
          });

          // Send content delta
          const chunk = {
            id: completionId,
            object: 'chat.completion.chunk',
            created,
            model: 'chatgpt-web',
            choices: [
              {
                index: 0,
                delta: { content: resultText },
                finish_reason: null
              }
            ]
          };
          res.write(`data: ${JSON.stringify(chunk)}\n\n`);

          // Send finish stop
          const finishChunk = {
            id: completionId,
            object: 'chat.completion.chunk',
            created,
            model: 'chatgpt-web',
            choices: [
              {
                index: 0,
                delta: {},
                finish_reason: 'stop'
              }
            ]
          };
          res.write(`data: ${JSON.stringify(finishChunk)}\n\n`);
          res.write('data: [DONE]\n\n');
          return res.end();
        } else {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          return res.end(JSON.stringify({
            id: completionId,
            object: 'chat.completion',
            created,
            model: 'chatgpt-web',
            choices: [
              {
                index: 0,
                message: {
                  role: 'assistant',
                  content: resultText
                },
                finish_reason: 'stop'
              }
            ],
            usage: {
              prompt_tokens: prompt.length / 4 | 0,
              completion_tokens: resultText.length / 4 | 0,
              total_tokens: (prompt.length + resultText.length) / 4 | 0
            }
          }));
        }
      } catch (err) {
        console.error('[Bridge] Error handling completion:', err.message);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({
          error: {
            message: err.message || 'Bridge error',
            type: 'bridge_error'
          }
        }));
      }
    });
    return;
  }

  res.writeHead(404, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: { message: 'Not found' } }));
});

// Start listening and connect to ZAP
server.listen(PORT, '127.0.0.1', async () => {
  console.log(`[Hanzo Bridge] Listening on http://127.0.0.1:${PORT}/v1`);
  try {
    await zap.connect();
    console.log(`[Hanzo Bridge] Connected to ZAP router on ${ZAP_SOCK}`);
  } catch (e) {
    console.warn(`[Hanzo Bridge] ZAP connect warning:`, e.message);
  }
});
