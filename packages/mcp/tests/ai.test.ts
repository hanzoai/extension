import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

vi.hoisted(() => {
  delete process.env.API_URL;
  process.env.HANZO_API_KEY = 'sk-test';
});

import { llmRouterTool, spawnAgentTool } from '../src/orchestration/agent-tools';
import { apiTool } from '../src/tools/hanzo-cloud';
import { thinkTool } from '../src/tools/think';

// Every model is reached through the gateway; each row is the one request an action makes.
const V1 = 'https://api.hanzo.ai/v1';
type Call = [url: string, model: unknown];

let calls: Call[];

beforeEach(() => {
  calls = [];
  vi.stubGlobal('fetch', vi.fn(async (url: string, init: any = {}) => {
    const body = init.body === undefined ? {} : JSON.parse(init.body);
    expect(init.headers.Authorization).toBe('Bearer sk-test');
    calls.push([url, body.model]);
    return new Response(JSON.stringify({ choices: [{ message: { content: 'ok' } }], data: [{ embedding: [0.5] }] }));
  }));
});

const api: Array<[Record<string, unknown>, Call[]]> = [
  [{ action: 'chat', message: 'hi' }, [[`${V1}/chat/completions`, 'zen5']]],
  [{ action: 'chat', message: 'hi', model: 'zen5-pro' }, [[`${V1}/chat/completions`, 'zen5-pro']]],
  [{ action: 'embeddings', input: 'hi' }, [[`${V1}/embeddings`, 'zen-embedding']]],
  [{ action: 'images', prompt: 'a cat', model: 'img' }, [[`${V1}/images/generations`, 'img']]],
  [{ action: 'audio', input: 'hi', model: 'voice' }, [[`${V1}/audio/speech`, 'voice']]],
];

describe('api tool', () => {
  it.each(api)('%o', async (args, want) => {
    const res = await apiTool.handler(args);
    expect(res.isError).toBeUndefined();
    expect(calls).toEqual(want);
  });

  // /v1/models lists no image or speech model, so there is none to default to.
  it.each(['images', 'audio'])('%s names its model or sends nothing', async (action) => {
    const res = await apiTool.handler({ action, prompt: 'x', input: 'x' });
    expect(res.isError).toBe(true);
    expect(calls).toEqual([]);
  });

  it('offers only actions the gateway serves', () => {
    expect((apiTool.inputSchema as any).properties.action.enum).toEqual(['models', 'chat', 'embeddings', 'images', 'audio', 'usage', 'health']);
  });
});

const think: Array<[Record<string, unknown>, Call[]]> = [
  [{ action: 'agent', task: 't' }, [[`${V1}/chat/completions`, 'zen5']]],
  [{ action: 'summarize', text: 't' }, [[`${V1}/chat/completions`, 'zen5']]],
  [{ action: 'agent', task: 't', model: 'zen5-coder' }, [[`${V1}/chat/completions`, 'zen5-coder']]],
  [{ action: 'consensus', question: 'q' }, [[`${V1}/chat/completions`, 'zen5'], [`${V1}/chat/completions`, 'zen5-pro']]],
  [{ action: 'embed', text: 't' }, [[`${V1}/embeddings`, 'zen-embedding']]],
];

describe('think tool', () => {
  it.each(think)('%o', async (args, want) => {
    const res = await thinkTool.handler(args);
    expect(res.isError).toBeUndefined();
    expect(calls).toEqual(want);
  });
});

describe('orchestration', () => {
  it('spawns agents on zen5 and invents no fallback chain', () => {
    expect((spawnAgentTool.inputSchema as any).properties.model.default).toBe('zen5');
    expect((llmRouterTool.inputSchema as any).properties.fallbackChain.default).toBeUndefined();
  });
});

describe('no upstream provider', () => {
  const upstream = /api\.openai\.com|api\.anthropic\.com|generativelanguage\.googleapis\.com|api\.cohere\.(ai|com)|api\.mistral\.ai|api\.groq\.com|api\.together\.(xyz|ai)|api\.replicate\.com|OPENAI_API_KEY|ANTHROPIC_API_KEY/;
  const files = (dir: string): string[] => fs.readdirSync(dir, { withFileTypes: true }).flatMap(e =>
    e.isDirectory() ? files(path.join(dir, e.name)) : /\.ts$/.test(e.name) ? [path.join(dir, e.name)] : []);

  it('is named in src', () => {
    const src = path.resolve(__dirname, '../src');
    const scanned = files(src);
    expect(scanned).toContain(path.join(src, 'tools', 'think.ts'));
    expect(scanned.filter(f => upstream.test(fs.readFileSync(f, 'utf8'))).map(f => path.relative(src, f))).toEqual([]);
  });
});
