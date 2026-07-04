import { describe, it, expect } from 'vitest';
import {
  buildMentionPrompt,
  formatMentionComment,
  mentionSystemPrompt,
  type MentionContext,
} from '../src/mention.js';

const ctx: MentionContext = {
  repo: 'hanzoai/extension',
  number: 9,
  isPullRequest: false,
  title: 'How do I configure X?',
  body: 'I cannot find the setting.',
  comments: [
    { author: 'alice', body: 'Same here.' },
    { author: 'bob', body: 'Try the config file.' },
  ],
};

describe('buildMentionPrompt', () => {
  it('carries the issue metadata, thread, and the question', () => {
    const p = buildMentionPrompt(ctx, 'where is the setting?');
    expect(p).toContain('issue hanzoai/extension#9');
    expect(p).toContain('How do I configure X?');
    expect(p).toContain('@alice: Same here.');
    expect(p).toContain('@bob: Try the config file.');
    expect(p).toContain('where is the setting?');
  });

  it('labels a PR thread as a pull request', () => {
    const p = buildMentionPrompt({ ...ctx, isPullRequest: true }, 'q');
    expect(p).toContain('pull request hanzoai/extension#9');
  });

  it('falls back to summarize for a bare mention', () => {
    const p = buildMentionPrompt(ctx, '');
    expect(p).toContain('Summarize the thread');
  });

  it('handles an empty thread', () => {
    const p = buildMentionPrompt({ ...ctx, comments: [] }, 'q');
    expect(p).toContain('(no prior comments)');
  });
});

describe('formatMentionComment', () => {
  it('appends the Hanzo attribution with model id', () => {
    const out = formatMentionComment('Here is the answer.', 'zen5');
    expect(out).toContain('Here is the answer.');
    expect(out).toContain('_Answered by Hanzo AI (`zen5`)._');
  });
});

describe('mentionSystemPrompt', () => {
  it('frames a context-bound answer', () => {
    expect(mentionSystemPrompt()).toContain('@hanzo');
    expect(mentionSystemPrompt()).toContain('Do not invent facts');
  });
});
