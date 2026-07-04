/**
 * Adaptive Card action dispatch — pure routing from a submit payload to intent.
 *
 * Every `Action.Submit` in a Hanzo card carries `data.action` (from
 * `@hanzo/cards`). This module turns that raw payload into a typed
 * {@link CardIntent} the bot can act on, with **no** botbuilder or network
 * dependency, so the routing table is unit-tested in isolation.
 *
 * The `data.action` grammar from `@hanzo/cards`:
 *  - `hanzo_model_select`         — model picker changed
 *  - `hanzo_prompt_submit`        — freeform prompt submitted
 *  - `hanzo_quick_action:<chip>`  — a quick-action chip (also `data.chip`)
 *  - `hanzo_sign_in`              — sign-in button
 */
import { ActionId, PROMPT_INPUT_ID } from '@hanzo/cards';

/** The raw submit payload: `data.action` plus the card's input fields by id. */
export type SubmitData = Record<string, unknown>;

/** A model-picker change. */
export interface ModelSelectIntent {
  kind: 'model_select';
  /** Selected model id. */
  model: string;
}

/** A freeform prompt submission. */
export interface PromptIntent {
  kind: 'prompt';
  /** The prompt text from the `hanzo_prompt` input. */
  prompt: string;
  /** Model id selected in the same submit, when present. */
  model?: string;
}

/** A quick-action chip click. */
export interface QuickActionIntent {
  kind: 'quick_action';
  /** The chip id, e.g. `summarize`. */
  chip: string;
  /** Freeform prompt submitted alongside, when present. */
  prompt?: string;
  /** Model id selected in the same submit, when present. */
  model?: string;
}

/** The sign-in button. */
export interface SignInIntent {
  kind: 'sign_in';
}

/** An unrecognized or malformed payload. */
export interface UnknownIntent {
  kind: 'unknown';
  /** The raw `action` value, for logging. */
  action?: string;
}

/** The closed set of intents a Hanzo card can produce. */
export type CardIntent =
  | ModelSelectIntent
  | PromptIntent
  | QuickActionIntent
  | SignInIntent
  | UnknownIntent;

const QUICK_PREFIX = `${ActionId.QuickAction}:`;

function str(v: unknown): string | undefined {
  return typeof v === 'string' && v.length > 0 ? v : undefined;
}

/**
 * The selected model id from a submit payload. The picker's `Input.ChoiceSet`
 * is keyed by {@link ActionId.ModelSelect}, so its value rides along on every
 * submit from the same card.
 */
export function selectedModel(data: SubmitData): string | undefined {
  return str(data[ActionId.ModelSelect]);
}

/**
 * The prompt text from a submit payload. The `Input.Text` field is keyed by
 * {@link PROMPT_INPUT_ID}.
 */
export function promptText(data: SubmitData): string | undefined {
  const raw = str(data[PROMPT_INPUT_ID]);
  return raw ? raw.trim() || undefined : undefined;
}

/**
 * Route a submit payload to a typed intent. This is the single dispatch point
 * for both `onAdaptiveCardInvoke` (`data` from `invokeValue.action.data`) and
 * classic `Action.Submit` (`data` from `activity.value`).
 */
export function dispatch(data: SubmitData): CardIntent {
  const action = str(data.action);
  const model = selectedModel(data);
  const prompt = promptText(data);

  if (action === ActionId.SignIn) {
    return { kind: 'sign_in' };
  }

  if (action === ActionId.ModelSelect) {
    // A bare model-select carries its value in the picker field, not `chip`.
    if (model) return { kind: 'model_select', model };
    return { kind: 'unknown', action };
  }

  if (action === ActionId.PromptSubmit) {
    if (!prompt) return { kind: 'unknown', action };
    return { kind: 'prompt', prompt, ...(model ? { model } : {}) };
  }

  if (action && action.startsWith(QUICK_PREFIX)) {
    // The chip id is both the suffix and `data.chip`; prefer the explicit field.
    const chip = str(data.chip) ?? action.slice(QUICK_PREFIX.length);
    if (!chip) return { kind: 'unknown', action };
    return {
      kind: 'quick_action',
      chip,
      ...(prompt ? { prompt } : {}),
      ...(model ? { model } : {}),
    };
  }

  return { kind: 'unknown', ...(action ? { action } : {}) };
}
