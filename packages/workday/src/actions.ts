// The AI actions over Workday people records — summarize a worker/team, draft a
// job description / requisition, summarize an org / headcount, answer an HR /
// policy question, and draft review feedback. Each is a prompt template applied to
// the windowed people context via the single `ask` primitive in hanzo.ts. There
// is exactly ONE code path to the model: an action is (id → prompt), and the panel
// and any server-side caller resolve an id here and call `ask`. No action speaks
// to the gateway directly. (A freeform question is `ask` directly, not an action —
// it has no fixed prompt.)

import { ask, type AskOptions, type PeopleMeta } from './hanzo.js';
import type { PeopleContext } from './people.js';

// The action catalog. `id` is the stable key the panel's chips use; `label` is the
// button text; `prompt` is the instruction handed to the model as the task, over
// the fenced people records. Prompts are specific, output-shaped (bullets,
// structured lists), and carry the HR guardrails (no protected characteristics, no
// invented facts, informational only) so results are consistent and safe.
export const ACTIONS = {
  summarizeWorker: {
    label: 'Summarize worker',
    prompt:
      'Summarize the worker profile(s) in these records for an HR business ' +
      'partner. Cover: role and business title, the organization and manager, ' +
      'location, and whether they manage people. If direct reports are shown, note ' +
      'team size and the notable roles. Use short bullets, reference each worker by ' +
      'name, ground every statement in the records, and do not infer compensation, ' +
      'performance, or any protected characteristic. No preamble. If more than one ' +
      'worker is shown, summarize each briefly.',
  },
  draftJobDescription: {
    label: 'Draft job description',
    prompt:
      'Draft a clear, inclusive job description / requisition for the role ' +
      'indicated by these records (use the requisition title, organization, and ' +
      'location when present). Include: a one-paragraph role summary, key ' +
      'responsibilities as bullets, and required and preferred qualifications as ' +
      'bullets. Use neutral, bias-free language free of age, gender, or other ' +
      'protected-characteristic coded terms, and do not invent compensation, ' +
      'benefits, or requirements the records do not support. Return only the job ' +
      'description, ready to paste into a Workday requisition.',
  },
  summarizeOrg: {
    label: 'Org & headcount',
    prompt:
      'Write a concise organization and headcount summary from these records for ' +
      'an HR leader. Cover: the organization and its manager, total headcount and ' +
      'how the workers break down by role or sub-team, any open requisitions and ' +
      'their openings, and anything the time-off records indicate about current ' +
      'coverage. Structure as a one-line headline followed by grouped bullets. Base ' +
      'every number and statement strictly on the records and say plainly if the ' +
      'records look incomplete.',
  },
  answerHrQuestion: {
    label: 'Answer HR question',
    prompt:
      'Answer the HR or policy question using these Workday records and general HR ' +
      'best practice. Ground any employee-specific claim in the records provided ' +
      'and cite the worker or organization it comes from; where the answer depends ' +
      'on a company policy document not included here, state exactly what policy or ' +
      'approval is needed rather than inventing one. Be concise and neutral, and ' +
      'note that the answer is informational and may require review by HR or legal ' +
      'before any action is taken.',
  },
  draftReviewFeedback: {
    label: 'Draft review feedback',
    prompt:
      'Draft constructive, balanced performance-review feedback for the worker in ' +
      'these records, written from a manager to the employee. Use only what the ' +
      'records support (role, responsibilities, organization) and clearly frame ' +
      'observations as prompts the manager should confirm with specific examples, ' +
      'since these records do not contain performance ratings. Cover strengths, ' +
      'areas for growth, and forward-looking goals, in neutral and respectful ' +
      'language free of any protected-characteristic reference. Return only the ' +
      'feedback draft.',
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
// prompt and run it over the windowed people context via `ask`. This is the one
// code path from an action id to the model. Async so an unknown id surfaces as a
// rejected promise (not a synchronous throw), giving callers ONE way to handle
// failure: `await`/`.catch`. A gateway error rejects via `ask`.
export async function runAction(
  id: string,
  ctx: PeopleContext,
  meta?: PeopleMeta,
  opts: AskOptions = {},
): Promise<string> {
  return ask(actionPrompt(id), ctx, meta, opts);
}
