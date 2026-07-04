/**
 * Build Hanzo assistant panels for Slack via `@hanzo/cards`.
 *
 * ONE builder shapes the canonical {@link PanelSpec}; `toSlackBlocks` (called by
 * the Bolt layer / `blocks()` here) turns it into Block Kit. We never hand-write
 * Block Kit — the card contract and its stable action ids live in `@hanzo/cards`.
 *
 * Pure: no Slack SDK, no network. Every function returns data structures, so
 * panel assembly is unit-testable against the `@hanzo/cards` output shape.
 */

import {
  assistantPanel,
  toSlackBlocks,
  type ModelOption,
  type PanelSpec,
  type QuickAction,
  type SlackBlocks,
} from '@hanzo/cards';
import { QUICK_ACTIONS, type QuickActionId } from './hanzo.js';
import type { ModelInfo } from './client.js';

/** The quick-action chips, derived from the single catalog in hanzo.ts. */
export function quickActionChips(): QuickAction[] {
  return (Object.keys(QUICK_ACTIONS) as QuickActionId[]).map((id) => ({
    id,
    label: QUICK_ACTIONS[id].label,
    style: QUICK_ACTIONS[id].style,
  }));
}

/** Map gateway model info to card model options (fullName → label). Pure. */
export function toModelOptions(models: ModelInfo[]): ModelOption[] {
  return models.map((m) => ({ id: m.id, label: m.fullName ?? m.id }));
}

/** Inputs for {@link assistantPanelSpec}. */
export interface PanelInput {
  /** Models for the picker. Empty hides the picker. */
  models: ModelInfo[];
  /** Currently selected model id. */
  selectedModel: string;
  /** Final AI output (markdown) to show. Omit for the empty panel. */
  output?: string;
  /** Signed-in state. Signed-out shows the sign-in prompt instead of widgets. */
  signedIn: boolean;
  /** Pre-fill the prompt input. */
  promptValue?: string;
}

/**
 * Assemble the canonical assistant {@link PanelSpec} (App Home / slash reply).
 * Delegates to `@hanzo/cards`' `assistantPanel` so the shape stays canonical.
 */
export function assistantPanelSpec(input: PanelInput): PanelSpec {
  return assistantPanel({
    title: 'Hanzo Assistant',
    subtitle: 'AI for your Slack workspace',
    icon: '🤖',
    models: toModelOptions(input.models),
    model: input.selectedModel,
    actions: quickActionChips(),
    output: input.output,
    input: input.promptValue ? { value: input.promptValue } : undefined,
    signedIn: input.signedIn,
    signInPrompt: 'Connect Hanzo to use the assistant in this workspace.',
  });
}

/** {@link assistantPanelSpec} rendered to Slack Block Kit `blocks[]`. */
export function assistantBlocks(input: PanelInput): SlackBlocks {
  return toSlackBlocks(assistantPanelSpec(input));
}

/**
 * A results-only panel spec for a slash-command / shortcut reply: the header,
 * the model that produced the output, quick actions to follow up, and the text.
 * No input field — the reply is not the persistent Home surface.
 */
export function resultPanelSpec(
  output: string,
  model: string,
  models: ModelInfo[] = [],
): PanelSpec {
  return assistantPanel({
    title: 'Hanzo Assistant',
    subtitle: model,
    icon: '🤖',
    models: models.length > 0 ? toModelOptions(models) : [{ id: model }],
    model,
    actions: quickActionChips(),
    output,
    input: false,
  });
}

/** {@link resultPanelSpec} rendered to Slack Block Kit `blocks[]`. */
export function resultBlocks(
  output: string,
  model: string,
  models: ModelInfo[] = [],
): SlackBlocks {
  return toSlackBlocks(resultPanelSpec(output, model, models));
}

/**
 * The App Home view payload (`views.publish`). Wraps the assistant blocks in a
 * `home` view. Returned as a plain object so it is testable and SDK-free.
 */
export function homeView(input: PanelInput): { type: 'home'; blocks: SlackBlocks } {
  return { type: 'home', blocks: assistantBlocks(input) };
}
