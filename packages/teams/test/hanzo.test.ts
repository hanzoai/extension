import { describe, it, expect, vi } from 'vitest';
import { complete, listModels, type AiClient } from '../src/hanzo';

// A hand-built stub of the exact client slice hanzo.ts uses, so we assert on
// the request we shape and the response we read — no network.
function stubClient(overrides: Partial<AiClient> = {}): {
  client: AiClient;
  create: ReturnType<typeof vi.fn>;
  list: ReturnType<typeof vi.fn>;
} {
  const create = vi.fn(async () => ({
    choices: [{ message: { content: 'hello from hanzo' } }],
  }));
  const list = vi.fn(async () => ({ data: [{ id: 'zen-eco-3b' }, { id: 'zen-4b' }] }));
  const client: AiClient = {
    chat: { completions: { create } },
    models: { list },
    ...overrides,
  } as AiClient;
  return { client, create, list };
}

describe('complete', () => {
  it('shapes the request with model, messages, and max_tokens', async () => {
    const { client, create } = stubClient();
    const text = await complete(client, {
      model: 'zen-4b',
      messages: [{ role: 'user', content: 'hi' }],
      maxTokens: 256,
      temperature: 0.3,
    });
    expect(text).toBe('hello from hanzo');
    expect(create).toHaveBeenCalledWith({
      model: 'zen-4b',
      messages: [{ role: 'user', content: 'hi' }],
      max_tokens: 256,
      temperature: 0.3,
    });
  });

  it('omits temperature and max_tokens when not provided', async () => {
    const { client, create } = stubClient();
    await complete(client, { model: 'zen-eco-3b', messages: [] });
    expect(create).toHaveBeenCalledWith({ model: 'zen-eco-3b', messages: [] });
  });

  it('throws on an empty completion', async () => {
    const { client } = stubClient({
      chat: { completions: { create: vi.fn(async () => ({ choices: [] })) } },
    } as Partial<AiClient>);
    await expect(
      complete(client, { model: 'x', messages: [] }),
    ).rejects.toThrow(/empty completion/i);
  });

  it('throws when the message content is null', async () => {
    const { client } = stubClient({
      chat: {
        completions: { create: vi.fn(async () => ({ choices: [{ message: { content: null } }] })) },
      },
    } as Partial<AiClient>);
    await expect(complete(client, { model: 'x', messages: [] })).rejects.toThrow();
  });
});

describe('listModels', () => {
  it('returns the model ids from the catalog', async () => {
    const { client } = stubClient();
    expect(await listModels(client)).toEqual(['zen-eco-3b', 'zen-4b']);
  });

  it('returns [] when the catalog is shaped unexpectedly', async () => {
    const { client } = stubClient({
      models: { list: vi.fn(async () => ({})) },
    } as Partial<AiClient>);
    expect(await listModels(client)).toEqual([]);
  });
});
