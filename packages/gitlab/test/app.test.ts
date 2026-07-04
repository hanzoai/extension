import { describe, it, expect } from 'vitest';
import { dispatch, type RunModel } from '../src/app.js';
import { GitlabClient, type FetchLike } from '../src/gitlab-api.js';
import { loadConfig, type Config } from '../src/config.js';

const config: Config = loadConfig({
  GITLAB_TOKEN: 'glpat-abc',
  GITLAB_WEBHOOK_SECRET: 's',
  HANZO_MODEL: 'zen5',
} as NodeJS.ProcessEnv);

interface Call {
  url: string;
  method: string;
  body?: unknown;
}

/** Fake fetch scripting responses per (url, method), recording every call. */
function fakeClient(dataFor: (url: string, method: string) => unknown): {
  client: GitlabClient;
  calls: Call[];
} {
  const calls: Call[] = [];
  const fetch: FetchLike = async (url, init) => {
    const method = init?.method ?? 'GET';
    calls.push({ url, method, body: init?.body ? JSON.parse(init.body) : undefined });
    const data = dataFor(url, method);
    return { ok: true, status: 200, text: async () => (data === undefined ? '' : JSON.stringify(data)) };
  };
  return { client: new GitlabClient({ baseURL: 'https://gitlab.com', token: 't', fetch }), calls };
}

const stubRun: RunModel = async () => 'MODEL OUTPUT';
const project = { id: 100, path_with_namespace: 'hanzoai/extension' };

describe('dispatch: Merge Request Hook → review', () => {
  it('fetches changes and posts a review note', async () => {
    const { client, calls } = fakeClient((url) =>
      url.endsWith('/changes')
        ? { changes: [{ old_path: 'x.ts', new_path: 'x.ts', diff: '+a' }] }
        : {},
    );
    const captured: Array<{ system: string; user: string }> = [];
    const run: RunModel = async (i) => {
      captured.push(i);
      return 'Looks good.';
    };

    await dispatch(
      'Merge Request Hook',
      { object_kind: 'merge_request', project, object_attributes: { action: 'open', iid: 12, title: 'T', description: 'B' } },
      client,
      config,
      run,
    );

    const changesCall = calls.find((c) => c.url.endsWith('/changes'));
    expect(changesCall?.url).toContain('/projects/100/merge_requests/12/changes');
    const note = calls.find((c) => c.method === 'POST' && c.url.endsWith('/merge_requests/12/notes'));
    expect((note?.body as { body: string }).body).toContain('Looks good.');
    // The reconstructed diff reached the prompt.
    expect(captured[0].user).toContain('diff --git a/x.ts');
  });

  it('ignores a closed MR (no calls)', async () => {
    const { client, calls } = fakeClient(() => ({}));
    await dispatch(
      'Merge Request Hook',
      { project, object_attributes: { action: 'close', iid: 12 } },
      client,
      config,
      stubRun,
    );
    expect(calls).toHaveLength(0);
  });
});

describe('dispatch: Issue Hook → triage', () => {
  it('lists labels, notes, and applies only real labels', async () => {
    const { client, calls } = fakeClient((url, method) =>
      url.includes('/labels') && method === 'GET' ? [{ name: 'bug' }, { name: 'crash' }] : {},
    );
    const run: RunModel = async () =>
      ['Summary: Boot crash', 'Severity: high', 'Labels: bug, wontfix', 'Response:', 'Thanks!'].join(
        '\n',
      );

    await dispatch(
      'Issue Hook',
      { project, object_attributes: { action: 'open', iid: 7, title: 'Crash', description: 'boom' } },
      client,
      config,
      run,
    );

    expect(calls.find((c) => c.url.includes('/labels') && c.method === 'GET')).toBeDefined();
    const note = calls.find((c) => c.method === 'POST' && c.url.endsWith('/issues/7/notes'));
    expect((note?.body as { body: string }).body).toContain('Boot crash');
    // "wontfix" is not a real project label — only bug survives, applied via PUT add_labels.
    const put = calls.find((c) => c.method === 'PUT' && c.url.includes('/issues/7'));
    expect(put?.url).toContain('add_labels=bug');
    expect(put?.url).not.toContain('wontfix');
  });

  it('applies no labels when the model picks none real (no PUT)', async () => {
    const { client, calls } = fakeClient((url, method) =>
      url.includes('/labels') && method === 'GET' ? [{ name: 'bug' }] : {},
    );
    const run: RunModel = async () => 'Summary: x\nSeverity: low\nLabels: wontfix\nResponse:\nHi';
    await dispatch(
      'Issue Hook',
      { project, object_attributes: { action: 'open', iid: 8, title: 'T', description: 'B' } },
      client,
      config,
      run,
    );
    expect(calls.find((c) => c.method === 'PUT')).toBeUndefined();
  });
});

describe('dispatch: Note Hook → mention', () => {
  it('answers a @hanzo question on an MR using the thread', async () => {
    const { client, calls } = fakeClient((url, method) =>
      url.includes('/notes') && method === 'GET'
        ? [{ author: { username: 'alice' }, body: 'context here', system: false }]
        : {},
    );
    const captured: Array<{ user: string }> = [];
    const run: RunModel = async (i) => {
      captured.push(i);
      return 'The answer.';
    };

    await dispatch(
      'Note Hook',
      {
        project,
        object_attributes: { noteable_type: 'MergeRequest', note: '@hanzo what does this do?' },
        merge_request: { iid: 3, title: 'Q', description: 'body' },
      },
      client,
      config,
      run,
    );

    const post = calls.find((c) => c.method === 'POST' && c.url.endsWith('/merge_requests/3/notes'));
    expect((post?.body as { body: string }).body).toContain('The answer.');
    expect(captured[0].user).toContain('what does this do?');
    expect(captured[0].user).toContain('@alice: context here');
  });

  it('answers a @hanzo question on an issue', async () => {
    const { client, calls } = fakeClient((url, method) =>
      url.includes('/notes') && method === 'GET' ? [] : {},
    );
    await dispatch(
      'Note Hook',
      {
        project,
        object_attributes: { noteable_type: 'Issue', note: '@hanzo help' },
        issue: { iid: 4, title: 'Q', description: 'body' },
      },
      client,
      config,
      stubRun,
    );
    const post = calls.find((c) => c.method === 'POST' && c.url.endsWith('/issues/4/notes'));
    expect(post).toBeDefined();
  });

  it('ignores a note without @hanzo', async () => {
    const { client, calls } = fakeClient(() => ({}));
    await dispatch(
      'Note Hook',
      {
        project,
        object_attributes: { noteable_type: 'Issue', note: 'nice' },
        issue: { iid: 4 },
      },
      client,
      config,
      stubRun,
    );
    expect(calls).toHaveLength(0);
  });
});

describe('dispatch: unknown event', () => {
  it('does nothing', async () => {
    const { client, calls } = fakeClient(() => ({}));
    await dispatch('Push Hook', { project, object_attributes: { action: 'open' } }, client, config, stubRun);
    expect(calls).toHaveLength(0);
  });
});
