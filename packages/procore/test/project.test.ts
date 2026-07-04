import { describe, it, expect } from 'vitest';
import {
  renderRFI,
  renderSubmittal,
  renderDocument,
  renderObservation,
  renderDailyLog,
  buildProjectContext,
  contextNote,
  rfiSection,
  submittalSection,
  documentSection,
  observationSection,
  dailyLogSection,
} from '../src/project.js';
import type { Rfi, Submittal, DocumentEntry, Observation, DailyLogNote } from '../src/procore-api.js';

const rfi: Rfi = {
  id: 555,
  number: '042',
  subject: 'Base plate conflict',
  status: 'open',
  ballInCourt: 'Dana Structural',
  dueDate: '2026-06-25',
  createdAt: '2026-06-18',
  question: {
    body: 'Detail 5/A-501 conflicts with S-201. Which governs?',
    replies: [{ id: 1, body: 'S-201 governs.', createdBy: 'Dana', createdAt: '2026-06-19' }],
  },
};

describe('project: record rendering', () => {
  it('renders an RFI with number, meta, question, and replies in order', () => {
    const text = renderRFI(rfi);
    expect(text).toContain('RFI 042: Base plate conflict');
    expect(text).toContain('Status: open');
    expect(text).toContain('Ball in court: Dana Structural');
    expect(text).toContain('Question: Detail 5/A-501 conflicts');
    expect(text).toContain('Reply (Dana): S-201 governs.');
  });

  it('renders a submittal, document, observation, and daily log compactly', () => {
    const sub: Submittal = { id: 10, number: 'SUB-01', title: 'Rebar', status: 'Open', type: 'Shop Drawing', dueDate: '2026-07-01' };
    expect(renderSubmittal(sub)).toContain('Submittal SUB-01: Rebar');
    expect(renderSubmittal(sub)).toContain('Type: Shop Drawing · Status: Open · Due: 2026-07-01');

    const doc: DocumentEntry = { id: 2, name: 'A-501.pdf', isFolder: false, updatedAt: '2026-06-10' };
    expect(renderDocument(doc)).toBe('File: A-501.pdf (updated 2026-06-10)');

    const obs: Observation = { id: 20, name: 'Missing guardrail', status: 'Initiated', priority: 'High', description: 'East edge open.' };
    expect(renderObservation(obs)).toContain('Observation: Missing guardrail');
    expect(renderObservation(obs)).toContain('East edge open.');

    const note: DailyLogNote = { id: 30, date: '2026-06-20', comment: 'Rain delay.', createdBy: 'Super' };
    expect(renderDailyLog(note)).toBe('[2026-06-20] — Super: Rain delay.');
  });
});

describe('project: buildProjectContext', () => {
  it('returns empty for no blocks', () => {
    const ctx = buildProjectContext([{ title: 'RFIs', blocks: [] }]);
    expect(ctx).toEqual({ text: '', totalBlocks: 0, includedBlocks: 0, truncated: false });
  });

  it('includes all blocks under section headers when within budget', () => {
    const ctx = buildProjectContext([
      { title: 'RFIs', blocks: ['a', 'b'] },
      { title: 'Docs', blocks: ['c'] },
    ]);
    expect(ctx.totalBlocks).toBe(3);
    expect(ctx.includedBlocks).toBe(3);
    expect(ctx.truncated).toBe(false);
    expect(ctx.text).toContain('## RFIs');
    expect(ctx.text).toContain('## Docs');
    expect(ctx.text.indexOf('## RFIs')).toBeLessThan(ctx.text.indexOf('## Docs'));
  });

  it('windows in order and reports truncation when the budget is exceeded', () => {
    const blocks = ['x'.repeat(30), 'y'.repeat(30), 'z'.repeat(30)];
    const ctx = buildProjectContext([{ title: 'RFIs', blocks }], 60);
    expect(ctx.totalBlocks).toBe(3);
    expect(ctx.includedBlocks).toBeLessThan(3);
    expect(ctx.truncated).toBe(true);
    expect(ctx.text).toContain('xxx');
    expect(ctx.text).not.toContain('zzz');
    expect(ctx.text.length).toBeLessThanOrEqual(60);
  });

  it('always includes at least the first block, hard-cutting it if it alone overflows', () => {
    const huge = 'q'.repeat(500);
    const ctx = buildProjectContext([{ title: 'RFIs', blocks: [huge, 'next'] }], 50);
    expect(ctx.includedBlocks).toBe(1);
    expect(ctx.truncated).toBe(true);
    expect(ctx.text.length).toBe(50);
    expect(ctx.text.startsWith('## RFIs')).toBe(true);
  });

  it('skips empty sections without charging a header', () => {
    const ctx = buildProjectContext([
      { title: 'Empty', blocks: [] },
      { title: 'RFIs', blocks: ['a'] },
    ]);
    expect(ctx.text).not.toContain('## Empty');
    expect(ctx.text).toContain('## RFIs');
    expect(ctx.includedBlocks).toBe(1);
  });
});

describe('project: contextNote', () => {
  it('is honest about no records', () => {
    expect(contextNote({ text: '', totalBlocks: 0, includedBlocks: 0, truncated: false })).toMatch(/No project records/);
  });
  it('reports full coverage', () => {
    expect(contextNote({ text: 'x', totalBlocks: 3, includedBlocks: 3, truncated: false })).toMatch(/all 3 items/);
  });
  it('reports truncation with the counts', () => {
    expect(contextNote({ text: 'x', totalBlocks: 10, includedBlocks: 4, truncated: true })).toMatch(/4 of 10 items/);
  });
});

describe('project: section builders assemble a real context', () => {
  it('turns typed records into a windowed context end to end', () => {
    const ctx = buildProjectContext([
      rfiSection([rfi]),
      submittalSection([{ id: 10, number: 'SUB-01', title: 'Rebar', status: 'Open', type: 'Shop', dueDate: '' }]),
      documentSection([{ id: 2, name: 'A-501.pdf', isFolder: false, updatedAt: '' }]),
      observationSection([{ id: 20, name: 'Guardrail', status: 'Initiated', priority: 'High', description: '' }]),
      dailyLogSection([{ id: 30, date: '2026-06-20', comment: 'Rain delay.', createdBy: 'Super' }]),
    ]);
    expect(ctx.totalBlocks).toBe(5);
    expect(ctx.truncated).toBe(false);
    expect(ctx.text).toContain('## RFIs');
    expect(ctx.text).toContain('RFI 042');
    expect(ctx.text).toContain('## Submittals');
    expect(ctx.text).toContain('## Documents');
    expect(ctx.text).toContain('## Observations');
    expect(ctx.text).toContain('## Daily log');
  });
});
