import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  truncate,
  assembleMatterContext,
  actionTask,
  noteSubject,
  writeBack,
  runAction,
  isTextExtractable,
  MAX_DOC_CHARS,
  MAX_CONTEXT_CHARS,
  type MatterContext,
} from '../src/actions';
import { clioBase } from '../src/config';

const base = clioBase('us');

describe('truncate', () => {
  it('leaves short text intact', () => {
    expect(truncate('hello', 10)).toBe('hello');
  });
  it('cuts to max and marks the elision with the dropped count', () => {
    const out = truncate('abcdefghij', 4);
    expect(out.startsWith('abcd')).toBe(true);
    expect(out).toContain('truncated 6 chars');
  });
});

describe('assembleMatterContext', () => {
  const matter: MatterContext = {
    displayNumber: '00123-Smith',
    description: 'Estate administration',
    clientName: 'Jane Smith',
    status: 'open',
    practiceArea: 'Estates',
    responsibleAttorney: 'A. Attorney',
    openDate: '2026-01-01',
    documents: [
      { name: 'will.pdf', text: 'Last will and testament...' },
      { name: 'inventory.docx', text: 'Asset inventory...' },
    ],
  };

  it('puts metadata first, then each fenced document', () => {
    const ctx = assembleMatterContext(matter);
    const willIdx = ctx.indexOf('=== Document: will.pdf ===');
    expect(ctx.indexOf('Matter: 00123-Smith')).toBeLessThan(willIdx);
    expect(ctx).toContain('Client: Jane Smith');
    expect(ctx).toContain('Responsible attorney: A. Attorney');
    expect(ctx).toContain('=== Document: inventory.docx ===');
  });

  it('omits absent metadata lines', () => {
    const ctx = assembleMatterContext({ displayNumber: 'X', documents: [] });
    expect(ctx).toBe('Matter: X');
    expect(ctx).not.toContain('Client:');
  });

  it('caps each document at MAX_DOC_CHARS', () => {
    const big = 'z'.repeat(MAX_DOC_CHARS + 5000);
    const ctx = assembleMatterContext({ displayNumber: 'X', documents: [{ name: 'big.txt', text: big }] });
    expect(ctx).toContain('truncated');
    // the raw doc body length in context is bounded by the per-doc cap (+marker)
    const bodyLen = ctx.split('=== Document: big.txt ===\n')[1].length;
    expect(bodyLen).toBeLessThan(MAX_DOC_CHARS + 100);
  });

  it('caps the whole context at MAX_CONTEXT_CHARS', () => {
    const docs = Array.from({ length: 20 }, (_, i) => ({ name: `d${i}.txt`, text: 'y'.repeat(MAX_DOC_CHARS) }));
    const ctx = assembleMatterContext({ displayNumber: 'X', documents: docs });
    expect(ctx.length).toBeLessThanOrEqual(MAX_CONTEXT_CHARS + 40); // + the truncation marker
    expect(ctx).toContain('truncated');
  });

  it('respects a custom overall cap', () => {
    const ctx = assembleMatterContext({ displayNumber: 'ABCDEFGHIJ', documents: [] }, 5);
    expect(ctx.startsWith('Matte')).toBe(true);
    expect(ctx).toContain('truncated');
  });
});

describe('isTextExtractable', () => {
  it('accepts text-ish content types', () => {
    expect(isTextExtractable('text/plain')).toBe(true);
    expect(isTextExtractable('text/html')).toBe(true);
    expect(isTextExtractable('application/json')).toBe(true);
    expect(isTextExtractable('application/xml')).toBe(true);
    expect(isTextExtractable('text/markdown')).toBe(true);
    expect(isTextExtractable('text/csv')).toBe(true);
    expect(isTextExtractable('application/rtf')).toBe(true);
    expect(isTextExtractable('text/plain; charset=utf-8')).toBe(true); // strips params
  });
  it('rejects binary legal-document types (PDF/DOCX) and missing types', () => {
    expect(isTextExtractable('application/pdf')).toBe(false);
    expect(isTextExtractable('application/vnd.openxmlformats-officedocument.wordprocessingml.document')).toBe(false);
    expect(isTextExtractable('image/png')).toBe(false);
    expect(isTextExtractable(undefined)).toBe(false);
    expect(isTextExtractable('')).toBe(false);
  });
});

describe('actionTask', () => {
  it('summarize is a fixed instruction', () => {
    expect(actionTask('summarize')).toContain('Summarize this matter');
  });
  it('dates asks for a structured list with sources', () => {
    const t = actionTask('dates');
    expect(t).toContain('key date');
    expect(t).toContain('source document');
  });
  it('draft embeds the user instruction, with a sensible default', () => {
    expect(actionTask('draft', 'a demand letter')).toContain('Draft a demand letter');
    expect(actionTask('draft')).toContain('letter to the client');
  });
  it('chat returns the question, with a default', () => {
    expect(actionTask('chat', 'What is the deadline?')).toBe('What is the deadline?');
    expect(actionTask('chat')).toContain('current status');
  });
});

describe('noteSubject', () => {
  it('labels each action and appends the matter label', () => {
    expect(noteSubject('summarize', '00123')).toBe('Hanzo AI: Matter summary — 00123');
    expect(noteSubject('draft')).toBe('Hanzo AI: Draft correspondence');
    expect(noteSubject('dates', 'M-1')).toBe('Hanzo AI: Key dates & obligations — M-1');
    expect(noteSubject('chat')).toBe('Hanzo AI: Q&A');
  });
});

describe('runAction', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('assembles context, forms the task, and posts to the Hanzo gateway', async () => {
    const fetchMock = vi.fn(async (url: string, init: any) => {
      expect(url).toBe('https://api.hanzo.ai/v1/chat/completions');
      const body = JSON.parse(init.body);
      // matter context is fenced in the user message
      expect(body.messages[1].content).toContain('Matter: 00123-Smith');
      expect(body.messages[1].content).toContain('Summarize this matter');
      return { ok: true, status: 200, text: async () => JSON.stringify({ content: 'SUMMARY' }) } as any;
    });
    vi.stubGlobal('fetch', fetchMock);
    const out = await runAction({
      id: 'summarize',
      context: { displayNumber: '00123-Smith', documents: [] },
      hanzoToken: 'hk-x',
    });
    expect(out).toBe('SUMMARY');
  });
});

describe('writeBack', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('note target POSTs to /notes with the subject + body', async () => {
    const fetchMock = vi.fn(async (url: string, init: any) => {
      expect(url).toBe('https://app.clio.com/api/v4/notes');
      const body = JSON.parse(init.body);
      expect(body.data.subject).toBe('Hanzo AI: Matter summary');
      expect(body.data.detail).toBe('the output');
      expect(body.data.matter).toEqual({ id: 42 });
      return { ok: true, status: 201, text: async () => JSON.stringify({ data: { id: 999 } }) } as any;
    });
    vi.stubGlobal('fetch', fetchMock);
    const created = await writeBack({
      target: 'note',
      token: 'CT',
      base,
      matterId: 42,
      subject: 'Hanzo AI: Matter summary',
      body: 'the output',
    });
    expect(created.data.id).toBe(999);
  });

  it('activity target POSTs to /activities as a TimeEntry combining subject + body', async () => {
    const fetchMock = vi.fn(async (url: string, init: any) => {
      expect(url).toBe('https://app.clio.com/api/v4/activities');
      const body = JSON.parse(init.body);
      expect(body.data.type).toBe('TimeEntry');
      expect(body.data.note).toContain('SUBJ');
      expect(body.data.note).toContain('BODY');
      expect(body.data.matter).toEqual({ id: 7 });
      return { ok: true, status: 201, text: async () => JSON.stringify({ data: { id: 1 } }) } as any;
    });
    vi.stubGlobal('fetch', fetchMock);
    await writeBack({ target: 'activity', token: 'CT', base, matterId: 7, subject: 'SUBJ', body: 'BODY' });
    expect(fetchMock).toHaveBeenCalledOnce();
  });
});
