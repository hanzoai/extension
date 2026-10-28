#!/usr/bin/env node
/**
 * Hanzo Browser Extension CLI Bridge
 * 
 * Exposes an OpenAI-compatible HTTP endpoint at http://127.0.0.1:3695/v1
 * that dynamically routes inference through whatever model is currently active
 * in the Hanzo Browser Extension (ChatGPT Plus, Claude Web, Spark, Evo, Zen5).
 * 
 * Usage:
 *   node packages/browser/src/cli-bridge.mjs
 *   dev --ext
 */

import http from 'http';
import WebSocket from 'ws';

const PORT = 3695;
const CDP_HTTP = 'http://127.0.0.1:9222';
const EXT_ID = 'biingenefmanpecedoafkfajbnlgdmbl';

// Helper to query CDP endpoints
async function getCdpTargets() {
  try {
    const res = await fetch(`${CDP_HTTP}/json`);
    if (!res.ok) return [];
    return await res.json();
  } catch {
    return [];
  }
}

// Helper to execute code in extension background or tab via CDP
async function evalInTarget(targetWsUrl, expression) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(targetWsUrl);
    const id = Math.floor(Math.random() * 100000);
    const timeout = setTimeout(() => {
      ws.close();
      reject(new Error('CDP evaluation timed out'));
    }, 120000);

    ws.on('open', () => {
      ws.send(JSON.stringify({
        id,
        method: 'Runtime.evaluate',
        params: {
          expression,
          awaitPromise: true,
          returnByValue: true
        }
      }));
    });

    ws.on('message', (data) => {
      try {
        const msg = JSON.parse(data.toString());
        if (msg.id === id) {
          clearTimeout(timeout);
          ws.close();
          if (msg.error) {
            reject(new Error(msg.error.message));
          } else if (msg.result?.exceptionDetails) {
            reject(new Error(msg.result.exceptionDetails.text || 'CDP exception'));
          } else {
            resolve(msg.result?.result?.value);
          }
        }
      } catch (err) {
        clearTimeout(timeout);
        ws.close();
        reject(err);
      }
    });

    ws.on('error', (err) => {
      clearTimeout(timeout);
      reject(err);
    });
  });
}

// Get the active model from extension storage
async function getActiveExtensionModel() {
  const targets = await getCdpTargets();
  const bgTarget = targets.find(t => 
    (t.url && t.url.includes(EXT_ID)) || 
    (t.title && t.title.includes('Hanzo'))
  );

  if (!bgTarget || !bgTarget.webSocketDebuggerUrl) {
    return 'chatgpt-web'; // default fallback
  }

  try {
    const model = await evalInTarget(
      bgTarget.webSocketDebuggerUrl,
      `chrome.storage.local.get('hanzo_selected_model').then(r => r.hanzo_selected_model || 'chatgpt-web')`
    );
    return model || 'chatgpt-web';
  } catch {
    return 'chatgpt-web';
  }
}

// Execute invisible prompt via extension temporary chat
async function completeViaExtension(prompt, messages = []) {
  const targets = await getCdpTargets();
  const bgTarget = targets.find(t => 
    (t.url && t.url.includes(EXT_ID)) || 
    (t.title && t.title.includes('Hanzo'))
  );

  if (!bgTarget || !bgTarget.webSocketDebuggerUrl) {
    throw new Error('Hanzo extension is not reachable via CDP on port 9222');
  }

  const encodedPrompt = JSON.stringify(prompt);
  const encodedMessages = JSON.stringify(messages);

  const code = `
    (async () => {
      const { executeInvisibleChatGpt } = await import(chrome.runtime.getURL('shared/chatgpt-web.js'));
      return await executeInvisibleChatGpt(${encodedPrompt}, ${encodedMessages});
    })()
  `;

  return await evalInTarget(bgTarget.webSocketDebuggerUrl, code);
}

const server = http.createServer(async (req, res) => {
  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    res.writeHead(200);
    return res.end();
  }

  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);

  // Health / status check
  if (url.pathname === '/' || url.pathname === '/status') {
    const activeModel = await getActiveExtensionModel();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({
      status: 'ok',
      service: 'hanzo-extension-bridge',
      active_model: activeModel,
      endpoint: `http://127.0.0.1:${PORT}/v1`
    }));
  }

  // Model list
  if (url.pathname === '/v1/models') {
    const activeModel = await getActiveExtensionModel();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({
      object: 'list',
      data: [
        { id: 'active', object: 'model', owned_by: 'hanzo-extension', active_model: activeModel },
        { id: 'ext', object: 'model', owned_by: 'hanzo-extension' },
        { id: 'chatgpt-web', object: 'model', owned_by: 'openai' },
        { id: 'claude-web', object: 'model', owned_by: 'anthropic' },
        { id: 'hanzo-spark', object: 'model', owned_by: 'hanzo' },
        { id: 'hanzo-evo', object: 'model', owned_by: 'hanzo' },
        { id: 'zen5-coder', object: 'model', owned_by: 'hanzo' }
      ]
    }));
  }

  // Chat completions
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

        const activeModel = await getActiveExtensionModel();
        console.log(`[Bridge] Dispatching prompt to active extension model: ${activeModel}`);

        const resultText = await completeViaExtension(prompt, messages);

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
            model: activeModel,
            choices: [
              {
                index: 0,
                delta: { content: resultText },
                finish_reason: null
              }
            ]
          };
          res.write(`data: ${JSON.stringify(chunk)}\n\n`);

          // Send finish reason
          const finishChunk = {
            id: completionId,
            object: 'chat.completion.chunk',
            created,
            model: activeModel,
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
            model: activeModel,
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
        console.error('[Bridge] Error handling chat completion:', err);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({
          error: {
            message: err.message || 'Internal bridge error',
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

server.listen(PORT, '127.0.0.1', () => {
  console.log(`[Hanzo Bridge] Running at http://127.0.0.1:${PORT}/v1`);
  console.log(`[Hanzo Bridge] Ready for 'dev --ext' or 'hanzo dev --ext'`);
});
