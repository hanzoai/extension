import { describe, it, expect } from 'vitest';
import { dispatch, type RunModel } from '../src/app.js';
import type { RequestOctokit } from '../src/github-api.js';
import { loadConfig, type Config } from '../src/config.js';

const config: Config = loadConfig({
  GITHUB_APP_ID: '1',
  GITHUB_PRIVATE_KEY: 'k',
  GITHUB_WEBHOOK_SECRET: 's',
  HANZO_MODEL: 'zen5',
} as NodeJS.ProcessEnv);

interface Call {
  route: string;
  params?: Record<string, unknown>;
}

/** Fake octokit scripting responses per route, recording every call. */
function fakeOctokit(dataFor: (route: string) => unknown): { octokit: RequestOctokit; calls: Call[] } {
  const calls: Call[] = [];
  const octokit: RequestOctokit = {
    async request(route, params) {
      calls.push({ route, params });
      return { data: dataFor(route) };
    },
  };
  return { octokit, calls };
}

const stubRun: RunModel = async () => 'MODEL OUTPUT';

const repository = { owner: { login: 'hanzoai' }, name: 'extension' };

describe('dispatch: pull_request → review', () => {
  it('fetches the diff and posts a review', async () => {
    const { octokit, calls } = fakeOctokit((route) =>
      route.endsWith('/pulls/{pull_number}') ? 'diff --git a/x b/x\n+a' : {},
    );
    const captured: Array<{ system: string; user: string }> = [];
    const run: RunModel = async (i) => {
      captured.push(i);
      return 'Looks good.';
    };

    await dispatch(
      'pull_request',
      { action: 'opened', repository, pull_request: { number: 12, title: 'T', body: 'B' } },
      octokit,
      config,
      run,
    );

    const routes = calls.map((c) => c.route);
    expect(routes).toContain('GET /repos/{owner}/{repo}/pulls/{pull_number}');
    const review = calls.find((c) => c.route.endsWith('/reviews'));
    expect(review?.params).toMatchObject({ event: 'COMMENT', pull_number: 12 });
    expect(String(review?.params?.body)).toContain('Looks good.');
    // The diff reached the prompt.
    expect(captured[0].user).toContain('diff --git a/x');
  });

  it('ignores a closed PR (no calls)', async () => {
    const { octokit, calls } = fakeOctokit(() => ({}));
    await dispatch(
      'pull_request',
      { action: 'closed', repository, pull_request: { number: 12 } },
      octokit,
      config,
      stubRun,
    );
    expect(calls).toHaveLength(0);
  });
});

describe('dispatch: issues → triage', () => {
  it('lists labels, comments, and applies only real labels', async () => {
    const { octokit, calls } = fakeOctokit((route) =>
      route.endsWith('/labels') && route.startsWith('GET')
        ? [{ name: 'bug' }, { name: 'crash' }]
        : {},
    );
    const run: RunModel = async () =>
      ['Summary: Boot crash', 'Severity: high', 'Labels: bug, wontfix', 'Response:', 'Thanks!'].join('\n');

    await dispatch(
      'issues',
      { action: 'opened', repository, issue: { number: 7, title: 'Crash', body: 'boom' } },
      octokit,
      config,
      run,
    );

    const routes = calls.map((c) => c.route);
    expect(routes).toContain('GET /repos/{owner}/{repo}/labels');
    const commentCall = calls.find((c) => c.route.endsWith('/comments'));
    expect(String(commentCall?.params?.body)).toContain('Boot crash');
    const labelCall = calls.find((c) => c.route.endsWith('/labels') && c.params?.labels);
    // "wontfix" is not a real repo label — dropped.
    expect(labelCall?.params?.labels).toEqual(['bug']);
  });
});

describe('dispatch: issue_comment → mention', () => {
  it('answers a @hanzo question using the thread', async () => {
    const { octokit, calls } = fakeOctokit((route) =>
      route.endsWith('/comments') && route.startsWith('GET')
        ? [{ user: { login: 'alice', type: 'User' }, body: 'context here' }]
        : {},
    );
    const captured: Array<{ user: string }> = [];
    const run: RunModel = async (i) => {
      captured.push(i);
      return 'The answer.';
    };

    await dispatch(
      'issue_comment',
      {
        action: 'created',
        repository,
        issue: { number: 3, title: 'Q', body: 'body' },
        comment: { body: '@hanzo what does this do?' },
      },
      octokit,
      config,
      run,
    );

    const post = calls.find((c) => c.route.startsWith('POST') && c.route.endsWith('/comments'));
    expect(String(post?.params?.body)).toContain('The answer.');
    expect(captured[0].user).toContain('what does this do?');
    expect(captured[0].user).toContain('@alice: context here');
  });

  it('ignores a comment without @hanzo', async () => {
    const { octokit, calls } = fakeOctokit(() => ({}));
    await dispatch(
      'issue_comment',
      { action: 'created', repository, issue: { number: 3 }, comment: { body: 'nice' } },
      octokit,
      config,
      stubRun,
    );
    expect(calls).toHaveLength(0);
  });
});

describe('dispatch: unknown event', () => {
  it('does nothing', async () => {
    const { octokit, calls } = fakeOctokit(() => ({}));
    await dispatch('star', { action: 'created', repository }, octokit, config, stubRun);
    expect(calls).toHaveLength(0);
  });
});
