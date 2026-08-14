import { describe, it, expect, vi } from 'vitest';
import type { AiClient, ChatCompletionCreateParams } from '@hanzo/ai';
import {
  buildMessages,
  quickActionPrompt,
  isQuickActionId,
  messageText,
  QUICK_ACTIONS,
  SYSTEM_PROMPT,
  stream,
  complete,
  type RunInput,
} from '../src/hanzo';
import { buildContext, type TicketInput } from '../src/ticket';

function ticketInput(over: Partial<TicketInput> = {}): TicketInput {
  return {
    subject: 'Refund not received',
    requesterName: 'Grace Hopper',
    comments: [
      { value: 'I was charged twice for order #42.', author: { name: 'Grace' }, public: true },
      { value: 'Confirmed the duplicate charge.', author: { name: 'Agent' }, public: false },
    ],
    ...over,
  };
}

describe('quick-action catalog', () => {
  it('exposes the four support actions with labels + prompts', () => {
    expect(Object.keys(QUICK_ACTIONS).sort()).toEqual(
      ['draft_reply', 'explain', 'next_steps', 'summarize'].sort(),
    );
    for (const a of Object.values(QUICK_ACTIONS)) {
      expect(a.label.length).toBeGreaterThan(0);
      expect(a.prompt.length).toBeGreaterThan(0);
    }
  });

  it('isQuickActionId guards the boundary', () => {
    expect(isQuickActionId('draft_reply')).toBe(true);
    expect(isQuickActionId('nope')).toBe(false);
    // Prototype keys must not leak through.
    expect(isQuickActionId('toString')).toBe(false);
  });

  it('quickActionPrompt resolves known ids and throws on unknown', () => {
    expect(quickActionPrompt('summarize')).toBe(QUICK_ACTIONS.summarize.prompt);
    expect(() => quickActionPrompt('bogus')).toThrow(/Unknown quick action/);
  });

  it('the draft_reply prompt asks for the agent voice, reply-only, no placeholders', () => {
    const p = QUICK_ACTIONS.draft_reply.prompt.toLowerCase();
    expect(p).toContain('voice');
    expect(p).toContain('only the reply');
    expect(p).toContain('ready to send');
  });
});

describe('buildMessages (request shaping)', () => {
  const ctx = buildContext(ticketInput());

  it('is a system + single user message', () => {
    const msgs = buildMessages('Summarize', ctx);
    expect(msgs).toHaveLength(2);
    expect(msgs[0].role).toBe('system');
    expect(msgs[0].content).toBe(SYSTEM_PROMPT);
    expect(msgs[1].role).toBe('user');
  });

  it('fences the ticket context and appends the task', () => {
    const msgs = buildMessages('Draft a reply', ctx);
    const user = msgs[1].content as string;
    expect(user).toContain('Subject: Refund not received');
    expect(user).toContain('I was charged twice for order #42.');
    expect(user).toContain('---- task ----');
    expect(user).toContain('Draft a reply');
  });

  it('leads with the honest context note so the model knows its scope', () => {
    const msgs = buildMessages('x', ctx);
    const user = msgs[1].content as string;
    expect(user.startsWith('Context:')).toBe(true);
  });

  it('the system prompt keeps the model grounded and agent-voiced', () => {
    expect(SYSTEM_PROMPT.toLowerCase()).toContain('only from the ticket context');
    expect(SYSTEM_PROMPT.toLowerCase()).toContain("agent's voice");
  });
});

/** A fake AiClient that captures the params it was called with and returns a
 *  scripted stream / completion. Matches the `@hanzo/ai` surface we use. */
function fakeClient(opts: {
  chunks?: string[];
  content?: string;
  capture?: (p: ChatCompletionCreateParams) => void;
}): AiClient {
  const create = vi.fn(async (params: ChatCompletionCreateParams) => {
    opts.capture?.(params);
    if (params.stream) {
      async function* gen() {
        for (const c of opts.chunks ?? []) {
          yield {
            id: 'x',
            object: 'chat.completion.chunk' as const,
            created: 0,
            model: params.model,
            choices: [{ index: 0, delta: { content: c }, finish_reason: null }],
          };
        }
      }
      return gen();
    }
    return {
      id: 'x',
      object: 'chat.completion' as const,
      created: 0,
      model: params.model,
      choices: [
        { index: 0, message: { role: 'assistant' as const, content: opts.content ?? '' }, finish_reason: 'stop' },
      ],
    };
  });
  return { chat: { completions: { create } } } as unknown as AiClient;
}

describe('stream (reply-draft assembly over a mocked client)', () => {
  it('concatenates deltas into the final draft and streams each chunk', async () => {
    const seen: string[] = [];
    const client = fakeClient({ chunks: ['Hi Grace, ', 'we found the ', 'duplicate charge.'] });
    const input: RunInput = {
      task: quickActionPrompt('draft_reply'),
      ctx: buildContext(ticketInput()),
      token: 'sk-test',
      model: 'zen5',
      client,
    };
    const full = await stream(input, (d) => seen.push(d));
    expect(full).toBe('Hi Grace, we found the duplicate charge.');
    expect(seen).toEqual(['Hi Grace, ', 'we found the ', 'duplicate charge.']);
  });

  it('sends the right model, streams=true, and the shaped messages', async () => {
    let captured: ChatCompletionCreateParams | undefined;
    const client = fakeClient({ chunks: ['ok'], capture: (p) => (captured = p) });
    await stream(
      { task: 'Summarize', ctx: buildContext(ticketInput()), token: 'sk-test', model: 'zen-custom', client },
      () => {},
    );
    expect(captured?.model).toBe('zen-custom');
    expect(captured?.stream).toBe(true);
    expect(captured?.messages[0].role).toBe('system');
    expect(captured?.messages[1].content).toContain('Refund not received');
  });

  it('defaults the model to zen5 when none is given', async () => {
    let captured: ChatCompletionCreateParams | undefined;
    const client = fakeClient({ chunks: ['ok'], capture: (p) => (captured = p) });
    await stream({ task: 'x', ctx: buildContext(ticketInput()), token: '', client }, () => {});
    expect(captured?.model).toBe('zen5');
  });

  it('ignores empty deltas', async () => {
    const seen: string[] = [];
    const client = fakeClient({ chunks: ['a', '', 'b'] });
    const full = await stream(
      { task: 'x', ctx: buildContext(ticketInput()), token: '', client },
      (d) => seen.push(d),
    );
    expect(full).toBe('ab');
    expect(seen).toEqual(['a', 'b']);
  });
});

describe('complete (non-streaming path)', () => {
  it('returns the assistant message content', async () => {
    const client = fakeClient({ content: 'A tidy summary.' });
    const out = await complete({ task: 'Summarize', ctx: buildContext(ticketInput()), token: '', client });
    expect(out).toBe('A tidy summary.');
  });
});

describe('messageText (content flattening)', () => {
  it('returns a plain string as-is', () => {
    expect(messageText('hello')).toBe('hello');
  });
  it('concatenates the text parts of an array content', () => {
    expect(
      messageText([
        { type: 'text', text: 'a' },
        { type: 'image_url', image_url: { url: 'x' } },
        { type: 'text', text: 'b' },
      ]),
    ).toBe('ab');
  });
  it('is empty for undefined', () => {
    expect(messageText(undefined)).toBe('');
  });
});
