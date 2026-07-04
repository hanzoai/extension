// The SMART app panel glue: the browser page that launches from Epic with a
// patient in context, loads that patient's chart through the server-side FHIR
// proxy (so no PHI token touches the browser), and drives the four Hanzo AI
// actions over the assembled chart. All the logic-heavy work — SMART/PKCE
// shaping, FHIR request wrappers, chart assembly, action prompts — lives in its
// own tested pure modules; this file is the one impure, browser-only entry point
// that binds them to the DOM.
//
// The launch dance (see README for the full flow):
//   1. EHR launch: Epic opens this page with `iss` + `launch`. Standalone: the
//      page is opened with an `iss` (or the sandbox default) and no `launch`.
//   2. The page mints PKCE + state, asks the server (/oauth/prepare) to discover
//      Epic's authorize/token endpoints, then redirects the browser to authorize.
//   3. Epic redirects back to /oauth/callback?code&state; the page posts them to
//      the server, which exchanges (secret + PKCE server-side) and sets an opaque
//      session cookie. The browser learns only the patient id + granted scope.
//   4. The page loads the chart via /fhir?path=… (proxied), assembles the
//      context, and runs actions against api.hanzo.ai with the pasted Hanzo key.
//
// These build-time constants are stamped by build.js (the client id + redirect
// are PUBLIC; the secret is server-only and never bundled).
declare const SMART_CLIENT_ID: string;
declare const SMART_REDIRECT_URI: string;
declare const SMART_DEFAULT_ISS: string;

import {
  createPkce,
  authorizeUrl,
  parseLaunch,
  parseCallback,
} from './smart-oauth.js';
import {
  getPatient,
  searchConditions,
  searchMedicationRequests,
  searchAllergyIntolerances,
  searchObservations,
  searchDocumentReferences,
  bundleEntries,
  fetchAllPages,
  type FhirResource,
  type FhirRequest,
} from './fhir-client.js';
import { assembleChartContext, chartIsEmpty, emptyChart, type Chart } from './chart.js';
import { ACTIONS, isActionId, runAction, listModels } from './hanzo.js';
import { scopeString } from './config.js';
import { getApiKey, setApiKey, bearer, validateKey } from './auth.js';

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const STATE_KEY = 'hanzo.epic.oauthState';
const VERIFIER_KEY = 'hanzo.epic.pkceVerifier';

// The panel's live SMART context (non-PHI parts) once authenticated.
interface Session {
  patient: string;
  scope: string;
}

let controller: AbortController | null = null;
let session: Session | null = null;
let chartContext = '';

window.addEventListener('DOMContentLoaded', () => void boot());

// boot decides which phase of the launch we are in: a callback (we have a code),
// a launch (we have iss/launch — start authorize), or a cold open (show the
// standalone launcher). Then wires the UI.
async function boot(): Promise<void> {
  wireApiKey();
  wireActions();
  void populateModels();

  const search = window.location.search;
  const cb = parseCallback(search);
  const launch = parseLaunch(search);

  if (cb.error) {
    status(`Launch declined: ${cb.errorDescription || cb.error}`, 'error');
    return;
  }
  if (cb.code) {
    await completeCallback(cb.code, cb.state);
    return;
  }
  if (launch.iss || SMART_DEFAULT_ISS) {
    await beginAuthorize(launch.iss || SMART_DEFAULT_ISS, launch.launch);
    return;
  }
  status('Open this app from Epic, or configure a FHIR server to launch standalone.', 'warn');
}

// beginAuthorize mints PKCE + state, asks the server to discover Epic's
// endpoints, stores the verifier/state, and redirects the browser to authorize.
async function beginAuthorize(iss: string, launchToken: string): Promise<void> {
  status('Connecting to the EHR…');
  const pkce = await createPkce();
  const state = crypto.randomUUID();
  sessionStorage.setItem(STATE_KEY, state);
  sessionStorage.setItem(VERIFIER_KEY, pkce.verifier);

  const prep = await postJson('/oauth/prepare', { iss, state, codeVerifier: pkce.verifier });
  if (!prep.authorizationEndpoint) {
    status('Could not discover the EHR OAuth endpoints.', 'error');
    return;
  }
  window.location.href = authorizeUrl({
    authorizationEndpoint: prep.authorizationEndpoint,
    clientId: SMART_CLIENT_ID,
    redirectUri: SMART_REDIRECT_URI,
    aud: iss,
    scope: scopeString(),
    state,
    codeChallenge: pkce.challenge,
    launch: launchToken || undefined,
  });
}

// completeCallback verifies state, posts code+state to the server (which does
// the secret+PKCE exchange and sets the session cookie), then loads the chart.
async function completeCallback(code: string, returnedState: string): Promise<void> {
  const expected = sessionStorage.getItem(STATE_KEY) || '';
  if (!expected || returnedState !== expected) {
    status('OAuth state mismatch — refusing to continue.', 'error');
    return;
  }
  sessionStorage.removeItem(STATE_KEY);
  sessionStorage.removeItem(VERIFIER_KEY);
  status('Completing sign-in…');
  const out = await postJson('/oauth/callback', { code, state: returnedState });
  if (out.error || !out.patient) {
    status(`Sign-in failed: ${out.error || 'no patient context'}`, 'error');
    return;
  }
  // Clean the code/state out of the URL bar (never leave an auth code in history).
  window.history.replaceState({}, document.title, window.location.pathname);
  session = { patient: out.patient, scope: out.scope || '' };
  await loadChart();
}

// loadChart pulls the launched patient's chart through the proxy and assembles
// the clinical context. Every FHIR read goes through /fhir — the browser never
// holds the FHIR token. Reads run concurrently; each is independent.
async function loadChart(): Promise<void> {
  if (!session) return;
  status('Loading patient chart…');
  const patientId = session.patient;
  // The FHIR base/token live server-side; the request wrappers here shape a
  // RELATIVE path the proxy resolves. token/base are placeholders the proxy
  // replaces, so we pass empty strings and send only the resolved path.
  const rel = (req: FhirRequest) => proxyPath(req.url);
  const chart: Chart = emptyChart();
  try {
    const [patient, conditions, meds, allergies, obs, docs] = await Promise.all([
      proxyGet(rel(getPatient('', '', patientId))),
      proxyGetAll(searchConditions(sp(patientId))),
      proxyGetAll(searchMedicationRequests(sp(patientId))),
      proxyGetAll(searchAllergyIntolerances(sp(patientId))),
      proxyGetAll(searchObservations(sp(patientId))),
      proxyGetAll(searchDocumentReferences(sp(patientId))),
    ]);
    chart.patient = (patient as FhirResource)?.resourceType === 'Patient' ? (patient as FhirResource) : undefined;
    chart.conditions = conditions;
    chart.medications = meds;
    chart.allergies = allergies;
    chart.observations = obs;
    chart.documents = docs;
  } catch (e: unknown) {
    status(`Could not load the chart: ${(e as Error).message}`, 'error');
    return;
  }
  chartContext = assembleChartContext(chart);
  const label = chart.patient
    ? summarizeHeader(chart.patient)
    : `Patient ${patientId}`;
  $('patient-title').textContent = label;
  status(chartIsEmpty(chart) ? 'Chart loaded (no clinical data recorded).' : 'Chart loaded.', 'ok');
  setActionsEnabled(true);
}

// sp builds a patient-scoped SearchParams with empty base/token — the proxy
// supplies both. Only the relative path matters here.
function sp(patientId: string) {
  return { base: '', token: '', patientId };
}

// proxyPath turns a FHIR request URL (which the wrappers built with an empty
// base, so it is like `/Condition?patient=…`) into the proxy query. The wrappers
// prepend the normalized base; with an empty base the URL is just the path.
function proxyPath(fhirUrl: string): string {
  const path = fhirUrl.replace(/^\/+/, '');
  return `/fhir?path=${encodeURIComponent(path)}`;
}

// proxyGet does one proxied FHIR read and returns the parsed resource/Bundle.
async function proxyGet(path: string): Promise<unknown> {
  const resp = await fetch(path, { credentials: 'same-origin' });
  if (!resp.ok) throw new Error(`FHIR proxy ${resp.status}`);
  return resp.json();
}

// proxyGetAll pages a search to completion through the proxy, following the
// Bundle `next` links (rewritten as proxy paths). Returns the flattened
// resources. Uses fetchAllPages' Bundle logic via a proxy-backed fetch.
async function proxyGetAll(first: FhirRequest): Promise<FhirResource[]> {
  const doFetch: typeof fetch = async (input) => {
    const raw = typeof input === 'string' ? input : (input as Request).url;
    // `raw` is either our first relative path or an absolute FHIR `next` URL;
    // both go through the proxy by path.
    return fetch(proxyPath(raw), { credentials: 'same-origin' }) as Promise<Response>;
  };
  return fetchAllPages({ ...first, url: first.url.replace(/^\/+/, '') }, '', { doFetch });
}

// summarizeHeader renders a short patient label for the panel header from a
// Patient resource (name only — the sensitive detail stays in the chart body).
function summarizeHeader(patient: FhirResource): string {
  const p = patient as { name?: Array<{ text?: string; given?: string[]; family?: string }> };
  const n = Array.isArray(p.name) ? p.name[0] : undefined;
  if (n?.text) return n.text;
  const given = Array.isArray(n?.given) ? n!.given!.join(' ') : '';
  return `${given} ${n?.family ?? ''}`.trim() || 'Patient';
}

// ── Actions ────────────────────────────────────────────────────────────────

function wireActions(): void {
  const chipRow = $('chips');
  for (const a of ACTIONS) {
    const b = document.createElement('button');
    b.className = 'chip';
    b.textContent = a.label;
    b.dataset.action = a.id;
    b.disabled = true;
    b.onclick = () => void run(a.id);
    chipRow.appendChild(b);
  }
  $<HTMLButtonElement>('stop').onclick = () => controller?.abort();
}

function setActionsEnabled(on: boolean): void {
  for (const el of document.querySelectorAll<HTMLButtonElement>('.chip')) el.disabled = !on;
}

// run executes one action over the assembled chart context. Requires a loaded
// chart; a prompt-taking action reads the detail box.
async function run(id: string): Promise<void> {
  if (!isActionId(id)) return;
  if (!chartContext) {
    status('Load a patient chart first (launch from Epic).', 'warn');
    return;
  }
  const def = ACTIONS.find((a) => a.id === id)!;
  const detail = $<HTMLTextAreaElement>('prompt').value.trim();
  if (def.needsPrompt && id === 'ask' && !detail) {
    status('Type a question about this patient.', 'warn');
    return;
  }
  controller?.abort();
  controller = new AbortController();
  const outputEl = $<HTMLTextAreaElement>('output');
  outputEl.value = '';
  status(`Running “${def.label}”…`);
  $<HTMLButtonElement>('stop').disabled = false;
  setActionsEnabled(false);
  const model = $<HTMLSelectElement>('model').value || undefined;
  try {
    const text = await runAction({
      id,
      detail,
      chartContext,
      opts: { token: bearer(), model, signal: controller.signal },
    });
    outputEl.value = text;
    status('Done. Review before use — decision support, not a diagnosis.', 'ok');
  } catch (e: unknown) {
    if ((e as Error).name === 'AbortError') status('Stopped.', 'warn');
    else status(`Error: ${(e as Error).message}`, 'error');
  } finally {
    $<HTMLButtonElement>('stop').disabled = true;
    setActionsEnabled(true);
  }
}

// ── Hanzo key + models ─────────────────────────────────────────────────────

function wireApiKey(): void {
  const apiKeyEl = $<HTMLInputElement>('apikey');
  apiKeyEl.value = getApiKey();
  $<HTMLButtonElement>('savekey').onclick = async () => {
    const key = apiKeyEl.value.trim();
    try {
      const models = await validateKey(key);
      setApiKey(key);
      fillModels(models);
      status('Hanzo API key saved.', 'ok');
    } catch (e: unknown) {
      status(`Key rejected: ${(e as Error).message}`, 'error');
    }
  };
}

async function populateModels(): Promise<void> {
  try {
    fillModels(await listModels({ token: bearer() }));
  } catch {
    /* anonymous / offline — the picker stays with its default option */
  }
}

function fillModels(ids: string[]): void {
  const sel = $<HTMLSelectElement>('model');
  const current = sel.value;
  sel.innerHTML = '';
  for (const id of ids) {
    const o = document.createElement('option');
    o.value = id;
    o.textContent = id;
    sel.appendChild(o);
  }
  if (current && ids.includes(current)) sel.value = current;
}

// ── Small helpers ──────────────────────────────────────────────────────────

async function postJson(path: string, body: unknown): Promise<any> {
  const resp = await fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'same-origin',
    body: JSON.stringify(body),
  });
  return resp.json().catch(() => ({ error: `HTTP ${resp.status}` }));
}

function status(msg: string, kind: '' | 'ok' | 'warn' | 'error' = ''): void {
  const el = $('status');
  el.textContent = msg;
  el.className = `status${kind ? ` ${kind}` : ''}`;
}

// Re-export a couple of pure helpers the panel uses so the module boundary is
// explicit (and so a smoke test can import this file under a DOM shim if needed).
export { bundleEntries };
