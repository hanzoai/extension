import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

// The tools read settings through vscode; each test sets what it needs here.
const settings = new Map<string, unknown>();
vi.mock('vscode', () => ({
  EventEmitter: class { event = () => ({ dispose() {} }); fire() {} },
  workspace: {
    getConfiguration: (section: string) => ({
      get: (key: string, fallback?: unknown) => settings.has(`${section}.${key}`) ? settings.get(`${section}.${key}`) : fallback,
    }),
  },
}));

import { complete, MODEL } from '../../api/chat';
import { encode, SECRET } from '../../auth/iam';
import { AuthManager } from '../../auth/manager';
import { AITools } from '../../mcp/tools/ai-tools';
import { createLLMTools } from '../../mcp/tools/llm';
import { createZenTool } from '../../mcp/tools/zen';

const GATEWAY = 'https://api.hanzo.ai/v1/chat/completions';

// One SecretStorage for the AuthManager singleton, shared by every test.
const secrets = new Map<string, string>();
const context = {
  secrets: {
    get: async (k: string) => secrets.get(k),
    store: async (k: string, v: string) => { secrets.set(k, v); },
    delete: async (k: string) => { secrets.delete(k); },
  },
  globalState: { get: (_k: string, d?: unknown) => d, update: async () => undefined },
} as any;

interface Call { url: string; auth: string | null; body: any }
let calls: Call[];

beforeEach(() => {
  calls = [];
  settings.clear();
  secrets.clear();
  vi.stubEnv('HANZO_API_KEY', 'sk-env');
  vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit) => {
    const body = JSON.parse(String(init.body));
    calls.push({ url, auth: new Headers(init.headers).get('Authorization'), body });
    return new Response(JSON.stringify({ choices: [{ message: { content: `reply from ${body.model}` } }] }));
  }));
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe('complete', () => {
  it('posts to api.hanzo.ai/v1/chat/completions as zen5 unless told otherwise', async () => {
    expect(MODEL).toBe('zen5');
    await expect(complete('tok', [{ role: 'user', content: 'hi' }])).resolves.toBe('reply from zen5');
    expect(calls).toEqual([{ url: GATEWAY, auth: 'Bearer tok', body: { model: 'zen5', messages: [{ role: 'user', content: 'hi' }] } }]);
  });

  it('sends the named model, temperature and max_tokens', async () => {
    await complete('tok', [{ role: 'user', content: 'hi' }], { model: 'zen5-pro', temperature: 0.2, maxTokens: 50 });
    expect(calls[0].body).toEqual({ model: 'zen5-pro', messages: [{ role: 'user', content: 'hi' }], temperature: 0.2, max_tokens: 50 });
  });

  it('refuses to send without a credential', async () => {
    await expect(complete(undefined, [{ role: 'user', content: 'hi' }])).rejects.toThrow('Hanzo: Login');
    expect(calls).toEqual([]);
  });

  it('names the status the gateway answered', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{"msg":"no"}', { status: 401 })));
    await expect(complete('tok', [{ role: 'user', content: 'hi' }])).rejects.toThrow('api.hanzo.ai answered 401');
  });
});

describe('bearer', () => {
  const auth = () => AuthManager.getInstance(context);

  it('prefers the signed-in session to any key', async () => {
    secrets.set(SECRET, encode({ access: 'iam-access' }));
    await expect(auth().bearer()).resolves.toBe('iam-access');
  });

  it('falls back to HANZO_API_KEY, then the setting', async () => {
    await expect(auth().bearer()).resolves.toBe('sk-env');
    vi.stubEnv('HANZO_API_KEY', '');
    settings.set('hanzo.llm.hanzo.apiKey', 'sk-setting');
    await expect(auth().bearer()).resolves.toBe('sk-setting');
    settings.clear();
    await expect(auth().bearer()).resolves.toBeUndefined();
  });
});

describe('tools', () => {
  const tool = (tools: { name: string; handler: (a: any) => any }[], name: string) => tools.find(t => t.name === name)!.handler;

  it('zen asks zen5 by default and offers only listed Zen 5 ids', async () => {
    const zen = createZenTool(context);
    expect((zen.inputSchema as any).properties.model.enum).toEqual(['zen5', 'zen5-flash', 'zen5-mini', 'zen5-coder', 'zen5-pro']);
    await expect(zen.handler({ prompt: 'hi', system: 'be brief' })).resolves.toBe('reply from zen5');
    expect(calls[0]).toMatchObject({ url: GATEWAY, auth: 'Bearer sk-env' });
    expect(calls[0].body.messages).toEqual([{ role: 'system', content: 'be brief' }, { role: 'user', content: 'hi' }]);
  });

  it('llm goes to the gateway as zen5, or as the model named', async () => {
    const llm = tool(createLLMTools(context), 'llm');
    await expect(llm({ prompt: 'hi' })).resolves.toBe('reply from zen5');
    await expect(llm({ prompt: 'hi', model: 'openai/gpt-4o' })).resolves.toBe('reply from openai/gpt-4o');
    expect(calls.map(c => c.url)).toEqual([GATEWAY, GATEWAY]);
  });

  it('consensus asks zen5 and zen5-pro through the gateway', async () => {
    const consensus = tool(createLLMTools(context), 'consensus');
    const text = await consensus({ prompt: 'hi' });
    expect(calls.map(c => c.body.model)).toEqual(['zen5', 'zen5-pro']);
    expect(text).toContain('reply from zen5-pro');
  });

  it('AITools routes llm and agent through the gateway as hanzo.llm.hanzo.model', async () => {
    const ai = new AITools(context);
    const schema = ai.getTools().find(t => t.name === 'llm')!.inputSchema as any;
    expect(schema.properties.provider.enum).toEqual(['hanzo', 'local']);
    await expect(tool(ai.getTools(), 'llm')({ prompt: 'hi' })).resolves.toMatchObject({ success: true, provider: 'hanzo', model: 'zen5' });
    await expect(tool(ai.getTools(), 'agent')({ task: 'review' })).resolves.toMatchObject({ success: true, result: 'reply from zen5' });
    settings.set('hanzo.llm.hanzo.model', 'zen5-coder');
    await tool(new AITools(context).getTools(), 'llm')({ prompt: 'hi' });
    expect(calls.map(c => [c.url, c.body.model])).toEqual([[GATEWAY, 'zen5'], [GATEWAY, 'zen5'], [GATEWAY, 'zen5-coder']]);
  });
});

// Every hosted model is reached through api.hanzo.ai, so no source names a provider's own API.
describe('no upstream provider', () => {
  const upstream = /api\.openai\.com|api\.anthropic\.com|generativelanguage\.googleapis\.com|api\.cohere\.(ai|com)|api\.mistral\.ai|api\.groq\.com|api\.together\.(xyz|ai)|api\.replicate\.com/;
  const root = path.resolve(__dirname, '../..');
  const files = (dir: string): string[] => fs.readdirSync(dir, { withFileTypes: true }).flatMap(e => {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {return p === path.join(root, 'test') ? [] : files(p);}
    return /\.(ts|js)$/.test(e.name) ? [p] : [];
  });

  it('appears in src or the contributed settings', () => {
    const scanned = [...files(root), path.resolve(root, '../package.json')];
    expect(scanned.map(f => path.relative(root, f))).toContain(path.join('mcp', 'tools', 'llm.ts'));
    const hits = scanned
      .filter(f => upstream.test(fs.readFileSync(f, 'utf8')))
      .map(f => path.relative(root, f));
    expect(hits).toEqual([]);
  });
});
