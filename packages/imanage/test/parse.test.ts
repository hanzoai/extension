import { describe, it, expect } from 'vitest';
import {
  parseLibraries,
  parseWorkspaces,
  parseWorkspaceDetail,
  parseFolderChildren,
  parseDocument,
  parseSearchResults,
} from '../src/imanage-api.js';

// A realistic iManage Work API v2 document profile (envelope-wrapped, trimmed to
// the fields we surface). iManage separates coded fields from *_description labels.
const documentEnvelope = {
  data: {
    id: 'ACTIVE_US!4567.1',
    name: 'Master Services Agreement - Acme Corp',
    extension: 'DOCX',
    size: 48213,
    author: 'jsmith',
    author_description: 'Jane Smith',
    class: 'AGR',
    class_description: 'Agreement',
    type: 'DOC',
    type_description: 'Document',
    version: 1,
    edit_date: '2026-06-20T14:00:00Z',
    comment: 'Final executed copy',
  },
};

describe('parse: libraries', () => {
  it('reads id + name from an envelope and drops idless rows', () => {
    const libs = parseLibraries({ data: [{ id: 'ACTIVE_US', name: 'Active (US)' }, { name: 'no id' }] });
    expect(libs).toEqual([{ id: 'ACTIVE_US', name: 'Active (US)' }]);
  });
  it('falls id back to name (and vice versa)', () => {
    expect(parseLibraries([{ id: 'X' }])[0]).toEqual({ id: 'X', name: 'X' });
  });
});

describe('parse: workspaces', () => {
  it('reads the matter fields from an envelope array and drops idless rows', () => {
    const wss = parseWorkspaces({
      data: [
        {
          id: 'ACTIVE_US!12',
          name: 'Acme Corp / Project Falcon',
          wstype: 'workspace',
          description: 'M&A due diligence',
          client: 'Acme Corp',
          matter: '2026-0042',
          database: 'ACTIVE_US',
        },
        { name: 'no id' },
      ],
    });
    expect(wss).toHaveLength(1);
    expect(wss[0]).toEqual({
      id: 'ACTIVE_US!12',
      name: 'Acme Corp / Project Falcon',
      description: 'M&A due diligence',
      client: 'Acme Corp',
      matter: '2026-0042',
      database: 'ACTIVE_US',
    });
  });
  it('reads client/matter from custom1/custom2 fallbacks', () => {
    const w = parseWorkspaces([{ id: 'W1', name: 'W', custom1: 'ClientCo', custom2: 'M-9' }])[0];
    expect(w.client).toBe('ClientCo');
    expect(w.matter).toBe('M-9');
  });
  it('parseWorkspaceDetail unwraps a single workspace envelope', () => {
    const w = parseWorkspaceDetail({ data: { id: 'W2', name: 'Solo' } });
    expect(w.id).toBe('W2');
    expect(w.name).toBe('Solo');
  });
});

describe('parse: document profile', () => {
  it('unwraps the envelope and prefers *_description labels; lowercases the extension', () => {
    const doc = parseDocument(documentEnvelope);
    expect(doc.id).toBe('ACTIVE_US!4567.1');
    expect(doc.name).toBe('Master Services Agreement - Acme Corp');
    expect(doc.extension).toBe('docx');
    expect(doc.size).toBe(48213);
    expect(doc.author).toBe('Jane Smith');
    expect(doc.class).toBe('Agreement');
    expect(doc.type).toBe('Document');
    expect(doc.version).toBe(1);
    expect(doc.editDate).toBe('2026-06-20T14:00:00Z');
    expect(doc.comment).toBe('Final executed copy');
  });
  it('tolerates a bare (unwrapped) profile and missing fields', () => {
    const doc = parseDocument({ id: 'D1', name: 'X' });
    expect(doc.id).toBe('D1');
    expect(doc.extension).toBe('');
    expect(doc.size).toBe(0);
    expect(doc.author).toBe('');
  });
});

describe('parse: folder children (folders + documents split)', () => {
  const children = {
    data: [
      { id: 'FOLDER!1', name: 'Contracts', type: 'folder', wstype: 'folder' },
      {
        id: 'ACTIVE_US!4567.1',
        name: 'MSA - Acme',
        type: 'document',
        extension: 'DOCX',
        author_description: 'Jane Smith',
        edit_date: '2026-06-20',
      },
      { id: 'ACTIVE_US!4568.2', name: 'NDA', extension: 'PDF' },
    ],
  };

  it('separates typed folders from documents and untyped-with-extension rows', () => {
    const { folders, documents } = parseFolderChildren(children);
    expect(folders).toEqual([{ id: 'FOLDER!1', name: 'Contracts' }]);
    expect(documents.map((d) => d.id)).toEqual(['ACTIVE_US!4567.1', 'ACTIVE_US!4568.2']);
    expect(documents[0].author).toBe('Jane Smith');
    expect(documents[1].extension).toBe('pdf');
  });

  it('treats an untyped row with no extension as a folder (never guessed a document)', () => {
    const { folders, documents } = parseFolderChildren([{ id: 'C1', name: 'Correspondence' }]);
    expect(folders).toEqual([{ id: 'C1', name: 'Correspondence' }]);
    expect(documents).toEqual([]);
  });

  it('reads a nested { document } child object', () => {
    const { documents } = parseFolderChildren([
      { type: 'document', document: { id: 'D9', name: 'Deed', extension: 'PDF' } },
    ]);
    expect(documents[0]).toMatchObject({ id: 'D9', name: 'Deed', extension: 'pdf' });
  });

  it('drops idless rows from both buckets', () => {
    const { folders, documents } = parseFolderChildren([{ type: 'folder', name: 'nameless' }, { extension: 'DOCX', name: 'no id doc' }]);
    expect(folders).toEqual([]);
    expect(documents).toEqual([]);
  });
});

describe('parse: search results', () => {
  it('reads document rows from an envelope and drops idless rows', () => {
    const results = parseSearchResults({
      data: [
        { id: 'ACTIVE_US!4567.1', name: 'MSA - Acme', extension: 'DOCX', author_description: 'Jane Smith', class_description: 'Agreement' },
        { name: 'no id' },
      ],
    });
    expect(results).toHaveLength(1);
    expect(results[0].name).toBe('MSA - Acme');
    expect(results[0].class).toBe('Agreement');
  });
  it('handles a bare array shape', () => {
    expect(parseSearchResults([{ id: 'D1', name: 'X', extension: 'PDF' }])).toHaveLength(1);
  });
});
