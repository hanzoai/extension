// The AI actions over a Canvas course — summarize the course, draft assignment
// feedback, generate quiz/discussion questions, summarize student submissions, and
// draft an announcement. Each is a prompt template applied to the windowed course
// context via the single `ask` primitive in hanzo.ts. There is exactly ONE code path
// to the model: an action is (id → prompt), and the panel and any server-side caller
// resolve an id here and call `ask`. No action speaks to the gateway directly. (A
// freeform "ask about the course" is `ask` directly, not an action — it has no fixed
// prompt.)

import { ask, type AskOptions, type CourseMeta } from './hanzo.js';
import type { CourseContext } from './course.js';

// The action catalog. `id` is the stable key the panel's chips use; `label` is the
// button text; `prompt` is the instruction handed to the model as the task, over the
// fenced course records. Prompts are specific and output-shaped (bullets, structured
// lists) so results are consistent and parseable.
export const ACTIONS = {
  summarizeCourse: {
    label: 'Summarize course',
    prompt:
      'Write a clear overview of this course for a student or a colleague, grounded ' +
      'in the syllabus and module structure in these records. Cover: what the course ' +
      'is about, how it is organised (the modules and their sequence), the major ' +
      'assignments and how grading works if the records say, and any key policies. ' +
      'Use a short headline followed by grouped bullets. Base every statement on the ' +
      'records; if the syllabus or modules look incomplete, say so plainly.',
  },
  draftFeedback: {
    label: 'Draft feedback',
    prompt:
      'Draft constructive, specific feedback for the student submission in these ' +
      'records, addressed to the student. Ground every point in what the submission ' +
      'actually contains and in the assignment’s stated requirements; do not invent ' +
      'content the student did not write or a grade the records do not show. Lead with ' +
      'what was done well, then give concrete, actionable suggestions for improvement, ' +
      'and close with an encouraging next step. Keep the tone supportive and ' +
      'professional. Return only the feedback text, ready to paste as a submission ' +
      'comment for the instructor to review.',
  },
  generateQuestions: {
    label: 'Generate questions',
    prompt:
      'From the course content in these records (a page, module, or assignment), ' +
      'generate assessment questions. Produce two groups. First, "Quiz questions": 5 ' +
      'to 8 questions that check understanding of the material, a mix of ' +
      'multiple-choice (with options and the correct answer marked) and short-answer, ' +
      'each tied to a specific idea in the records. Second, "Discussion prompts": 3 ' +
      'open-ended prompts that invite analysis or application. Base every question ' +
      'strictly on the provided content; do not test material that is not present.',
  },
  summarizeSubmissions: {
    label: 'Summarize submissions',
    prompt:
      'Summarize the student submissions in these records for the instructor. Cover: ' +
      'how many submitted vs are missing or late, the range of scores or grades if the ' +
      'records show them, common strengths and common problems across the responses, ' +
      'and any submissions that stand out (exemplary or struggling) — referenced by ' +
      'user id, not invented names. Structure as a one-line headline followed by ' +
      'grouped bullets. Do not fabricate scores or content the records do not contain.',
  },
  draftAnnouncement: {
    label: 'Draft announcement',
    prompt:
      'Draft a course announcement for the students, grounded in these course records ' +
      '(upcoming assignments, due dates, module content). Write a short, clear ' +
      'announcement with a specific subject line on the first line, then the body: what ' +
      'is happening, what students need to do, and any relevant due date drawn from the ' +
      'records. Keep it warm and concise. Do not invent dates or requirements that are ' +
      'not in the records. Return the subject line and body, ready for the instructor ' +
      'to review and post.',
  },
} as const;

// An action id from the catalog.
export type ActionId = keyof typeof ACTIONS;

// isActionId narrows an arbitrary string to a known action id. Boundary guard — the
// panel and the server validate an inbound id here before running it.
export function isActionId(id: string): id is ActionId {
  return Object.prototype.hasOwnProperty.call(ACTIONS, id);
}

// actionPrompt resolves an action id to its prompt template. Throws on an unknown id
// (a boundary error, surfaced to the caller) rather than silently running a default.
// Pure.
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
// prompt and run it over the windowed course context via `ask`. This is the one code
// path from an action id to the model. Async so an unknown id surfaces as a rejected
// promise (not a synchronous throw), giving callers ONE way to handle failure:
// `await`/`.catch`. A gateway error rejects via `ask`.
export async function runAction(
  id: string,
  ctx: CourseContext,
  meta?: CourseMeta,
  opts: AskOptions = {},
): Promise<string> {
  return ask(actionPrompt(id), ctx, meta, opts);
}
