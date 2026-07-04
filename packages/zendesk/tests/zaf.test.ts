import { describe, it, expect, vi } from 'vitest';
import {
  normalizeComments,
  getTicketContext,
  appendReply,
  setCommentType,
  getModel,
  secureFetch,
  type ZafClient,
  type ZafRequestOptions,
} from '../src/zaf';
import { APIKEY_SETTING } from '../src/config';

/** A configurable fake ZAF client. */
function fakeZaf(over: Partial<ZafClient> = {}): ZafClient {
  return {
    get: vi.fn(async () => ({})),
    set: vi.fn(async () => undefined),
    invoke: vi.fn(async () => undefined),
    metadata: vi.fn(async () => ({ settings: {} })),
    request: vi.fn(async () => ({ status: 200, responseText: '{}' })),
    ...over,
  };
}

describe('normalizeComments (ZAF ticket.comments → typed)', () => {
  it('maps value/author.name/public and defaults missing publicity to public', () => {
    const out = normalizeComments([
      { value: 'hello', author: { name: 'Ada', email: 'a@x.io' }, public: true, createdAt: '2026-01-01T00:00:00Z' },
      { value: 'note', author: { name: 'Agent' }, public: false },
      { value: 'no publicity field', author: { name: 'X' } },
    ]);
    expect(out[0]).toEqual({ value: 'hello', author: { name: 'Ada' }, public: true, createdAt: '2026-01-01T00:00:00Z' });
    expect(out[1].public).toBe(false);
    expect(out[2].public).toBe(true); // default when host omits it
  });

  it('tolerates non-array / malformed input', () => {
    expect(normalizeComments(undefined)).toEqual([]);
    expect(normalizeComments(null)).toEqual([]);
    expect(normalizeComments('nope')).toEqual([]);
    const out = normalizeComments([{}, { author: 'not-an-object' }]);
    expect(out).toHaveLength(2);
    expect(out[0].value).toBe('');
    expect(out[0].author).toBeNull();
    expect(out[1].author).toBeNull();
  });
});

describe('getTicketContext (one batched ZAF get)', () => {
  it('requests subject, requester name, and comments in one call and shapes them', async () => {
    const get = vi.fn(async () => ({
      'ticket.subject': '  Refund issue  ',
      'ticket.requester.name': 'Grace Hopper',
      'ticket.comments': [{ value: 'charged twice', author: { name: 'Grace' }, public: true }],
    }));
    const client = fakeZaf({ get });
    const input = await getTicketContext(client);
    expect(get).toHaveBeenCalledWith(['ticket.subject', 'ticket.requester.name', 'ticket.comments']);
    expect(input.subject).toBe('Refund issue'); // trimmed
    expect(input.requesterName).toBe('Grace Hopper');
    expect(input.comments).toHaveLength(1);
    expect(input.comments[0].value).toBe('charged twice');
  });
});

describe('write-back invokes the correct ZAF paths', () => {
  it('appendReply uses ticket.comment.appendText with the text', async () => {
    const invoke = vi.fn(async () => undefined);
    await appendReply(fakeZaf({ invoke }), 'On it!');
    expect(invoke).toHaveBeenCalledWith('ticket.comment.appendText', 'On it!');
  });

  it('setCommentType sets ticket.comment.type', async () => {
    const set = vi.fn(async () => undefined);
    await setCommentType(fakeZaf({ set }), 'internalNote');
    expect(set).toHaveBeenCalledWith('ticket.comment.type', 'internalNote');
  });
});

describe('getModel (non-secure setting)', () => {
  it('reads the configured model from metadata settings', async () => {
    const client = fakeZaf({ metadata: vi.fn(async () => ({ settings: { default_model: 'zen-custom' } })) });
    expect(await getModel(client)).toBe('zen-custom');
  });
  it('falls back to the default when unset or on error', async () => {
    expect(await getModel(fakeZaf({ metadata: vi.fn(async () => ({ settings: {} })) }))).toBe('zen5');
    expect(await getModel(fakeZaf({ metadata: vi.fn(async () => { throw new Error('x'); }) }))).toBe('zen5');
  });
});

describe('secureFetch (key stays server-side)', () => {
  it('routes through client.request with secure:true and the setting placeholder — never a raw key', async () => {
    let captured: ZafRequestOptions | undefined;
    const request = vi.fn(async (opts: ZafRequestOptions) => {
      captured = opts;
      return { status: 200, responseText: '{"choices":[{"message":{"content":"hi"}}]}' };
    });
    const doFetch = secureFetch(fakeZaf({ request }));

    const res = await doFetch('https://api.hanzo.ai/v1/chat/completions', {
      method: 'POST',
      body: JSON.stringify({ model: 'zen5', messages: [] }),
    });

    expect(captured?.url).toBe('https://api.hanzo.ai/v1/chat/completions');
    expect(captured?.method).toBe('POST');
    expect(captured?.secure).toBe(true);
    // The Authorization header carries the PLACEHOLDER, not a real key.
    expect(captured?.headers?.Authorization).toBe(`Bearer {{setting.${APIKEY_SETTING}}}`);
    expect(JSON.stringify(captured)).not.toMatch(/hk-/);
    // The Response is usable by @hanzo/ai.
    expect(res.ok).toBe(true);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.choices[0].message.content).toBe('hi');
  });

  it('surfaces a non-2xx status from the proxy', async () => {
    const request = vi.fn(async () => ({ status: 401, responseText: '{"error":{"message":"bad key"}}' }));
    const doFetch = secureFetch(fakeZaf({ request }));
    const res = await doFetch('https://api.hanzo.ai/v1/models', { method: 'GET' });
    expect(res.ok).toBe(false);
    expect(res.status).toBe(401);
  });
});
