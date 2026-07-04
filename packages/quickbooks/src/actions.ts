// The AI actions over the books — summarize financials, explain a report, draft
// invoice/estimate line descriptions, categorize/explain transactions. Each is a
// prompt template applied to the assembled financial context via the single
// `ask` primitive in hanzo.ts. There is exactly ONE code path to the model: an
// action is (id → prompt), and the panel, the picker, and the server proxy all
// resolve an id here and call `ask`. No action speaks to the gateway directly.
//
// (A freeform "ask about the books" is `ask` in hanzo.ts with the user's own
// question — not an entry here — so the catalog stays the set of one-click
// canned analyses.)

import { ask, type AskOptions } from './hanzo.js';
import type { FinanceContext } from './finance.js';

// The action catalog. `id` is the stable key the panel's chips and the proxy
// use; `label` is the button text; `prompt` is the instruction handed to the
// model as the task, over the fenced financial data. Prompts are specific and
// output-shaped (short sections, bullet lists) so results are consistent.
export const ACTIONS = {
  summarizeFinancials: {
    label: 'Summarize financials',
    prompt:
      'Summarize these financials in plain language for a busy owner or ' +
      'manager. Cover: the headline result (net income / net position), the ' +
      'largest revenue and expense drivers by amount, and any notable trends or ' +
      'swings across the columns/periods shown. Call out the top 3 line items ' +
      'that most affect the bottom line. Use short sections or bullets, cite ' +
      'figures by their line/account name, and keep amounts in the reported ' +
      'currency. Do not invent accounts or amounts that are not in the data. No ' +
      'preamble.',
  },
  explainReport: {
    label: 'Explain this report',
    prompt:
      'Explain what this report shows to someone who is not an accountant. ' +
      'Define the sections and subtotals in the statement, walk through how the ' +
      'total is built up from the lines, and point out the two or three numbers ' +
      'a reader should pay attention to and why. Do not give advice and do not ' +
      'invent lines that are not in the report — just make the report ' +
      'understandable. Reference lines by name.',
  },
  draftLineDescriptions: {
    label: 'Draft line descriptions',
    prompt:
      'Draft clear, professional line-item descriptions for an invoice or ' +
      'estimate based on the products/services and amounts shown. For each line, ' +
      'write a concise customer-facing description (one line each) that states ' +
      'what was delivered. Return them as "Amount — description" rows, ready to ' +
      'paste. If the data does not include line items, say what is needed instead ' +
      'of inventing services.',
  },
  categorizeTransactions: {
    label: 'Categorize / explain transactions',
    prompt:
      'Review these transactions and, for each, suggest the most likely expense ' +
      'or income account category and briefly explain the transaction in plain ' +
      'language (payee, what it appears to be). Format as "Date · Payee · ' +
      'Amount → Suggested category (reason)" rows. Where the category is ' +
      'genuinely ambiguous, say so and give the top two candidates rather than ' +
      'guessing one. Do not invent transactions that are not listed.',
  },
} as const;

// An action id from the catalog.
export type ActionId = keyof typeof ACTIONS;

// isActionId narrows an arbitrary string to a known action id. Boundary guard —
// the panel and the server validate an inbound id here before running it.
export function isActionId(id: string): id is ActionId {
  return Object.prototype.hasOwnProperty.call(ACTIONS, id);
}

// actionPrompt resolves an action id to its prompt template. Throws on an
// unknown id (a boundary error, surfaced to the caller) rather than silently
// running a default.
export function actionPrompt(id: string): string {
  if (!isActionId(id)) throw new Error(`Unknown action: ${id}`);
  return ACTIONS[id].prompt;
}

// actionList is the ordered catalog for building the UI (chips) — id + label,
// derived from ACTIONS so the panel and the catalog can never drift.
export function actionList(): Array<{ id: ActionId; label: string }> {
  return (Object.keys(ACTIONS) as ActionId[]).map((id) => ({ id, label: ACTIONS[id].label }));
}

// runAction is the single entry point every surface calls: resolve the action's
// prompt and run it over the assembled financial context via `ask`. This is the
// one code path from an action id to the model — the chips, the proxy, and any
// programmatic caller share it. Async so an unknown id surfaces as a rejected
// promise (not a synchronous throw), giving callers ONE way to handle failure:
// `await`/`.catch`. A gateway error rejects via `ask`.
export async function runAction(id: string, ctx: FinanceContext, opts: AskOptions = {}): Promise<string> {
  return ask(actionPrompt(id), ctx, opts);
}
