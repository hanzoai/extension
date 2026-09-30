import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// The parts of the vscode API the model provider touches.
vi.mock('vscode', () => {
  class LanguageModelTextPart { constructor(public value: string) {} }
  class LanguageModelToolCallPart { constructor(public callId: string, public name: string, public input: object) {} }
  class LanguageModelToolResultPart { constructor(public callId: string, public content: unknown[]) {} }
  return {
    LanguageModelTextPart,
    LanguageModelToolCallPart,
    LanguageModelToolResultPart,
    LanguageModelChatMessageRole: { User: 1, Assistant: 2 },
    LanguageModelChatToolMode: { Auto: 1, Required: 2 },
  };
});

import * as vscode from 'vscode';
import { stream } from '../../api/chat';
import { Models, wire } from '../../lm/models';

const auth = { bearer: async () => 'tok', onDidChange: () => ({ dispose() {} }) } as any;
const token = { isCancellationRequested: false, onCancellationRequested: () => ({ dispose() {} }) } as any;

/** A body that arrives as these chunks, the way a socket splits server-sent events. */
function chunked(...chunks: string[]): Response {
  const encoder = new TextEncoder();
  return new Response(new ReadableStream({
    start(controller) {
      chunks.forEach(chunk => controller.enqueue(encoder.encode(chunk)));
      controller.close();
    },
  }));
}

const event = (delta: object) => `data: ${JSON.stringify({ choices: [{ delta }] })}\n\n`;

let requests: { url: string; auth: string | null; body: any }[];

beforeEach(() => {
  requests = [];
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function answer(respond: () => Response) {
  vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit = {}) => {
    requests.push({ url, auth: new Headers(init.headers).get('Authorization'), body: init.body ? JSON.parse(String(init.body)) : undefined });
    return respond();
  }));
}

describe('stream', () => {
  it('hands text on as it arrives and each tool call once its arguments are whole', async () => {
    const whole = event({ content: 'Look' }) + event({ content: 'ing.' })
      + event({ tool_calls: [{ index: 0, id: 'c1', type: 'function', function: { name: 'mcp_hanzo_fs', arguments: '{"path":' } }] })
      + event({ tool_calls: [{ index: 0, function: { arguments: '"/a"}' } }] })
      + 'data: [DONE]\n\n';
    // Split mid-event, so a line is carried across reads.
    answer(() => chunked(whole.slice(0, 37), whole.slice(37, 150), whole.slice(150)));
    const text: string[] = [];
    const calls: unknown[] = [];
    await stream('tok', { model: 'zen5', messages: [] }, { text: v => text.push(v), call: (...c) => calls.push(c) });

    expect(text.join('')).toBe('Looking.');
    expect(calls).toEqual([['c1', 'mcp_hanzo_fs', { path: '/a' }]]);
    expect(requests).toEqual([{ url: 'https://api.hanzo.ai/v1/chat/completions', auth: 'Bearer tok', body: { model: 'zen5', messages: [], stream: true } }]);
  });

  it('refuses without a bearer and names the status api.hanzo.ai answered', async () => {
    const sink = { text() {}, call() {} };
    await expect(stream(undefined, {}, sink)).rejects.toThrow('Sign in to Hanzo AI');
    answer(() => new Response('quota', { status: 429 }));
    await expect(stream('tok', {}, sink)).rejects.toThrow('api.hanzo.ai answered 429: quota');
  });
});

describe('Models', () => {
  it('lists the Hanzo models that answer in text, with the catalog window or the gateway floor', async () => {
    answer(() => Response.json({ object: 'list', data: [
      { id: 'zen5', owned_by: 'hanzo', context_window: 1_000_000 },
      { id: 'zen5-coder', owned_by: 'hanzo', outputs: ['text'], max_output_tokens: 65_536 },
      { id: 'kai', owned_by: 'hanzo', outputs: ['decision'] },
      { id: 'gpt-4o', owned_by: 'openai' },
    ] }));
    const models = await new Models(auth).provideLanguageModelChatInformation({ silent: true }, token);

    expect(requests[0]).toMatchObject({ url: 'https://api.hanzo.ai/v1/models', auth: 'Bearer tok' });
    expect(models).toEqual([
      { id: 'zen5', name: 'zen5', family: 'zen5', version: 'zen5', maxInputTokens: 1_000_000, maxOutputTokens: 32_768, capabilities: { toolCalling: true } },
      { id: 'zen5-coder', name: 'zen5-coder', family: 'zen5-coder', version: 'zen5-coder', maxInputTokens: 131_072, maxOutputTokens: 65_536, capabilities: { toolCalling: true } },
    ]);
  });

  it('sends the tools VS Code offers and reports text and tool calls as parts', async () => {
    answer(() => chunked(event({ content: 'ok' }), event({ tool_calls: [{ index: 0, id: 'c1', function: { name: 'read', arguments: '{}' } }] })));
    const parts: unknown[] = [];
    await new Models(auth).provideLanguageModelChatResponse(
      { id: 'zen5' } as any,
      [{ role: 1, content: [new vscode.LanguageModelTextPart('hi')], name: undefined }],
      { tools: [{ name: 'read', description: 'Read a file', inputSchema: { type: 'object' } }], toolMode: vscode.LanguageModelChatToolMode.Required },
      { report: (part: unknown) => parts.push(part) },
      token,
    );

    expect(requests[0].body).toEqual({
      model: 'zen5',
      messages: [{ role: 'user', content: 'hi' }],
      tools: [{ type: 'function', function: { name: 'read', description: 'Read a file', parameters: { type: 'object' } } }],
      tool_choice: 'required',
      stream: true,
    });
    expect(parts).toEqual([new vscode.LanguageModelTextPart('ok'), new vscode.LanguageModelToolCallPart('c1', 'read', {})]);
  });
});

describe('wire', () => {
  it('puts each tool result right after the call it answers, ahead of the user text that carried it', () => {
    const { LanguageModelTextPart: Text, LanguageModelToolCallPart: Call, LanguageModelToolResultPart: Result } = vscode;
    expect(wire([
      { role: 3 as any, content: [new Text('Be brief.')], name: undefined },
      { role: 1, content: [new Text('Read '), new Text('/a')], name: undefined },
      { role: 2, content: [new Call('c1', 'read', { path: '/a' })], name: undefined },
      { role: 1, content: [new Result('c1', [new Text('alpha')]), new Text('Now summarize.')], name: undefined },
      { role: 2, content: [new Text('Alpha.')], name: undefined },
    ])).toEqual([
      { role: 'system', content: 'Be brief.' },
      { role: 'user', content: 'Read /a' },
      { role: 'assistant', content: null, tool_calls: [{ id: 'c1', type: 'function', function: { name: 'read', arguments: '{"path":"/a"}' } }] },
      { role: 'tool', tool_call_id: 'c1', content: 'alpha' },
      { role: 'user', content: 'Now summarize.' },
      { role: 'assistant', content: 'Alpha.' },
    ]);
  });
});
