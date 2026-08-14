import { describe, it, expect } from 'vitest';
import {
  HANZO_API_BASE_URL,
  DEFAULT_MODEL,
  pickBearer,
  SMART_SCOPES,
  scopeString,
  smartConfigUrl,
  normalizeBase,
  FHIR_RESOURCES,
} from '../src/config.js';

describe('config: Hanzo gateway', () => {
  it('points at api.hanzo.ai with no /api/ prefix', () => {
    expect(HANZO_API_BASE_URL).toBe('https://api.hanzo.ai');
    expect(HANZO_API_BASE_URL).not.toContain('/api/');
  });

  it('default model is a zen model', () => {
    expect(DEFAULT_MODEL).toMatch(/^zen/);
  });
});

describe('config: pickBearer', () => {
  it('prefers the pasted key over the IAM token', () => {
    expect(pickBearer('sk-key', 'iam-token')).toBe('sk-key');
  });
  it('falls back to the IAM token when no key', () => {
    expect(pickBearer('', 'iam-token')).toBe('iam-token');
    expect(pickBearer('   ', 'iam-token')).toBe('iam-token');
  });
  it('is empty (anonymous) when neither is present', () => {
    expect(pickBearer('', '')).toBe('');
  });
});

describe('config: SMART scopes', () => {
  it('requests launch + patient read scopes and NO write scope', () => {
    const s = scopeString();
    expect(s).toContain('launch');
    expect(s).toContain('openid');
    expect(s).toContain('fhirUser');
    expect(s).toContain('patient/Patient.read');
    expect(s).toContain('patient/Condition.read');
    expect(s).toContain('patient/MedicationRequest.read');
    expect(s).toContain('patient/Observation.read');
    expect(s).toContain('patient/AllergyIntolerance.read');
    expect(s).toContain('patient/DocumentReference.read');
    // Read + assist only — a write scope must never be requested in v1.
    expect(s).not.toMatch(/\.write/);
    expect(s).not.toMatch(/\*\/\*/);
  });

  it('scopeString is space-delimited and deterministic', () => {
    expect(scopeString(['a', 'b', 'c'])).toBe('a b c');
    expect(scopeString()).toBe(SMART_SCOPES.join(' '));
  });
});

describe('config: discovery URL', () => {
  it('derives the well-known discovery URL from iss', () => {
    expect(smartConfigUrl('https://fhir.example.org/r4')).toBe(
      'https://fhir.example.org/r4/.well-known/smart-configuration',
    );
  });
  it('normalizes a trailing slash on iss', () => {
    expect(smartConfigUrl('https://fhir.example.org/r4/')).toBe(
      'https://fhir.example.org/r4/.well-known/smart-configuration',
    );
    expect(normalizeBase('https://x/')).toBe('https://x');
    expect(normalizeBase('https://x///')).toBe('https://x');
  });
});

describe('config: FHIR resource names', () => {
  it('names the six read resources', () => {
    expect(Object.keys(FHIR_RESOURCES).sort()).toEqual([
      'AllergyIntolerance',
      'Condition',
      'DocumentReference',
      'MedicationRequest',
      'Observation',
      'Patient',
    ]);
  });
});
