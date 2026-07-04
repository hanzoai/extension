// The four AI actions over an agreement — summarize, extract key terms,
// risk-flag clauses, draft a memo. Each is a prompt template applied to the
// windowed agreement via the single `ask` primitive in hanzo.ts. There is
// exactly ONE code path to the model: an action is (id → prompt), and the panel,
// the picker, and the webhook all resolve an id here and call `ask`. No action
// speaks to the gateway directly.

import { ask, type AgreementMeta, type AskOptions, type DocumentContext } from './hanzo.js';

// The action catalog. `id` is the stable key the panel's chips and the webhook
// use; `label` is the button text; `prompt` is the instruction handed to the
// model as the task, over the fenced agreement text. Prompts are specific and
// output-shaped (bullet lists, tables) so results are consistent and parseable.
export const ACTIONS = {
  summarize: {
    label: 'Summarize',
    prompt:
      'Summarize this agreement for a busy reviewer. Cover: what it is and who ' +
      'the parties are, the core commercial terms, the term and termination, and ' +
      'anything a signer must know before signing. Use short paragraphs or ' +
      'bullets. No preamble.',
  },
  extractTerms: {
    label: 'Extract key terms',
    prompt:
      'Extract the key terms from this agreement as a structured list. Include, ' +
      'where present: the parties; the effective date and any expiry/renewal ' +
      'date; the term length; payment terms (amounts, schedule, currency); the ' +
      'main obligations of each party; termination rights; and the governing ' +
      'law/jurisdiction. Format as "Term: value" lines grouped under headings. ' +
      'If a term is not stated, write "not specified" rather than guessing.',
  },
  riskFlags: {
    label: 'Risk flags',
    prompt:
      'Review this agreement and flag clauses that are unusual, one-sided, or ' +
      'carry material risk for a signer. For each: name the clause/section, quote ' +
      'or paraphrase the risky part, and explain the risk in plain language ' +
      '(1-2 sentences). Order by severity (highest first). If nothing stands out, ' +
      'say so. Do not invent clauses that are not in the text.',
  },
  draftMemo: {
    label: 'Draft memo',
    prompt:
      'Write a short cover memo about this agreement for an internal reviewer or ' +
      'approver. Structure: a one-line summary; the key terms in brief; the top ' +
      'risks or open items; and a clear recommendation (approve / approve with ' +
      'changes / do not sign) with a one-sentence rationale. Return only the memo ' +
      'body, ready to paste.',
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
// prompt and run it over the windowed agreement via `ask`. This is the one code
// path from an action id to the model — the chips, the webhook auto-summarize,
// and any programmatic caller share it. Async so an unknown id surfaces as a
// rejected promise (not a synchronous throw), giving callers ONE way to handle
// failure: `await`/`.catch`. A gateway error rejects via `ask`.
export async function runAction(
  id: string,
  ctx: DocumentContext,
  meta?: AgreementMeta,
  opts: AskOptions = {},
): Promise<string> {
  return ask(actionPrompt(id), ctx, meta, opts);
}
