import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.hoisted(() => {
  delete process.env.API_URL;
  delete process.env.IAM_URL;
  process.env.HANZO_API_KEY = 'sk-test';
});

import { iamTool, authTool } from '../src/tools/hanzo-cloud';

// IAM on the unified gateway, one entity at /v1/iam/<kind>/<owner>/<name>, the
// verb in the method. Each row is the requests one action makes, in order.
const B = 'https://api.hanzo.ai/v1/iam';
type Call = [method: string, url: string, body?: unknown];

let calls: Call[];

beforeEach(() => {
  calls = [];
  vi.stubGlobal('fetch', vi.fn(async (url: string, init: any = {}) => {
    const call: Call = [init.method || 'GET', url];
    if (init.body !== undefined) {
      try { call.push(JSON.parse(init.body)); } catch { call.push(init.body); }
    }
    calls.push(call);
    return { ok: true, text: async () => JSON.stringify({ name: 'x' }) } as any;
  }));
});

const iam: Array<[Record<string, unknown>, Call[]]> = [
  [{ action: 'list_users', owner: 'acme' }, [['GET', `${B}/users?owner=acme&limit=50`]]],
  [{ action: 'get_user', id: 'acme/bob' }, [['GET', `${B}/users/acme/bob`]]],
  [{ action: 'get_user', id: 'bob' }, [['GET', `${B}/users/admin/bob`]]],
  [{ action: 'create_user', owner: 'acme', name: 'bob', email: 'b@acme.test', password: 'pw' },
    [['POST', `${B}/users`, { user: { owner: 'acme', name: 'bob', email: 'b@acme.test' }, password: 'pw' }]]],
  [{ action: 'update_user', id: 'acme/bob', displayName: 'Bob' },
    [['GET', `${B}/users/acme/bob`], ['PUT', `${B}/users/acme/bob`, { user: { name: 'x', displayName: 'Bob' } }]]],
  [{ action: 'delete_user', id: 'acme/bob' }, [['DELETE', `${B}/users/acme/bob`]]],
  [{ action: 'list_orgs' }, [['GET', `${B}/organizations?limit=50`]]],
  [{ action: 'get_org', id: 'acme' }, [['GET', `${B}/organizations/admin/acme`]]],
  [{ action: 'create_org', name: 'acme' },
    [['POST', `${B}/organizations`, { owner: 'admin', name: 'acme', displayName: 'acme' }]]],
  [{ action: 'update_org', id: 'acme', displayName: 'Acme', data: { websiteUrl: 'https://acme.test' } },
    [['POST', `${B}/organizations/profile`, { owner: 'admin', name: 'acme', displayName: 'Acme', websiteUrl: 'https://acme.test' }]]],
  [{ action: 'delete_org', id: 'acme' }, [['DELETE', `${B}/organizations/admin/acme`]]],
  [{ action: 'list_roles', owner: 'acme' }, [['GET', `${B}/roles?owner=acme`]]],
  [{ action: 'get_role', id: 'acme/r' }, [['GET', `${B}/roles/acme/r`]]],
  [{ action: 'create_role', owner: 'acme', name: 'r' },
    [['POST', `${B}/roles`, { owner: 'acme', name: 'r', displayName: 'r' }]]],
  [{ action: 'update_role', id: 'acme/r', data: { description: 'd' } },
    [['GET', `${B}/roles/acme/r`], ['PUT', `${B}/roles/acme/r`, { name: 'x', description: 'd' }]]],
  [{ action: 'delete_role', id: 'acme/r' }, [['DELETE', `${B}/roles/acme/r`]]],
  [{ action: 'list_apps', owner: 'acme' }, [['GET', `${B}/applications?owner=acme`]]],
  [{ action: 'get_app', id: 'acme/app' }, [['GET', `${B}/applications/acme/app`]]],
  [{ action: 'create_app', owner: 'acme', name: 'app' },
    [['POST', `${B}/applications`, { owner: 'acme', name: 'app', displayName: 'app', organization: 'hanzo' }]]],
  [{ action: 'list_providers', owner: 'acme' }, [['GET', `${B}/providers?owner=acme`]]],
  [{ action: 'list_tokens', owner: 'acme' }, [['GET', `${B}/tokens?owner=acme`]]],
  [{ action: 'create_token', owner: 'acme', name: 't' }, [['POST', `${B}/tokens`, { owner: 'acme', name: 't' }]]],
  [{ action: 'delete_token', owner: 'acme', id: 't' }, [['DELETE', `${B}/tokens/acme/t`]]],
  [{ action: 'list_permissions', owner: 'acme' }, [['GET', `${B}/permissions?owner=acme`]]],
  [{ action: 'assign_role', role: 'acme/r', user: 'acme/bob' },
    [['GET', `${B}/roles/acme/r`], ['PUT', `${B}/roles/acme/r`, { name: 'x', users: ['acme/bob'] }]]],
  [{ action: 'remove_role', role: 'acme/r', user: 'acme/bob' },
    [['GET', `${B}/roles/acme/r`], ['PUT', `${B}/roles/acme/r`, { name: 'x', users: [] }]]],
  [{ action: 'list_sessions', owner: 'acme' }, [['GET', `${B}/sessions?owner=acme`]]],
  [{ action: 'delete_session', id: 'acme/bob/app' }, [['DELETE', `${B}/sessions/acme/bob/app`]]],
  [{ action: 'health' }, [['GET', `${B}/health`]]],
];

describe('iam tool', () => {
  it.each(iam)('%o', async (args, want) => {
    const res = await iamTool.handler(args);
    expect(res.isError).toBeUndefined();
    expect(calls).toEqual(want);
  });

  it('delete_session refuses a key without the application', async () => {
    const res = await iamTool.handler({ action: 'delete_session', id: 'bob' });
    expect(res.isError).toBe(true);
    expect(calls).toEqual([]);
  });
});

describe('auth tool', () => {
  it('reads userinfo, logs out and refreshes on the gateway', async () => {
    await authTool.handler({ action: 'whoami' });
    await authTool.handler({ action: 'logout' });
    await authTool.handler({ action: 'refresh', refreshToken: 'RT' });
    expect(calls.map(([m, u]) => [m, u])).toEqual([
      ['GET', `${B}/oauth/userinfo`],
      ['POST', `${B}/oauth/logout`],
      ['POST', `${B}/oauth/token`],
    ]);
  });
});
