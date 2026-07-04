import { describe, it, expect } from 'vitest';
import {
  codeableText,
  effectiveDate,
  summarizePatient,
  conditionRow,
  medicationRow,
  allergyRow,
  observationRow,
  observationValue,
  documentRow,
  renderSection,
  assembleChartContext,
  truncate,
  chartIsEmpty,
  emptyChart,
  MAX_ROWS_PER_SECTION,
  type Chart,
} from '../src/chart.js';
import type { FhirResource } from '../src/fhir-client.js';

// ── Realistic R4 fixtures ──────────────────────────────────────────────────

const patient: FhirResource = {
  resourceType: 'Patient',
  id: 'p1',
  name: [{ use: 'official', given: ['Jane', 'Q'], family: 'Doe' }],
  gender: 'female',
  birthDate: '1958-03-11',
};

const hypertension: FhirResource = {
  resourceType: 'Condition',
  id: 'c1',
  clinicalStatus: { coding: [{ code: 'active', display: 'Active' }] },
  code: { text: 'Essential hypertension', coding: [{ system: 'http://snomed.info/sct', code: '59621000' }] },
  onsetDateTime: '2015-06-01',
};

const diabetes: FhirResource = {
  resourceType: 'Condition',
  id: 'c2',
  clinicalStatus: { coding: [{ code: 'active' }] },
  code: { coding: [{ display: 'Type 2 diabetes mellitus' }] },
};

const lisinopril: FhirResource = {
  resourceType: 'MedicationRequest',
  id: 'm1',
  status: 'active',
  medicationCodeableConcept: { text: 'Lisinopril 10 mg oral tablet' },
  dosageInstruction: [{ text: 'Take 1 tablet by mouth once daily' }],
};

const metforminByRef: FhirResource = {
  resourceType: 'MedicationRequest',
  id: 'm2',
  status: 'active',
  medicationReference: { display: 'Metformin 500 mg' },
};

const penicillinAllergy: FhirResource = {
  resourceType: 'AllergyIntolerance',
  id: 'a1',
  clinicalStatus: { coding: [{ code: 'active' }] },
  criticality: 'high',
  code: { text: 'Penicillin' },
  reaction: [{ manifestation: [{ text: 'Anaphylaxis' }] }],
};

const a1c: FhirResource = {
  resourceType: 'Observation',
  id: 'o1',
  code: { text: 'Hemoglobin A1c' },
  valueQuantity: { value: 8.2, unit: '%' },
  effectiveDateTime: '2026-05-20',
};

const bp: FhirResource = {
  resourceType: 'Observation',
  id: 'o2',
  code: { text: 'Systolic blood pressure' },
  valueQuantity: { value: 148, unit: 'mmHg' },
  effectivePeriod: { start: '2026-06-01' },
};

const progressNote: FhirResource = {
  resourceType: 'DocumentReference',
  id: 'd1',
  type: { text: 'Progress note' },
  date: '2026-06-15',
};

describe('CodeableConcept decoding', () => {
  it('prefers text, then coding.display, then coding.code', () => {
    expect(codeableText({ text: 'Foo' })).toBe('Foo');
    expect(codeableText({ coding: [{ display: 'Bar' }] })).toBe('Bar');
    expect(codeableText({ coding: [{ code: 'baz' }] })).toBe('baz');
    expect(codeableText({})).toBe('');
    expect(codeableText(undefined)).toBe('');
  });
});

describe('effectiveDate polymorphism', () => {
  it('reads effectiveDateTime, effectivePeriod.start, onset, authoredOn', () => {
    expect(effectiveDate({ resourceType: 'X', effectiveDateTime: '2026-01-01' })).toBe('2026-01-01');
    expect(effectiveDate({ resourceType: 'X', effectivePeriod: { start: '2026-02-02' } })).toBe('2026-02-02');
    expect(effectiveDate({ resourceType: 'X', onsetDateTime: '2026-03-03' })).toBe('2026-03-03');
    expect(effectiveDate({ resourceType: 'X', authoredOn: '2026-04-04' })).toBe('2026-04-04');
    expect(effectiveDate({ resourceType: 'X' })).toBe('');
  });
});

describe('patient demographics', () => {
  it('renders name, sex, DOB from a HumanName', () => {
    expect(summarizePatient(patient)).toEqual(['Name: Jane Q Doe', 'Sex: female', 'DOB: 1958-03-11']);
  });
  it('prefers name.text when present', () => {
    expect(summarizePatient({ resourceType: 'Patient', name: [{ text: 'John Smith' }] })).toEqual([
      'Name: John Smith',
    ]);
  });
  it('is empty for no patient', () => {
    expect(summarizePatient(undefined)).toEqual([]);
  });
});

describe('per-resource rows', () => {
  it('conditionRow — name, status, onset', () => {
    expect(conditionRow(hypertension)).toBe('Essential hypertension (Active) onset 2015-06-01');
    expect(conditionRow(diabetes)).toBe('Type 2 diabetes mellitus (active)');
  });

  it('medicationRow — from codeableConcept with dosage, and from a reference', () => {
    expect(medicationRow(lisinopril)).toBe(
      'Lisinopril 10 mg oral tablet — Take 1 tablet by mouth once daily (active)',
    );
    expect(medicationRow(metforminByRef)).toBe('Metformin 500 mg (active)');
  });

  it('allergyRow — substance, manifestation, criticality, status', () => {
    expect(allergyRow(penicillinAllergy)).toBe('Penicillin → Anaphylaxis [high] (active)');
  });

  it('observationRow / observationValue — quantity with unit + date', () => {
    expect(observationValue(a1c)).toBe('8.2 %');
    expect(observationRow(a1c)).toBe('Hemoglobin A1c = 8.2 % (2026-05-20)');
    expect(observationRow(bp)).toBe('Systolic blood pressure = 148 mmHg (2026-06-01)');
  });

  it('observationValue — codeable and string variants', () => {
    expect(observationValue({ resourceType: 'Observation', valueCodeableConcept: { text: 'Positive' } })).toBe(
      'Positive',
    );
    expect(observationValue({ resourceType: 'Observation', valueString: 'see report' })).toBe('see report');
    expect(observationValue({ resourceType: 'Observation' })).toBe('');
  });

  it('documentRow — type and date, no bytes inlined', () => {
    expect(documentRow(progressNote)).toBe('Progress note (2026-06-15)');
  });
});

describe('renderSection', () => {
  it('renders a heading + bulleted rows', () => {
    const out = renderSection({ heading: 'Problems', resources: [hypertension, diabetes], row: conditionRow });
    expect(out).toContain('## Problems');
    expect(out).toContain('- Essential hypertension (Active) onset 2015-06-01');
    expect(out).toContain('- Type 2 diabetes mellitus (active)');
  });

  it('marks an empty section explicitly (absence is meaningful)', () => {
    expect(renderSection({ heading: 'Allergies', resources: [], row: allergyRow })).toBe(
      '## Allergies\n(none recorded)',
    );
  });

  it('caps rows and shows a visible "N more" marker', () => {
    const many = Array.from({ length: MAX_ROWS_PER_SECTION + 5 }, (_, i) => ({
      ...diabetes,
      code: { text: `Condition ${i}` },
    }));
    const out = renderSection({ heading: 'Problems', resources: many, row: conditionRow });
    expect(out).toContain('- …and 5 more not shown');
    // exactly MAX_ROWS_PER_SECTION data rows + heading + the "more" line
    expect(out.split('\n').filter((l) => l.startsWith('- ')).length).toBe(MAX_ROWS_PER_SECTION + 1);
  });
});

describe('assembleChartContext', () => {
  const chart: Chart = {
    patient,
    conditions: [hypertension, diabetes],
    medications: [lisinopril, metforminByRef],
    allergies: [penicillinAllergy],
    observations: [a1c, bp],
    documents: [progressNote],
  };

  it('assembles demographics + all five sections in clinical priority order', () => {
    const ctx = assembleChartContext(chart);
    expect(ctx.indexOf('# Patient')).toBeLessThan(ctx.indexOf('## Problems'));
    expect(ctx.indexOf('## Problems')).toBeLessThan(ctx.indexOf('## Medications'));
    expect(ctx.indexOf('## Medications')).toBeLessThan(ctx.indexOf('## Allergies'));
    expect(ctx.indexOf('## Allergies')).toBeLessThan(ctx.indexOf('## Recent labs & vitals'));
    expect(ctx.indexOf('## Recent labs & vitals')).toBeLessThan(ctx.indexOf('## Clinical notes'));
    expect(ctx).toContain('Jane Q Doe');
    expect(ctx).toContain('Penicillin → Anaphylaxis [high]');
    expect(ctx).toContain('Hemoglobin A1c = 8.2 %');
  });

  it('renders a usable chart even with no demographics', () => {
    const ctx = assembleChartContext({ ...emptyChart(), conditions: [hypertension] });
    expect(ctx).toContain('(no demographics available)');
    expect(ctx).toContain('Essential hypertension');
  });

  it('caps the whole context and marks truncation visibly', () => {
    const bigDoc: FhirResource = {
      resourceType: 'DocumentReference',
      type: { text: 'x'.repeat(2000) },
      date: '2026-01-01',
    };
    const chartBig: Chart = { ...emptyChart(), documents: Array.from({ length: 50 }, () => bigDoc) };
    const ctx = assembleChartContext(chartBig, 500);
    expect(ctx.length).toBeLessThanOrEqual(500 + 60);
    expect(ctx).toMatch(/chart truncated: \d+ chars omitted/);
  });
});

describe('truncate + chartIsEmpty', () => {
  it('truncate marks elision and passes short text through', () => {
    expect(truncate('short', 100)).toBe('short');
    expect(truncate('abcdef', 3)).toMatch(/^abc\n…\[chart truncated: 3 chars omitted\]$/);
  });
  it('chartIsEmpty is true only when all clinical lists are empty', () => {
    expect(chartIsEmpty(emptyChart())).toBe(true);
    expect(chartIsEmpty({ ...emptyChart(), patient })).toBe(true); // patient alone still empty
    expect(chartIsEmpty({ ...emptyChart(), conditions: [hypertension] })).toBe(false);
  });
});
