/**
 * Action-id routing — pure parsing of `@hanzo/cards` action ids into a typed
 * intent the Bolt layer dispatches on.
 *
 * The card contract emits four stable action ids:
 *  - `hanzo_model_select`            → pick a model
 *  - `hanzo_prompt_submit`           → run the freeform prompt
 *  - `hanzo_quick_action:<id>`       → run a quick action (id qualifies it)
 *  - `hanzo_sign_in`                 → start sign-in
 *
 * Keeping the parse here (not in Bolt handlers) makes routing unit-testable and
 * gives ONE place that knows the id grammar. Bolt registers handlers by exact id
 * / regex; this module classifies an id when a single handler needs to branch.
 */

import { ActionId } from '@hanzo/cards';

/** Regex matching any quick-action id: `hanzo_quick_action:<id>`. */
export const QUICK_ACTION_RE = new RegExp(`^${ActionId.QuickAction}:(.+)$`);

/** A parsed action intent. */
export type ActionIntent =
  | { kind: 'model_select' }
  | { kind: 'prompt_submit' }
  | { kind: 'quick_action'; id: string }
  | { kind: 'sign_in' }
  | { kind: 'unknown'; actionId: string };

/**
 * Classify a raw Slack `action_id` into an {@link ActionIntent}. Pure — the
 * single source of truth for the id grammar. Unit-tested.
 */
export function parseActionId(actionId: string): ActionIntent {
  if (actionId === ActionId.ModelSelect) return { kind: 'model_select' };
  if (actionId === ActionId.PromptSubmit) return { kind: 'prompt_submit' };
  if (actionId === ActionId.SignIn) return { kind: 'sign_in' };
  const m = QUICK_ACTION_RE.exec(actionId);
  if (m) return { kind: 'quick_action', id: m[1]! };
  return { kind: 'unknown', actionId };
}

/** Extract the quick-action id from a `hanzo_quick_action:<id>` action id. */
export function quickActionIdFrom(actionId: string): string | null {
  const m = QUICK_ACTION_RE.exec(actionId);
  return m ? m[1]! : null;
}
