import { describe, it, expect, vi, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import axios from 'axios';
import { OIDC_PATHS } from '@hanzo/iam/paths';
import { IAM_API_PATH, StandaloneAuthManager } from '../../auth/standalone-auth';

vi.mock('axios', () => ({ default: { post: vi.fn(async () => ({ data: {} })) } }));

// This extension restates Hanzo IAM's OAuth path prefix instead of importing
// @hanzo/iam at runtime — that package is 1.8 MB with three transitive
// dependencies, which is a poor trade for twelve characters in a shipped
// extension. The copy is therefore fine; an UNCHECKED copy is not.
//
// The prefix was wrong here once already: this file hit
// hanzo.id/oauth/authorize, with no /v1/iam, and 404'd. It was then kept in
// step by a comment instructing the next reader to compare it by hand, which
// is the same mechanism that let it drift in the first place.
//
// @hanzo/iam is a devDependency, so this costs nothing at runtime and the
// build cannot go green while the two disagree.
describe('the local IAM path prefix agrees with @hanzo/iam', () => {
  it('every OAuth endpoint this extension builds is under IAM_API_PATH', () => {
    for (const key of ['authorize', 'token', 'userinfo'] as const) {
      expect(OIDC_PATHS[key].startsWith(`${IAM_API_PATH}/`)).toBe(true);
    }
  });

  it('the prefix is exactly what @hanzo/iam declares, not merely a prefix of it', () => {
    // `/v` and `/v1` both pass a startsWith check; only the real value builds a
    // URL that resolves. Derive it from the canonical path and compare.
    const derived = OIDC_PATHS.authorize.slice(0, OIDC_PATHS.authorize.indexOf('/oauth/'));
    expect(IAM_API_PATH).toBe(derived);
  });
});

describe('the token endpoint is on the unified gateway', () => {
  afterEach(() => vi.unstubAllEnvs());

  it('refresh POSTs to api.hanzo.ai/v1/iam/oauth/token', async () => {
    // The constructor writes ~/.hanzo-mcp, so HOME points at a throwaway dir.
    vi.stubEnv('HOME', fs.mkdtempSync(path.join(os.tmpdir(), 'hanzo-iam-')));
    vi.stubEnv('IAM_ENDPOINT', '');
    await new StandaloneAuthManager(false)['refreshToken']('RT');
    expect(axios.post).toHaveBeenCalledWith('https://api.hanzo.ai/v1/iam/oauth/token', expect.any(URLSearchParams));
  });
});
