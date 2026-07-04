import { describe, it, expect } from 'vitest';
import {
  changesToDiff,
  splitDiffByFile,
  windowDiff,
  diffTruncationNote,
  assembleReview,
  buildReviewPrompt,
  formatReviewNote,
  reviewSystemPrompt,
  type FileChange,
  type MergeRequestContext,
} from '../src/review.js';

function fileDiff(path: string, body: string): string {
  return `diff --git a/${path} b/${path}\nindex 000..111 100644\n--- a/${path}\n+++ b/${path}\n${body}`;
}

function change(path: string, body: string): FileChange {
  // GitLab's per-file `diff` body has no `diff --git` header — it starts at the
  // index/hunk lines. `changesToDiff` reconstructs the header.
  return {
    old_path: path,
    new_path: path,
    diff: `index 000..111 100644\n--- a/${path}\n+++ b/${path}\n${body}`,
  };
}

const ctx: MergeRequestContext = {
  title: 'Add feature',
  body: 'This adds a feature.',
  project: 'hanzoai/extension',
  iid: 42,
};

describe('changesToDiff', () => {
  it('reconstructs a `diff --git` header per file change', () => {
    const diff = changesToDiff([change('a.ts', '+a'), change('b.ts', '+b')]);
    expect(diff).toContain('diff --git a/a.ts b/a.ts');
    expect(diff).toContain('diff --git a/b.ts b/b.ts');
    // Downstream splitting sees two files.
    expect(splitDiffByFile(diff)).toHaveLength(2);
  });

  it('honors a rename (old_path != new_path)', () => {
    const diff = changesToDiff([
      { old_path: 'old.ts', new_path: 'new.ts', diff: '--- a/old.ts\n+++ b/new.ts\n+x' },
    ]);
    expect(diff).toContain('diff --git a/old.ts b/new.ts');
  });

  it('returns empty for no changes', () => {
    expect(changesToDiff([])).toBe('');
  });
});

describe('splitDiffByFile', () => {
  it('splits a multi-file diff at each `diff --git` header', () => {
    const diff = [fileDiff('a.ts', '+a'), fileDiff('b.ts', '+b')].join('\n');
    const parts = splitDiffByFile(diff);
    expect(parts).toHaveLength(2);
    expect(parts[0]).toContain('a/a.ts');
    expect(parts[1]).toContain('a/b.ts');
    expect(parts[1].startsWith('diff --git')).toBe(true);
  });

  it('returns [] for empty input', () => {
    expect(splitDiffByFile('')).toEqual([]);
  });

  it('handles a single-file diff', () => {
    const parts = splitDiffByFile(fileDiff('a.ts', '+a'));
    expect(parts).toHaveLength(1);
  });
});

describe('windowDiff', () => {
  it('keeps all files when under budget', () => {
    const diff = [fileDiff('a.ts', '+a'), fileDiff('b.ts', '+b')].join('\n');
    const w = windowDiff(diff, 10_000);
    expect(w.truncated).toBe(false);
    expect(w.filesIncluded).toBe(2);
    expect(w.filesOmitted).toBe(0);
    expect(w.text).toContain('a/a.ts');
    expect(w.text).toContain('a/b.ts');
  });

  it('drops whole files past the budget and reports the count', () => {
    const f1 = fileDiff('a.ts', '+a'.repeat(50));
    const f2 = fileDiff('b.ts', '+b'.repeat(50));
    const f3 = fileDiff('c.ts', '+c'.repeat(50));
    const diff = [f1, f2, f3].join('\n');
    const w = windowDiff(diff, f1.length + 5);
    expect(w.truncated).toBe(true);
    expect(w.filesIncluded).toBe(1);
    expect(w.filesOmitted).toBe(2);
    expect(w.text).toContain('a/a.ts');
    expect(w.text).not.toContain('a/b.ts');
  });

  it('always admits at least one file, hard-capping a huge first file', () => {
    const huge = fileDiff('big.ts', '+x'.repeat(1000));
    const w = windowDiff(huge, 100);
    expect(w.filesIncluded).toBe(1);
    expect(w.truncated).toBe(true);
    expect(w.text.length).toBe(100);
  });

  it('returns an empty window for an empty diff', () => {
    const w = windowDiff('', 100);
    expect(w).toEqual({ text: '', truncated: false, filesIncluded: 0, filesOmitted: 0 });
  });
});

describe('diffTruncationNote', () => {
  it('is empty when not truncated', () => {
    expect(
      diffTruncationNote({ text: '', truncated: false, filesIncluded: 1, filesOmitted: 0 }),
    ).toBe('');
  });

  it('reports omitted files honestly', () => {
    const note = diffTruncationNote({ text: '', truncated: true, filesIncluded: 2, filesOmitted: 3 });
    expect(note).toContain('2 file(s) shown, 3 omitted');
  });

  it('reports a single hard-capped file', () => {
    const note = diffTruncationNote({ text: '', truncated: true, filesIncluded: 1, filesOmitted: 0 });
    expect(note).toContain('single large file was cut');
  });
});

describe('assembleReview / buildReviewPrompt', () => {
  it('includes MR metadata, fenced diff, and truncation note', () => {
    const changes = [change('a.ts', '+a'.repeat(50)), change('b.ts', '+b'.repeat(50))];
    const { prompt, windowed } = assembleReview(ctx, changes, 80);
    expect(prompt).toContain('hanzoai/extension!42');
    expect(prompt).toContain('Add feature');
    expect(prompt).toContain('This adds a feature.');
    expect(prompt).toContain('```diff');
    expect(windowed.truncated).toBe(true);
    expect(prompt).toContain('diff truncated');
  });

  it('omits the description block when body is empty', () => {
    const prompt = buildReviewPrompt(
      { ...ctx, body: '' },
      { text: 'x', truncated: false, filesIncluded: 1, filesOmitted: 0 },
    );
    expect(prompt).not.toContain('Description:');
  });
});

describe('formatReviewNote', () => {
  it('adds the Hanzo attribution header and model id', () => {
    const out = formatReviewNote('  Looks good.  ', 'zen5');
    expect(out).toContain('## Hanzo AI review');
    expect(out).toContain('Looks good.');
    expect(out).toContain('`zen5`');
  });
});

describe('reviewSystemPrompt', () => {
  it('frames the assistant as a code reviewer working only from the diff', () => {
    const p = reviewSystemPrompt();
    expect(p).toContain('code reviewer');
    expect(p).toContain('merge requests');
    expect(p).toContain('do not invent');
  });
});
