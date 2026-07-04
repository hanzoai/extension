import { describe, it, expect } from 'vitest';
import {
  truncate,
  truncateTail,
  stripAnsi,
  errorOutputs,
  hasError,
  formatError,
  cellErrorText,
  cellOutputText,
  cellContext,
  notebookContext,
  stripFences,
  MAX_CONTEXT_CHARS,
  type CellData,
  type CellOutput,
} from '../src/notebook';

// ── truncation ───────────────────────────────────────────────────────────────

describe('truncate', () => {
  it('leaves short text unchanged', () => {
    expect(truncate('hello', 10)).toBe('hello');
  });
  it('cuts the tail and marks the elision', () => {
    const out = truncate('abcdefghij', 4);
    expect(out.startsWith('abcd')).toBe(true);
    expect(out).toContain('truncated 6 chars');
  });
  it('keeps the head (most informative for source/tracebacks)', () => {
    expect(truncate('HEAD-tail', 4).startsWith('HEAD')).toBe(true);
  });
});

describe('truncateTail', () => {
  it('leaves short text unchanged', () => {
    expect(truncateTail('hello', 10)).toBe('hello');
  });
  it('keeps the tail and marks the elision', () => {
    const out = truncateTail('abcdefghij', 4);
    expect(out.endsWith('ghij')).toBe(true);
    expect(out).toContain('truncated 6 chars');
  });
});

// ── ANSI stripping ───────────────────────────────────────────────────────────

describe('stripAnsi', () => {
  it('removes SGR color codes from a traceback', () => {
    const colored = '[0;31mValueError[0m: bad';
    expect(stripAnsi(colored)).toBe('ValueError: bad');
  });
  it('is a no-op on clean text', () => {
    expect(stripAnsi('plain text')).toBe('plain text');
  });
});

// ── error extraction ─────────────────────────────────────────────────────────

const errCell: CellData = {
  type: 'code',
  source: 'x = 1/0',
  executionCount: 3,
  outputs: [
    { kind: 'stream', text: 'starting\n' },
    {
      kind: 'error',
      ename: 'ZeroDivisionError',
      evalue: 'division by zero',
      text: '[0;31mTraceback[0m\n  File "<ipython>", line 1\nZeroDivisionError: division by zero',
    },
  ],
};

const cleanCell: CellData = {
  type: 'code',
  source: 'print(2 + 2)',
  executionCount: 1,
  outputs: [{ kind: 'stream', text: '4\n' }],
};

describe('errorOutputs / hasError', () => {
  it('finds the error output', () => {
    expect(errorOutputs(errCell)).toHaveLength(1);
    expect(hasError(errCell)).toBe(true);
  });
  it('reports clean cells as error-free', () => {
    expect(errorOutputs(cleanCell)).toHaveLength(0);
    expect(hasError(cleanCell)).toBe(false);
  });
  it('handles cells with no outputs', () => {
    expect(hasError({ type: 'code', source: 'y = 1' })).toBe(false);
  });
});

describe('formatError', () => {
  it('renders "ename: evalue" head then the ansi-stripped traceback', () => {
    const err = errorOutputs(errCell)[0];
    const out = formatError(err);
    expect(out).toContain('ZeroDivisionError: division by zero');
    expect(out).toContain('Traceback');
    expect(out).not.toContain('['); // ansi removed
  });
  it('truncates a huge traceback', () => {
    const big: CellOutput = { kind: 'error', ename: 'E', evalue: 'v', text: 'x'.repeat(9000) };
    expect(formatError(big, 100).length).toBeLessThan(300);
  });
});

describe('cellErrorText', () => {
  it('concatenates error blocks for the fix action', () => {
    expect(cellErrorText(errCell)).toContain('ZeroDivisionError');
  });
  it('is empty for a clean cell', () => {
    expect(cellErrorText(cleanCell)).toBe('');
  });
});

describe('cellOutputText', () => {
  it('includes stream output but excludes errors', () => {
    const txt = cellOutputText(errCell);
    expect(txt).toContain('starting');
    expect(txt).not.toContain('ZeroDivisionError');
  });
  it('returns "" when there is no textual non-error output', () => {
    expect(cellOutputText({ type: 'code', source: 'x=1' })).toBe('');
  });
});

// ── cell → context ───────────────────────────────────────────────────────────

describe('cellContext', () => {
  it('fences code cells as python and omits outputs by default', () => {
    const ctx = cellContext(cleanCell);
    expect(ctx).toContain('```python');
    expect(ctx).toContain('print(2 + 2)');
    expect(ctx).not.toContain('Output:');
  });
  it('includes outputs and errors when asked (fix action path)', () => {
    const ctx = cellContext(errCell, { includeOutputs: true });
    expect(ctx).toContain('Output:');
    expect(ctx).toContain('starting');
    expect(ctx).toContain('Error:');
    expect(ctx).toContain('ZeroDivisionError');
  });
  it('fences markdown cells as markdown', () => {
    const ctx = cellContext({ type: 'markdown', source: '# Title' });
    expect(ctx).toContain('```markdown');
    expect(ctx).toContain('# Title');
  });
  it('fences raw cells as text', () => {
    const ctx = cellContext({ type: 'raw', source: 'literal' });
    expect(ctx).toContain('```text');
  });
});

// ── notebook → context ───────────────────────────────────────────────────────

describe('notebookContext', () => {
  const nb = {
    cells: [
      { type: 'markdown', source: '# Analysis' } as CellData,
      { type: 'code', source: 'import pandas as pd' } as CellData,
      { type: 'code', source: '' } as CellData, // empty — skipped
      { type: 'code', source: 'df.head()' } as CellData,
    ],
  };
  it('numbers cells and labels their type', () => {
    const ctx = notebookContext(nb);
    expect(ctx).toContain('Cell [1] (markdown)');
    expect(ctx).toContain('Cell [2] (code)');
    expect(ctx).toContain('import pandas as pd');
  });
  it('skips empty cells (they carry no signal)', () => {
    const ctx = notebookContext(nb);
    // the empty code cell at index 2 must not appear as its own block
    expect(ctx).toContain('df.head()');
    expect(ctx).not.toMatch(/Cell \[3\] \(code\):\n```python\n\n```/);
  });
  it('caps the whole notebook at the char budget', () => {
    const huge = { cells: [{ type: 'code', source: 'x'.repeat(200000) } as CellData] };
    expect(notebookContext(huge).length).toBeLessThanOrEqual(MAX_CONTEXT_CHARS + 80);
  });
});

// ── stripFences ──────────────────────────────────────────────────────────────

describe('stripFences', () => {
  it('unwraps a ```python fenced block', () => {
    expect(stripFences('```python\nprint(1)\n```')).toBe('print(1)');
  });
  it('unwraps an unlabeled fence', () => {
    expect(stripFences('```\nx = 1\n```')).toBe('x = 1');
  });
  it('leaves already-clean code untouched', () => {
    expect(stripFences('x = 1\ny = 2')).toBe('x = 1\ny = 2');
  });
  it('does not strip an inner fence that is not a full wrapper', () => {
    const s = 'text ```not a wrapper``` more';
    expect(stripFences(s)).toBe(s);
  });
});
