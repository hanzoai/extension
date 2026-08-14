// The Hanzo call over a patient's CHART, and the four clinical AI actions — pure
// prompt/response shaping plus one thin async edge (the @hanzo/ai client). No
// DOM, no FHIR SDK, so the prompt builders and the response extraction are fully
// unit-testable without a network.
//
// This layers on the published headless SDK: `@hanzo/ai`'s `createAiClient`
// gives ONE call shape across every Hanzo surface —
//   const ai = createAiClient({ token });
//   const res = await ai.chat.completions.create({ model, messages });
// We import it directly (do NOT reimplement); the SDK defaults to
// https://api.hanzo.ai and `/v1/...`. `ai` is injectable so the four actions and
// their prompt builders are tested against a fake client with zero network.
//
// PHI posture: the assembled chart context (chart.ts) is PHI. It is sent ONLY to
// api.hanzo.ai as the model input and is NEVER logged here. There is no
// write-back to the EHR — these actions read the chart and return assistant text
// for the clinician to review.

import {
  createAiClient,
  type AiClient,
  type ChatCompletion,
  type ChatCompletionMessage,
} from '@hanzo/ai';
import { DEFAULT_MODEL, HANZO_API_BASE_URL } from './config.js';

// ── System prompt ──────────────────────────────────────────────────────────

// CLINICAL_SYSTEM_PROMPT frames Hanzo as a clinician's assistant working over a
// FHIR-derived chart. It FORBIDS inventing findings the chart doesn't support
// (the failure mode that makes a clinical assistant dangerous), demands honesty
// about a truncated chart, and states plainly that the output is decision
// SUPPORT the clinician reviews — not a diagnosis or an order.
export const CLINICAL_SYSTEM_PROMPT =
  'You are Hanzo AI, a clinical assistant embedded in the clinician\'s EHR via ' +
  'SMART on FHIR. You are given the launched patient\'s chart (problems, ' +
  'medications, allergies, recent labs/vitals, and notes) as structured data. ' +
  'Work ONLY from the chart provided — never invent diagnoses, medications, ' +
  'allergies, lab values, or history that the chart does not support. When the ' +
  'chart is marked truncated and a complete answer needs the omitted part, say ' +
  'so plainly rather than guessing. Be precise, concise, and neutral, and use ' +
  'standard clinical terminology. This is decision SUPPORT that the clinician ' +
  'reviews and is responsible for — it is not a diagnosis, a treatment ' +
  'recommendation to act on unreviewed, or a substitute for clinical judgment.';

// ── The four actions ───────────────────────────────────────────────────────

export type ActionId = 'summarize' | 'note' | 'extract' | 'ask';

// The action catalog — the single source of truth the UI chips and the prompt
// builder both read, so they never drift. `needsPrompt` flags the actions that
// take clinician-supplied detail (the note's reason-for-visit / the question).
export interface ActionDef {
  id: ActionId;
  label: string;
  needsPrompt: boolean;
}

export const ACTIONS: readonly ActionDef[] = [
  { id: 'summarize', label: 'Summarize patient', needsPrompt: false },
  { id: 'note', label: 'Draft clinical note', needsPrompt: true },
  { id: 'extract', label: 'Extract problems & meds', needsPrompt: false },
  { id: 'ask', label: 'Ask about this patient', needsPrompt: true },
] as const;

// isActionId narrows an arbitrary string to an ActionId. Boundary guard. Pure.
export function isActionId(v: string): v is ActionId {
  return ACTIONS.some((a) => a.id === v);
}

// actionTask renders an action's task instruction. `detail` is the
// clinician-supplied text for the two actions that need it (the note's
// reason-for-visit, the free-text question); the other two are fixed. Pure — the
// exact instruction a test asserts is the exact instruction sent to the model.
export function actionTask(id: ActionId, detail = ''): string {
  const d = detail.trim();
  switch (id) {
    case 'summarize':
      return (
        'Write a concise clinical summary of this patient for a clinician ' +
        'picking up their care. Cover the active problems, current medications, ' +
        'allergies, and the most relevant recent labs/vitals, and flag anything ' +
        'that stands out (e.g. an abnormal value, a high-risk allergy, a ' +
        'medication–problem mismatch). Do not invent anything not in the chart.'
      );
    case 'note':
      return (
        `Draft a clinical note in SOAP format (Subjective, Objective, ` +
        `Assessment, Plan) for this encounter${
          d ? `. Reason for visit / clinician input: ${d}` : ''
        }. Populate Objective from the chart's labs, vitals, and active ` +
        'problems; base the Assessment and Plan on the charted problems and ' +
        'medications. Where the chart lacks information a real note needs (e.g. ' +
        'the subjective history), write a clear placeholder for the clinician to ' +
        'complete rather than fabricating it. The clinician reviews and signs ' +
        'this note.'
      );
    case 'extract':
      return (
        'Extract this patient\'s active problems and current medications as two ' +
        'structured lists. Problems: the condition and its status. Medications: ' +
        'the drug, dose/route/frequency if stated, and status. Include only what ' +
        'the chart contains; if a list is empty, say so plainly.'
      );
    case 'ask':
      return d || 'What is the most important thing to know about this patient right now?';
  }
}

// ── Message assembly (pure) ────────────────────────────────────────────────

// buildMessages composes the clinical system frame, the fenced chart context,
// and the task instruction into the OpenAI-compatible message list. The chart is
// FENCED so the model treats a patient's data as data, never as instructions
// (prompt-injection boundary — a note in the chart cannot redirect the model).
// Pure.
export function buildMessages(
  task: string,
  chartContext: string,
  systemPrompt = CLINICAL_SYSTEM_PROMPT,
): ChatCompletionMessage[] {
  const context = chartContext.trim();
  const user: ChatCompletionMessage = {
    role: 'user',
    content: context
      ? `---- patient chart ----\n${context}\n---- end patient chart ----\n\n---- task ----\n${task}`
      : task,
  };
  return [{ role: 'system', content: systemPrompt }, user];
}

// extractContent pulls the assistant text out of a ChatCompletion, tolerating an
// empty/odd shape. Throws on empty content so the caller surfaces a real failure
// rather than rendering a blank result. Pure.
export function extractContent(res: ChatCompletion): string {
  const content = res?.choices?.[0]?.message?.content;
  const text = typeof content === 'string' ? content : '';
  if (!text) throw new Error('Hanzo API returned no content');
  return text;
}

// ── The single call path ───────────────────────────────────────────────────

export interface AskOptions {
  model?: string;
  temperature?: number;
  token?: string; // sk- key or IAM token; empty → anonymous/public models
  baseUrl?: string;
  /** Injected @hanzo/ai client (tests). Defaults to a real createAiClient. */
  client?: AiClient;
  signal?: AbortSignal;
  system?: string;
}

// makeClient builds (or reuses an injected) @hanzo/ai client. One place decides
// how the SDK is configured, so every call is consistent. Pure but for the SDK
// construction.
function makeClient(opts: AskOptions): AiClient {
  return (
    opts.client ??
    createAiClient({ token: opts.token, baseUrl: opts.baseUrl ?? HANZO_API_BASE_URL })
  );
}

// ask runs ONE non-streaming completion over a chart and returns the assistant
// text. This is the single path from every Epic surface to the model — all four
// actions funnel through runAction → ask. Pure over the injected client.
export async function ask(task: string, chartContext: string, opts: AskOptions = {}): Promise<string> {
  const client = makeClient(opts);
  const res = await client.chat.completions.create({
    model: opts.model ?? DEFAULT_MODEL,
    messages: buildMessages(task, chartContext, opts.system),
    stream: false,
    ...(opts.temperature !== undefined ? { temperature: opts.temperature } : {}),
  }, { signal: opts.signal });
  return extractContent(res);
}

export interface RunActionParams {
  id: ActionId;
  detail?: string; // note reason-for-visit / question
  chartContext: string; // assembled by chart.assembleChartContext
  opts?: AskOptions;
}

// runAction forms the task for an action and asks Hanzo over the chart. Returns
// the raw assistant text — there is NO write-back to the EHR (v1 is read +
// assist only), so the clinician reviews the output before it is used.
export async function runAction(p: RunActionParams): Promise<string> {
  const task = actionTask(p.id, p.detail);
  return ask(task, p.chartContext, p.opts);
}

// listModels returns the model ids the caller may route to, via the SDK's
// /v1/models. The catalog is org-scoped by the bearer; an empty token lists
// public models. Thin over the injected client.
export async function listModels(opts: AskOptions = {}): Promise<string[]> {
  const client = makeClient(opts);
  const models = await client.models.list({ signal: opts.signal });
  return models.map((m) => m.id).filter((id): id is string => typeof id === 'string' && id.length > 0);
}
