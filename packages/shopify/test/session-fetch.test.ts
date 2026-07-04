import { describe, it, expect } from 'vitest';
import { authenticatedFetch } from '../src/app/session-fetch';

// A base fetch that records the request it was given and returns a canned 200.
function recordingFetch(): { fetch: typeof fetch; last: () => { url: any; init: any } } {
  let url: any;
  let init: any;
  const f = (async (u: any, i: any) => {
    url = u;
    init = i;
    return new Response('{}', { status: 200 });
  }) as unknown as typeof fetch;
  return { fetch: f, last: () => ({ url, init }) };
}

describe('authenticatedFetch', () => {
  it('adds a fresh session token as a Bearer header on each request', async () => {
    const rec = recordingFetch();
    const f = authenticatedFetch(rec.fetch, async () => 'jwt-token');
    await f('/v1/product?shop=s.myshopify.com&id=1');
    const headers = new Headers(rec.last().init.headers);
    expect(headers.get('Authorization')).toBe('Bearer jwt-token');
  });

  it('merges (does not clobber) caller headers', async () => {
    const rec = recordingFetch();
    const f = authenticatedFetch(rec.fetch, async () => 'jwt');
    await f('/v1/product/action', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
    });
    const headers = new Headers(rec.last().init.headers);
    expect(headers.get('Content-Type')).toBe('application/json');
    expect(headers.get('Authorization')).toBe('Bearer jwt');
    expect(rec.last().init.method).toBe('POST');
  });

  it('fetches a NEW token per request (tokens expire ~1 min, never cached)', async () => {
    const rec = recordingFetch();
    let n = 0;
    const f = authenticatedFetch(rec.fetch, async () => `t${++n}`);
    await f('/a');
    await f('/b');
    expect(n).toBe(2);
  });

  it('sends the request without the header (server will 401) when token retrieval fails', async () => {
    const rec = recordingFetch();
    const f = authenticatedFetch(rec.fetch, async () => {
      throw new Error('app bridge not ready');
    });
    const resp = await f('/x');
    expect(resp.status).toBe(200); // the request still went out
    const headers = new Headers(rec.last().init.headers);
    expect(headers.get('Authorization')).toBeNull();
  });

  it('omits the header when the token is empty', async () => {
    const rec = recordingFetch();
    const f = authenticatedFetch(rec.fetch, async () => '');
    await f('/x');
    const headers = new Headers(rec.last().init.headers);
    expect(headers.get('Authorization')).toBeNull();
  });
});
