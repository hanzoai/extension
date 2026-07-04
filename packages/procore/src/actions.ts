// The AI actions over a Procore project — summarize an RFI, draft an RFI
// response, extract action items / risks, summarize project status. Each is a
// prompt template applied to the windowed project context via the single `ask`
// primitive in hanzo.ts. There is exactly ONE code path to the model: an action
// is (id → prompt), and the panel and any server-side caller resolve an id here
// and call `ask`. No action speaks to the gateway directly. (A freeform question
// is `ask` directly, not an action — it has no fixed prompt.)

import { ask, type AskOptions, type ProjectMeta } from './hanzo.js';
import type { ProjectContext } from './project.js';

// The action catalog. `id` is the stable key the panel's chips use; `label` is
// the button text; `prompt` is the instruction handed to the model as the task,
// over the fenced project records. Prompts are specific and output-shaped
// (bullets, structured lists) so results are consistent and parseable.
export const ACTIONS = {
  summarizeRfi: {
    label: 'Summarize RFI',
    prompt:
      'Summarize the RFI in these records for a busy project engineer. Cover: the ' +
      'question being asked and why it matters, any answer or replies so far, the ' +
      'current status and who the ball is in court with, and what still needs to ' +
      'happen. Reference the RFI number. Use short bullets. No preamble. If more ' +
      'than one RFI is shown, summarize each briefly.',
  },
  draftRfiResponse: {
    label: 'Draft RFI response',
    prompt:
      'Draft a clear, professional response to the open RFI in these records, ' +
      'written from the responding party to the asker. Answer the question ' +
      'directly using only what the records support; where the records do not ' +
      'contain the answer, state exactly what information or decision is still ' +
      'needed rather than inventing one. Keep it concise and reference any ' +
      'relevant drawing, spec section, or submittal named in the records. Return ' +
      'only the response body, ready to paste as an RFI reply.',
  },
  extractActionItems: {
    label: 'Action items & risks',
    prompt:
      'Read these project records (RFIs, observations, daily logs) and extract two ' +
      'lists. First, "Action items": concrete follow-ups, each as a single line ' +
      'with the owner (ball-in-court or author) when the records name one and a ' +
      'due date when present. Second, "Risks": schedule, cost, safety, or quality ' +
      'risks the records surface, ordered by severity (highest first), each with a ' +
      'one-line explanation grounded in the record it comes from. If a list is ' +
      'empty, say so. Do not invent items not in the records.',
  },
  projectStatus: {
    label: 'Project status',
    prompt:
      'Write a short project-status summary for a superintendent or PM from these ' +
      'records. Cover: open vs closed RFIs and any that are overdue or waiting on ' +
      'the team; submittals in review or overdue; notable observations; and ' +
      'anything from the daily logs that affects schedule or safety. Structure as ' +
      'a one-line headline followed by grouped bullets. Base every statement on ' +
      'the records; note plainly if the records look incomplete.',
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
// prompt and run it over the windowed project context via `ask`. This is the one
// code path from an action id to the model. Async so an unknown id surfaces as a
// rejected promise (not a synchronous throw), giving callers ONE way to handle
// failure: `await`/`.catch`. A gateway error rejects via `ask`.
export async function runAction(
  id: string,
  ctx: ProjectContext,
  meta?: ProjectMeta,
  opts: AskOptions = {},
): Promise<string> {
  return ask(actionPrompt(id), ctx, meta, opts);
}
