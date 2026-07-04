/**
 * Slack Block Kit emitter.
 *
 * Turns a canonical {@link PanelSpec} into a Slack `blocks[]` array:
 * `header`/`section` for text, `actions` with `button`/`static_select`,
 * `input`, `context`, and `divider`. The result is the value a host adapter
 * passes as `blocks` to `chat.postMessage` / view payloads.
 *
 * See https://api.slack.com/reference/block-kit/blocks
 */
import {
  ActionId,
  PROMPT_INPUT_ID,
  type ModelOption,
  type PanelSpec,
  type QuickAction,
} from './spec';

/** Minimal structural types for the Slack blocks we emit. */
export interface SlackText {
  type: 'plain_text' | 'mrkdwn';
  text: string;
  emoji?: boolean;
}

export interface SlackOption {
  text: { type: 'plain_text'; text: string };
  value: string;
}

export interface SlackBlock {
  type: string;
  [key: string]: unknown;
}

export type SlackBlocks = SlackBlock[];

function plain(text: string): SlackText {
  return { type: 'plain_text', text, emoji: true };
}

function mrkdwn(text: string): SlackText {
  return { type: 'mrkdwn', text };
}

function modelOption(o: ModelOption): SlackOption {
  return { text: { type: 'plain_text', text: o.label ?? o.id }, value: o.id };
}

function quickActionButton(a: QuickAction): SlackBlock {
  const button: SlackBlock = {
    type: 'button',
    text: plain(a.label),
    value: a.id,
    action_id: `${ActionId.QuickAction}:${a.id}`,
  };
  if (a.style === 'primary') button.style = 'primary';
  return button;
}

/**
 * Emit Slack Block Kit `blocks[]` for a {@link PanelSpec}.
 */
export function toSlackBlocks(spec: PanelSpec): SlackBlocks {
  const blocks: SlackBlocks = [];

  // Header: Slack `header` blocks are plain_text only; subtitle/icon go in a
  // context block beneath so no header information is lost.
  const headerText = spec.icon && !isUrl(spec.icon) ? `${spec.icon} ${spec.title}` : spec.title;
  blocks.push({ type: 'header', text: plain(headerText) });

  const headerContext: SlackText[] = [];
  if (spec.icon && isUrl(spec.icon)) {
    blocks.push({ type: 'context', elements: [{ type: 'image', image_url: spec.icon, alt_text: spec.title }, mrkdwn(spec.subtitle ?? spec.title)] });
  } else if (spec.subtitle) {
    headerContext.push(mrkdwn(spec.subtitle));
  }
  if (headerContext.length > 0) {
    blocks.push({ type: 'context', elements: headerContext });
  }

  if (spec.signedIn === false) {
    blocks.push({ type: 'divider' });
    blocks.push({
      type: 'section',
      text: mrkdwn(spec.signInPrompt ?? 'Sign in to Hanzo to use the assistant.'),
    });
    blocks.push({
      type: 'actions',
      elements: [
        {
          type: 'button',
          text: plain(spec.signInLabel ?? 'Sign in'),
          style: 'primary',
          action_id: ActionId.SignIn,
        },
      ],
    });
    if (spec.footer) {
      blocks.push({ type: 'context', elements: [mrkdwn(spec.footer)] });
    }
    return blocks;
  }

  blocks.push({ type: 'divider' });

  // Model picker: a section with a static_select accessory.
  const mp = spec.modelPicker;
  if (mp && mp.options.length > 0) {
    // `options[0]` exists under the length guard; `find` may miss, so fall back.
    const initial = mp.options.find((o) => o.id === mp.value) ?? mp.options[0]!;
    blocks.push({
      type: 'section',
      text: mrkdwn(`*${mp.label ?? 'Model'}*`),
      accessory: {
        type: 'static_select',
        action_id: ActionId.ModelSelect,
        placeholder: plain(mp.label ?? 'Select a model'),
        options: mp.options.map(modelOption),
        initial_option: modelOption(initial),
      },
    });
  }

  // Quick actions: a single actions block of buttons.
  if (spec.quickActions && spec.quickActions.length > 0) {
    blocks.push({
      type: 'actions',
      elements: spec.quickActions.map(quickActionButton),
    });
  }

  // Output: markdown section. Slack mrkdwn is close enough to markdown.
  if (spec.output) {
    blocks.push({ type: 'section', text: mrkdwn(spec.output) });
  }

  // Prompt input + submit.
  if (spec.input) {
    const inp = spec.input;
    blocks.push({
      type: 'input',
      block_id: `${PROMPT_INPUT_ID}_block`,
      dispatch_action: true,
      label: plain(inp.placeholder ?? 'Ask Hanzo'),
      element: {
        type: 'plain_text_input',
        action_id: PROMPT_INPUT_ID,
        multiline: inp.multiline ?? true,
        ...(inp.value ? { initial_value: inp.value } : {}),
        ...(inp.placeholder ? { placeholder: plain(inp.placeholder) } : {}),
        dispatch_action_config: { trigger_actions_on: ['on_enter_pressed'] },
      },
    });
    blocks.push({
      type: 'actions',
      elements: [
        {
          type: 'button',
          text: plain(inp.submitLabel ?? 'Send'),
          style: 'primary',
          action_id: ActionId.PromptSubmit,
        },
      ],
    });
  }

  // Footer context.
  if (spec.footer) {
    blocks.push({ type: 'divider' });
    blocks.push({ type: 'context', elements: [mrkdwn(spec.footer)] });
  }

  return blocks;
}

function isUrl(s: string): boolean {
  return /^https?:\/\//i.test(s);
}
