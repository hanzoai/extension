// Epic / SMART-on-FHIR config — the two backends this app talks to and nothing
// else. Hanzo (the model gateway, api.hanzo.ai/v1, via @hanzo/ai) and the FHIR
// server (Epic or any SMART-on-FHIR EHR), whose OAuth + REST endpoints are
// DISCOVERED at runtime from the launch `iss` — never hard-coded, because a
// SMART app must run against whatever FHIR server launched it (an Epic org, the
// fhir.epic.com sandbox, or a non-Epic EHR).
//
// Rule: no `/api/` prefix on Hanzo (it IS api.hanzo.ai); the FHIR base comes
// from `iss`, appended with `/Patient`, `/Condition`, etc. Secrets never live
// here — the SMART app's client_secret (confidential apps) is read from the
// environment by server.ts, never bundled and never sent to the browser.

// ── Hanzo model gateway ───────────────────────────────────────────────────

// Where the Hanzo model gateway lives. `@hanzo/ai` defaults here too. /v1 only,
// never an /api/ prefix (api.hanzo.ai IS the api host).
export const HANZO_API_BASE_URL = 'https://api.hanzo.ai';

// Default model. A Zen model (qwen3+). Overridable per-request via the picker;
// the gateway routes it.
export const DEFAULT_MODEL = 'zen5';

// localStorage key for the pasted Hanzo API key (`sk-…`) in the web panel. The
// SMART app launches as a static web page (iframe/browser), not an EHR host with
// server-side storage, so the zero-setup Hanzo credential lives in localStorage —
// same as @hanzo/pdf and @hanzo/docusign. NOTE: this is the HANZO gateway key,
// NOT the FHIR/PHI token — the FHIR token stays server-side (see server.ts).
export const APIKEY_STORAGE_KEY = 'hanzo.epic.apiKey';

// pickBearer chooses the credential to send to the Hanzo gateway: a pasted API
// key wins over an IAM token (an explicit key is a deliberate override), else
// the token, else empty (anonymous — the gateway still serves public models).
// Pure — unit-tested.
export function pickBearer(apiKey: string, iamToken: string): string {
  return (apiKey && apiKey.trim()) || (iamToken && iamToken.trim()) || '';
}

// ── SMART on FHIR ──────────────────────────────────────────────────────────
//
// SMART scopes this app requests. It is READ + ASSIST ONLY in v1 — there is NO
// `*.write` scope, so a bug can never mutate a patient's chart. `launch` is for
// the EHR-launch flow (Epic passes a `launch` token that carries the patient
// context); `launch/patient` is the standalone-launch equivalent that asks the
// user to pick a patient. `openid`+`fhirUser` identify the launching clinician;
// `patient/<Resource>.read` grants read of the launched patient's chart only.
//
// Kept as an ordered array so the scope string is deterministic (stable tests,
// stable authorize URLs). `offline_access` requests a refresh_token so a long
// review session survives the access token's ~1h lifetime.
export const SMART_SCOPES = [
  'launch',
  'launch/patient',
  'openid',
  'fhirUser',
  'offline_access',
  'patient/Patient.read',
  'patient/Condition.read',
  'patient/MedicationRequest.read',
  'patient/Observation.read',
  'patient/AllergyIntolerance.read',
  'patient/DocumentReference.read',
] as const;

// scopeString renders the requested scopes into the space-delimited form the
// SMART authorize endpoint expects. Pure.
export function scopeString(scopes: readonly string[] = SMART_SCOPES): string {
  return scopes.join(' ');
}

// The SMART discovery document path. A conformant SMART-on-FHIR server publishes
// its authorize/token endpoints (and capabilities) at
// `<iss>/.well-known/smart-configuration`. We NEVER guess these; we read them.
export const SMART_CONFIG_PATH = '.well-known/smart-configuration';

// smartConfigUrl derives the discovery URL from the FHIR base (`iss`). Trailing
// slashes on `iss` are normalized so the join is exact. Pure.
export function smartConfigUrl(iss: string): string {
  return `${normalizeBase(iss)}/${SMART_CONFIG_PATH}`;
}

// normalizeBase strips trailing slashes from a base/iss so callers append
// `/<Resource>` or `/.well-known/...` without doubling the separator. Pure.
export function normalizeBase(base: string): string {
  return base.replace(/\/+$/, '');
}

// The Epic App Orchard / sandbox FHIR bases, for documentation + a default in
// standalone launch. In an EHR launch the real `iss` arrives in the URL and
// overrides any default — this table is only a convenience for standalone
// testing against Epic's public sandbox.
export const EPIC_SANDBOX_FHIR_BASE =
  'https://fhir.epic.com/interconnect-fhir-oauth/api/FHIR/R4';

// FHIR resource path segments this app reads. Named so the FHIR client and the
// tests reference ONE set of names (no drift between the request builder and the
// scope list above).
export const FHIR_RESOURCES = {
  Patient: 'Patient',
  Condition: 'Condition',
  MedicationRequest: 'MedicationRequest',
  Observation: 'Observation',
  AllergyIntolerance: 'AllergyIntolerance',
  DocumentReference: 'DocumentReference',
} as const;

export type FhirResourceType = keyof typeof FHIR_RESOURCES;
