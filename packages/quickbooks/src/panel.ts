// Pure browser-context helpers for the panel: read the launch query string and
// turn whatever the user pasted into a FinanceContext. No DOM, no network — so
// the context-building logic the panel depends on is unit-tested. app.ts binds
// these to the textarea/URL; everything decision-making lives here.

import {
  buildReportContext,
  buildEntitiesContext,
  truncateToBudget,
  type FinanceContext,
  type QboReport,
} from './finance.js';
import { CONTEXT_CHAR_BUDGET } from './config.js';

// The launch context the panel opens with. QuickBooks / the deployment can pass
// the company name (realm) and a starting report name in the URL so the panel
// titles itself; all fields are optional (the panel also works standalone).
export interface LaunchContext {
  company: string;
  realmId: string;
  report: string;
}

// parseLaunchContext reads the panel's launch query string. Defensive over a
// malformed search string. Pure.
export function parseLaunchContext(search: string): LaunchContext {
  let params: URLSearchParams;
  try {
    params = new URLSearchParams(search || '');
  } catch {
    params = new URLSearchParams();
  }
  return {
    company: params.get('company') || '',
    realmId: params.get('realmId') || '',
    report: params.get('report') || '',
  };
}

// panelTitle is the header label: the company name when present, else a generic
// title. Pure.
export function panelTitle(ctx: LaunchContext): string {
  return ctx.company ? ctx.company : 'QuickBooks Online';
}

// looksLikeReport / looksLikeQueryResponse are the boundary sniffs that decide
// how to render pasted JSON. A QBO report has a Rows/Columns tree; a query
// response wraps entities under QueryResponse. Pure.
function looksLikeReport(data: any): boolean {
  return !!data && typeof data === 'object' && (!!data.Rows || !!data.Columns) && !data.QueryResponse;
}
function looksLikeQueryResponse(data: any): boolean {
  return !!data && typeof data === 'object' && !!data.QueryResponse && typeof data.QueryResponse === 'object';
}

// firstEntityKey finds the entity array a QueryResponse carries (e.g. "Invoice")
// and returns its name + records, ignoring QBO's bookkeeping keys. Pure.
function firstEntityKey(qr: Record<string, unknown>): { entity: string; records: Array<Record<string, unknown>> } | null {
  const skip = new Set(['startPosition', 'maxResults', 'totalCount']);
  for (const [key, val] of Object.entries(qr)) {
    if (skip.has(key)) continue;
    if (Array.isArray(val)) {
      return { entity: key, records: val as Array<Record<string, unknown>> };
    }
  }
  return null;
}

// buildContextFromPaste turns whatever the user pasted into a FinanceContext:
//   • a QBO report JSON        → rendered statement (buildReportContext)
//   • a QBO query response JSON → rendered entity blocks (buildEntitiesContext)
//   • anything else            → treated as plain financial text, budget-capped
// This is the ONE place the panel decides how to interpret pasted data, so the
// three shapes share the same downstream `ask` path. Pure and total.
export function buildContextFromPaste(
  raw: string,
  budget: number = CONTEXT_CHAR_BUDGET,
): FinanceContext {
  const trimmed = raw.trim();
  if (!trimmed) return { text: '', label: '', truncated: false };

  let data: any;
  try {
    data = JSON.parse(trimmed);
  } catch {
    // Not JSON — treat as pasted plain-text figures, capped to the budget.
    const { text, truncated } = truncateToBudget(trimmed, budget);
    return { text, label: 'Pasted financial data', truncated };
  }

  if (looksLikeReport(data)) {
    return buildReportContext(data as QboReport, budget);
  }
  if (looksLikeQueryResponse(data)) {
    const found = firstEntityKey(data.QueryResponse);
    if (found) {
      return buildEntitiesContext(found.entity, found.records, `${found.entity} query`, budget);
    }
  }

  // Valid JSON of an unrecognized shape — stringify it and cap it rather than
  // dropping it, so the user still gets an answer over what they pasted.
  const { text, truncated } = truncateToBudget(JSON.stringify(data, null, 2), budget);
  return { text, label: 'Pasted JSON data', truncated };
}
