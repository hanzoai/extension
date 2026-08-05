import { describe, expect, it } from 'vitest';
import { extractWidgets, parseWidget, type Widget } from '../src/answer/widget.js';

const fence = (o: unknown) => '```hanzo-widget\n' + JSON.stringify(o) + '\n```';

describe('widget validation', () => {
  it('accepts each kind and returns it typed', () => {
    const cases: [unknown, Widget['kind']][] = [
      [{ kind: 'comparison', columns: ['', 'A', 'B'], rows: [['x', '1', '2']] }, 'comparison'],
      [{ kind: 'steps', steps: ['first', 'second'] }, 'steps'],
      [{ kind: 'stats', stats: [{ label: 'Users', value: '1.2M' }] }, 'stats'],
      [{ kind: 'timeline', events: [{ when: '2019', what: 'started' }] }, 'timeline'],
      [{ kind: 'entity', title: 'Rich Hickey', facts: [{ label: 'Known for', value: 'Clojure' }] }, 'entity'],
      [{ kind: 'definition', term: 'chmod', meaning: 'change file mode' }, 'definition'],
    ];
    for (const [raw, kind] of cases) {
      expect(parseWidget(raw)?.kind).toBe(kind);
    }
  });

  it('refuses a ragged comparison rather than padding it', () => {
    // A row shorter than the header renders as a broken grid. Half-valid is worse
    // than absent: the prose it replaced was at least complete.
    expect(
      parseWidget({ kind: 'comparison', columns: ['', 'A', 'B'], rows: [['only-one']] }),
    ).toBeNull();
  });

  it('refuses an unknown kind', () => {
    expect(parseWidget({ kind: 'iframe', src: 'https://evil.example' })).toBeNull();
    expect(parseWidget({ kind: 'html', html: '<script>alert(1)</script>' })).toBeNull();
  });

  it('refuses non-string fields instead of coercing them', () => {
    expect(parseWidget({ kind: 'steps', steps: [1, 2, 3] })).toBeNull();
    expect(parseWidget({ kind: 'stats', stats: [{ label: 'a', value: 42 }] })).toBeNull();
    expect(parseWidget({ kind: 'entity', title: 'x', facts: [{ label: 'a' }] })).toBeNull();
  });

  it('refuses empty and oversized payloads', () => {
    expect(parseWidget({ kind: 'steps', steps: [] })).toBeNull();
    // A model that loops must not be able to hang the page.
    const huge = Array.from({ length: 500 }, (_, i) => `step ${i}`);
    expect(parseWidget({ kind: 'steps', steps: huge })).toBeNull();
    const long = 'x'.repeat(5000);
    expect(parseWidget({ kind: 'definition', term: 't', meaning: long })).toBeNull();
  });

  it('refuses junk', () => {
    for (const junk of [null, undefined, 'string', 42, [], {}]) {
      expect(parseWidget(junk)).toBeNull();
    }
  });
});

describe('extraction from a streaming answer', () => {
  it('pulls the widget out and leaves the prose without it', () => {
    const md =
      'Here is the comparison.\n\n' +
      fence({ kind: 'comparison', columns: ['', 'A'], rows: [['x', '1']] }) +
      '\n\nThat is the summary.';
    const { prose, widgets } = extractWidgets(md);
    expect(widgets).toHaveLength(1);
    expect(widgets[0]!.kind).toBe('comparison');
    // The block must not survive as text — otherwise the reader sees the JSON too.
    expect(prose).not.toContain('hanzo-widget');
    expect(prose).not.toContain('{"kind"');
    expect(prose).toContain('Here is the comparison.');
    expect(prose).toContain('That is the summary.');
  });

  it('leaves an UNTERMINATED fence alone while it streams', () => {
    // Mid-stream the JSON is incomplete and could never parse; stripping it early
    // would also make the prose jump as the block completes.
    const partial = 'Answer.\n\n```hanzo-widget\n{"kind":"steps","steps":["fir';
    const { prose, widgets } = extractWidgets(partial);
    expect(widgets).toHaveLength(0);
    expect(prose).toBe(partial);
  });

  it('drops a closed fence whose body is not JSON, keeping the prose', () => {
    const md = 'Before.\n\n```hanzo-widget\nnot json at all\n```\n\nAfter.';
    const { prose, widgets } = extractWidgets(md);
    expect(widgets).toHaveLength(0);
    expect(prose).toContain('Before.');
    expect(prose).toContain('After.');
    expect(prose).not.toContain('not json at all');
  });

  it('drops an invalid widget but keeps the surrounding answer', () => {
    // The failure mode of a widget is the answer WITHOUT it — never an error.
    const md = 'Prose.\n\n' + fence({ kind: 'comparison', columns: ['A'], rows: [] }) + '\n\nMore.';
    const { prose, widgets } = extractWidgets(md);
    expect(widgets).toHaveLength(0);
    expect(prose).toContain('Prose.');
    expect(prose).toContain('More.');
  });

  it('handles several widgets in one answer, in order', () => {
    const md =
      fence({ kind: 'steps', steps: ['a'] }) + '\n\ntext\n\n' + fence({ kind: 'stats', stats: [{ label: 'l', value: 'v' }] });
    const { widgets } = extractWidgets(md);
    expect(widgets.map((w) => w.kind)).toEqual(['steps', 'stats']);
  });

  it('is a no-op on an answer with no widgets', () => {
    const md = '# Heading\n\nJust prose with `code` and a [link](https://example.com).';
    expect(extractWidgets(md)).toEqual({ prose: md, widgets: [] });
  });

  it('never lets markup through as a field value', () => {
    // The model reads the open web, so a page can try to inject through it. The
    // string survives as DATA (React escapes it at render); what matters is that it
    // is never treated as a kind or as markup.
    const w = parseWidget({
      kind: 'definition',
      term: '<img src=x onerror=alert(1)>',
      meaning: '</pre><script>alert(2)</script>',
    });
    expect(w).not.toBeNull();
    expect(w!.kind).toBe('definition');
    // It is still just a string — no parsing, no unescaping, no markup semantics.
    expect(typeof (w as any).term).toBe('string');
  });
});
