import { describe, it, expect } from 'vitest';
import {
  renderSegment,
  buildTranscriptContext,
  parseVtt,
  contextNote,
  type TranscriptSegment,
} from '../src/hanzo';

function segs(n: number, per: number): TranscriptSegment[] {
  return Array.from({ length: n }, (_, i) => ({ speaker: `S${i}`, ts: `00:0${i}`, text: 'x'.repeat(per) }));
}

describe('renderSegment', () => {
  it('renders speaker + timestamp + text', () => {
    expect(renderSegment({ speaker: 'Ana', ts: '00:01', text: 'hello' })).toBe('[00:01] Ana: hello');
  });
  it('drops the missing pieces cleanly', () => {
    expect(renderSegment({ speaker: 'Ana', text: 'hi' })).toBe('Ana: hi');
    expect(renderSegment({ ts: '00:02', text: 'hi' })).toBe('[00:02] hi');
    expect(renderSegment({ text: 'hi' })).toBe('hi');
  });
  it('trims stray whitespace in each field', () => {
    expect(renderSegment({ speaker: ' Ana ', ts: ' 00:01 ', text: ' hi ' })).toBe('[00:01] Ana: hi');
  });
});

describe('buildTranscriptContext (windowing / truncation)', () => {
  it('includes everything and is not truncated when under budget', () => {
    const ctx = buildTranscriptContext(segs(3, 10), 10_000);
    expect(ctx.totalSegments).toBe(3);
    expect(ctx.includedSegments).toBe(3);
    expect(ctx.truncated).toBe(false);
    expect(ctx.text.split('\n')).toHaveLength(3);
  });

  it('stops at the budget and marks truncated', () => {
    // Each rendered line ~ "[00:0i] Si: " + 100 chars ≈ 112 chars. Budget 250
    // fits ~2 lines.
    const ctx = buildTranscriptContext(segs(10, 100), 250);
    expect(ctx.totalSegments).toBe(10);
    expect(ctx.includedSegments).toBeGreaterThanOrEqual(1);
    expect(ctx.includedSegments).toBeLessThan(10);
    expect(ctx.truncated).toBe(true);
    expect(ctx.text.length).toBeLessThanOrEqual(250);
  });

  it('always includes at least the first segment, hard-cutting an over-budget line', () => {
    const ctx = buildTranscriptContext([{ text: 'y'.repeat(1000) }], 100);
    expect(ctx.includedSegments).toBe(1);
    expect(ctx.truncated).toBe(true);
    expect(ctx.text.length).toBe(100);
  });

  it('preserves transcript order', () => {
    const ctx = buildTranscriptContext(
      [{ text: 'first' }, { text: 'second' }, { text: 'third' }],
      10_000,
    );
    expect(ctx.text.indexOf('first')).toBeLessThan(ctx.text.indexOf('second'));
    expect(ctx.text.indexOf('second')).toBeLessThan(ctx.text.indexOf('third'));
  });

  it('handles an empty transcript', () => {
    const ctx = buildTranscriptContext([], 1000);
    expect(ctx).toEqual({ text: '', totalSegments: 0, includedSegments: 0, truncated: false });
  });
});

describe('parseVtt', () => {
  it('parses cues into speaker/ts/text segments', () => {
    const vtt = [
      'WEBVTT',
      '',
      '1',
      '00:00:01.000 --> 00:00:04.000',
      'Ana Ng: Welcome everyone.',
      '',
      '2',
      '00:00:05.000 --> 00:00:09.000',
      'Bob Lee: Thanks, let us start.',
    ].join('\n');
    const s = parseVtt(vtt);
    expect(s).toHaveLength(2);
    expect(s[0]).toEqual({ speaker: 'Ana Ng', ts: '00:00:01', text: 'Welcome everyone.' });
    expect(s[1]).toEqual({ speaker: 'Bob Lee', ts: '00:00:05', text: 'Thanks, let us start.' });
  });

  it('handles CRLF newlines and cues without a speaker', () => {
    const vtt = 'WEBVTT\r\n\r\n00:00:01.000 --> 00:00:02.000\r\nJust some narration.';
    const s = parseVtt(vtt);
    expect(s).toHaveLength(1);
    expect(s[0].speaker).toBeUndefined();
    expect(s[0].ts).toBe('00:00:01');
    expect(s[0].text).toBe('Just some narration.');
  });

  it('skips NOTE blocks and the header', () => {
    const vtt = 'WEBVTT\n\nNOTE this is a comment\n\n00:00:01.000 --> 00:00:02.000\nHi.';
    const s = parseVtt(vtt);
    expect(s).toHaveLength(1);
    expect(s[0].text).toBe('Hi.');
  });

  it('joins multi-line cue text', () => {
    const vtt = 'WEBVTT\n\n00:00:01.000 --> 00:00:03.000\nCarol: This is a long\nsentence split across lines.';
    const s = parseVtt(vtt);
    expect(s[0].speaker).toBe('Carol');
    expect(s[0].text).toBe('This is a long sentence split across lines.');
  });

  it('returns [] for empty or non-VTT input', () => {
    expect(parseVtt('')).toEqual([]);
    expect(parseVtt('WEBVTT')).toEqual([]);
  });
});

describe('contextNote (honesty)', () => {
  it('says "full meeting" when nothing was dropped', () => {
    const ctx = buildTranscriptContext(segs(2, 5), 10_000);
    expect(contextNote(ctx).toLowerCase()).toContain('full meeting');
  });
  it('says "truncated" and names the counts when windowed', () => {
    const ctx = buildTranscriptContext(segs(10, 100), 250);
    const note = contextNote(ctx).toLowerCase();
    expect(note).toContain('truncated');
    expect(note).toContain('of 10 segments');
  });
  it('says no transcript when empty', () => {
    expect(contextNote(buildTranscriptContext([], 100)).toLowerCase()).toContain('no transcript');
  });
});
