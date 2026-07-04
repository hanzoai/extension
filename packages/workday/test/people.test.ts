import { describe, it, expect } from 'vitest';
import {
  renderWorker,
  renderOrganization,
  renderJobRequisition,
  renderAbsenceType,
  renderReportRow,
  buildPeopleContext,
  contextNote,
  workerSection,
  directReportSection,
  organizationSection,
  requisitionSection,
  absenceTypeSection,
  timeOffSection,
} from '../src/people.js';
import type { Worker, Organization, JobRequisition, AbsenceType } from '../src/workday-api.js';

const worker: Worker = {
  id: 'w1',
  name: 'Logan McNeil',
  businessTitle: 'Vice President, Human Resources',
  email: 'lmcneil@workday.net',
  isManager: true,
  jobTitle: 'Vice President, Human Resources',
  organization: 'Human Resources',
  location: 'San Francisco',
  managerName: 'Joy Banks',
};

describe('people: record rendering', () => {
  it('renders a worker with title, org, and details, no invented fields', () => {
    const text = renderWorker(worker);
    expect(text).toContain('Logan McNeil');
    expect(text).toContain('Vice President, Human Resources · Human Resources');
    expect(text).toContain('Location: San Francisco');
    expect(text).toContain('Manager: Joy Banks');
    expect(text).toContain('Email: lmcneil@workday.net');
    expect(text).toContain('People manager');
  });

  it('shows a distinct Job line only when jobTitle differs from businessTitle', () => {
    const w: Worker = { ...worker, jobTitle: 'Recruiter' };
    expect(renderWorker(w)).toContain('Job: Recruiter');
    expect(renderWorker(worker)).not.toContain('Job: Vice President');
  });

  it('renders an org, requisition, absence type, and report row compactly', () => {
    const org: Organization = { id: 'o1', name: 'Human Resources', code: 'HR', type: 'Supervisory', managerName: 'Logan McNeil' };
    expect(renderOrganization(org)).toContain('Organization: Human Resources');
    expect(renderOrganization(org)).toContain('Code: HR · Type: Supervisory · Manager: Logan McNeil');

    const req: JobRequisition = { id: 'R-1', name: 'R-1', title: 'Senior Recruiter', status: 'Open', openings: 3, location: 'Remote', startDate: '2026-06-01' };
    expect(renderJobRequisition(req)).toContain('Requisition R-1: Senior Recruiter');
    expect(renderJobRequisition(req)).toContain('Status: Open · Openings: 3 · Location: Remote · Start: 2026-06-01');

    const abs: AbsenceType = { id: 'a1', name: 'Sick' };
    expect(renderAbsenceType(abs)).toBe('Absence type: Sick');

    expect(renderReportRow({ Worker: 'Amy', Balance: '12', Empty: '' })).toBe('Worker: Amy · Balance: 12');
    expect(renderReportRow({ Empty: '' })).toBe('');
  });
});

describe('people: buildPeopleContext', () => {
  it('returns empty for no blocks', () => {
    expect(buildPeopleContext([{ title: 'Workers', blocks: [] }])).toEqual({
      text: '',
      totalBlocks: 0,
      includedBlocks: 0,
      truncated: false,
    });
  });

  it('includes all blocks under section headers when within budget', () => {
    const ctx = buildPeopleContext([
      { title: 'Workers', blocks: ['a', 'b'] },
      { title: 'Orgs', blocks: ['c'] },
    ]);
    expect(ctx.totalBlocks).toBe(3);
    expect(ctx.includedBlocks).toBe(3);
    expect(ctx.truncated).toBe(false);
    expect(ctx.text).toContain('## Workers');
    expect(ctx.text).toContain('## Orgs');
    expect(ctx.text.indexOf('## Workers')).toBeLessThan(ctx.text.indexOf('## Orgs'));
  });

  it('windows in order and reports truncation when the budget is exceeded', () => {
    const blocks = ['x'.repeat(30), 'y'.repeat(30), 'z'.repeat(30)];
    const ctx = buildPeopleContext([{ title: 'Workers', blocks }], 60);
    expect(ctx.totalBlocks).toBe(3);
    expect(ctx.includedBlocks).toBeLessThan(3);
    expect(ctx.truncated).toBe(true);
    expect(ctx.text).toContain('xxx');
    expect(ctx.text).not.toContain('zzz');
    expect(ctx.text.length).toBeLessThanOrEqual(60);
  });

  it('always includes at least the first block, hard-cutting it if it alone overflows', () => {
    const huge = 'q'.repeat(500);
    const ctx = buildPeopleContext([{ title: 'Workers', blocks: [huge, 'next'] }], 50);
    expect(ctx.includedBlocks).toBe(1);
    expect(ctx.truncated).toBe(true);
    expect(ctx.text.length).toBe(50);
    expect(ctx.text.startsWith('## Workers')).toBe(true);
  });

  it('skips empty sections without charging a header', () => {
    const ctx = buildPeopleContext([
      { title: 'Empty', blocks: [] },
      { title: 'Workers', blocks: ['a'] },
    ]);
    expect(ctx.text).not.toContain('## Empty');
    expect(ctx.text).toContain('## Workers');
    expect(ctx.includedBlocks).toBe(1);
  });
});

describe('people: contextNote', () => {
  it('is honest about no records', () => {
    expect(contextNote({ text: '', totalBlocks: 0, includedBlocks: 0, truncated: false })).toMatch(/No Workday records/);
  });
  it('reports full coverage', () => {
    expect(contextNote({ text: 'x', totalBlocks: 3, includedBlocks: 3, truncated: false })).toMatch(/all 3 items/);
  });
  it('reports truncation with the counts', () => {
    expect(contextNote({ text: 'x', totalBlocks: 10, includedBlocks: 4, truncated: true })).toMatch(/4 of 10 items/);
  });
});

describe('people: section builders assemble a real context', () => {
  it('turns typed records into a windowed context end to end', () => {
    const ctx = buildPeopleContext([
      workerSection([worker]),
      directReportSection([{ ...worker, id: 'w2', name: 'Amy Wong', businessTitle: 'Recruiter', isManager: false }]),
      organizationSection([{ id: 'o1', name: 'Human Resources', code: 'HR', type: 'Supervisory', managerName: 'Logan McNeil' }]),
      requisitionSection([{ id: 'R-1', name: 'R-1', title: 'Senior Recruiter', status: 'Open', openings: 2, location: '', startDate: '' }]),
      absenceTypeSection([{ id: 'a1', name: 'Sick' }]),
      timeOffSection([{ Worker: 'Amy Wong', Balance: '12' }, { Empty: '' }]),
    ]);
    expect(ctx.totalBlocks).toBe(6); // the all-empty time-off row is dropped by timeOffSection
    expect(ctx.truncated).toBe(false);
    expect(ctx.text).toContain('## Workers');
    expect(ctx.text).toContain('Logan McNeil');
    expect(ctx.text).toContain('## Direct reports');
    expect(ctx.text).toContain('Amy Wong');
    expect(ctx.text).toContain('## Organization');
    expect(ctx.text).toContain('## Job requisitions');
    expect(ctx.text).toContain('## Absence types');
    expect(ctx.text).toContain('## Time off');
    expect(ctx.text).toContain('Worker: Amy Wong · Balance: 12');
  });
});
