import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  kmsListSecrets,
  kmsGetSecret,
  kmsPutSecret,
  kmsDeleteSecret,
} from '../src/shared/kms';

// ---------------------------------------------------------------------------
// Mock fetch
// ---------------------------------------------------------------------------

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

function mockResponse(data: any, ok = true, status = 200) {
  return {
    ok,
    status,
    json: async () => data,
    text: async () => JSON.stringify(data),
  };
}

const TOKEN = 'test-bearer-token';
const REF = { org: 'hanzo', env: 'production', path: 'app' };
const SECRET = { ...REF, name: 'API_KEY' };

function calledUrl(): string {
  return mockFetch.mock.calls[0][0] as string;
}

function calledInit(): any {
  return mockFetch.mock.calls[0][1];
}

beforeEach(() => {
  mockFetch.mockReset();
});

// ---------------------------------------------------------------------------
// Path shape — the regression that actually happened
// ---------------------------------------------------------------------------

describe('KMS paths', () => {
  it('never emits an /api/ prefix', async () => {
    // This client used to speak /api/v3/secrets/raw, because the KMS binary
    // embedded a console SPA under a root catch-all and answered every
    // unmatched path with 200 text/html — so the wrong path looked alive and
    // the right one looked broken. Nothing may drift back to it.
    mockFetch.mockResolvedValue(mockResponse({ names: [] }));
    await kmsListSecrets(TOKEN, REF);
    mockFetch.mockResolvedValue(mockResponse({ secret: { value: 'v' } }));
    await kmsGetSecret(TOKEN, SECRET);
    mockFetch.mockResolvedValue(mockResponse({}));
    await kmsPutSecret(TOKEN, SECRET, 'v');
    mockFetch.mockResolvedValue(mockResponse({}));
    await kmsDeleteSecret(TOKEN, SECRET);

    expect(mockFetch.mock.calls).toHaveLength(4);
    for (const [url] of mockFetch.mock.calls) {
      expect(url).not.toContain('/api/');
      expect(url).toContain('/v1/kms/');
    }
  });

  it('escapes path segments individually so separators survive', async () => {
    // The server splits {rest...} at its LAST slash into (path, name). Escaping
    // the joined string would encode the separators into one long name.
    mockFetch.mockResolvedValue(mockResponse({ secret: { value: 'v' } }));
    await kmsGetSecret(TOKEN, { org: 'hanzo', env: 'main', path: 'a/b', name: 'C D' });
    expect(calledUrl()).toContain('/v1/kms/orgs/hanzo/secrets/a/b/C%20D');
  });
});

// ---------------------------------------------------------------------------
// kmsListSecrets
// ---------------------------------------------------------------------------

describe('kmsListSecrets', () => {
  it('returns the names array', async () => {
    mockFetch.mockResolvedValue(mockResponse({ names: ['API_KEY', 'DB_URL'] }));
    await expect(kmsListSecrets(TOKEN, REF)).resolves.toEqual(['API_KEY', 'DB_URL']);
  });

  it('addresses the collection with path and env as query, and sends the bearer', async () => {
    mockFetch.mockResolvedValue(mockResponse({ names: [] }));
    await kmsListSecrets(TOKEN, REF);
    expect(calledUrl()).toContain('/v1/kms/orgs/hanzo/secrets?');
    expect(calledUrl()).toContain('path=app');
    expect(calledUrl()).toContain('env=production');
    expect(calledInit().headers.Authorization).toBe(`Bearer ${TOKEN}`);
  });

  it('defaults env when the ref omits it', async () => {
    mockFetch.mockResolvedValue(mockResponse({ names: [] }));
    await kmsListSecrets(TOKEN, { org: 'hanzo' });
    expect(calledUrl()).toContain('env=default');
  });

  it('yields an empty array when the server omits names', async () => {
    mockFetch.mockResolvedValue(mockResponse({}));
    await expect(kmsListSecrets(TOKEN, REF)).resolves.toEqual([]);
  });

  it('uses a custom baseUrl when provided', async () => {
    mockFetch.mockResolvedValue(mockResponse({ names: [] }));
    await kmsListSecrets(TOKEN, REF, 'https://custom-kms.example.com');
    expect(calledUrl()).toContain('custom-kms.example.com/v1/kms/orgs/hanzo/secrets');
  });

  it('throws with the status on failure', async () => {
    mockFetch.mockResolvedValue(mockResponse('Not found', false, 404));
    await expect(kmsListSecrets(TOKEN, REF)).rejects.toThrow('KMS list failed: 404');
  });
});

// ---------------------------------------------------------------------------
// kmsGetSecret
// ---------------------------------------------------------------------------

describe('kmsGetSecret', () => {
  it('unwraps secret.value', async () => {
    mockFetch.mockResolvedValue(mockResponse({ secret: { value: 'postgres://...' } }));
    await expect(kmsGetSecret(TOKEN, SECRET)).resolves.toBe('postgres://...');
  });

  it('addresses the secret and carries env', async () => {
    mockFetch.mockResolvedValue(mockResponse({ secret: { value: 'v' } }));
    await kmsGetSecret(TOKEN, SECRET);
    expect(calledUrl()).toContain('/v1/kms/orgs/hanzo/secrets/app/API_KEY');
    expect(calledUrl()).toContain('env=production');
  });

  it('throws with the status on failure', async () => {
    mockFetch.mockResolvedValue(mockResponse('Not found', false, 404));
    await expect(kmsGetSecret(TOKEN, SECRET)).rejects.toThrow('KMS get failed: 404');
  });
});

// ---------------------------------------------------------------------------
// kmsPutSecret — create and replace are one call, because the server has one
// ---------------------------------------------------------------------------

describe('kmsPutSecret', () => {
  it('POSTs to the collection with the flat body the server takes', async () => {
    mockFetch.mockResolvedValue(mockResponse({}));
    await kmsPutSecret(TOKEN, SECRET, 'sk-live-123');

    expect(calledUrl()).toContain('/v1/kms/orgs/hanzo/secrets');
    expect(calledUrl()).not.toContain('API_KEY'); // name is in the body, not the URL
    expect(calledInit().method).toBe('POST');
    expect(JSON.parse(calledInit().body)).toEqual({
      path: 'app',
      name: 'API_KEY',
      env: 'production',
      value: 'sk-live-123',
    });
  });

  it('throws with the status on failure', async () => {
    mockFetch.mockResolvedValue(mockResponse('Forbidden', false, 403));
    await expect(kmsPutSecret(TOKEN, SECRET, 'v')).rejects.toThrow('KMS put failed: 403');
  });
});

// ---------------------------------------------------------------------------
// kmsDeleteSecret
// ---------------------------------------------------------------------------

describe('kmsDeleteSecret', () => {
  it('DELETEs the secret URL', async () => {
    mockFetch.mockResolvedValue(mockResponse({}));
    await kmsDeleteSecret(TOKEN, SECRET);
    expect(calledInit().method).toBe('DELETE');
    expect(calledUrl()).toContain('/v1/kms/orgs/hanzo/secrets/app/API_KEY');
    expect(calledUrl()).toContain('env=production');
  });

  it('throws with the status on failure', async () => {
    mockFetch.mockResolvedValue(mockResponse('Forbidden', false, 403));
    await expect(kmsDeleteSecret(TOKEN, SECRET)).rejects.toThrow('KMS delete failed: 403');
  });
});
