import { describe, it, expect } from 'vitest';
import { loadGs } from './loadGs.mjs';

const {
  API_BASE_URL,
  DEFAULT_MODEL,
  chatCompletionsURL,
  modelsURL,
  buildMessages,
  requestBody,
  extractContent,
  parseModels,
} = loadGs('src/hanzo.gs');

describe('gateway endpoints', () => {
  it('chat + models go through api.hanzo.ai/v1 — no /api/ prefix, no v2', () => {
    expect(API_BASE_URL).toBe('https://api.hanzo.ai');
    expect(chatCompletionsURL()).toBe('https://api.hanzo.ai/v1/chat/completions');
    expect(modelsURL()).toBe('https://api.hanzo.ai/v1/models');
    expect(chatCompletionsURL()).not.toContain('/api/');
    expect(chatCompletionsURL()).not.toContain('/v2/');
  });
});

describe('buildMessages', () => {
  it('pure generation when no selection', () => {
    const m = buildMessages('draft an NDA clause', '');
    expect(m[0].role).toBe('system');
    expect(m[1].role).toBe('user');
    expect(m[1].content).toBe('draft an NDA clause');
  });

  it('fences the selection as data when present', () => {
    const m = buildMessages('rewrite formally', 'hey wanna sign this');
    expect(m[1].content).toContain('rewrite formally');
    expect(m[1].content).toContain('---- selected text ----');
    expect(m[1].content).toContain('hey wanna sign this');
  });

  it('tolerates undefined/whitespace selection as pure generation', () => {
    expect(buildMessages('x', undefined)[1].content).toBe('x');
    expect(buildMessages('x', '   ')[1].content).toBe('x');
  });

  it('system prompt forbids markdown fences / preamble', () => {
    expect(buildMessages('x', '')[0].content.toLowerCase()).toContain('only the text');
  });
});

describe('requestBody', () => {
  it('defaults the model and forces stream:false (Apps Script has no SSE)', () => {
    const b = requestBody(buildMessages('x', ''));
    expect(b.model).toBe(DEFAULT_MODEL);
    expect(DEFAULT_MODEL).toBe('zen5');
    expect(b.stream).toBe(false);
    expect(Array.isArray(b.messages)).toBe(true);
  });
  it('passes an explicit model + temperature through', () => {
    const b = requestBody(buildMessages('x', ''), { model: 'zen5-pro', temperature: 0.2 });
    expect(b.model).toBe('zen5-pro');
    expect(b.temperature).toBe(0.2);
  });
  it('never streams even when asked (contract: one-shot only)', () => {
    expect(requestBody(buildMessages('x', ''), { stream: true }).stream).toBe(false);
  });
});

describe('extractContent', () => {
  it('reads OpenAI choices[0].message.content', () => {
    expect(extractContent({ choices: [{ message: { content: 'hello' } }] })).toBe('hello');
  });
  it('tolerates choices[0].text and bare content', () => {
    expect(extractContent({ choices: [{ text: 'a' }] })).toBe('a');
    expect(extractContent({ content: 'b' })).toBe('b');
  });
  it('throws on an error payload with the gateway message', () => {
    expect(() => extractContent({ error: { message: 'rate limited' } })).toThrow(/rate limited/);
    expect(() => extractContent({ error: 'bad key' })).toThrow(/bad key/);
  });
  it('throws when there is no content', () => {
    expect(() => extractContent({ choices: [{}] })).toThrow(/no content/);
  });
});

describe('parseModels', () => {
  it('reads ids from a {data:[…]} response', () => {
    expect(parseModels({ data: [{ id: 'zen5' }, { id: 'zen5-pro' }] })).toEqual(['zen5', 'zen5-pro']);
  });
  it('tolerates {models:[…]} and a bare string array', () => {
    expect(parseModels({ models: [{ id: 'a' }] })).toEqual(['a']);
    expect(parseModels(['x', 'y'])).toEqual(['x', 'y']);
  });
  it('drops empty / non-string ids', () => {
    expect(parseModels({ data: [{ id: '' }, {}, { id: 'ok' }] })).toEqual(['ok']);
  });
  it('empty on a shapeless response', () => {
    expect(parseModels({})).toEqual([]);
    expect(parseModels(null)).toEqual([]);
  });
});
