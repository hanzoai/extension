import { describe, it, expect, vi } from 'vitest';
import {
  resourceUrl,
  getPatient,
  searchConditions,
  searchMedicationRequests,
  searchAllergyIntolerances,
  searchObservations,
  searchDocumentReferences,
  bundleEntries,
  nextPageUrl,
  isOperationOutcome,
  operationOutcomeMessage,
  fhirFetch,
  fetchAllPages,
  DEFAULT_COUNT,
  type FhirRequest,
} from '../src/fhir-client.js';

const BASE = 'https://fhir.example.org/r4';
const TOKEN = 'AT-secret';
const PID = 'Patient-123';

function res(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/fhir+json' } });
}

describe('resourceUrl', () => {
  it('builds a search root and a single-resource URL', () => {
    expect(resourceUrl(BASE, 'Condition')).toBe(`${BASE}/Condition`);
    expect(resourceUrl(BASE, 'Patient', PID)).toBe(`${BASE}/Patient/Patient-123`);
  });
  it('normalizes a trailing slash and encodes the id', () => {
    expect(resourceUrl(`${BASE}/`, 'Patient', 'a/b')).toBe(`${BASE}/Patient/a%2Fb`);
  });
});

describe('single-patient read', () => {
  it('getPatient targets Patient/<id> with a bearer + fhir accept', () => {
    const r = getPatient(BASE, TOKEN, PID);
    expect(r.method).toBe('GET');
    expect(r.url).toBe(`${BASE}/Patient/Patient-123`);
    expect(r.headers.Authorization).toBe(`Bearer ${TOKEN}`);
    expect(r.headers.Accept).toBe('application/fhir+json');
  });
});

describe('patient-scoped searches', () => {
  const sp = { base: BASE, token: TOKEN, patientId: PID };

  it('scopes every search with patient=<id> and a default _count', () => {
    for (const req of [
      searchConditions(sp),
      searchMedicationRequests(sp),
      searchAllergyIntolerances(sp),
      searchDocumentReferences(sp),
    ]) {
      const u = new URL(req.url);
      expect(u.searchParams.get('patient')).toBe(PID);
      expect(u.searchParams.get('_count')).toBe(String(DEFAULT_COUNT));
    }
  });

  it('hits the right resource path for each search', () => {
    expect(new URL(searchConditions(sp).url).pathname).toMatch(/\/Condition$/);
    expect(new URL(searchMedicationRequests(sp).url).pathname).toMatch(/\/MedicationRequest$/);
    expect(new URL(searchAllergyIntolerances(sp).url).pathname).toMatch(/\/AllergyIntolerance$/);
    expect(new URL(searchDocumentReferences(sp).url).pathname).toMatch(/\/DocumentReference$/);
  });

  it('observation search defaults to laboratory + vital-signs categories', () => {
    const u = new URL(searchObservations(sp).url);
    expect(u.pathname).toMatch(/\/Observation$/);
    expect(u.searchParams.get('category')).toBe('laboratory,vital-signs');
  });

  it('observation category is overridable', () => {
    const u = new URL(searchObservations({ ...sp, category: 'laboratory' }).url);
    expect(u.searchParams.get('category')).toBe('laboratory');
  });

  it('a custom _count is honored', () => {
    expect(new URL(searchConditions({ ...sp, count: 10 }).url).searchParams.get('_count')).toBe('10');
  });

  it('a pageUrl cursor is used verbatim (pagination), ignoring other params', () => {
    const next = `${BASE}/Condition?patient=${PID}&_count=50&_getpages=abc&_getpagesoffset=50`;
    const r = searchConditions({ ...sp, pageUrl: next, count: 999 });
    expect(r.url).toBe(next);
    expect(r.headers.Authorization).toBe(`Bearer ${TOKEN}`);
  });
});

describe('Bundle helpers', () => {
  const bundle = {
    resourceType: 'Bundle',
    type: 'searchset',
    entry: [
      { resource: { resourceType: 'Condition', id: 'c1' } },
      { resource: { resourceType: 'Condition', id: 'c2' } },
      { fullUrl: 'no-resource-here' }, // dropped
    ],
    link: [
      { relation: 'self', url: `${BASE}/Condition?patient=${PID}` },
      { relation: 'next', url: `${BASE}/Condition?_getpages=abc` },
    ],
  };

  it('bundleEntries returns only entries with a resource', () => {
    const rs = bundleEntries(bundle);
    expect(rs.map((r) => r.id)).toEqual(['c1', 'c2']);
  });
  it('bundleEntries returns [] for a non-Bundle', () => {
    expect(bundleEntries({ resourceType: 'Condition' })).toEqual([]);
    expect(bundleEntries(null)).toEqual([]);
  });
  it('nextPageUrl returns the next link, or empty on the last page', () => {
    expect(nextPageUrl(bundle)).toBe(`${BASE}/Condition?_getpages=abc`);
    expect(nextPageUrl({ resourceType: 'Bundle', link: [{ relation: 'self', url: 'x' }] })).toBe('');
    expect(nextPageUrl({ resourceType: 'Bundle' })).toBe('');
  });
});

describe('OperationOutcome handling', () => {
  const oo = {
    resourceType: 'OperationOutcome',
    issue: [{ severity: 'error', code: 'forbidden', diagnostics: 'not authorized for this patient' }],
  };
  it('detects an OperationOutcome and renders its message', () => {
    expect(isOperationOutcome(oo)).toBe(true);
    expect(isOperationOutcome({ resourceType: 'Bundle' })).toBe(false);
    expect(operationOutcomeMessage(oo)).toBe('not authorized for this patient');
  });
});

describe('fhirFetch', () => {
  it('returns the parsed Bundle on success', async () => {
    const doFetch = vi.fn().mockResolvedValue(res(200, { resourceType: 'Bundle', entry: [] }));
    const out = (await fhirFetch(getPatient(BASE, TOKEN, PID) as FhirRequest, doFetch)) as {
      resourceType: string;
    };
    expect(out.resourceType).toBe('Bundle');
    expect(doFetch).toHaveBeenCalledWith(`${BASE}/Patient/Patient-123`, {
      method: 'GET',
      headers: { Authorization: `Bearer ${TOKEN}`, Accept: 'application/fhir+json' },
    });
  });

  it('throws the OperationOutcome diagnostics (not the raw body)', async () => {
    const doFetch = vi.fn().mockResolvedValue(
      res(403, { resourceType: 'OperationOutcome', issue: [{ diagnostics: 'access denied' }] }),
    );
    await expect(fhirFetch(getPatient(BASE, TOKEN, PID), doFetch)).rejects.toThrow(/access denied/);
  });

  it('throws on a non-2xx without echoing a PHI body', async () => {
    const doFetch = vi.fn().mockResolvedValue(res(500, { resourceType: 'Bundle' }));
    await expect(fhirFetch(getPatient(BASE, TOKEN, PID), doFetch)).rejects.toThrow(/FHIR 500/);
  });

  it('throws a length-only hint on non-JSON', async () => {
    const doFetch = vi.fn().mockResolvedValue(new Response('<html>PHI leak</html>', { status: 502 }));
    const err = await fhirFetch(getPatient(BASE, TOKEN, PID), doFetch).then(
      () => new Error('expected a throw'),
      (e: unknown) => e as Error,
    );
    expect(err.message).toMatch(/non-JSON/);
    expect(err.message).not.toContain('PHI leak');
  });
});

describe('fetchAllPages', () => {
  it('walks Bundle next links and flattens resources', async () => {
    const page1 = {
      resourceType: 'Bundle',
      entry: [{ resource: { resourceType: 'Condition', id: 'c1' } }],
      link: [{ relation: 'next', url: `${BASE}/Condition?page=2` }],
    };
    const page2 = {
      resourceType: 'Bundle',
      entry: [{ resource: { resourceType: 'Condition', id: 'c2' } }],
      link: [{ relation: 'self', url: `${BASE}/Condition?page=2` }],
    };
    const doFetch = vi
      .fn()
      .mockResolvedValueOnce(res(200, page1))
      .mockResolvedValueOnce(res(200, page2));
    const first = searchConditions({ base: BASE, token: TOKEN, patientId: PID });
    const all = await fetchAllPages(first, TOKEN, { doFetch });
    expect(all.map((r) => r.id)).toEqual(['c1', 'c2']);
    expect(doFetch).toHaveBeenCalledTimes(2);
    // The second call used the exact `next` URL, with the bearer re-attached.
    expect(doFetch.mock.calls[1][0]).toBe(`${BASE}/Condition?page=2`);
    expect(doFetch.mock.calls[1][1].headers.Authorization).toBe(`Bearer ${TOKEN}`);
  });

  it('stops at maxPages against an infinite pager', async () => {
    const loop = {
      resourceType: 'Bundle',
      entry: [{ resource: { resourceType: 'Condition', id: 'c' } }],
      link: [{ relation: 'next', url: `${BASE}/Condition?loop` }],
    };
    // A fresh Response per call — a Response body is single-use, so the same
    // object cannot be returned twice (fhirFetch consumes it with .text()).
    const doFetch = vi.fn().mockImplementation(async () => res(200, loop));
    const first = searchConditions({ base: BASE, token: TOKEN, patientId: PID });
    const all = await fetchAllPages(first, TOKEN, { doFetch, maxPages: 3 });
    expect(doFetch).toHaveBeenCalledTimes(3);
    expect(all).toHaveLength(3);
  });

  it('returns a single page when there is no next link', async () => {
    const only = {
      resourceType: 'Bundle',
      entry: [{ resource: { resourceType: 'Condition', id: 'x' } }],
      link: [{ relation: 'self', url: 'self' }],
    };
    const doFetch = vi.fn().mockResolvedValue(res(200, only));
    const all = await fetchAllPages(searchConditions({ base: BASE, token: TOKEN, patientId: PID }), TOKEN, {
      doFetch,
    });
    expect(all).toHaveLength(1);
    expect(doFetch).toHaveBeenCalledTimes(1);
  });
});
