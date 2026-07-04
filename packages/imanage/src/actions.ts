// The AI actions over an iManage document / matter — summarize a document, extract
// key clauses / dates / parties (contract review), search-and-synthesize a matter,
// and compare a document set. Each is a prompt template applied to the windowed
// document context via the single `ask` primitive in hanzo.ts. There is exactly
// ONE code path to the model: an action is (id → prompt), and the panel and any
// server-side caller resolve an id here and call `ask`. No action speaks to the
// gateway directly. (A freeform "ask about the matter" is `ask` directly, not an
// action — it has no fixed prompt.)

import { ask, type AskOptions, type MatterMeta } from './hanzo.js';
import type { DocumentContext } from './documents.js';

// The action catalog. `id` is the stable key the panel's chips use; `label` is the
// button text; `prompt` is the instruction handed to the model as the task, over
// the fenced document records. Prompts are specific and output-shaped (bullets,
// structured lists) so results are consistent and parseable.
export const ACTIONS = {
  summarizeDocument: {
    label: 'Summarize document',
    prompt:
      'Summarize the document in these records for a lawyer skimming the matter. ' +
      'Cover: what kind of document it is, its purpose, the parties, the key terms ' +
      'or obligations, and anything unusual or that needs attention. Reference the ' +
      'document name. Use short bullets. No preamble. Ground every statement in the ' +
      'text; if the content was not extractable and you only have the profile, say ' +
      'so and summarize from the metadata alone.',
  },
  extractClauses: {
    label: 'Key clauses, dates & parties',
    prompt:
      'Perform a contract-review extraction over the document in these records. ' +
      'Return four labelled lists, each grounded strictly in the text: "Parties" ' +
      '(every named party and their role); "Key dates" (effective date, term, ' +
      'renewal, termination, and any deadline, each with what it governs); "Key ' +
      'clauses" (governing law, indemnity, limitation of liability, confidentiality, ' +
      'assignment, termination, and any other material clause — quote the operative ' +
      'language); and "Dollar amounts / figures" (fees, caps, penalties). If a list ' +
      'has no entries in the text, write "None found in the text." Never infer a ' +
      'term that is not written.',
  },
  synthesizeMatter: {
    label: 'Search & synthesize',
    prompt:
      'You are given a set of documents (or search results) from one matter. ' +
      'Synthesize an answer to the matter question or, if none is posed, a short ' +
      'briefing across the set: what the documents collectively establish, where ' +
      'they agree, where they conflict, and what is missing. Attribute each point to ' +
      'the document it comes from by name or number. Base every statement on the ' +
      'records; if the set is marked truncated, note that the synthesis covers only ' +
      'the shown documents.',
  },
  compareDocuments: {
    label: 'Compare document set',
    prompt:
      'Compare the documents in these records. Produce: a one-line statement of what ' +
      'they have in common; then a table-style list of the material differences ' +
      '(term, obligation, date, amount, or clause) with each document\'s position ' +
      'side by side; then any provision present in one document but absent in ' +
      'another. Reference each document by name or number. Compare only what the ' +
      'text supports — do not assume a standard or a missing term.',
  },
} as const;

// An action id from the catalog.
export type ActionId = keyof typeof ACTIONS;

// isActionId narrows an arbitrary string to a known action id. Boundary guard —
// the panel and the server validate an inbound id here before running it.
export function isActionId(id: string): id is ActionId {
  return Object.prototype.hasOwnProperty.call(ACTIONS, id);
}

// actionPrompt resolves an action id to its prompt template. Throws on an unknown
// id (a boundary error, surfaced to the caller) rather than silently running a
// default. Pure.
export function actionPrompt(id: string): string {
  if (!isActionId(id)) throw new Error(`Unknown action: ${id}`);
  return ACTIONS[id].prompt;
}

// actionList is the ordered catalog for building the UI (chips) — id + label,
// derived from ACTIONS so the panel and the catalog can never drift. Pure.
export function actionList(): Array<{ id: ActionId; label: string }> {
  return (Object.keys(ACTIONS) as ActionId[]).map((id) => ({ id, label: ACTIONS[id].label }));
}

// runAction is the single entry point every surface calls: resolve the action's
// prompt and run it over the windowed document context via `ask`. This is the one
// code path from an action id to the model. Async so an unknown id surfaces as a
// rejected promise (not a synchronous throw), giving callers ONE way to handle
// failure: `await`/`.catch`. A gateway error rejects via `ask`.
export async function runAction(
  id: string,
  ctx: DocumentContext,
  meta?: MatterMeta,
  opts: AskOptions = {},
): Promise<string> {
  return ask(actionPrompt(id), ctx, meta, opts);
}
