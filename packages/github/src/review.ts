/**
 * PR review core — PURE. No network, no Octokit, no `@hanzo/ai`. Everything here
 * is a total function over its inputs, so the whole review pipeline (diff →
 * windowing → prompt → formatted comment) is unit-testable without a gateway or
 * a GitHub App.
 *
 * The impure edges live in `github-api.ts` (fetch the diff, post the review) and
 * `hanzo.ts` (call the model). This module just transforms text.
 */

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
  'You are Hanzo AI, an expert code reviewer on GitHub pull requests. Review the ' +
  'unified diff for correctness bugs, security issues, and clear design or ' +
  'maintainability problems. Be concise and specific: cite the file and the ' +
  'change, explain the risk, and suggest a fix. Prefer a short list of concrete ' +
  'findings over prose. If the diff looks correct and low-risk, say so plainly ' +
  'in one or two sentences. Use GitHub-flavored Markdown. Work only from the ' +
  'diff — do not invent code that is not shown.';

/** The system prompt for a PR review. Exported so it can be asserted in tests. */
export function reviewSystemPrompt(): string {
  return SYSTEM_PROMPT;
}

/** Metadata about the PR under review, used to frame the prompt. */
export interface PullRequestContext {
  /** PR title. */
  title: string;
  /** PR body / description. May be empty. */
  body: string;
  /** `owner/repo` for the PR. */
  repo: string;
  /** PR number. */
  number: number;
}

/**
 * Assemble the user prompt for a PR review: PR metadata, then the windowed diff
 * fenced so the model treats it as data, then the honest truncation note. Pure.
 */
export function buildReviewPrompt(ctx: PullRequestContext, windowed: WindowedDiff): string {
  const header =
    `Pull request ${ctx.repo}#${ctx.number}: ${ctx.title}\n` +
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
 * Format the model's review text into the body posted as a PR review. Adds the
 * Hanzo AI attribution header so it is unmistakably an automated review and
 * carries the model id for auditability. Pure.
 */
export function formatReviewComment(review: string, model: string): string {
  return `## Hanzo AI review\n\n${review.trim()}\n\n---\n_Reviewed by Hanzo AI (\`${model}\`)._`;
}

/**
 * The full pure pipeline: diff + PR context + budget → the review prompt. The
 * caller feeds the returned prompt to `hanzo.complete`, then wraps the model
 * output with {@link formatReviewComment}. Kept as one function so a test can
 * assert the entire assembly deterministically.
 */
export function assembleReview(
  ctx: PullRequestContext,
  diff: string,
  maxChars: number,
): { prompt: string; windowed: WindowedDiff } {
  const windowed = windowDiff(diff, maxChars);
  return { prompt: buildReviewPrompt(ctx, windowed), windowed };
}
