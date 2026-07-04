import { describe, it, expect } from 'vitest';
import {
  getPRDiff,
  createReview,
  comment,
  addLabels,
  listRepoLabels,
  getIssueComments,
  type RequestOctokit,
} from '../src/github-api.js';

interface Call {
  route: string;
  params?: Record<string, unknown>;
}

/** A fake Octokit recording calls and returning a scripted `data`. */
function fakeOctokit(dataFor: (route: string) => unknown): {
  octokit: RequestOctokit;
  calls: Call[];
} {
  const calls: Call[] = [];
  const octokit: RequestOctokit = {
    async request(route, params) {
      calls.push({ route, params });
      return { data: dataFor(route) };
    },
  };
  return { octokit, calls };
}

const repo = { owner: 'hanzoai', repo: 'extension' };

describe('getPRDiff', () => {
  it('requests the diff media type and returns the raw string', async () => {
    const { octokit, calls } = fakeOctokit(() => 'diff --git a/x b/x\n+a');
    const diff = await getPRDiff(octokit, repo, 5);
    expect(diff).toBe('diff --git a/x b/x\n+a');
    expect(calls[0].route).toBe('GET /repos/{owner}/{repo}/pulls/{pull_number}');
    expect(calls[0].params).toMatchObject({ pull_number: 5, mediaType: { format: 'diff' } });
  });
});

describe('createReview', () => {
  it('posts a COMMENT review by default', async () => {
    const { octokit, calls } = fakeOctokit(() => ({}));
    await createReview(octokit, repo, 5, 'body');
    expect(calls[0].route).toBe('POST /repos/{owner}/{repo}/pulls/{pull_number}/reviews');
    expect(calls[0].params).toMatchObject({ pull_number: 5, body: 'body', event: 'COMMENT' });
  });
});

describe('comment', () => {
  it('posts an issue comment', async () => {
    const { octokit, calls } = fakeOctokit(() => ({}));
    await comment(octokit, repo, 7, 'hello');
    expect(calls[0].route).toBe('POST /repos/{owner}/{repo}/issues/{issue_number}/comments');
    expect(calls[0].params).toMatchObject({ issue_number: 7, body: 'hello' });
  });
});

describe('addLabels', () => {
  it('is a no-op for an empty list', async () => {
    const { octokit, calls } = fakeOctokit(() => ({}));
    await addLabels(octokit, repo, 7, []);
    expect(calls).toHaveLength(0);
  });

  it('posts labels when present', async () => {
    const { octokit, calls } = fakeOctokit(() => ({}));
    await addLabels(octokit, repo, 7, ['bug', 'crash']);
    expect(calls[0].route).toBe('POST /repos/{owner}/{repo}/issues/{issue_number}/labels');
    expect(calls[0].params).toMatchObject({ issue_number: 7, labels: ['bug', 'crash'] });
  });
});

describe('listRepoLabels', () => {
  it('returns label names only', async () => {
    const { octokit } = fakeOctokit(() => [{ name: 'bug' }, { name: 'crash' }, { id: 1 }]);
    expect(await listRepoLabels(octokit, repo)).toEqual(['bug', 'crash']);
  });
});

describe('getIssueComments', () => {
  it('drops bot comments and empties, returns author+body oldest-first', async () => {
    const { octokit } = fakeOctokit(() => [
      { user: { login: 'alice', type: 'User' }, body: 'first' },
      { user: { login: 'hanzo[bot]', type: 'Bot' }, body: 'auto reply' },
      { user: { login: 'bob', type: 'User' }, body: '   ' },
      { user: { login: 'carol', type: 'User' }, body: 'third' },
    ]);
    const out = await getIssueComments(octokit, repo, 7);
    expect(out).toEqual([
      { author: 'alice', body: 'first' },
      { author: 'carol', body: 'third' },
    ]);
  });
});
