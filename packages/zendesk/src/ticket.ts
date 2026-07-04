// Ticket-context assembly — PURE, DOM-free, ZAF-free. Turns the raw values the
// ZAF client returns (`ticket.subject`, `ticket.requester`, `ticket.comments`)
// into the single windowed text block we attach to a model request. zaf.ts is
// the thin impure adapter that fetches these values from the Zendesk host and
// hands them here; everything below is deterministic and unit-tested.

/** A single ticket comment as returned by ZAF `ticket.comments`. Only the
 *  fields we read are typed; the host sends more. `value` is the comment body
 *  (plain text); `public: false` marks an internal note. */
export interface TicketComment {
  /** Comment body. ZAF exposes the text as `value`. */
  value?: string;
  /** Author display info. `author.name` is who wrote it. */
  author?: { name?: string } | null;
  /** True for a public reply, false for an internal note. */
  public?: boolean;
  /** ISO timestamp the comment was created. */
  createdAt?: string;
}

/** The pieces of ticket context zaf.ts collects for the model. */
export interface TicketInput {
  subject: string;
  requesterName: string;
  comments: TicketComment[];
}

/** The result of windowing a ticket down to what we'll actually send: the
 *  assembled text, how many comments it covers, and whether older comments were
 *  dropped (so the prompt/UI can say so honestly). */
export interface TicketContext {
  text: string;
  totalComments: number;
  includedComments: number;
  truncated: boolean;
}

/** Render one comment as a labelled block. Newest carries the most signal for a
 *  reply, so blocks are self-describing (author + visibility) and ordered by the
 *  caller. Empty-bodied comments contribute nothing. */
function renderComment(c: TicketComment): string {
  const body = (c.value ?? '').trim();
  if (!body) return '';
  const who = c.author?.name?.trim() || 'Unknown';
  const kind = c.public === false ? 'internal note' : 'public reply';
  return `[${who} · ${kind}]\n${body}`;
}

/** buildContext assembles the ticket text within `budget` characters, keeping
 *  the NEWEST comments (a support reply is grounded in the latest exchange) and
 *  dropping the oldest first. Comments are assumed oldest→newest as ZAF returns
 *  them; the output preserves that reading order. Always includes at least the
 *  most recent non-empty comment (hard-cut to the budget if that one alone is
 *  over). Pure and total: no I/O, deterministic.
 *
 *  The subject line is always prepended and counts against the budget. */
export function buildContext(
  input: TicketInput,
  budget: number = 48_000,
): TicketContext {
  const subject = input.subject.trim();
  const requester = input.requesterName.trim();
  const head =
    `Subject: ${subject || '(none)'}\n` +
    `Requester: ${requester || '(unknown)'}\n` +
    `\n---- conversation (oldest first) ----`;

  const rendered = input.comments.map(renderComment);
  const total = input.comments.length;

  // Walk newest→oldest, accepting blocks until the budget is spent, then emit in
  // reading order (oldest→newest). The separator between blocks is counted.
  const sep = '\n\n';
  const kept: string[] = []; // newest-first as we accept
  let used = head.length;
  let hardCut = false;

  for (let i = rendered.length - 1; i >= 0; i--) {
    const block = rendered[i];
    if (!block) continue; // empty comment — skip, doesn't count as "included"
    const addition = (kept.length === 0 ? sep : sep) + block;
    if (used + addition.length > budget) {
      if (kept.length === 0) {
        // The most recent non-empty comment overflows on its own — hard-cut it
        // so we always return something to answer from.
        const room = Math.max(budget - used - sep.length, 0);
        kept.push(sep + block.slice(0, room));
        hardCut = true;
      }
      break;
    }
    kept.push(addition);
    used += addition.length;
  }

  const includedComments = kept.length;
  // kept is newest-first; reverse to reading order for the model.
  const body = kept.reverse().join('');
  const text = includedComments === 0 ? head : head + body;
  const nonEmptyTotal = rendered.filter((b) => b).length;
  const truncated = hardCut || includedComments < nonEmptyTotal;

  return { text, totalComments: total, includedComments, truncated };
}

/** One honest sentence describing the scope of what the model was shown, so the
 *  prompt (and, echoed in the UI, the agent) knows whether older context was
 *  omitted. Never claim we sent the whole thread when we didn't. */
export function contextNote(ctx: TicketContext): string {
  if (ctx.totalComments === 0) {
    return 'This ticket has no comments yet — answer from the subject alone.';
  }
  if (ctx.includedComments === 0) {
    return 'The ticket comments were empty; only the subject is available.';
  }
  return ctx.truncated
    ? `Context: the ${ctx.includedComments} most recent of ${ctx.totalComments} comments (older ones were omitted to fit; if a full answer needs earlier context, say so).`
    : `Context: the full ticket thread (${ctx.totalComments} comment${ctx.totalComments === 1 ? '' : 's'}).`;
}
