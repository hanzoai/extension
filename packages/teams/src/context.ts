/**
 * Message/thread text extraction — pure, host-schema in, plain text out.
 *
 * Teams hands the bot two very different context shapes:
 *  - an inbound **Activity** (`onMessage`), where the user typed a prompt,
 *    possibly with an `@Hanzo` mention that must be stripped; and
 *  - a **message-extension** payload (`MessageActionsPayload`), the message a
 *    user ran "Ask Hanzo" on — its body may be HTML.
 *
 * These functions take only the fields they read (structural typing), so they
 * are trivially testable and carry no botbuilder runtime dependency.
 */

/** Hard cap on context text fed to the model, in characters. */
export const MAX_CONTEXT_CHARS = 12_000;

/** Structural view of the inbound Activity fields we read. */
export interface ActivityLike {
  text?: string;
  /** Entities on the activity; `@mention` entities carry the mention text. */
  entities?: Array<{ type?: string; text?: string } | undefined>;
}

/** Structural view of a Teams message payload body. */
export interface MessageBodyLike {
  contentType?: string;
  content?: string;
}

/** Structural view of the message a message-extension acts on. */
export interface MessagePayloadLike {
  subject?: string;
  body?: MessageBodyLike;
  from?: { user?: { displayName?: string } } | undefined;
}

const WHITESPACE = /\s+/g;

/** Collapse runs of whitespace and trim. */
export function normalizeWhitespace(s: string): string {
  return s.replace(WHITESPACE, ' ').trim();
}

/**
 * Strip HTML to readable text: drop `<script>`/`<style>` bodies, turn block
 * boundaries into newlines, remove remaining tags, and decode the handful of
 * named entities Teams emits. Not a full HTML parser — a deliberate, safe
 * subset for turning message bodies into prompt context.
 */
export function htmlToText(html: string): string {
  const withoutScripts = html
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, '');
  const withBreaks = withoutScripts
    .replace(/<\/(p|div|li|tr|h[1-6])>/gi, '\n')
    .replace(/<br\s*\/?>/gi, '\n');
  const stripped = withBreaks.replace(/<[^>]+>/g, '');
  const decoded = stripped
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'");
  return decoded
    .split('\n')
    .map((line) => normalizeWhitespace(line))
    .filter((line) => line.length > 0)
    .join('\n');
}

/**
 * Truncate to at most {@link MAX_CONTEXT_CHARS} (or `limit`), appending an
 * ellipsis marker so the model knows the text was cut. Truncates on a word
 * boundary when a nearby one exists.
 */
export function truncate(text: string, limit: number = MAX_CONTEXT_CHARS): string {
  if (text.length <= limit) return text;
  const slice = text.slice(0, limit);
  const lastSpace = slice.lastIndexOf(' ');
  const cut = lastSpace > limit * 0.8 ? slice.slice(0, lastSpace) : slice;
  return `${cut.trimEnd()}…`;
}

/** Matches a Teams `<at ...>Display Name</at>` mention span. */
const AT_MENTION = /<at\b[^>]*>.*?<\/at>/gis;

/**
 * The user's prompt from an inbound Activity, with the bot `@mention` removed.
 *
 * Teams renders mentions in `activity.text` as `<at>…</at>` spans (each has a
 * matching `mention` entity). We strip only those spans — never arbitrary
 * substrings — so a mention of "Hanzo" does not also delete the word "Hanzo"
 * elsewhere in the user's prompt. Any leftover exact-match mention `entity.text`
 * (a plain-text mention with no `<at>` wrapper) is removed once, at the start.
 */
export function promptFromActivity(activity: ActivityLike): string {
  let text = (activity.text ?? '').replace(AT_MENTION, ' ');
  for (const entity of activity.entities ?? []) {
    if (entity?.type === 'mention' && entity.text) {
      // Only a leading plain-text mention; leave later occurrences intact.
      const trimmed = text.trimStart();
      if (trimmed.startsWith(entity.text)) {
        const lead = text.length - trimmed.length;
        text = text.slice(0, lead) + trimmed.slice(entity.text.length);
      }
    }
  }
  return normalizeWhitespace(text);
}

/**
 * Readable text of the message a message-extension acted on: subject line then
 * body (HTML decoded to text when `contentType` is html), truncated for the
 * prompt. Returns `''` when there is nothing to read.
 */
export function textFromMessagePayload(
  payload: MessagePayloadLike,
  limit: number = MAX_CONTEXT_CHARS,
): string {
  const parts: string[] = [];
  const subject = payload.subject ? normalizeWhitespace(payload.subject) : '';
  if (subject) parts.push(subject);

  const body = payload.body;
  if (body?.content) {
    const isHtml = (body.contentType ?? '').toLowerCase() === 'html';
    const bodyText = isHtml ? htmlToText(body.content) : normalizeWhitespace(body.content);
    if (bodyText) parts.push(bodyText);
  }

  return truncate(parts.join('\n\n'), limit);
}
