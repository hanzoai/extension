/**
 * Panels — the Hanzo assistant UI, built once via `@hanzo/cards`.
 *
 * Every card the bot renders comes from here. We assemble a canonical
 * {@link PanelSpec} with `assistantPanel` and emit an Adaptive Card with
 * `toAdaptiveCard`; we never hand-write Adaptive Card JSON. Quick-action ids
 * defined here are the contract between the card and {@link dispatch}.
 *
 * Pure: no network, no botbuilder, no secrets — just spec assembly.
 */
import {
  assistantPanel,
  toAdaptiveCard,
  type AdaptiveCard,
  type PanelSpec,
  type QuickAction,
} from '@hanzo/cards';

/** Stable quick-action ids. These flow into `data.action` as the chip id. */
export const QuickActionId = {
  Draft: 'draft',
  Summarize: 'summarize',
  Explain: 'explain',
  ActionItems: 'action_items',
} as const;

export type QuickActionId = (typeof QuickActionId)[keyof typeof QuickActionId];

/** The four assistant quick actions, in display order. */
export const QUICK_ACTIONS: readonly QuickAction[] = [
  { id: QuickActionId.Draft, label: 'Draft reply', style: 'primary' },
  { id: QuickActionId.Summarize, label: 'Summarize' },
  { id: QuickActionId.Explain, label: 'Explain' },
  { id: QuickActionId.ActionItems, label: 'Extract action items' },
] as const;

/**
 * System prompt for each quick action. The action operates on supplied context
 * (a message/thread) plus any freeform prompt. `undefined` for an unknown id.
 */
export function systemPromptFor(actionId: string): string | undefined {
  switch (actionId) {
    case QuickActionId.Draft:
      return 'You are Hanzo, drafting a concise, professional reply to the message below. Return only the reply body.';
    case QuickActionId.Summarize:
      return 'You are Hanzo. Summarize the message or thread below in a few clear bullet points.';
    case QuickActionId.Explain:
      return 'You are Hanzo. Explain the message or thread below in plain language for someone new to the topic.';
    case QuickActionId.ActionItems:
      return 'You are Hanzo. Extract concrete action items from the message or thread below as a checklist, each with an owner when one is stated.';
    default:
      return undefined;
  }
}

/** Options shared by the panel builders. */
export interface PanelOptions {
  /** Model ids for the picker. */
  models: string[];
  /** Selected model id. */
  model: string;
  /** Whether the user is signed in to Hanzo. */
  signedIn?: boolean;
}

/** The base spec: header, model picker, quick actions, prompt input, footer. */
function base(opts: PanelOptions, output?: string): PanelSpec {
  return assistantPanel({
    title: 'Hanzo Assistant',
    subtitle: 'AI for Microsoft Teams',
    models: opts.models,
    model: opts.model,
    actions: [...QUICK_ACTIONS],
    output,
    signedIn: opts.signedIn ?? true,
  });
}

/** The idle assistant panel (no output yet), e.g. the bot's welcome card. */
export function welcomePanel(opts: PanelOptions): PanelSpec {
  return base(opts);
}

/** An assistant panel showing a completed answer, ready for the next prompt. */
export function resultPanel(opts: PanelOptions, output: string): PanelSpec {
  return base(opts, output);
}

/** The signed-out panel: sign-in prompt replaces the interactive widgets. */
export function signedOutPanel(opts: Omit<PanelOptions, 'signedIn'>): PanelSpec {
  return assistantPanel({
    title: 'Hanzo Assistant',
    subtitle: 'AI for Microsoft Teams',
    models: opts.models,
    model: opts.model,
    signedIn: false,
    signInPrompt: 'Connect your Hanzo account to use the assistant in Teams.',
  });
}

/** Emit the Adaptive Card JSON for a spec. Convenience over `toAdaptiveCard`. */
export function renderCard(spec: PanelSpec): AdaptiveCard {
  return toAdaptiveCard(spec);
}
