/**
 * `@hanzo/cards` — one canonical panel spec, three host card formats.
 *
 * Presentation layer for Hanzo's card-host chat surfaces (Slack, Microsoft
 * Teams, Google Workspace). A host adapter builds a {@link PanelSpec} (directly
 * or via {@link assistantPanel}) and emits the host's native card:
 *
 * ```ts
 * import { assistantPanel, toSlackBlocks } from '@hanzo/cards';
 * const spec = assistantPanel({ models: ['zen-eco-3b'], output: text });
 * await slack.chat.postMessage({ channel, blocks: toSlackBlocks(spec) });
 * ```
 *
 * Pure: no network, no host SDKs, no secrets. Emitters never call the AI or
 * auth — they only shape UI. Card hosts are non-streaming, so `PanelSpec.output`
 * is the FINAL AI text.
 */
export {
  ActionId,
  PROMPT_INPUT_ID,
  assistantPanel,
  type AssistantPanelOptions,
  type ModelOption,
  type ModelPicker,
  type PanelSpec,
  type PromptInput,
  type QuickAction,
} from './spec';

export {
  toSlackBlocks,
  type SlackBlock,
  type SlackBlocks,
  type SlackOption,
  type SlackText,
} from './slack';

export {
  ADAPTIVE_CARD_SCHEMA,
  ADAPTIVE_CARD_VERSION,
  toAdaptiveCard,
  type AdaptiveAction,
  type AdaptiveCard,
  type AdaptiveElement,
} from './teams';

export {
  CALLBACK_FUNCTION,
  toCardServiceJson,
  type CardAction,
  type CardHeader,
  type CardSection,
  type CardServiceJson,
  type CardWidget,
} from './cardservice';
