import { describe, it, expect, vi, beforeEach } from 'vitest';

// The parts of the vscode API @hanzo touches; lm is what each test steers.
const lm = vi.hoisted(() => ({
  tools: [] as { name: string; description: string; inputSchema: object; tags: string[] }[],
  invokeTool: undefined as unknown as (name: string, options: any) => Promise<{ content: unknown[] }>,
  selectChatModels: undefined as unknown as (selector: object) => Promise<unknown[]>,
}));

vi.mock('vscode', () => {
  class LanguageModelTextPart { constructor(public value: string) {} }
  class LanguageModelToolCallPart { constructor(public callId: string, public name: string, public input: object) {} }
  class LanguageModelToolResultPart { constructor(public callId: string, public content: unknown[]) {} }
  const message = (role: string) => (content: unknown) => ({ role, content });
  return {
    LanguageModelTextPart,
    LanguageModelToolCallPart,
    LanguageModelToolResultPart,
    LanguageModelChatMessage: { User: message('user'), Assistant: message('assistant') },
    ChatRequestTurn: class {},
    ChatResponseMarkdownPart: class {},
    lm,
    workspace: { getConfiguration: () => ({ get: (_key: string, fallback: unknown) => fallback }) },
  };
});

import * as vscode from 'vscode';
import { handle } from '../../chat/hanzo-chat-participant';

/** A model that answers each request with the next list of parts, and records what it was sent. */
function model(vendor: string, ...turns: unknown[][]) {
  const sent: { messages: any[]; tools: unknown }[] = [];
  return {
    vendor,
    sent,
    sendRequest: async (messages: any[], options: { tools: unknown }) => {
      sent.push({ messages: [...messages], tools: options.tools });
      const parts = turns.shift() ?? [];
      return { stream: (async function* () { yield* parts; })() };
    },
  };
}

const token = { isCancellationRequested: false } as any;
const context = { history: [] } as any;

let markdown: string[];
const stream = { markdown: (value: string) => markdown.push(value) } as any;

beforeEach(() => {
  markdown = [];
  lm.tools = [
    { name: 'mcp_hanzo_fs', description: 'Files', inputSchema: { type: 'object' }, tags: ['mcp'] },
    { name: 'copilot_readFile', description: 'Read', inputSchema: { type: 'object' }, tags: [] },
  ];
});

describe('@hanzo', () => {
  it('calls the MCP tools the model asks for and answers once the model stops calling', async () => {
    const zen = model('hanzo',
      [new vscode.LanguageModelToolCallPart('c1', 'mcp_hanzo_fs', { path: '/a' })],
      [new vscode.LanguageModelTextPart('It says alpha.')],
    );
    const invoked: unknown[] = [];
    lm.invokeTool = async (name, options) => {
      invoked.push([name, options]);
      return { content: [new vscode.LanguageModelTextPart('alpha')] };
    };

    await handle({ prompt: 'read /a', model: zen, toolInvocationToken: 'turn-1' } as any, context, stream, token);

    expect(invoked).toEqual([['mcp_hanzo_fs', { input: { path: '/a' }, toolInvocationToken: 'turn-1' }]]);
    expect(zen.sent[0].tools).toEqual([{ name: 'mcp_hanzo_fs', description: 'Files', inputSchema: { type: 'object' } }]);
    expect(zen.sent[1].messages.slice(-2)).toEqual([
      { role: 'assistant', content: [new vscode.LanguageModelToolCallPart('c1', 'mcp_hanzo_fs', { path: '/a' })] },
      { role: 'user', content: [new vscode.LanguageModelToolResultPart('c1', [new vscode.LanguageModelTextPart('alpha')])] },
    ]);
    expect(markdown).toEqual(['It says alpha.']);
  });

  it('hands a failed tool call back to the model', async () => {
    const zen = model('hanzo', [new vscode.LanguageModelToolCallPart('c1', 'mcp_hanzo_fs', {})], []);
    lm.invokeTool = async () => { throw new Error('denied'); };

    await handle({ prompt: 'go', model: zen, toolInvocationToken: 't' } as any, context, stream, token);

    expect(zen.sent[1].messages.at(-1).content).toEqual([
      new vscode.LanguageModelToolResultPart('c1', [new vscode.LanguageModelTextPart('mcp_hanzo_fs failed: denied')]),
    ]);
  });

  it('runs on the Hanzo default when the chat view picked another vendor', async () => {
    const zen = model('hanzo', [new vscode.LanguageModelTextPart('hi')]);
    const selectors: unknown[] = [];
    lm.selectChatModels = async selector => { selectors.push(selector); return [zen]; };

    await handle({ prompt: 'hi', model: model('copilot'), toolInvocationToken: 't' } as any, context, stream, token);

    expect(selectors).toEqual([{ vendor: 'hanzo', id: 'zen5' }]);
    expect(zen.sent).toHaveLength(1);
  });
});
