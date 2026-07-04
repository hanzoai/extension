import { describe, it, expect } from 'vitest';
import {
  COMPANY_HEADER,
  DEFAULT_PER_PAGE,
  pageParams,
  parseTotal,
  listProjects,
  listRFIs,
  getRFI,
  createReply,
  listSubmittals,
  listDocuments,
  listObservations,
  listDailyLogs,
  type Scope,
} from '../src/procore-api.js';
import { apiBaseUrl } from '../src/config.js';

const scope: Scope = {
  apiBase: apiBaseUrl('production'),
  accessToken: 'at-123',
  companyId: 42,
};

function q(url: string): URLSearchParams {
  return new URL(url).searchParams;
}

describe('api: pageParams', () => {
  it('emits nothing for no page', () => {
    expect(pageParams(undefined)).toEqual({});
  });
  it('emits page + per_page when set', () => {
    expect(pageParams({ page: 2, perPage: 50 })).toEqual({ page: '2', per_page: '50' });
  });
  it('clamps per_page to the documented max', () => {
    expect(pageParams({ perPage: 500 }).per_page).toBe(String(DEFAULT_PER_PAGE));
  });
  it('ignores non-positive values', () => {
    expect(pageParams({ page: 0, perPage: -5 })).toEqual({});
  });
});

describe('api: company + auth scoping', () => {
  it('every read carries the Bearer token and the Procore-Company-Id header', () => {
    for (const req of [
      listProjects(scope),
      listRFIs(scope, 7),
      getRFI(scope, 7, 9),
      listSubmittals(scope, 7),
      listDocuments(scope, 7),
      listObservations(scope, 7),
      listDailyLogs(scope, 7, '2026-06-20'),
    ]) {
      expect(req.headers.Authorization).toBe('Bearer at-123');
      expect(req.headers[COMPANY_HEADER]).toBe('42');
    }
  });

  it('COMPANY_HEADER is exactly Procore-Company-Id', () => {
    expect(COMPANY_HEADER).toBe('Procore-Company-Id');
  });
});

describe('api: listProjects', () => {
  it('is company-scoped (query) with no project in the path', () => {
    const req = listProjects(scope, { page: 3, perPage: 25 });
    const url = new URL(req.url);
    expect(url.pathname).toBe('/rest/v1.0/projects');
    expect(q(req.url).get('company_id')).toBe('42');
    expect(q(req.url).get('page')).toBe('3');
    expect(q(req.url).get('per_page')).toBe('25');
  });
});

describe('api: RFIs', () => {
  it('lists RFIs on a project path with pagination', () => {
    const req = listRFIs(scope, 100, { page: 2 });
    expect(new URL(req.url).pathname).toBe('/rest/v1.0/projects/100/rfis');
    expect(q(req.url).get('page')).toBe('2');
  });
  it('gets one RFI by id', () => {
    const req = getRFI(scope, 100, 555);
    expect(new URL(req.url).pathname).toBe('/rest/v1.0/projects/100/rfis/555');
  });
});

describe('api: createReply (the one write path)', () => {
  it('POSTs an rfi_reply body under the project/rfi path', () => {
    const req = createReply(scope, 100, 555, 'Use detail 5/A-501.');
    expect(req.method).toBe('POST');
    expect(new URL(req.url).pathname).toBe('/rest/v1.0/projects/100/rfis/555/replies');
    expect(req.headers['Content-Type']).toBe('application/json');
    expect(req.headers[COMPANY_HEADER]).toBe('42');
    expect(JSON.parse(req.body)).toEqual({ rfi_reply: { body: 'Use detail 5/A-501.' } });
  });
});

describe('api: submittals / documents / observations / daily logs', () => {
  it('submittals are project-path scoped', () => {
    expect(new URL(listSubmittals(scope, 100).url).pathname).toBe('/rest/v1.0/projects/100/submittals');
  });
  it('documents use folders_and_files with project_id query', () => {
    const req = listDocuments(scope, 100);
    expect(new URL(req.url).pathname).toBe('/rest/v1.0/folders_and_files');
    expect(q(req.url).get('project_id')).toBe('100');
  });
  it('observations use observations/items with project_id query', () => {
    const req = listObservations(scope, 100);
    expect(new URL(req.url).pathname).toBe('/rest/v1.0/observations/items');
    expect(q(req.url).get('project_id')).toBe('100');
  });
  it('daily logs are project-path scoped with a log_date', () => {
    const req = listDailyLogs(scope, 100, '2026-06-20', { perPage: 10 });
    expect(new URL(req.url).pathname).toBe('/rest/v1.0/projects/100/daily_logs/notes_logs');
    expect(q(req.url).get('log_date')).toBe('2026-06-20');
    expect(q(req.url).get('per_page')).toBe('10');
  });
});

describe('api: path segment encoding', () => {
  it('encodes ids defensively so a stray value cannot traverse the path', () => {
    const req = getRFI(scope, 'a/b', 'c d');
    expect(req.url).toContain('/projects/a%2Fb/rfis/c%20d');
  });
});

describe('api: parseTotal', () => {
  it('reads a numeric Total from a Headers instance', () => {
    const h = new Headers({ Total: '137' });
    expect(parseTotal(h)).toBe(137);
  });
  it('reads Total from a plain header map (either case)', () => {
    expect(parseTotal({ Total: '5' })).toBe(5);
    expect(parseTotal({ total: '9' })).toBe(9);
  });
  it('handles an array-valued header', () => {
    expect(parseTotal({ Total: ['12', '13'] })).toBe(12);
  });
  it('returns 0 for a missing or unparseable header', () => {
    expect(parseTotal({})).toBe(0);
    expect(parseTotal(new Headers())).toBe(0);
    expect(parseTotal({ Total: 'many' })).toBe(0);
  });
});
