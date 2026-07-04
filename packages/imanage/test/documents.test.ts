import { describe, it, expect } from 'vitest';
import {
  looksBinary,
  extractText,
  renderDocumentMeta,
  renderWorkspace,
  renderDocumentLine,
  renderFolderLine,
  contentBlocks,
  buildContext,
  contextNote,
  documentSection,
  documentIndexSection,
  folderSection,
  workspaceSection,
  searchResultSection,
} from '../src/documents.js';
import type { DocumentEntry, Workspace, FolderEntry } from '../src/imanage-api.js';

const doc: DocumentEntry = {
  id: 'ACTIVE_US!4567.1',
  name: 'Master Services Agreement',
  extension: 'docx',
  size: 48213,
  author: 'Jane Smith',
  class: 'Agreement',
  type: 'Document',
  version: 1,
  editDate: '2026-06-20',
  comment: 'Final executed copy',
};

// Binary content is built from char codes so no literal control bytes live in the
// source. NUL is a reliable binary tell; CONTROLS is a run of C0 control chars.
const NUL = String.fromCharCode(0);
const CONTROLS = Array.from({ length: 12 }, (_, i) => String.fromCharCode(i + 1)).join('');

describe('documents: looksBinary', () => {
  it('is false for plain text (incl. tabs and newlines)', () => {
    expect(looksBinary('This is a\tcontract.\nGoverning law: NY.')).toBe(false);
    expect(looksBinary('')).toBe(false);
  });
  it('is true for content with a NUL byte', () => {
    expect(looksBinary('PK' + NUL + 'native bytes')).toBe(true);
  });
  it('is true for a high share of control characters', () => {
    expect(looksBinary('abc' + CONTROLS)).toBe(true);
  });
});

describe('documents: extractText', () => {
  it('returns cleaned text for plain content', () => {
    const r = extractText('  Agreement\r\ntext.  ', 'MSA.txt');
    expect(r.extracted).toBe(true);
    expect(r.text).toBe('Agreement\ntext.');
  });
  it('reports binary content as not extractable (OCR out of scope)', () => {
    const r = extractText('PK' + NUL + 'native docx bytes', 'MSA.docx');
    expect(r.extracted).toBe(false);
    expect(r.text).toBe('');
    expect(r.reason).toMatch(/out of scope|binary/i);
    expect(r.reason).toContain('MSA.docx');
  });
  it('reports empty content honestly', () => {
    const r = extractText('   ');
    expect(r.extracted).toBe(false);
    expect(r.reason).toMatch(/no extractable text/i);
  });
});

describe('documents: record rendering', () => {
  it('renders a document profile with meta and comment', () => {
    const t = renderDocumentMeta(doc);
    expect(t).toContain('Document: Master Services Agreement');
    expect(t).toContain('Type: .docx');
    expect(t).toContain('Class: Agreement');
    expect(t).toContain('Author: Jane Smith');
    expect(t).toContain('Version: 1');
    expect(t).toContain('Comment: Final executed copy');
  });
  it('renders a workspace, a document line, and a folder line compactly', () => {
    const ws: Workspace = { id: 'W1', name: 'Acme / Falcon', description: 'M&A', client: 'Acme', matter: '2026-0042', database: 'ACTIVE_US' };
    expect(renderWorkspace(ws)).toContain('Workspace: Acme / Falcon');
    expect(renderWorkspace(ws)).toContain('Client: Acme · Matter: 2026-0042');
    expect(renderWorkspace(ws)).toContain('M&A');

    expect(renderDocumentLine(doc)).toBe('Doc: Master Services Agreement.docx — Jane Smith (2026-06-20)');

    const f: FolderEntry = { id: 'F1', name: 'Contracts' };
    expect(renderFolderLine(f)).toBe('Folder: Contracts');
  });
});

describe('documents: contentBlocks', () => {
  it('splits on blank lines and trims, dropping empties', () => {
    expect(contentBlocks('Para 1.\n\n\nPara 2.\n\n   ')).toEqual(['Para 1.', 'Para 2.']);
  });
});

describe('documents: buildContext (the windowing algorithm)', () => {
  it('returns empty for no blocks', () => {
    const ctx = buildContext([{ title: 'Document', blocks: [] }]);
    expect(ctx).toEqual({ text: '', totalBlocks: 0, includedBlocks: 0, truncated: false });
  });

  it('includes all blocks under section headers when within budget', () => {
    const ctx = buildContext([
      { title: 'Profile', blocks: ['a', 'b'] },
      { title: 'Text', blocks: ['c'] },
    ]);
    expect(ctx.totalBlocks).toBe(3);
    expect(ctx.includedBlocks).toBe(3);
    expect(ctx.truncated).toBe(false);
    expect(ctx.text).toContain('## Profile');
    expect(ctx.text).toContain('## Text');
    expect(ctx.text.indexOf('## Profile')).toBeLessThan(ctx.text.indexOf('## Text'));
  });

  it('windows in order and reports truncation when the budget is exceeded', () => {
    const blocks = ['x'.repeat(30), 'y'.repeat(30), 'z'.repeat(30)];
    const ctx = buildContext([{ title: 'Text', blocks }], 60);
    expect(ctx.totalBlocks).toBe(3);
    expect(ctx.includedBlocks).toBeLessThan(3);
    expect(ctx.truncated).toBe(true);
    expect(ctx.text).toContain('xxx');
    expect(ctx.text).not.toContain('zzz');
    expect(ctx.text.length).toBeLessThanOrEqual(60);
  });

  it('always includes at least the first block, hard-cutting it if it alone overflows', () => {
    const huge = 'q'.repeat(500);
    const ctx = buildContext([{ title: 'Text', blocks: [huge, 'next'] }], 50);
    expect(ctx.includedBlocks).toBe(1);
    expect(ctx.truncated).toBe(true);
    expect(ctx.text.length).toBe(50);
    expect(ctx.text.startsWith('## Text')).toBe(true);
  });

  it('skips empty sections without charging a header', () => {
    const ctx = buildContext([
      { title: 'Empty', blocks: [] },
      { title: 'Text', blocks: ['a'] },
    ]);
    expect(ctx.text).not.toContain('## Empty');
    expect(ctx.text).toContain('## Text');
    expect(ctx.includedBlocks).toBe(1);
  });
});

describe('documents: contextNote', () => {
  it('is honest about no records', () => {
    expect(contextNote({ text: '', totalBlocks: 0, includedBlocks: 0, truncated: false })).toMatch(/No document/);
  });
  it('reports full coverage', () => {
    expect(contextNote({ text: 'x', totalBlocks: 3, includedBlocks: 3, truncated: false })).toMatch(/all 3 sections/);
  });
  it('reports truncation with the counts', () => {
    expect(contextNote({ text: 'x', totalBlocks: 10, includedBlocks: 4, truncated: true })).toMatch(/4 of 10 sections/);
  });
});

describe('documents: section builders', () => {
  it('documentSection assembles profile + paragraph-blocked content', () => {
    const section = documentSection(doc, { text: 'Clause 1.\n\nClause 2.', extracted: true });
    expect(section.title).toBe('Document');
    expect(section.blocks[0]).toContain('Document: Master Services Agreement');
    expect(section.blocks).toContain('Clause 1.');
    expect(section.blocks).toContain('Clause 2.');
  });

  it('documentSection uses the non-extractable reason as the sole content block', () => {
    const section = documentSection(doc, { text: '', extracted: false, reason: 'binary - OCR out of scope' });
    expect(section.blocks).toHaveLength(2);
    expect(section.blocks[1]).toBe('[binary - OCR out of scope]');
  });

  it('index / folder / workspace / search sections turn records into a windowed context', () => {
    const ws: Workspace = { id: 'W1', name: 'Acme', description: '', client: 'Acme', matter: 'M1', database: 'ACTIVE_US' };
    const folders: FolderEntry[] = [{ id: 'F1', name: 'Contracts' }];
    const ctx = buildContext([
      workspaceSection([ws]),
      folderSection(folders),
      documentIndexSection([doc]),
      searchResultSection([doc]),
    ]);
    expect(ctx.totalBlocks).toBe(4);
    expect(ctx.truncated).toBe(false);
    expect(ctx.text).toContain('## Workspaces');
    expect(ctx.text).toContain('## Folders');
    expect(ctx.text).toContain('## Documents');
    expect(ctx.text).toContain('## Search results');
  });
});
