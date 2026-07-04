/**
 * Webhook boundary — PURE. Two responsibilities, both total functions:
 *
 *  1. Verify the GitHub `X-Hub-Signature-256` HMAC over the raw body, in
 *     constant time. This is the security gate: nothing is processed until the
 *     signature matches the shared secret.
 *  2. Route a verified event to an intent — the `(event, action)` pair maps to
 *     exactly one of: review a PR, triage an issue, answer an `@hanzo` mention,
 *     or ignore. Routing is a lookup, not a pile of `if`s, so it is exhaustively
 *     testable and there is one obvious place to add an event.
 *
 * `crypto` is the standard library — no dependency for HMAC. The dispatch that
 * turns an intent into Octokit + model calls lives in `app.ts`; this module only
 * decides *what* to do, never *how*.
 */

import { createHmac, timingSafeEqual } from 'node:crypto';

/** The signature scheme header GitHub sends. */
export const SIGNATURE_HEADER = 'x-hub-signature-256';

/**
 * Compute the `sha256=<hex>` signature GitHub would send for `body` under
 * `secret`. Pure — used by both {@link verifySignature} and tests. Exposed so a
 * test can generate a valid signature without duplicating the HMAC.
 */
export function sign(body: string, secret: string): string {
  const mac = createHmac('sha256', secret).update(body, 'utf8').digest('hex');
  return `sha256=${mac}`;
}

/**
 * Constant-time verification of GitHub's `X-Hub-Signature-256` over the RAW
 * request body. Returns false (never throws) on any malformed input — a missing
 * or wrong-length signature is simply invalid. `timingSafeEqual` avoids leaking
 * the secret through response timing. Pure.
 */
export function verifySignature(body: string, signature: string | undefined, secret: string): boolean {
  if (!signature || !secret) return false;
  const expected = sign(body, secret);
  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  // timingSafeEqual requires equal lengths; unequal length ⇒ not a match.
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

/** What a verified webhook should cause the app to do. */
export type Intent =
  | { kind: 'review_pr' }
  | { kind: 'triage_issue' }
  | { kind: 'answer_mention'; question: string }
  | { kind: 'ignore'; reason: string };

/** The `@hanzo <question>` trigger. Case-insensitive, must lead the comment word. */
export const MENTION_RE = /(?:^|\s)@hanzo\b[ \t]*(.*)/is;

/**
 * Extract the question from an `@hanzo …` comment. Returns the text after the
 * mention (trimmed), or null when the comment does not mention `@hanzo`. When
 * `@hanzo` appears with no trailing text the question is '' — the caller treats
 * an empty question as "summarize this thread". Pure.
 */
export function parseMention(comment: string): string | null {
  const m = comment.match(MENTION_RE);
  if (!m) return null;
  return m[1].trim();
}

/** The minimal shape of a webhook payload we route on. */
export interface RoutablePayload {
  /** Present on `pull_request` events. */
  pull_request?: unknown;
  /** Present on `issues`/`issue_comment` events. `pull_request` set ⇒ PR. */
  issue?: { pull_request?: unknown; [key: string]: unknown };
  /** The event action, e.g. `opened`, `synchronize`, `created`. */
  action?: string;
  /** Present on comment events. */
  comment?: { body?: string; [key: string]: unknown };
}

/**
 * Map a verified `(event, payload)` to an {@link Intent}. This is the whole
 * routing table — a lookup over the event name and action:
 *
 *  - `pull_request` opened|synchronize|reopened  → review the PR
 *  - `issues` opened                             → triage the issue
 *  - `issue_comment` created with `@hanzo …`     → answer in context
 *
 * Anything else is `ignore` with a reason (used for logging, never an error).
 * Bot-authored comments and comments without a mention are ignored to prevent
 * loops. Pure — exhaustively unit-tested.
 */
export function routeEvent(event: string, payload: RoutablePayload): Intent {
  const action = payload.action ?? '';

  if (event === 'pull_request') {
    if (action === 'opened' || action === 'synchronize' || action === 'reopened') {
      return { kind: 'review_pr' };
    }
    return { kind: 'ignore', reason: `pull_request action ${action || '(none)'} not handled` };
  }

  if (event === 'issues') {
    if (action === 'opened') return { kind: 'triage_issue' };
    return { kind: 'ignore', reason: `issues action ${action || '(none)'} not handled` };
  }

  if (event === 'issue_comment') {
    if (action !== 'created') {
      return { kind: 'ignore', reason: `issue_comment action ${action || '(none)'} not handled` };
    }
    const question = parseMention(payload.comment?.body ?? '');
    if (question === null) return { kind: 'ignore', reason: 'comment does not mention @hanzo' };
    return { kind: 'answer_mention', question };
  }

  return { kind: 'ignore', reason: `event ${event} not handled` };
}
