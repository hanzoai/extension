import { describe, it, expect } from 'vitest';
import {
  MAX_LIMIT,
  pageParams,
  restGet,
  raasGet,
  listWorkers,
  getWorker,
  listDirectReports,
  listSupervisoryOrganizations,
  getSupervisoryOrganization,
  listJobRequisitions,
  getJobRequisition,
  listEligibleAbsenceTypes,
  timeOffReport,
  type Scope,
} from '../src/workday-api.js';
import { STAFFING } from '../src/config.js';

const scope: Scope = {
  host: 'https://wd2-impl-services1.workday.com',
  tenant: 'acme',
  accessToken: 'at-123',
};

function q(url: string): URLSearchParams {
  return new URL(url).searchParams;
}
function path(url: string): string {
  return new URL(url).pathname;
}

describe('api: pageParams', () => {
  it('emits nothing for no page', () => {
    expect(pageParams(undefined)).toEqual({});
  });
  it('emits limit + offset when set', () => {
    expect(pageParams({ limit: 50, offset: 100 })).toEqual({ limit: '50', offset: '100' });
  });
  it('clamps limit to the documented max', () => {
    expect(pageParams({ limit: 500 }).limit).toBe(String(MAX_LIMIT));
  });
  it('drops a zero/absent offset (0 is the default) and non-positive limit', () => {
    expect(pageParams({ offset: 0 })).toEqual({});
    expect(pageParams({ limit: 0, offset: -5 })).toEqual({});
  });
});

describe('api: auth headers', () => {
  it('every read carries the Bearer token and a JSON Accept', () => {
    for (const req of [
      listWorkers(scope),
      getWorker(scope, 'w1'),
      listDirectReports(scope, 'w1'),
      listSupervisoryOrganizations(scope),
      getSupervisoryOrganization(scope, 'o1'),
      listJobRequisitions(scope),
      getJobRequisition(scope, 'r1'),
      listEligibleAbsenceTypes(scope, 'w1'),
      timeOffReport(scope, 'lmcneil', 'Team_Time_Off'),
    ]) {
      expect(req.headers.Authorization).toBe('Bearer at-123');
      expect(req.headers.Accept).toBe('application/json');
    }
  });
});

describe('api: restGet service routing', () => {
  it('routes staffing v6 with tenant in the path', () => {
    const req = restGet(scope, STAFFING, '/workers', { limit: '10' });
    expect(path(req.url)).toBe('/ccx/api/staffing/v6/acme/workers');
    expect(q(req.url).get('limit')).toBe('10');
  });
});

describe('api: workers (staffing)', () => {
  it('lists workers with pagination', () => {
    const req = listWorkers(scope, { limit: 100, offset: 200 });
    expect(path(req.url)).toBe('/ccx/api/staffing/v6/acme/workers');
    expect(q(req.url).get('limit')).toBe('100');
    expect(q(req.url).get('offset')).toBe('200');
  });
  it('gets one worker by id', () => {
    expect(path(getWorker(scope, 'abc123').url)).toBe('/ccx/api/staffing/v6/acme/workers/abc123');
  });
  it('lists direct reports under the worker path', () => {
    expect(path(listDirectReports(scope, 'abc123').url)).toBe(
      '/ccx/api/staffing/v6/acme/workers/abc123/directReports',
    );
  });
});

describe('api: organizations (staffing)', () => {
  it('lists supervisory organizations', () => {
    expect(path(listSupervisoryOrganizations(scope).url)).toBe(
      '/ccx/api/staffing/v6/acme/supervisoryOrganizations',
    );
  });
  it('gets one organization by id', () => {
    expect(path(getSupervisoryOrganization(scope, 'o9').url)).toBe(
      '/ccx/api/staffing/v6/acme/supervisoryOrganizations/o9',
    );
  });
});

describe('api: job requisitions (recruiting)', () => {
  it('lists requisitions on the recruiting v4 service', () => {
    expect(path(listJobRequisitions(scope).url)).toBe('/ccx/api/recruiting/v4/acme/jobRequisitions');
  });
  it('gets one requisition by id', () => {
    expect(path(getJobRequisition(scope, 'R-42').url)).toBe(
      '/ccx/api/recruiting/v4/acme/jobRequisitions/R-42',
    );
  });
});

describe('api: absence (time off)', () => {
  it('lists eligible absence types on the absenceManagement v1 service', () => {
    expect(path(listEligibleAbsenceTypes(scope, 'w1').url)).toBe(
      '/ccx/api/absenceManagement/v1/acme/workers/w1/eligibleAbsenceTypes',
    );
  });
});

describe('api: RaaS report', () => {
  it('targets the customreport2 path and forces format=json', () => {
    const req = timeOffReport(scope, 'lmcneil', 'Team_Time_Off', { asOf: '2026-07-01' });
    expect(path(req.url)).toBe('/ccx/service/customreport2/acme/lmcneil/Team_Time_Off');
    expect(q(req.url).get('format')).toBe('json');
    expect(q(req.url).get('asOf')).toBe('2026-07-01');
  });
  it('defaults format=json even without extra params', () => {
    expect(q(raasGet(scope, 'owner', 'Rep').url).get('format')).toBe('json');
  });
});

describe('api: path segment encoding', () => {
  it('encodes ids defensively so a stray value cannot traverse the path', () => {
    expect(getWorker(scope, 'a/b c').url).toContain('/workers/a%2Fb%20c');
  });
});
