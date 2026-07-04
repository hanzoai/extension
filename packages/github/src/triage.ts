/**
 * Issue triage core — PURE. Turn an issue into a triage prompt, and parse the
 * model's structured reply back into labels, a severity, and a drafted first
 * response. No network here; the impure edges (post the comment, add labels)
 * live in `github-api.ts`.
 *
 * The model is asked to answer with a small, fixed schema so parsing is a total
 * function, not a heuristic. We recognize a fenced ```labels line, a Severity:
 * line, and everything after a Response: marker.
 */

/** Severity buckets the model may assign. Kept small and orthogonal. */
export const SEVERITIES = ['critical', 'high', 'medium', 'low'] as const;
export type Severity = (typeof SEVERITIES)[number];

/** True when `s` names a known severity. Boundary guard. Pure. */
export function isSeverity(s: string): s is Severity {
  return (SEVERITIES as readonly string[]).includes(s);
}

/** Metadata about the issue under triage. */
export interface IssueContext {
  /** Issue title. */
  title: string;
  /** Issue body. May be empty. */
  body: string;
  /** `owner/repo`. */
  repo: string;
  /** Issue number. */
  number: number;
  /** Labels already available in the repo, so the model picks from real ones. */
  availableLabels: string[];
}

const SYSTEM_PROMPT =
  'You are Hanzo AI, triaging a new GitHub issue. Read the issue and reply in ' +
  'EXACTLY this format and nothing else:\n\n' +
  'Summary: <one sentence>\n' +
  'Severity: <critical|high|medium|low>\n' +
  'Labels: <comma-separated labels chosen ONLY from the provided list, or none>\n' +
  'Response:\n<a short, friendly first reply to the reporter — ask for missing ' +
  'repro details if needed>\n\n' +
  'Do not add any other sections. Choose labels only from the provided list.';

/** The system prompt for triage. Exported for test assertions. */
export function triageSystemPrompt(): string {
  return SYSTEM_PROMPT;
}

/** Assemble the user prompt for triage from the issue context. Pure. */
export function buildTriagePrompt(ctx: IssueContext): string {
  const labels = ctx.availableLabels.length ? ctx.availableLabels.join(', ') : '(none defined)';
  return (
    `Issue ${ctx.repo}#${ctx.number}: ${ctx.title}\n\n` +
    `Body:\n${ctx.body.trim() || '(empty)'}\n\n` +
    `Available labels: ${labels}`
  );
}

/** The parsed result of a triage completion. */
export interface Triage {
  /** One-sentence summary, or '' when the model omitted it. */
  summary: string;
  /** Assigned severity, or undefined when absent/unrecognized. */
  severity?: Severity;
  /** Labels intersected with the repo's real labels (case-insensitive). */
  labels: string[];
  /** The drafted first response to the reporter. */
  response: string;
}

function matchLine(text: string, key: string): string {
  const re = new RegExp(`^\\s*${key}\\s*:\\s*(.+)$`, 'im');
  const m = text.match(re);
  return m ? m[1].trim() : '';
}

/**
 * Parse the model's fixed-format reply into a {@link Triage}. Labels are
 * intersected with `availableLabels` (case-insensitive, returned in the repo's
 * canonical casing) so we never apply a label that does not exist — GitHub
 * would otherwise create it. `none` / `n/a` yields no labels. The Response
 * section is everything after the `Response:` marker. Pure — unit-tested.
 */
export function parseTriage(text: string, availableLabels: string[]): Triage {
  const summary = matchLine(text, 'Summary');

  const sevRaw = matchLine(text, 'Severity').toLowerCase();
  const severity = isSeverity(sevRaw) ? sevRaw : undefined;

  const labels = parseLabelLine(matchLine(text, 'Labels'), availableLabels);

  const respIdx = text.search(/^\s*Response\s*:\s*$/im);
  const inlineIdx = text.search(/^\s*Response\s*:\s*\S/im);
  let response = '';
  if (respIdx >= 0) {
    response = text.slice(text.indexOf('\n', respIdx) + 1).trim();
  } else if (inlineIdx >= 0) {
    response = matchLine(text, 'Response');
  }

  return { summary, severity, labels, response };
}

/**
 * Parse a comma/space-separated label line against the repo's real labels.
 * `none`, `n/a`, and empty all yield `[]`. Matching is case-insensitive but the
 * returned label uses the repo's canonical casing. Duplicates removed. Pure.
 */
export function parseLabelLine(line: string, availableLabels: string[]): string[] {
  const cleaned = line.trim();
  if (!cleaned || /^(none|n\/a|-)$/i.test(cleaned)) return [];
  const canon = new Map(availableLabels.map((l) => [l.toLowerCase(), l]));
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of cleaned.split(/[,\n]/)) {
    const token = raw.trim().replace(/^`|`$/g, '');
    if (!token) continue;
    const hit = canon.get(token.toLowerCase());
    if (hit && !seen.has(hit)) {
      seen.add(hit);
      out.push(hit);
    }
  }
  return out;
}

/**
 * Format the triage into the issue comment body. The summary and drafted reply
 * are shown; severity and labels are surfaced so a maintainer sees the reasoning
 * even though labels are also applied via the API. Pure.
 */
export function formatTriageComment(t: Triage, model: string): string {
  const lines = ['## Hanzo AI triage', ''];
  if (t.summary) lines.push(`**Summary:** ${t.summary}`, '');
  if (t.severity) lines.push(`**Severity:** ${t.severity}`, '');
  if (t.labels.length) lines.push(`**Suggested labels:** ${t.labels.join(', ')}`, '');
  if (t.response) lines.push(t.response.trim(), '');
  lines.push('---', `_Triaged by Hanzo AI (\`${model}\`)._`);
  return lines.join('\n');
}
