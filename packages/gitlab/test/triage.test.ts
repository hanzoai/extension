import { describe, it, expect } from 'vitest';
import {
  buildTriagePrompt,
  parseTriage,
  parseLabelLine,
  formatTriageNote,
  triageSystemPrompt,
  isSeverity,
  type IssueContext,
} from '../src/triage.js';

const ctx: IssueContext = {
  title: 'Crash on startup',
  body: 'App crashes when I run it.',
  project: 'hanzoai/extension',
  iid: 7,
  availableLabels: ['bug', 'crash', 'needs-info', 'enhancement'],
};

describe('buildTriagePrompt', () => {
  it('carries title, body, and the available label list', () => {
    const p = buildTriagePrompt(ctx);
    expect(p).toContain('hanzoai/extension#7');
    expect(p).toContain('Crash on startup');
    expect(p).toContain('App crashes when I run it.');
    expect(p).toContain('bug, crash, needs-info, enhancement');
  });

  it('shows (empty) for a missing body and (none defined) for no labels', () => {
    const p = buildTriagePrompt({ ...ctx, body: '', availableLabels: [] });
    expect(p).toContain('(empty)');
    expect(p).toContain('(none defined)');
  });
});

describe('parseLabelLine', () => {
  it('intersects with real labels case-insensitively, canonical casing out', () => {
    expect(parseLabelLine('Bug, CRASH', ctx.availableLabels)).toEqual(['bug', 'crash']);
  });

  it('drops labels not defined in the project', () => {
    expect(parseLabelLine('bug, wontfix, crash', ctx.availableLabels)).toEqual(['bug', 'crash']);
  });

  it('treats none / n/a / empty as no labels', () => {
    expect(parseLabelLine('none', ctx.availableLabels)).toEqual([]);
    expect(parseLabelLine('n/a', ctx.availableLabels)).toEqual([]);
    expect(parseLabelLine('   ', ctx.availableLabels)).toEqual([]);
  });

  it('strips backticks and de-duplicates', () => {
    expect(parseLabelLine('`bug`, bug, crash', ctx.availableLabels)).toEqual(['bug', 'crash']);
  });

  it('matches scoped GitLab labels verbatim', () => {
    const labels = ['priority::high', 'type::bug'];
    expect(parseLabelLine('priority::high, type::bug', labels)).toEqual([
      'priority::high',
      'type::bug',
    ]);
  });
});

describe('parseTriage', () => {
  it('parses the full fixed-format reply', () => {
    const reply = [
      'Summary: The app crashes at boot.',
      'Severity: high',
      'Labels: bug, crash',
      'Response:',
      'Thanks for the report! Can you share the log output?',
    ].join('\n');
    const t = parseTriage(reply, ctx.availableLabels);
    expect(t.summary).toBe('The app crashes at boot.');
    expect(t.severity).toBe('high');
    expect(t.labels).toEqual(['bug', 'crash']);
    expect(t.response).toBe('Thanks for the report! Can you share the log output?');
  });

  it('ignores an unrecognized severity', () => {
    const t = parseTriage('Severity: catastrophic\nLabels: none', ctx.availableLabels);
    expect(t.severity).toBeUndefined();
  });

  it('handles an inline Response on the same line', () => {
    const t = parseTriage('Summary: x\nResponse: Just do Y.', ctx.availableLabels);
    expect(t.response).toBe('Just do Y.');
  });

  it('preserves a multi-paragraph response', () => {
    const reply = 'Summary: x\nSeverity: low\nLabels: none\nResponse:\nHi there.\n\nMore detail.';
    const t = parseTriage(reply, ctx.availableLabels);
    expect(t.response).toBe('Hi there.\n\nMore detail.');
    expect(t.labels).toEqual([]);
  });
});

describe('isSeverity', () => {
  it('recognizes the four buckets and nothing else', () => {
    expect(isSeverity('critical')).toBe(true);
    expect(isSeverity('low')).toBe(true);
    expect(isSeverity('urgent')).toBe(false);
  });
});

describe('formatTriageNote', () => {
  it('renders summary, severity, labels, response, and attribution', () => {
    const out = formatTriageNote(
      { summary: 'Boot crash', severity: 'high', labels: ['bug'], response: 'Thanks!' },
      'zen5',
    );
    expect(out).toContain('## Hanzo AI triage');
    expect(out).toContain('**Summary:** Boot crash');
    expect(out).toContain('**Severity:** high');
    expect(out).toContain('**Suggested labels:** bug');
    expect(out).toContain('Thanks!');
    expect(out).toContain('`zen5`');
  });

  it('omits absent sections', () => {
    const out = formatTriageNote({ summary: '', labels: [], response: 'Hi' }, 'zen5');
    expect(out).not.toContain('**Summary:**');
    expect(out).not.toContain('**Severity:**');
    expect(out).not.toContain('**Suggested labels:**');
  });
});

describe('triageSystemPrompt', () => {
  it('demands the fixed reply schema', () => {
    const p = triageSystemPrompt();
    expect(p).toContain('Severity:');
    expect(p).toContain('Labels:');
    expect(p).toContain('Response:');
  });
});
