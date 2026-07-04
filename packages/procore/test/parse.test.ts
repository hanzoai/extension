import { describe, it, expect } from 'vitest';
import {
  parseProjects,
  parseRFI,
  parseRFIs,
  parseSubmittals,
  parseDocuments,
  parseObservations,
  parseDailyLogs,
} from '../src/procore-api.js';

// A realistic Procore RFI detail payload (trimmed to fields we surface).
const rfiFixture = {
  id: 555,
  number: '042',
  subject: 'Column base plate detail conflict',
  status: 'open',
  due_date: '2026-06-25',
  created_at: '2026-06-18T14:00:00Z',
  ball_in_court: { id: 9, name: 'Dana Structural', login: 'dana@eng.co' },
  question: {
    body: 'Detail 5/A-501 conflicts with S-201. Which governs at gridline C?',
    rfi_replies: [
      { id: 1, body: 'Structural S-201 governs.', created_by: { name: 'Dana Structural' }, created_at: '2026-06-19T09:00:00Z' },
      { id: 2, plain_text_body: 'Understood, proceeding.', created_by: 'Field Team', created_at: '2026-06-19T10:00:00Z' },
    ],
  },
};

describe('parse: projects', () => {
  it('normalizes a bare array and drops rows without an id', () => {
    const rows = parseProjects([
      { id: 1, name: 'Tower A', display_name: 'Tower A — Core', active: true },
      { id: 0, name: 'bad' },
      { name: 'no id' },
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toEqual({ id: 1, name: 'Tower A', displayName: 'Tower A — Core', active: true });
  });
  it('falls back display_name to name and reads a wrapped shape', () => {
    const rows = parseProjects({ projects: [{ id: 2, name: 'Annex' }] });
    expect(rows[0].displayName).toBe('Annex');
    expect(rows[0].active).toBe(false);
  });
});

describe('parse: RFI detail', () => {
  it('reads the question, replies (in order), status, and ball-in-court', () => {
    const rfi = parseRFI(rfiFixture);
    expect(rfi.id).toBe(555);
    expect(rfi.number).toBe('042');
    expect(rfi.subject).toBe('Column base plate detail conflict');
    expect(rfi.status).toBe('open');
    expect(rfi.ballInCourt).toBe('Dana Structural');
    expect(rfi.dueDate).toBe('2026-06-25');
    expect(rfi.question.body).toContain('Which governs at gridline C');
    expect(rfi.question.replies).toHaveLength(2);
    expect(rfi.question.replies[0].body).toBe('Structural S-201 governs.');
    expect(rfi.question.replies[0].createdBy).toBe('Dana Structural');
    // Reply 2 uses plain_text_body and a bare-string author.
    expect(rfi.question.replies[1].body).toBe('Understood, proceeding.');
    expect(rfi.question.replies[1].createdBy).toBe('Field Team');
  });

  it('tolerates a missing question / replies', () => {
    const rfi = parseRFI({ id: 1, subject: 'x' });
    expect(rfi.question.body).toBe('');
    expect(rfi.question.replies).toEqual([]);
  });
});

describe('parse: RFI list', () => {
  it('parses an array and drops idless rows', () => {
    const rfis = parseRFIs([rfiFixture, { subject: 'no id' }]);
    expect(rfis).toHaveLength(1);
    expect(rfis[0].number).toBe('042');
  });
  it('reads a wrapped { rfis } shape', () => {
    expect(parseRFIs({ rfis: [rfiFixture] })).toHaveLength(1);
  });
});

describe('parse: submittals', () => {
  it('reads nested status/type name objects', () => {
    const subs = parseSubmittals([
      { id: 10, number: 'SUB-01', title: 'Rebar shop drawings', status: { name: 'Open' }, type: { name: 'Shop Drawing' }, due_date: '2026-07-01' },
      { id: 11, formatted_number: '03-100', title: 'Concrete mix', status: 'Approved', type: 'Product Data' },
    ]);
    expect(subs[0]).toEqual({ id: 10, number: 'SUB-01', title: 'Rebar shop drawings', status: 'Open', type: 'Shop Drawing', dueDate: '2026-07-01' });
    expect(subs[1].number).toBe('03-100');
    expect(subs[1].status).toBe('Approved');
    expect(subs[1].type).toBe('Product Data');
  });
});

describe('parse: documents (folders_and_files)', () => {
  it('flattens folders + files with an isFolder flag', () => {
    const docs = parseDocuments({
      folders: [{ id: 1, name: 'Drawings', updated_at: '2026-06-01T00:00:00Z' }],
      files: [{ id: 2, name: 'A-501.pdf', updated_at: '2026-06-10T00:00:00Z' }],
    });
    expect(docs).toHaveLength(2);
    expect(docs[0]).toEqual({ id: 1, name: 'Drawings', isFolder: true, updatedAt: '2026-06-01T00:00:00Z' });
    expect(docs[1].isFolder).toBe(false);
  });
  it('handles a bare array of files and drops nameless/idless rows', () => {
    const docs = parseDocuments([{ id: 3, name: 'S-201.pdf' }, { id: 0, name: 'bad' }, { id: 4, name: '' }]);
    expect(docs).toHaveLength(1);
    expect(docs[0].name).toBe('S-201.pdf');
  });
});

describe('parse: observations', () => {
  it('reads name/status/priority/description', () => {
    const obs = parseObservations([
      { id: 20, name: 'Missing guardrail on level 3', status: 'Initiated', priority: 'High', description: 'East edge open.' },
    ]);
    expect(obs[0]).toEqual({ id: 20, name: 'Missing guardrail on level 3', status: 'Initiated', priority: 'High', description: 'East edge open.' });
  });
});

describe('parse: daily logs', () => {
  it('reads comment + author + date', () => {
    const notes = parseDailyLogs([
      { id: 30, date: '2026-06-20', comment: 'Rain delay, 2 hours lost.', created_by: { name: 'Super' } },
    ]);
    expect(notes[0]).toEqual({ id: 30, date: '2026-06-20', comment: 'Rain delay, 2 hours lost.', createdBy: 'Super' });
  });
  it('reads a wrapped { notes_logs } shape and log_date fallback', () => {
    const notes = parseDailyLogs({ notes_logs: [{ id: 31, log_date: '2026-06-21', comment: 'Pour complete.' }] });
    expect(notes[0].date).toBe('2026-06-21');
    expect(notes[0].createdBy).toBe('');
  });
});
