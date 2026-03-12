import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  kmsListSecrets,
  kmsGetSecret,
  kmsCreateSecret,
  kmsUpdateSecret,
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
const PARAMS = {
  workspaceId: 'ws-123',
  environment: 'production',
  secretPath: '/app',
};

beforeEach(() => {
  mockFetch.mockReset();
});

// ---------------------------------------------------------------------------
// kmsListSecrets
// ---------------------------------------------------------------------------

describe('kmsListSecrets', () => {
  it('sends GET with correct URL and query params', async () => {
    mockFetch.mockResolvedValue(mockResponse({ secrets: [{ secretKey: 'API_KEY' }] }));

    const result = await kmsListSecrets(TOKEN, PARAMS);

    expect(mockFetch).toHaveBeenCalledTimes(1);
    const [url, opts] = mockFetch.mock.calls[0];
    expect(url).toContain('kms.hanzo.ai/api/v3/secrets/raw?');
    expect(url).toContain('workspaceId=ws-123');
    expect(url).toContain('environment=production');
    expect(url).toContain('secretPath=%2Fapp');
    expect(opts.headers.Authorization).toBe(`Bearer ${TOKEN}`);
    expect(result).toEqual([{ secretKey: 'API_KEY' }]);
  });

  it('uses custom baseUrl when provided', async () => {
    mockFetch.mockResolvedValue(mockResponse({ secrets: [] }));

    await kmsListSecrets(TOKEN, PARAMS, 'https://custom-kms.example.com');

    const [url] = mockFetch.mock.calls[0];
    expect(url).toContain('custom-kms.example.com/api/v3/secrets/raw');
  });

  it('throws on non-ok response', async () => {
    mockFetch.mockResolvedValue(mockResponse('Not found', false, 404));

    await expect(kmsListSecrets(TOKEN, PARAMS)).rejects.toThrow('KMS list failed: 404');
  });
});

// ---------------------------------------------------------------------------
// kmsGetSecret
// ---------------------------------------------------------------------------

describe('kmsGetSecret', () => {
  it('sends GET with encoded secret name', async () => {
    mockFetch.mockResolvedValue(mockResponse({ secret: { secretKey: 'DB_URL', secretValue: 'postgres://...' } }));

    const result = await kmsGetSecret(TOKEN, { ...PARAMS, secretName: 'DB_URL' });

    const [url] = mockFetch.mock.calls[0];
    expect(url).toContain('/api/v3/secrets/raw/DB_URL');
    expect(result.secretKey).toBe('DB_URL');
  });

  it('URL-encodes special characters in secret name', async () => {
    mockFetch.mockResolvedValue(mockResponse({ secret: { secretKey: 'app/key' } }));

    await kmsGetSecret(TOKEN, { ...PARAMS, secretName: 'app/key' });

    const [url] = mockFetch.mock.calls[0];
    expect(url).toContain('app%2Fkey');
  });

  it('throws on non-ok response', async () => {
    mockFetch.mockResolvedValue(mockResponse('Forbidden', false, 403));

    await expect(kmsGetSecret(TOKEN, { ...PARAMS, secretName: 'X' })).rejects.toThrow('KMS get failed: 403');
  });
});

// ---------------------------------------------------------------------------
// kmsCreateSecret
// ---------------------------------------------------------------------------

describe('kmsCreateSecret', () => {
  it('sends POST with correct body', async () => {
    mockFetch.mockResolvedValue(mockResponse({ secret: { secretKey: 'NEW_KEY' } }));

    await kmsCreateSecret(TOKEN, { ...PARAMS, secretName: 'NEW_KEY' }, 'secret-value');

    const [url, opts] = mockFetch.mock.calls[0];
    expect(url).toContain('/api/v3/secrets/raw/NEW_KEY');
    expect(opts.method).toBe('POST');
    const body = JSON.parse(opts.body);
    expect(body.secretValue).toBe('secret-value');
    expect(body.workspaceId).toBe('ws-123');
    expect(body.environment).toBe('production');
    expect(body.type).toBe('shared');
  });

  it('includes Authorization header', async () => {
    mockFetch.mockResolvedValue(mockResponse({ secret: {} }));

    await kmsCreateSecret(TOKEN, { ...PARAMS, secretName: 'X' }, 'val');

    const [, opts] = mockFetch.mock.calls[0];
    expect(opts.headers.Authorization).toBe(`Bearer ${TOKEN}`);
    expect(opts.headers['Content-Type']).toBe('application/json');
  });
});

// ---------------------------------------------------------------------------
// kmsUpdateSecret
// ---------------------------------------------------------------------------

describe('kmsUpdateSecret', () => {
  it('sends PATCH with correct body', async () => {
    mockFetch.mockResolvedValue(mockResponse({ secret: { secretKey: 'KEY' } }));

    await kmsUpdateSecret(TOKEN, { ...PARAMS, secretName: 'KEY' }, 'new-value');

    const [url, opts] = mockFetch.mock.calls[0];
    expect(url).toContain('/api/v3/secrets/raw/KEY');
    expect(opts.method).toBe('PATCH');
    const body = JSON.parse(opts.body);
    expect(body.secretValue).toBe('new-value');
  });
});

// ---------------------------------------------------------------------------
// kmsDeleteSecret
// ---------------------------------------------------------------------------

describe('kmsDeleteSecret', () => {
  it('sends DELETE with correct body', async () => {
    mockFetch.mockResolvedValue(mockResponse({}));

    await kmsDeleteSecret(TOKEN, { ...PARAMS, secretName: 'OLD_KEY' });

    const [url, opts] = mockFetch.mock.calls[0];
    expect(url).toContain('/api/v3/secrets/raw/OLD_KEY');
    expect(opts.method).toBe('DELETE');
    const body = JSON.parse(opts.body);
    expect(body.workspaceId).toBe('ws-123');
  });

  it('throws on non-ok response', async () => {
    mockFetch.mockResolvedValue(mockResponse('Server Error', false, 500));

    await expect(kmsDeleteSecret(TOKEN, { ...PARAMS, secretName: 'X' })).rejects.toThrow('KMS delete failed: 500');
  });
});
