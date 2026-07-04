// The books-analysis pipeline: given a company (env + realmId) + access token,
// fetch a QBO report (or an entity query), assemble it into financial context,
// and run an AI action over it. This is the shared core the server proxy uses to
// answer the panel server-side (Intuit token stays server-only). It composes the
// pure modules (qbo-api, finance, hanzo, actions) and takes its `fetch` injected,
// so it is unit-testable end-to-end without a network.

import { report, query, parseQueryResponse, parseFault, type ReportName } from './qbo-api.js';
import { buildReportContext, buildEntitiesContext, type FinanceContext } from './finance.js';
import { ask, type AskOptions } from './hanzo.js';
import { actionPrompt } from './actions.js';
import type { QboEnv } from './config.js';

// Shared inputs: the company + token the QBO reads need, plus the Hanzo gateway
// options (bearer, model) the AI call rides on.
interface BaseInput {
  env: QboEnv;
  realmId: string;
  /** Intuit OAuth access token — authorizes the QBO reads. */
  accessToken: string;
  /** Hanzo gateway options (bearer token, model, injected client for tests). */
  ask?: AskOptions;
  /** Injected fetch (tests). Defaults to global fetch. */
  fetch?: typeof fetch;
}

// A report analysis: which report, over what period, and either a named action
// or a freeform task to run on it.
export interface AnalyzeReportInput extends BaseInput {
  name: ReportName;
  /** Report params (start_date, end_date, accounting_method, …). */
  params?: Record<string, string>;
  /** A named action id (actions.ACTIONS) — mutually exclusive with `task`. */
  actionId?: string;
  /** A freeform instruction — used when no actionId is given. */
  task?: string;
}

// An entity-query analysis: a QBO query statement + the entity it returns.
export interface AnalyzeQueryInput extends BaseInput {
  statement: string;
  /** The entity the query selects (e.g. "Invoice") — keys parseQueryResponse. */
  entity: string;
  actionId?: string;
  task?: string;
}

// The pipeline result: the AI output plus the context that produced it, so the
// caller can show the source label and whether it was truncated.
export interface AnalyzeResult {
  result: string;
  label: string;
  truncated: boolean;
}

// resolveTask picks the instruction to run: a named action's prompt, or the
// freeform task. Throws when neither is given (a boundary error). One rule for
// "what do we ask the model", shared by both analyze entry points.
function resolveTask(actionId: string | undefined, task: string | undefined): string {
  if (actionId) return actionPrompt(actionId);
  if (task && task.trim()) return task;
  throw new Error('analyze requires an actionId or a task');
}

// fetchJson GETs a QBO url and parses JSON, surfacing QBO's Fault message on a
// non-2xx so the caller learns the real reason (e.g. 401 expired token, 400 bad
// query). One JSON read path for every QBO fetch.
async function fetchJson(url: string, headers: Record<string, string>, doFetch: typeof fetch): Promise<any> {
  const resp = await doFetch(url, { headers });
  const text = await resp.text();
  let data: any;
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    throw new Error(`QuickBooks API ${resp.status}: ${text.slice(0, 200)}`);
  }
  if (!resp.ok) {
    const fault = parseFault(data);
    throw new Error(`QuickBooks API ${resp.status}: ${fault || 'request failed'}`);
  }
  return data;
}

// runOver is the shared tail: given an assembled FinanceContext and the resolved
// task, run the model and return the result + context metadata. Both analyze
// entry points converge here — one AI call path.
async function runOver(ctx: FinanceContext, task: string, opts: AskOptions | undefined): Promise<AnalyzeResult> {
  const result = await ask(task, ctx, opts);
  return { result, label: ctx.label, truncated: ctx.truncated };
}

// analyzeReport fetches a report, builds its context, and runs the action/task
// over it. The ONE place the report-analysis flow lives (the "summarize
// financials" flow: fetch P&L → render statement → summarize). Pure composition
// over injected effects; each step's failure surfaces as a thrown Error.
export async function analyzeReport(input: AnalyzeReportInput): Promise<AnalyzeResult> {
  const doFetch = input.fetch ?? fetch;
  const task = resolveTask(input.actionId, input.task);
  const req = report(input.env, input.realmId, input.accessToken, input.name, input.params);
  const data = await fetchJson(req.url, req.headers, doFetch);
  const ctx = buildReportContext(data);
  return runOver(ctx, task, input.ask);
}

// analyzeQuery runs a QBO entity query, builds its context, and runs the
// action/task over the returned records. Used for invoice/bill/transaction
// analyses. Pure composition over injected effects.
export async function analyzeQuery(input: AnalyzeQueryInput): Promise<AnalyzeResult> {
  const doFetch = input.fetch ?? fetch;
  const task = resolveTask(input.actionId, input.task);
  const req = query(input.env, input.realmId, input.accessToken, input.statement);
  const data = await fetchJson(req.url, req.headers, doFetch);
  const records = parseQueryResponse<Record<string, unknown>>(data, input.entity);
  const ctx = buildEntitiesContext(input.entity, records, `${input.entity} query`);
  return runOver(ctx, task, input.ask);
}
