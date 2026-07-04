import { describe, it, expect } from 'vitest';
import {
  parseTotal,
  parseRestData,
  parseWorker,
  parseWorkers,
  parseOrganization,
  parseOrganizations,
  parseJobRequisition,
  parseJobRequisitions,
  parseAbsenceTypes,
  flattenEntry,
  parseReportEntries,
} from '../src/workday-api.js';

// A realistic Workday Staffing v6 worker instance (trimmed to fields we surface).
const workerFixture = {
  id: '0e44c92412d34b01ace61e80a47aaf6d',
  descriptor: 'Logan McNeil',
  primaryWorkEmail: 'lmcneil@workday.net',
  businessTitle: 'Vice President, Human Resources',
  isManager: true,
  primarySupervisoryOrganization: { id: 'org-1', descriptor: 'Human Resources' },
  primaryJob: {
    id: 'job-1',
    descriptor: 'P-00001 Vice President, Human Resources',
    jobProfile: { id: 'jp-1', descriptor: 'Vice President, Human Resources' },
    location: { id: 'loc-1', descriptor: 'San Francisco' },
    manager: { id: 'mgr-1', descriptor: 'Joy Banks' },
  },
};

// A `{ total, data }` list envelope, as Workday REST returns.
const workerList = { total: 137, data: [workerFixture, { descriptor: 'no id' }] };

describe('parse: envelope helpers', () => {
  it('parseTotal reads the body total, 0 when missing/bad', () => {
    expect(parseTotal({ total: 42 })).toBe(42);
    expect(parseTotal({})).toBe(0);
    expect(parseTotal({ total: 'many' })).toBe(0);
    expect(parseTotal({ total: -3 })).toBe(0);
  });
  it('parseRestData reads the data array or a bare array', () => {
    expect(parseRestData({ data: [1, 2] })).toEqual([1, 2]);
    expect(parseRestData([3, 4])).toEqual([3, 4]);
    expect(parseRestData({})).toEqual([]);
  });
});

describe('parse: worker', () => {
  it('reads name (descriptor), title, email, org, job, location, manager', () => {
    const w = parseWorker(workerFixture);
    expect(w.id).toBe('0e44c92412d34b01ace61e80a47aaf6d');
    expect(w.name).toBe('Logan McNeil');
    expect(w.businessTitle).toBe('Vice President, Human Resources');
    expect(w.email).toBe('lmcneil@workday.net');
    expect(w.isManager).toBe(true);
    expect(w.jobTitle).toBe('Vice President, Human Resources'); // prefers jobProfile
    expect(w.organization).toBe('Human Resources');
    expect(w.location).toBe('San Francisco');
    expect(w.managerName).toBe('Joy Banks');
  });

  it('falls back jobTitle to the primaryJob descriptor and tolerates missing fields', () => {
    const w = parseWorker({ id: 'w', descriptor: 'Amy', primaryJob: { descriptor: 'Recruiter' } });
    expect(w.jobTitle).toBe('Recruiter');
    expect(w.email).toBe('');
    expect(w.isManager).toBe(false);
    expect(w.organization).toBe('');
  });

  it('parseWorkers reads the envelope and drops idless rows', () => {
    const rows = parseWorkers(workerList);
    expect(rows).toHaveLength(1);
    expect(rows[0].name).toBe('Logan McNeil');
  });
});

describe('parse: organization', () => {
  it('reads a supervisory org reference shape', () => {
    const o = parseOrganization({
      id: 'org-1',
      descriptor: 'Human Resources',
      code: 'HR',
      organizationType: { descriptor: 'Supervisory' },
      manager: { descriptor: 'Logan McNeil' },
    });
    expect(o).toEqual({
      id: 'org-1',
      name: 'Human Resources',
      code: 'HR',
      type: 'Supervisory',
      managerName: 'Logan McNeil',
    });
  });
  it('parseOrganizations drops idless rows', () => {
    expect(parseOrganizations({ data: [{ id: 'o', descriptor: 'X' }, { descriptor: 'no id' }] })).toHaveLength(1);
  });
});

describe('parse: job requisition', () => {
  it('reads title, status, openings, location, start date', () => {
    const r = parseJobRequisition({
      id: 'R-1',
      descriptor: 'R-1 Senior Recruiter',
      jobPostingTitle: 'Senior Recruiter',
      jobRequisitionStatus: { descriptor: 'Open' },
      numberOfOpenings: 3,
      primaryLocation: { descriptor: 'Remote - USA' },
      recruitingStartDate: '2026-06-01',
    });
    expect(r).toEqual({
      id: 'R-1',
      name: 'R-1 Senior Recruiter',
      title: 'Senior Recruiter',
      status: 'Open',
      openings: 3,
      location: 'Remote - USA',
      startDate: '2026-06-01',
    });
  });
  it('parseJobRequisitions defaults openings to 0 and drops idless rows', () => {
    const rows = parseJobRequisitions({ data: [{ id: 'R', descriptor: 'x' }, { title: 'no id' }] });
    expect(rows).toHaveLength(1);
    expect(rows[0].openings).toBe(0);
  });
});

describe('parse: absence types', () => {
  it('reads id + descriptor and keeps rows with either', () => {
    const types = parseAbsenceTypes({
      total: 2,
      data: [
        { id: 'a1', descriptor: 'Sick' },
        { id: 'a2', descriptor: 'Vacation' },
        { id: '', descriptor: '' },
      ],
    });
    expect(types).toEqual([
      { id: 'a1', name: 'Sick' },
      { id: 'a2', name: 'Vacation' },
    ]);
  });
});

describe('parse: RaaS Report_Entry', () => {
  it('flattenEntry stringifies scalars, references, and arrays', () => {
    const row = flattenEntry({
      Worker: { Descriptor: 'Logan McNeil', ID: 'wid' },
      Days: 3,
      Approved: true,
      Types: [{ Descriptor: 'Sick' }, { Descriptor: 'Vacation' }],
      Empty: null,
    });
    expect(row.Worker).toBe('Logan McNeil');
    expect(row.Days).toBe('3');
    expect(row.Approved).toBe('true');
    expect(row.Types).toBe('Sick, Vacation');
    expect(row.Empty).toBe('');
  });

  it('parseReportEntries reads the Report_Entry array (or a bare array)', () => {
    const rows = parseReportEntries({
      Report_Entry: [
        { Worker: { Descriptor: 'Amy' }, Time_Off_Balance: '12' },
        { Worker: { Descriptor: 'Bo' }, Time_Off_Balance: '4' },
      ],
    });
    expect(rows).toHaveLength(2);
    expect(rows[0]).toEqual({ Worker: 'Amy', Time_Off_Balance: '12' });
    expect(parseReportEntries([{ A: 1 }])).toEqual([{ A: '1' }]);
    expect(parseReportEntries({})).toEqual([]);
  });
});
