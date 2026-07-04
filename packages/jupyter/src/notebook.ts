// Pure notebook/cell → context text. This module knows nothing about the
// JupyterLab widget layer (@jupyterlab/notebook, @lumino) — index.ts adapts the
// live NotebookPanel into the plain {@link CellData}/{@link NotebookData} shapes
// here, and everything below is deterministic and unit-tested. Keeping the
// context assembly, output/traceback extraction, and truncation pure is what
// makes the model-facing behavior testable without a running kernel.

/** The kinds of cell JupyterLab surfaces. Markdown/raw carry no outputs. */
export type CellType = 'code' | 'markdown' | 'raw';

/**
 * One rendered cell output, reduced to the two things the model cares about:
 * a kind and its text. `stream` is stdout/stderr, `error` is a traceback,
 * `execute_result`/`display_data` are the cell's value(s). Binary MIME outputs
 * (images, widgets) reduce to '' and are dropped by the extractors.
 */
export interface CellOutput {
  kind: 'stream' | 'execute_result' | 'display_data' | 'error';
  text: string;
  /** Present for `error` outputs: the exception class and message. */
  ename?: string;
  evalue?: string;
}

/** A single notebook cell reduced to what the context assembler needs. */
export interface CellData {
  type: CellType;
  source: string;
  /** Only code cells carry outputs; undefined/[] otherwise. */
  outputs?: CellOutput[];
  /** The `[N]` execution counter for code cells, when the cell has run. */
  executionCount?: number | null;
}

/** A notebook reduced to an ordered list of {@link CellData}. */
export interface NotebookData {
  cells: CellData[];
}

// The model's context window is finite; a real analysis notebook can be huge.
// Cap the assembled context so a big notebook never blows the request. Chosen
// to fit comfortably alongside the response in a modern context window.
export const MAX_CONTEXT_CHARS = 48_000;

// Cap a single cell's output block: a runaway loop or a giant DataFrame dump
// must not crowd out the source the model actually needs to reason about.
export const MAX_OUTPUT_CHARS = 4_000;

/**
 * truncate cuts text to a max length, appending a visible marker so the model
 * (and the reviewing user) know content was elided. Truncating from the END
 * keeps the head, which for source and tracebacks is the most informative part.
 * Pure.
 */
export function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  return text.slice(0, max) + `\n…[truncated ${text.length - max} chars]`;
}

/**
 * truncateTail keeps the TAIL of text, used for long stdout/stream output where
 * the final lines (the result, the error that follows) matter more than the
 * scrollback. Pure.
 */
export function truncateTail(text: string, max: number): string {
  if (text.length <= max) return text;
  return `…[truncated ${text.length - max} chars]\n` + text.slice(text.length - max);
}

// ── Output / traceback extraction ────────────────────────────────────────────

// ANSI SGR escape sequences colour Jupyter tracebacks; they are noise to a
// model and inflate the char budget. Strip them. Pattern matches CSI … m.
// eslint-disable-next-line no-control-regex
const ANSI_RE = /\[[0-9;]*m/g;

/** stripAnsi removes ANSI colour codes from traceback/stream text. Pure. */
export function stripAnsi(text: string): string {
  return text.replace(ANSI_RE, '');
}

/**
 * errorOutputs returns just the `error` outputs of a cell — the tracebacks the
 * "fix / debug" action is built around. Empty when the cell ran clean. Pure.
 */
export function errorOutputs(cell: CellData): CellOutput[] {
  return (cell.outputs ?? []).filter((o) => o.kind === 'error');
}

/** hasError is true when the cell produced at least one error output. Pure. */
export function hasError(cell: CellData): boolean {
  return errorOutputs(cell).length > 0;
}

/**
 * formatError renders one error output as the "ename: evalue" head plus its
 * (ANSI-stripped, head-truncated) traceback. This is the exact text the fix
 * action shows the model. Pure — unit-tested.
 */
export function formatError(err: CellOutput, max = MAX_OUTPUT_CHARS): string {
  const head =
    err.ename || err.evalue
      ? `${err.ename ?? 'Error'}: ${err.evalue ?? ''}`.trim()
      : '';
  const trace = truncate(stripAnsi(err.text).trim(), max);
  return [head, trace].filter(Boolean).join('\n');
}

/**
 * cellErrorText concatenates every error output of a cell into one block for
 * the fix action, or '' when the cell has no error. Pure — unit-tested.
 */
export function cellErrorText(cell: CellData, max = MAX_OUTPUT_CHARS): string {
  return errorOutputs(cell)
    .map((e) => formatError(e, max))
    .join('\n\n');
}

/**
 * cellOutputText renders a cell's NON-error outputs (stream + results) into a
 * single readable block, ANSI-stripped and tail-truncated (recent output is the
 * useful part). Errors are excluded here — the fix action reads them via
 * {@link cellErrorText}. Returns '' when there is nothing textual. Pure.
 */
export function cellOutputText(cell: CellData, max = MAX_OUTPUT_CHARS): string {
  const parts: string[] = [];
  for (const o of cell.outputs ?? []) {
    if (o.kind === 'error') continue;
    const t = stripAnsi(o.text).trim();
    if (t) parts.push(t);
  }
  if (parts.length === 0) return '';
  return truncateTail(parts.join('\n'), max);
}

// ── Cell → context text ──────────────────────────────────────────────────────

/**
 * cellContext renders ONE cell to the fenced text the model sees: a language
 * hint on the fence for code, the source, then (optionally) its outputs and any
 * error. `includeOutputs` is off for actions that only need the source (explain,
 * optimize, document); the fix action turns it on to feed the traceback. Pure —
 * unit-tested.
 */
export function cellContext(
  cell: CellData,
  opts: { includeOutputs?: boolean } = {},
): string {
  if (cell.type !== 'code') {
    const label = cell.type === 'markdown' ? 'markdown' : 'text';
    return `\`\`\`${label}\n${cell.source.trim()}\n\`\`\``;
  }
  const lines = ['```python', cell.source.trim() === '' ? '' : cell.source, '```'];
  let out = lines.join('\n');
  if (opts.includeOutputs) {
    const stdout = cellOutputText(cell);
    if (stdout) out += `\n\nOutput:\n\`\`\`\n${stdout}\n\`\`\``;
    const err = cellErrorText(cell);
    if (err) out += `\n\nError:\n\`\`\`\n${err}\n\`\`\``;
  }
  return out;
}

/**
 * notebookContext renders a whole notebook (or a selection) to one string for
 * the side-panel "whole notebook" mode. Cells are numbered so the model can
 * refer to them; markdown/raw cells are included (they carry the narrative).
 * Outputs are omitted here to keep the budget for source across many cells.
 * Capped at maxChars. Pure — unit-tested.
 */
export function notebookContext(
  nb: NotebookData,
  maxChars = MAX_CONTEXT_CHARS,
): string {
  const blocks: string[] = [];
  nb.cells.forEach((cell, i) => {
    const body = cellContext(cell, { includeOutputs: false });
    if (body.replace(/```[a-z]*|```/g, '').trim() === '') return; // skip empty cells
    blocks.push(`Cell [${i + 1}] (${cell.type}):\n${body}`);
  });
  return truncate(blocks.join('\n\n'), maxChars);
}

/**
 * stripFences removes a leading ```lang / trailing ``` wrapper if the model
 * returned one despite the instruction not to — so inserted code is runnable.
 * Belt-and-suspenders: the action contract asks for no fences, this guarantees
 * it. Lives in the pure module so it is unit-testable without the widget layer.
 * Pure.
 */
export function stripFences(text: string): string {
  const trimmed = text.trim();
  const fence = /^```[a-zA-Z0-9]*\n([\s\S]*?)\n```$/;
  const m = trimmed.match(fence);
  return (m ? m[1] : trimmed).trim();
}
