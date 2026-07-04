import { describe, it, expect } from 'vitest';
import {
  htmlToText,
  truncate,
  normalizeWhitespace,
  promptFromActivity,
  textFromMessagePayload,
  MAX_CONTEXT_CHARS,
} from '../src/context';

describe('normalizeWhitespace', () => {
  it('collapses runs of whitespace and trims', () => {
    expect(normalizeWhitespace('  a   b\n\tc  ')).toBe('a b c');
  });
});

describe('htmlToText', () => {
  it('strips tags and decodes entities', () => {
    const html = '<p>Hello&nbsp;<b>world</b> &amp; more</p>';
    expect(htmlToText(html)).toBe('Hello world & more');
  });

  it('turns block boundaries into newlines', () => {
    const html = '<div>one</div><div>two</div>';
    expect(htmlToText(html)).toBe('one\ntwo');
  });

  it('turns list items and <br> into lines', () => {
    const html = '<ul><li>a</li><li>b</li></ul>first<br>second';
    expect(htmlToText(html)).toBe('a\nb\nfirst\nsecond');
  });

  it('drops script and style bodies', () => {
    const html = '<style>.x{color:red}</style><p>keep</p><script>alert(1)</script>';
    expect(htmlToText(html)).toBe('keep');
  });
});

describe('truncate', () => {
  it('leaves short text unchanged', () => {
    expect(truncate('short', 100)).toBe('short');
  });

  it('cuts on a word boundary and appends an ellipsis', () => {
    const text = 'alpha beta gamma delta epsilon';
    const out = truncate(text, 12);
    expect(out.endsWith('…')).toBe(true);
    expect(out.length).toBeLessThanOrEqual(13);
    expect(out).toBe('alpha beta…');
  });

  it('defaults to MAX_CONTEXT_CHARS', () => {
    const long = 'x'.repeat(MAX_CONTEXT_CHARS + 500);
    const out = truncate(long);
    expect(out.length).toBeLessThanOrEqual(MAX_CONTEXT_CHARS + 1);
    expect(out.endsWith('…')).toBe(true);
  });
});

describe('promptFromActivity', () => {
  it('returns normalized text when there is no mention', () => {
    expect(promptFromActivity({ text: '  what is  OIDC?  ' })).toBe('what is OIDC?');
  });

  it('strips the <at> mention span from a channel message', () => {
    const activity = {
      text: '<at>Hanzo</at> summarize this thread',
      entities: [{ type: 'mention', text: '<at>Hanzo</at>' }],
    };
    expect(promptFromActivity(activity)).toBe('summarize this thread');
  });

  it('strips <at id> markup even when entity.text is the plain display name', () => {
    const activity = {
      text: '<at id="0">Hanzo</at> explain OIDC',
      entities: [{ type: 'mention', text: 'Hanzo' }],
    };
    expect(promptFromActivity(activity)).toBe('explain OIDC');
  });

  it('does NOT delete later occurrences of the mention word in the prompt', () => {
    // Regression: a naive split().join() would mangle "Hanzo the company".
    const activity = {
      text: '<at>Hanzo</at> tell me about Hanzo the company',
      entities: [{ type: 'mention', text: 'Hanzo' }],
    };
    expect(promptFromActivity(activity)).toBe('tell me about Hanzo the company');
  });

  it('removes a leading plain-text mention only', () => {
    const activity = {
      text: 'Hanzo draft a reply to Hanzo support',
      entities: [{ type: 'mention', text: 'Hanzo' }],
    };
    expect(promptFromActivity(activity)).toBe('draft a reply to Hanzo support');
  });

  it('handles a missing text field', () => {
    expect(promptFromActivity({})).toBe('');
  });
});

describe('textFromMessagePayload', () => {
  it('joins subject and html body decoded to text', () => {
    const out = textFromMessagePayload({
      subject: 'Release plan',
      body: { contentType: 'html', content: '<p>Ship <b>v1</b> on Friday</p>' },
    });
    expect(out).toBe('Release plan\n\nShip v1 on Friday');
  });

  it('treats non-html body as plain text', () => {
    const out = textFromMessagePayload({
      body: { contentType: 'text', content: '  just   text  ' },
    });
    expect(out).toBe('just text');
  });

  it('returns empty string when there is nothing to read', () => {
    expect(textFromMessagePayload({})).toBe('');
    expect(textFromMessagePayload({ body: {} })).toBe('');
  });

  it('truncates a very long body', () => {
    const out = textFromMessagePayload(
      { body: { contentType: 'text', content: 'word '.repeat(5000) } },
      50,
    );
    expect(out.length).toBeLessThanOrEqual(51);
    expect(out.endsWith('…')).toBe(true);
  });
});
