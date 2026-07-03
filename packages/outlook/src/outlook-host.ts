// The Outlook (mail) host glue: read the open message and write the AI draft
// into a reply. Outlook is a DIFFERENT Office.js surface from Word/Excel/PPT —
// there is no document "selection"; the unit of work is the mail item
// (Office.context.mailbox.item). Two modes:
//   READ    — a received message is open; we read its body/subject/from to
//             summarize, extract deadlines, or draft a reply.
//   COMPOSE — a reply/new message is open; we write the draft into its body.
//
// As in host.ts (Word/Excel), the Office-calling functions are thin and the
// shaping helpers (stripHtml, collapseWhitespace, shapeMessage) are pure and
// unit-tested — no Office.js, no DOM.

/* global Office */

export type MailMode = 'read' | 'compose' | 'unknown';
export type ReplyMode = 'replace' | 'prepend';

// A message read off the mail item, normalized for the model.
export interface MailContext {
  subject: string;
  from: string;
  body: string;
}

// mailMode maps an Outlook item to read vs compose. A read item exposes
// `itemType`/`from`; a compose item exposes `body.setSelectedDataAsync` and no
// `from`. We key off the presence of `from` accessor semantics via displayReplyForm
// availability, but the reliable signal Office gives is item.itemType +
// whether from is a plain object (read) or absent (compose). Pure given the
// two booleans a caller can cheaply probe.
export function mailMode(hasFrom: boolean, canSetBody: boolean): MailMode {
  if (hasFrom) return 'read';
  if (canSetBody) return 'compose';
  return 'unknown';
}

// stripHtml removes tags and decodes the handful of entities Outlook bodies
// carry, so an HTML mail body becomes readable plain text for the model. Pure.
// It is deliberately small: Outlook can return the body as 'text' directly
// (getBodyText below asks for that), so this only guards the HTML fallback.
export function stripHtml(html: string): string {
  return collapseWhitespace(
    html
      .replace(/<\s*(script|style)[^>]*>[\s\S]*?<\s*\/\s*\1\s*>/gi, ' ')
      .replace(/<\s*br\s*\/?\s*>/gi, '\n')
      .replace(/<\s*\/\s*(p|div|tr|li|h[1-6])\s*>/gi, '\n')
      .replace(/<[^>]+>/g, ' ')
      .replace(/&nbsp;/gi, ' ')
      .replace(/&amp;/gi, '&')
      .replace(/&lt;/gi, '<')
      .replace(/&gt;/gi, '>')
      .replace(/&quot;/gi, '"')
      .replace(/&#39;/gi, "'"),
  );
}

// collapseWhitespace trims each line and drops runs of blank lines so the model
// sees clean text (Outlook HTML→text conversions leave ragged whitespace). Pure.
export function collapseWhitespace(text: string): string {
  return text
    .split('\n')
    .map((l) => l.replace(/[ \t ]+/g, ' ').trim())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

// shapeMessage renders a MailContext into the single string handed to chat.ts
// as the "selection" — a labeled block the model reads as data (subject, from,
// then the body). Pure, so the prompt shaping is unit-testable. Empty fields
// are omitted so a compose-mode empty context doesn't emit "Subject: ".
export function shapeMessage(ctx: MailContext): string {
  const headers: string[] = [];
  if (ctx.subject.trim()) headers.push(`Subject: ${ctx.subject.trim()}`);
  if (ctx.from.trim()) headers.push(`From: ${ctx.from.trim()}`);
  const body = ctx.body.trim();
  const headerBlock = headers.join('\n');
  // Separate the body from any header lines with a blank line; when there are
  // no headers (compose mode) the body stands alone with no leading newline.
  if (headerBlock && body) return `${headerBlock}\n\n${body}`;
  return headerBlock || body;
}

// formatFrom renders an Outlook EmailAddressDetails into "Name <addr>" (or just
// the address when there is no display name). Pure. `undefined` → ''.
export function formatFrom(from: { displayName?: string; emailAddress?: string } | undefined): string {
  if (!from) return '';
  const name = (from.displayName || '').trim();
  const addr = (from.emailAddress || '').trim();
  if (name && addr && name !== addr) return `${name} <${addr}>`;
  return addr || name;
}

// ── Office.js mailbox glue (thin) ─────────────────────────────────────────

// currentMailMode reads the live item and classifies it. `from` is only
// present on a read item; a compose item has body.setSelectedDataAsync.
export function currentMailMode(): MailMode {
  const item: any = Office.context?.mailbox?.item;
  if (!item) return 'unknown';
  const hasFrom = !!item.from;
  const canSetBody = !!(item.body && typeof item.body.setSelectedDataAsync === 'function' && !hasFrom);
  return mailMode(hasFrom, canSetBody);
}

// getBodyText reads the item body as plain text (Outlook converts HTML→text for
// us when we ask for CoercionType.Text). Falls back to '' on failure.
function getBodyText(): Promise<string> {
  return new Promise((resolve) => {
    const item: any = Office.context?.mailbox?.item;
    if (!item?.body?.getAsync) {
      resolve('');
      return;
    }
    item.body.getAsync(Office.CoercionType.Text, (r: any) => {
      if (r.status === Office.AsyncResultStatus.Succeeded) {
        resolve(collapseWhitespace(String(r.value || '')));
      } else {
        resolve('');
      }
    });
  });
}

// readMessage returns the open message as a MailContext: subject, from, and the
// plain-text body. Works in both read and compose mode (compose has no `from`
// and an empty/quoted body). The pure shaping happens in shapeMessage.
export async function readMessage(): Promise<MailContext> {
  const item: any = Office.context?.mailbox?.item;
  const subject = typeof item?.subject === 'string' ? item.subject : '';
  const from = formatFrom(item?.from);
  const body = await getBodyText();
  return { subject, from, body };
}

// readContext is the "selection" the task pane feeds chat.ts: the shaped
// message block. Empty when there is no readable item.
export async function readContext(): Promise<string> {
  if (currentMailMode() === 'unknown') return '';
  return shapeMessage(await readMessage());
}

// insertDraft writes the AI output into the compose body. `mode` chooses
// replace-the-body vs prepend-above-the-existing-quote (a reply keeps the
// quoted thread below the new text). Uses HTML coercion off so the plain draft
// lands as-is. Only valid in compose mode.
export async function insertDraft(text: string, mode: ReplyMode): Promise<void> {
  const item: any = Office.context?.mailbox?.item;
  if (!item?.body) throw new Error('No compose message is open');
  const options = { coercionType: Office.CoercionType.Text };
  await new Promise<void>((resolve, reject) => {
    const cb = (r: any) =>
      r.status === Office.AsyncResultStatus.Succeeded
        ? resolve()
        : reject(new Error(r.error?.message || 'insert failed'));
    if (mode === 'prepend' && typeof item.body.prependAsync === 'function') {
      item.body.prependAsync(text, options, cb);
    } else {
      item.body.setSelectedDataAsync(text, options, cb);
    }
  });
}

// startReply opens a reply form pre-filled with the AI draft, from a READ
// message — the one-click "draft a reply" path. Outlook's displayReplyForm
// takes the reply body directly, so we skip the compose round-trip.
export function startReply(draft: string): void {
  const item: any = Office.context?.mailbox?.item;
  if (item?.displayReplyForm) item.displayReplyForm(draft);
}
