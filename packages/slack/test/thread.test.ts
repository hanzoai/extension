import { describe, it, expect } from 'vitest';
import {
  threadToText,
  truncateMessage,
  isContentMessage,
  renderMessage,
  type SlackMessage,
} from '../src/thread.js';

describe('isContentMessage', () => {
  it('keeps messages with non-empty text', () => {
    expect(isContentMessage({ text: 'hi' })).toBe(true);
    expect(isContentMessage({ text: '   ' })).toBe(false);
    expect(isContentMessage({})).toBe(false);
  });

  it('drops join/leave and other noise subtypes', () => {
    expect(isContentMessage({ text: 'joined', subtype: 'channel_join' })).toBe(false);
    expect(isContentMessage({ text: 'left', subtype: 'channel_leave' })).toBe(false);
  });
});

describe('renderMessage', () => {
  it('labels by display name when provided, else raw id', () => {
    expect(renderMessage({ user: 'U1', text: 'hello' }, { U1: 'Ada' })).toBe('Ada: hello');
    expect(renderMessage({ user: 'U2', text: 'hi' })).toBe('U2: hi');
    expect(renderMessage({ bot_id: 'B1', text: 'beep' })).toBe('bot: beep');
  });
});

describe('threadToText', () => {
  const thread: SlackMessage[] = [
    { user: 'U1', text: 'What is our filing deadline?', ts: '1' },
    { user: 'U2', text: 'The motion is due Friday.', ts: '2' },
    { user: 'U1', text: 'joined', subtype: 'channel_join', ts: '3' },
    { user: 'U1', text: 'Thanks, I will draft it.', ts: '4' },
  ];

  it('renders oldest→newest, dropping noise, with name mapping', () => {
    const text = threadToText(thread, { names: { U1: 'Ada', U2: 'Lin' } });
    expect(text).toBe(
      'Ada: What is our filing deadline?\nLin: The motion is due Friday.\nAda: Thanks, I will draft it.',
    );
  });

  it('returns empty string when nothing is content', () => {
    expect(threadToText([{ subtype: 'channel_join', text: 'x' }])).toBe('');
    expect(threadToText([])).toBe('');
  });

  it('keeps the MOST RECENT messages when over the char budget', () => {
    const many: SlackMessage[] = Array.from({ length: 10 }, (_, i) => ({
      user: 'U1',
      text: `line ${i}`,
    }));
    const out = threadToText(many, { maxChars: 30 });
    // Oldest omitted; a marker is prepended; newest line is present.
    expect(out).toMatch(/earlier messages omitted/);
    expect(out).toContain('line 9');
    expect(out).not.toContain('line 0');
  });
});

describe('truncateMessage', () => {
  it('leaves short text untouched (trimmed)', () => {
    expect(truncateMessage('  hi  ')).toBe('hi');
  });

  it('cuts and marks long text', () => {
    const out = truncateMessage('x'.repeat(100), 10);
    expect(out).toBe(`${'x'.repeat(10)}…(truncated)`);
  });
});
