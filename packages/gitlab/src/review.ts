/**
 * MR review core — PURE. No network, no REST client, no `@hanzo/ai`. Everything
 * here is a total function over its inputs, so the whole review pipeline
 * (GitLab changes → unified diff → windowing → prompt → formatted note) is
 * unit-testable without a GitLab host or a gateway.
 *
 * The impure edges live in `gitlab-api.ts` (fetch the changes, post the note)
 * and `hanzo.ts` (call the model). This module just transforms text.
 */

/**
 * One file's change as returned by GitLab's MR changes endpoint. GitLab gives
 * structured changes (paths + a per-file `diff` body without the `diff --git`
 * header), so we reconstruct a standard unified diff to feed the model — the one
 * representation reviewers and models both understand.
 */
export interface FileChange {
  /** Path before the change (== new_path unless renamed). */
  old_path: string;
  /** Path after the change. */
  new_path: string;
  /** The unified-diff hunk body for this file (no `diff --git` line). */
  diff: string;
  /** True when the file was created in this MR. */
  new_file?: boolean;
  /** True when the file was deleted in this MR. */
  deleted_file?: boolean;
  /** True when the file was renamed. */
  renamed_file?: boolean;
}

/**
 * Reconstruct a standard unified diff from GitLab's structured file changes.
 * Each file gets a `diff --git a/<old> b/<new>` header so downstream windowing
 * (which splits on that marker) works identically to a GitHub PR diff — one diff
 * representation, one windowing path. Pure.
 */
export function changesToDiff(changes: FileChange[]): string {
  return changes
    .map((c) => {
      const header = `diff --git a/${c.old_path} b/${c.new_path}`;
      const body = c.diff.endsWith('\n') ? c.diff.slice(0, -1) : c.diff;
      return `${header}\n${body}`;
    })
    .join('\n');
}

/** A unified diff that has been windowed to fit a model budget. */
export interface WindowedDiff {
  /** The (possibly truncated) diff text. */
  text: string;
  /** True when the original exceeded the budget and files were dropped. */
  truncated: boolean;
  /** Files kept whole in {@link text}. */
  filesIncluded: number;
  /** Files dropped by truncation (0 when not truncated). */
  filesOmitted: number;
}

/**
 * Split a unified diff into per-file chunks. Each chunk starts at a `diff --git`
 * line and runs until the next one. Text before the first `diff --git` (rare
 * preamble) is attached to the first file so nothing is lost. Pure.
 */
export function splitDiffByFile(diff: string): string[] {
  if (!diff) return [];
  const marker = '\ndiff --git ';
  const normalized = diff.startsWith('diff --git ') ? diff : `\n${diff}`;
  const parts = normalized.split(marker);
  const chunks = parts.map((p, i) => (i === 0 ? p : `diff --git ${p}`));
  return chunks.map((c) => c.replace(/^\n/, '')).filter((c) => c.length > 0);
}

/**
 * Window a diff to `maxChars` by keeping whole files until the budget is spent,
 * then dropping the rest. Whole-file granularity keeps every hunk shown to the
 * model syntactically complete — never a half-file that reads as a bug. When a
 * single first file alone exceeds the budget it is hard-truncated so a huge
 * generated file can't starve the review entirely. Pure — the honest note is
 * added by {@link diffTruncationNote}, not here.
 */
export function windowDiff(diff: string, maxChars: number): WindowedDiff {
  const files = splitDiffByFile(diff);
  if (files.length === 0) return { text: '', truncated: false, filesIncluded: 0, filesOmitted: 0 };

  const kept: string[] = [];
  let used = 0;
  let firstFileCut = false;
  for (const file of files) {
    if (kept.length === 0 && file.length > maxChars) {
      // The very first file alone overflows: hard-cap it so a huge generated
      // file can't starve the review, and stop.
      kept.push(file.slice(0, maxChars));
      used = maxChars;
      firstFileCut = true;
      break;
    }
    if (used + file.length > maxChars) break; // budget spent — drop the rest
    kept.push(file);
    used += file.length;
  }

  const filesIncluded = kept.length;
  const filesOmitted = files.length - filesIncluded;
  return {
    text: kept.join('\n'),
    truncated: filesOmitted > 0 || firstFileCut,
    filesIncluded,
    filesOmitted,
  };
}

/** The honest truncation note appended to a windowed diff. Pure. */
export function diffTruncationNote(w: WindowedDiff): string {
  if (!w.truncated) return '';
  if (w.filesOmitted > 0) {
    return (
      `\n\n---- NOTE: diff truncated ----\n` +
      `${w.filesIncluded} file(s) shown, ${w.filesOmitted} omitted to fit the ` +
      `model window. Review is based only on the files above.`
    );
  }
  return (
    `\n\n---- NOTE: diff truncated ----\n` +
    `A single large file was cut to fit the model window. Review is based only ` +
    `on the portion above.`
  );
}

const SYSTEM_PROMPT =
  'You are Hanzo AI, an expert code reviewer on GitLab merge requests. Review the ' +
  'unified diff for correctness bugs, security issues, and clear design or ' +
  'maintainability problems. Be concise and specific: cite the file and the ' +
  'change, explain the risk, and suggest a fix. Prefer a short list of concrete ' +
  'findings over prose. If the diff looks correct and low-risk, say so plainly ' +
  'in one or two sentences. Use GitLab-flavored Markdown. Work only from the ' +
  'diff — do not invent code that is not shown.';

/** The system prompt for an MR review. Exported so it can be asserted in tests. */
export function reviewSystemPrompt(): string {
  return SYSTEM_PROMPT;
}

/** Metadata about the MR under review, used to frame the prompt. */
export interface MergeRequestContext {
  /** MR title. */
  title: string;
  /** MR description. May be empty. */
  body: string;
  /** `namespace/project` path for the MR. */
  project: string;
  /** MR internal id (the `!123` number in the project). */
  iid: number;
}

/**
 * Assemble the user prompt for an MR review: MR metadata, then the windowed diff
 * fenced so the model treats it as data, then the honest truncation note. Pure.
 */
export function buildReviewPrompt(ctx: MergeRequestContext, windowed: WindowedDiff): string {
  const header =
    `Merge request ${ctx.project}!${ctx.iid}: ${ctx.title}\n` +
    (ctx.body.trim() ? `\nDescription:\n${ctx.body.trim()}\n` : '');
  return (
    `${header}\n` +
    `Review the following unified diff.\n\n` +
    '```diff\n' +
    windowed.text +
    '\n```' +
    diffTruncationNote(windowed)
  );
}

/**
 * Format the model's review text into the note body posted on the MR. Adds the
 * Hanzo AI attribution header so it is unmistakably an automated review and
 * carries the model id for auditability. Pure.
 */
export function formatReviewNote(review: string, model: string): string {
  return `## Hanzo AI review\n\n${review.trim()}\n\n---\n_Reviewed by Hanzo AI (\`${model}\`)._`;
}

/**
 * The full pure pipeline: GitLab changes + MR context + budget → the review
 * prompt. The caller feeds the returned prompt to `hanzo.complete`, then wraps
 * the model output with {@link formatReviewNote}. Kept as one function so a test
 * can assert the entire assembly deterministically.
 */
export function assembleReview(
  ctx: MergeRequestContext,
  changes: FileChange[],
  maxChars: number,
): { prompt: string; windowed: WindowedDiff } {
  const windowed = windowDiff(changesToDiff(changes), maxChars);
  return { prompt: buildReviewPrompt(ctx, windowed), windowed };
}
