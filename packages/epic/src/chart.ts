// Turning raw FHIR R4 resources into the clinical-context TEXT handed to Hanzo —
// PURE and fully unit-tested (no network, no DOM, no @hanzo/ai). This is the
// clinical-reasoning core: it reads the messy, deeply-nested FHIR shapes
// (CodeableConcepts, references, effective[x] polymorphism) and renders a
// compact, honest, human-readable chart that a model can reason over and a
// clinician can eyeball.
//
// Two responsibilities, kept separate:
//   1. per-resource extraction — one small pure function per resource type that
//      pulls the clinically-relevant fields into a flat, display-ready row.
//   2. assembly + windowing — compose the sections into a single string capped
//      at a character budget, truncating VISIBLY (never silently) and section by
//      section so the most important sections (problems, meds, allergies)
//      survive when a chart is huge.
//
// The model's context window is finite and a real chart can be enormous, so we
// window honestly: cap each section's row count and the whole assembled text,
// and mark every truncation so the model — and the reviewing clinician — know
// what was elided.

import type { FhirResource } from './fhir-client.js';

// ── FHIR primitive extractors (pure) ───────────────────────────────────────

// codeableText renders a FHIR CodeableConcept to a display string: prefer its
// `text`, else the first coding's `display`, else the first coding's `code`.
// This is the single place the CodeableConcept shape is decoded, so every
// section reads a code the same way. Pure.
export function codeableText(concept: unknown): string {
  const c = concept as {
    text?: unknown;
    coding?: Array<{ display?: unknown; code?: unknown }>;
  };
  if (typeof c?.text === 'string' && c.text.trim()) return c.text.trim();
  const coding = Array.isArray(c?.coding) ? c.coding[0] : undefined;
  if (typeof coding?.display === 'string' && coding.display.trim()) return coding.display.trim();
  if (typeof coding?.code === 'string' && coding.code.trim()) return coding.code.trim();
  return '';
}

// effectiveDate pulls the clinically-relevant date off a resource's polymorphic
// effective[x]/onset[x]/authoredOn/recordedDate, tolerating the several field
// names FHIR uses across resource types. Returns '' when none is present. Pure.
export function effectiveDate(res: FhirResource): string {
  const r = res as Record<string, unknown>;
  const period = r.effectivePeriod as { start?: unknown } | undefined;
  const candidates = [
    r.effectiveDateTime,
    period?.start,
    r.onsetDateTime,
    r.authoredOn,
    r.recordedDate,
    r.issued,
  ];
  for (const v of candidates) {
    if (typeof v === 'string' && v.trim()) return v.trim();
  }
  return '';
}

// ── Per-resource rows (pure) ───────────────────────────────────────────────

// summarizePatient renders a Patient into the demographic header lines. Reads
// the R4 name/gender/birthDate. Uses the FIRST official/usual name. Pure.
export function summarizePatient(patient: FhirResource | undefined): string[] {
  if (!patient) return [];
  const p = patient as {
    name?: Array<{ text?: string; given?: string[]; family?: string; use?: string }>;
    gender?: string;
    birthDate?: string;
  };
  const lines: string[] = [];
  const name = pickName(p.name);
  if (name) lines.push(`Name: ${name}`);
  if (typeof p.gender === 'string' && p.gender) lines.push(`Sex: ${p.gender}`);
  if (typeof p.birthDate === 'string' && p.birthDate) lines.push(`DOB: ${p.birthDate}`);
  return lines;
}

// pickName renders a HumanName[]: prefer a `text`, else "Given Family" from the
// first name that has parts. Pure.
function pickName(names: Array<{ text?: string; given?: string[]; family?: string }> | undefined): string {
  if (!Array.isArray(names)) return '';
  for (const n of names) {
    if (typeof n.text === 'string' && n.text.trim()) return n.text.trim();
    const given = Array.isArray(n.given) ? n.given.join(' ') : '';
    const full = `${given} ${n.family ?? ''}`.trim();
    if (full) return full;
  }
  return '';
}

// conditionRow renders a Condition (problem) to one line: its name, clinical
// status, and onset date. Pure.
export function conditionRow(res: FhirResource): string {
  const r = res as { clinicalStatus?: unknown };
  const name = codeableText((res as { code?: unknown }).code) || 'Unnamed condition';
  const status = codeableText(r.clinicalStatus);
  const onset = effectiveDate(res);
  return joinRow([name, status && `(${status})`, onset && `onset ${onset}`]);
}

// medicationRow renders a MedicationRequest to one line: the drug (from
// medicationCodeableConcept, or the display of a contained/referenced
// Medication), status, and dosage text when present. Pure.
export function medicationRow(res: FhirResource): string {
  const r = res as {
    medicationCodeableConcept?: unknown;
    medicationReference?: { display?: string };
    status?: string;
    dosageInstruction?: Array<{ text?: string }>;
  };
  const drug =
    codeableText(r.medicationCodeableConcept) ||
    (typeof r.medicationReference?.display === 'string' ? r.medicationReference.display : '') ||
    'Unnamed medication';
  const status = typeof r.status === 'string' ? r.status : '';
  const dosage = Array.isArray(r.dosageInstruction)
    ? (r.dosageInstruction.find((d) => typeof d.text === 'string' && d.text)?.text ?? '')
    : '';
  return joinRow([drug, dosage && `— ${dosage}`, status && `(${status})`]);
}

// allergyRow renders an AllergyIntolerance to one line: the substance, clinical
// status, criticality, and the first reaction's manifestation when present.
// Pure.
export function allergyRow(res: FhirResource): string {
  const r = res as {
    clinicalStatus?: unknown;
    criticality?: string;
    reaction?: Array<{ manifestation?: unknown[] }>;
  };
  const substance = codeableText((res as { code?: unknown }).code) || 'Unknown allergen';
  const status = codeableText(r.clinicalStatus);
  const criticality = typeof r.criticality === 'string' ? r.criticality : '';
  const manifestation =
    Array.isArray(r.reaction) && Array.isArray(r.reaction[0]?.manifestation)
      ? codeableText(r.reaction[0]!.manifestation![0])
      : '';
  return joinRow([
    substance,
    manifestation && `→ ${manifestation}`,
    criticality && `[${criticality}]`,
    status && `(${status})`,
  ]);
}

// observationRow renders an Observation (lab/vital) to one line: the test name,
// the value (valueQuantity with unit, or valueCodeableConcept / valueString),
// and the date. Pure.
export function observationRow(res: FhirResource): string {
  const name = codeableText((res as { code?: unknown }).code) || 'Observation';
  const value = observationValue(res);
  const date = effectiveDate(res);
  return joinRow([name, value && `= ${value}`, date && `(${date})`]);
}

// observationValue decodes an Observation's polymorphic value[x]: a
// valueQuantity ("7.2 mg/dL"), a valueCodeableConcept, or a valueString. Pure.
export function observationValue(res: FhirResource): string {
  const r = res as {
    valueQuantity?: { value?: unknown; unit?: unknown };
    valueCodeableConcept?: unknown;
    valueString?: unknown;
  };
  if (r.valueQuantity && r.valueQuantity.value !== undefined) {
    const v = r.valueQuantity.value;
    const unit = typeof r.valueQuantity.unit === 'string' ? r.valueQuantity.unit : '';
    return unit ? `${v} ${unit}` : String(v);
  }
  const coded = codeableText(r.valueCodeableConcept);
  if (coded) return coded;
  if (typeof r.valueString === 'string' && r.valueString.trim()) return r.valueString.trim();
  return '';
}

// documentRow renders a DocumentReference to one line: its type/description and
// date. The note BYTES are not inlined here (they may be large binaries or
// attachments requiring a separate fetch); the model gets the note's existence,
// type, and date so it can reference it honestly. Pure.
export function documentRow(res: FhirResource): string {
  const r = res as { type?: unknown; description?: string; date?: string };
  const type = codeableText(r.type) || (typeof r.description === 'string' ? r.description : '') || 'Clinical note';
  const date = typeof r.date === 'string' ? r.date : effectiveDate(res);
  return joinRow([type, date && `(${date})`]);
}

// joinRow joins the non-empty cells of a row with single spaces. Pure — the
// per-resource rows all funnel through it so falsy cells never leave gaps.
function joinRow(cells: Array<string | false | undefined>): string {
  return cells.filter((c): c is string => typeof c === 'string' && c.length > 0).join(' ');
}

// ── The assembled chart ────────────────────────────────────────────────────

// A patient's chart as this app consumes it — the Patient plus the four/five
// resource lists pulled via the FHIR client. Any list may be empty.
export interface Chart {
  patient?: FhirResource;
  conditions: FhirResource[];
  medications: FhirResource[];
  allergies: FhirResource[];
  observations: FhirResource[];
  documents: FhirResource[];
}

// emptyChart — a zero-value Chart, so callers can build incrementally. Pure.
export function emptyChart(): Chart {
  return { conditions: [], medications: [], allergies: [], observations: [], documents: [] };
}

// Windowing budgets. Per-section row caps keep any one section (e.g. hundreds of
// lab results) from crowding out the problem list; the total char cap fits the
// assembled chart into a model window alongside the response. Chosen honest, not
// optimal — we truncate VISIBLY.
export const MAX_ROWS_PER_SECTION = 40;
export const MAX_CONTEXT_CHARS = 48_000;

// A section: a heading, the resources, and the row renderer. Ordered most- to
// least- clinically-critical so truncation drops the least important first.
interface Section {
  heading: string;
  resources: FhirResource[];
  row: (r: FhirResource) => string;
}

// renderSection renders one section's heading + capped rows. When the section has
// more resources than the cap, it appends a visible "…N more" line so the model
// knows the list was truncated. Empty sections render a single "none recorded"
// line so their ABSENCE is explicit (a blank problem list is clinically
// meaningful — don't let the model assume data was withheld). Pure.
export function renderSection(s: Section, maxRows = MAX_ROWS_PER_SECTION): string {
  const lines: string[] = [`## ${s.heading}`];
  if (s.resources.length === 0) {
    lines.push('(none recorded)');
    return lines.join('\n');
  }
  const shown = s.resources.slice(0, maxRows);
  for (const r of shown) {
    const row = s.row(r);
    if (row) lines.push(`- ${row}`);
  }
  const extra = s.resources.length - shown.length;
  if (extra > 0) lines.push(`- …and ${extra} more not shown`);
  return lines.join('\n');
}

// assembleChartContext renders a Chart into the single clinical-context string
// handed to Hanzo. Demographics first, then the sections in clinical priority
// order; the whole thing is capped at `maxChars` with a VISIBLE truncation
// marker. Pure and deterministic — the exact text a test asserts is the exact
// text sent to the model. Contains PHI: it is assembled in memory and sent ONLY
// to api.hanzo.ai (never logged).
export function assembleChartContext(chart: Chart, maxChars = MAX_CONTEXT_CHARS): string {
  const blocks: string[] = [];

  const demo = summarizePatient(chart.patient);
  blocks.push(['# Patient', ...(demo.length ? demo : ['(no demographics available)'])].join('\n'));

  const sections: Section[] = [
    { heading: 'Problems', resources: chart.conditions, row: conditionRow },
    { heading: 'Medications', resources: chart.medications, row: medicationRow },
    { heading: 'Allergies', resources: chart.allergies, row: allergyRow },
    { heading: 'Recent labs & vitals', resources: chart.observations, row: observationRow },
    { heading: 'Clinical notes', resources: chart.documents, row: documentRow },
  ];
  for (const s of sections) blocks.push(renderSection(s));

  return truncate(blocks.join('\n\n'), maxChars);
}

// truncate cuts text to a max length, appending a visible marker so the model
// (and a reviewing clinician) know content was elided. Pure.
export function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  return text.slice(0, max) + `\n…[chart truncated: ${text.length - max} chars omitted]`;
}

// chartIsEmpty reports whether a chart has NOTHING beyond possibly a Patient —
// so the UI can say "no clinical data for this patient" instead of asking the
// model to summarize a blank chart. Pure.
export function chartIsEmpty(chart: Chart): boolean {
  return (
    chart.conditions.length === 0 &&
    chart.medications.length === 0 &&
    chart.allergies.length === 0 &&
    chart.observations.length === 0 &&
    chart.documents.length === 0
  );
}
