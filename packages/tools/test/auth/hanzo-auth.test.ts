import { describe, it, expect, vi } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import fetch from 'node-fetch';
import { HanzoAuth } from '../../src/auth/hanzo-auth';

vi.mock('node-fetch', () => ({
  default: vi.fn(async () => ({ ok: true, json: async () => ({ access_token: 'AT2', expires_in: 60 }) })),
}));

// Every IAM call goes to the unified gateway; the login UI stays on hanzo.id.
describe('HanzoAuth talks to IAM on api.hanzo.ai', () => {
  const auth = () => {
    const a = new HanzoAuth({ configPath: fs.mkdtempSync(path.join(os.tmpdir(), 'hanzo-auth-')) });
    (a as any).credentials = { accessToken: 'AT', refreshToken: 'RT' };
    return a;
  };

  it('refresh POSTs to /v1/iam/oauth/token', async () => {
    expect(await auth().refreshToken()).toBe(true);
    expect(vi.mocked(fetch).mock.calls[0][0]).toBe('https://api.hanzo.ai/v1/iam/oauth/token');
  });

  it('logout POSTs to /v1/iam/oauth/logout', async () => {
    await auth().logout();
    expect(vi.mocked(fetch).mock.calls[0][0]).toBe('https://api.hanzo.ai/v1/iam/oauth/logout');
  });
});
