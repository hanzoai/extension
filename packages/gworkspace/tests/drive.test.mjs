import { describe, it, expect } from 'vitest';
import { loadGs } from './loadGs.mjs';

const { MAX_FILE_CHARS, driveReadURL, driveContext, draftTitle, multipartBody, driveItems } =
  loadGs('src/drive.gs');

const files = 'https://www.googleapis.com/drive/v3/files/';

describe('driveReadURL', () => {
  it('exports Google Docs and Slides as plain text, Sheets as CSV', () => {
    expect(driveReadURL({ id: 'd1', mimeType: 'application/vnd.google-apps.document' })).toBe(
      files + 'd1/export?mimeType=text%2Fplain'
    );
    expect(driveReadURL({ id: 's1', mimeType: 'application/vnd.google-apps.spreadsheet' })).toBe(
      files + 's1/export?mimeType=text%2Fcsv'
    );
    expect(driveReadURL({ id: 'p1', mimeType: 'application/vnd.google-apps.presentation' })).toBe(
      files + 'p1/export?mimeType=text%2Fplain'
    );
  });

  it('reads text, JSON and XML files as-is, shared drives included', () => {
    for (const mimeType of ['text/plain', 'text/markdown', 'text/csv', 'application/json', 'application/xml', 'image/svg+xml']) {
      expect(driveReadURL({ id: 't1', mimeType })).toBe(files + 't1?alt=media&supportsAllDrives=true');
    }
  });

  it('has no read for folders, PDFs and images', () => {
    for (const mimeType of ['application/vnd.google-apps.folder', 'application/pdf', 'image/png', undefined]) {
      expect(driveReadURL({ id: 'x', mimeType })).toBe('');
    }
  });

  it('escapes the file id', () => {
    expect(driveReadURL({ id: 'a/b', mimeType: 'text/plain' })).toBe(files + 'a%2Fb?alt=media&supportsAllDrives=true');
  });
});

describe('driveItems', () => {
  it('keeps the readable part of the selection', () => {
    const e = {
      drive: {
        selectedItems: [
          { id: '1', title: 'Plan', mimeType: 'application/vnd.google-apps.document' },
          { id: '2', title: 'Folder', mimeType: 'application/vnd.google-apps.folder' },
          { id: '3', title: 'notes.md', mimeType: 'text/markdown' },
        ],
      },
    };
    expect(driveItems(e).map((i) => i.id)).toEqual(['1', '3']);
  });

  it('is empty with no Drive selection', () => {
    expect(driveItems({})).toEqual([]);
    expect(driveItems(undefined)).toEqual([]);
  });
});

describe('driveContext', () => {
  it('puts each file under its title', () => {
    expect(driveContext([{ title: 'A', text: 'one' }, { title: 'B', text: 'two' }])).toBe('## A\none\n\n## B\ntwo');
  });

  it('cuts one file at MAX_FILE_CHARS and says so', () => {
    const out = driveContext([{ title: 'Big', text: 'x'.repeat(MAX_FILE_CHARS + 5) }]);
    expect(out).toBe('## Big\n' + 'x'.repeat(MAX_FILE_CHARS) + '\n[truncated]');
  });
});

describe('draftTitle', () => {
  it('names the draft after its sources', () => {
    expect(draftTitle([{ title: 'Plan' }, { title: 'Budget' }])).toBe('Hanzo draft: Plan, Budget');
  });

  it('stays within 100 characters', () => {
    const t = draftTitle([{ title: 'y'.repeat(200) }]);
    expect(t.length).toBe(100);
    expect(t.endsWith('…')).toBe(true);
  });
});

describe('multipartBody', () => {
  it('sends metadata that converts the text into a Google Doc', () => {
    const body = multipartBody('B', { name: 'Draft', mimeType: 'application/vnd.google-apps.document' }, 'hello');
    expect(body).toBe(
      '--B\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n' +
        '{"name":"Draft","mimeType":"application/vnd.google-apps.document"}\r\n' +
        '--B\r\nContent-Type: text/plain; charset=UTF-8\r\n\r\nhello\r\n--B--'
    );
  });
});
