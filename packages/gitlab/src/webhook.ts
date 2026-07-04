/**
 * Webhook boundary — PURE. Two responsibilities, both total functions:
 *
 *  1. Verify the GitLab `X-Gitlab-Token` secret, in constant time. Unlike
 *     GitHub, GitLab does NOT HMAC the body — it sends the shared secret token
 *     verbatim in the header. This is the security gate: nothing is processed
 *     until the token matches. Constant-time compare avoids leaking the secret
 *     through response timing.
 *  2. Route a verified event to an intent — the `(X-Gitlab-Event, payload)` pair
 *     maps to exactly one of: review a merge request, triage an issue, answer an
 *     `@hanzo` mention, or ignore. Routing is a lookup, not a pile of `if`s, so it
 *     is exhaustively testable and there is one obvious place to add an event.
 *
 * `crypto` is the standard library — no dependency for the compare. The dispatch
 * that turns an intent into REST + model calls lives in `app.ts`; this module
 * only decides *what* to do, never *how*.
 */

import { timingSafeEqual } from 'node:crypto';

/** The secret-token header GitLab sends on every webhook delivery. */
export const TOKEN_HEADER = 'x-gitlab-token';

/** The event-name header GitLab sends, e.g. `Merge Request Hook`. */
export const EVENT_HEADER = 'x-gitlab-event';

/**
 * Constant-time verification of GitLab's `X-Gitlab-Token` against the configured
 * webhook secret. Returns false (never throws) on any malformed input — a missing
 * or wrong-length token is simply invalid. `timingSafeEqual` avoids leaking the
 * secret through response timing. Pure.
 */
export function verifyToken(received: string | undefined, secret: string): boolean {
  if (!received || !secret) return false;
  const a = Buffer.from(received);
  const b = Buffer.from(secret);
  // timingSafeEqual requires equal lengths; unequal length ⇒ not a match.
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

/** What a verified webhook should cause the app to do. */
export type Intent =
  | { kind: 'review_mr' }
  | { kind: 'triage_issue' }
  | { kind: 'answer_mention'; question: string }
  | { kind: 'ignore'; reason: string };

/** The `@hanzo <question>` trigger. Case-insensitive, must lead the note word. */
export const MENTION_RE = /(?:^|\s)@hanzo\b[ \t]*(.*)/is;

/**
 * Extract the question from an `@hanzo …` note. Returns the text after the
 * mention (trimmed), or null when the note does not mention `@hanzo`. When
 * `@hanzo` appears with no trailing text the question is '' — the caller treats
 * an empty question as "summarize this thread". Pure.
 */
export function parseMention(note: string): string | null {
  const m = note.match(MENTION_RE);
  if (!m) return null;
  return m[1].trim();
}

/** The minimal shape of a GitLab webhook payload we route on. */
export interface RoutablePayload {
  /**
   * The event kind GitLab stamps in the body (`merge_request`, `issue`, `note`).
   * Present on every hook; the `X-Gitlab-Event` header carries the same info in
   * a human form. We route on the header and use this only as a cross-check.
   */
  object_kind?: string;
  /**
   * The resource's attributes. `action` (`open`, `update`, `reopen`) drives MR
   * and issue routing; `note` / `noteable_type` drive note routing.
   */
  object_attributes?: {
    action?: string;
    note?: string;
    noteable_type?: string;
    [key: string]: unknown;
  };
}

/** Normalize `X-Gitlab-Event` to the payload's `object_kind` vocabulary. */
function eventKind(event: string): 'merge_request' | 'issue' | 'note' | 'other' {
  switch (event) {
    case 'Merge Request Hook':
      return 'merge_request';
    case 'Issue Hook':
      return 'issue';
    case 'Note Hook':
      return 'note';
    default:
      return 'other';
  }
}

/**
 * Map a verified `(event, payload)` to an {@link Intent}. This is the whole
 * routing table — a lookup over the `X-Gitlab-Event` header and the payload
 * action:
 *
 *  - `Merge Request Hook` open|update|reopen  → review the MR
 *  - `Issue Hook` open                        → triage the issue
 *  - `Note Hook` on an MR/Issue with `@hanzo …` → answer in context
 *
 * Anything else is `ignore` with a reason (used for logging, never an error).
 * Notes without a mention are ignored to prevent loops. Pure — exhaustively
 * unit-tested.
 */
export function routeEvent(event: string, payload: RoutablePayload): Intent {
  const kind = eventKind(event);
  const action = payload.object_attributes?.action ?? '';

  if (kind === 'merge_request') {
    if (action === 'open' || action === 'update' || action === 'reopen') {
      return { kind: 'review_mr' };
    }
    return { kind: 'ignore', reason: `merge_request action ${action || '(none)'} not handled` };
  }

  if (kind === 'issue') {
    if (action === 'open' || action === 'reopen') return { kind: 'triage_issue' };
    return { kind: 'ignore', reason: `issue action ${action || '(none)'} not handled` };
  }

  if (kind === 'note') {
    const noteable = payload.object_attributes?.noteable_type ?? '';
    if (noteable !== 'MergeRequest' && noteable !== 'Issue') {
      return { kind: 'ignore', reason: `note on ${noteable || '(unknown)'} not handled` };
    }
    const question = parseMention(payload.object_attributes?.note ?? '');
    if (question === null) return { kind: 'ignore', reason: 'note does not mention @hanzo' };
    return { kind: 'answer_mention', question };
  }

  return { kind: 'ignore', reason: `event ${event} not handled` };
}
