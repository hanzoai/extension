/**
 * Slack conversation context → plain text for the model.
 *
 * Quick actions ("Summarize this thread", "Draft a reply") operate on the
 * message or thread the user invoked them on. The Bolt handler fetches the
 * messages via `conversations.replies` (a thread) or uses the single message
 * (a shortcut on a standalone message); THIS module is the pure transform from
 * those message objects to a token-bounded text block. No Slack SDK here, so it
 * is fully unit-testable.
 */

/** The subset of a Slack message we read. Matches the Web API message shape. */
export interface SlackMessage {
  /** Author user id, e.g. `U123`. Absent for some bot/system messages. */
  user?: string;
  /** Bot id when the author is a bot. */
  bot_id?: string;
  /** Message text (may contain Slack mrkdwn and <@U…> mentions). */
  text?: string;
  /** Slack ts; used only for stable ordering. */
  ts?: string;
  /** Subtype, e.g. `bot_message`, `channel_join`. Join/leave noise is dropped. */
  subtype?: string;
}

/** Options for {@link threadToText}. */
export interface ThreadToTextOptions {
  /**
   * Map of user id → display name to humanize authors. Missing ids fall back to
   * the raw id. Optional — omit for id-labeled output.
   */
  names?: Record<string, string>;
  /**
   * Max characters of the rendered transcript. When the transcript is longer,
   * the OLDEST messages are dropped and a `…(N earlier messages omitted)…`
   * marker is prepended so the most recent context (what the user is acting on)
   * is always kept. Defaults to 12000.
   */
  maxChars?: number;
}

const DEFAULT_MAX_CHARS = 12000;

/** Noise subtypes that carry no conversational content. */
const SKIP_SUBTYPES = new Set([
  'channel_join',
  'channel_leave',
  'channel_topic',
  'channel_purpose',
  'channel_name',
  'channel_archive',
  'channel_unarchive',
  'bot_add',
  'bot_remove',
]);

function authorLabel(m: SlackMessage, names?: Record<string, string>): string {
  if (m.user) return names?.[m.user] ?? m.user;
  if (m.bot_id) return 'bot';
  return 'unknown';
}

/** True when a message contributes conversational text. Pure. */
export function isContentMessage(m: SlackMessage): boolean {
  if (m.subtype && SKIP_SUBTYPES.has(m.subtype)) return false;
  return Boolean(m.text && m.text.trim());
}

/** Render one message as `Name: text`. Pure. */
export function renderMessage(m: SlackMessage, names?: Record<string, string>): string {
  return `${authorLabel(m, names)}: ${(m.text ?? '').trim()}`;
}

/**
 * Turn an ordered list of Slack messages (oldest→newest) into a single text
 * block for the model, dropping noise and bounding the length by keeping the
 * MOST RECENT messages. Pure — unit-tested.
 */
export function threadToText(
  messages: SlackMessage[],
  opts: ThreadToTextOptions = {},
): string {
  const maxChars = opts.maxChars ?? DEFAULT_MAX_CHARS;
  const rendered = messages
    .filter(isContentMessage)
    .map((m) => renderMessage(m, opts.names));

  if (rendered.length === 0) return '';

  // Keep newest messages within the budget: walk from the end, accumulating.
  const kept: string[] = [];
  let total = 0;
  let omitted = 0;
  for (let i = rendered.length - 1; i >= 0; i--) {
    const line = rendered[i]!;
    // +1 for the newline joiner.
    const cost = line.length + 1;
    if (total + cost > maxChars && kept.length > 0) {
      omitted = i + 1;
      break;
    }
    kept.push(line);
    total += cost;
  }
  kept.reverse();

  const body = kept.join('\n');
  return omitted > 0 ? `…(${omitted} earlier messages omitted)…\n${body}` : body;
}

/**
 * Truncate a single message's text to a character budget, appending an ellipsis
 * marker when cut. Used for the "Ask Hanzo" shortcut on a standalone message.
 * Pure — unit-tested.
 */
export function truncateMessage(text: string, maxChars = DEFAULT_MAX_CHARS): string {
  const t = text.trim();
  if (t.length <= maxChars) return t;
  return `${t.slice(0, maxChars)}…(truncated)`;
}
