/**
 * Microsoft Teams Adaptive Card emitter.
 *
 * Turns a canonical {@link PanelSpec} into an Adaptive Card (schema v1.5):
 * `TextBlock` for text, `Input.ChoiceSet` for the model picker,
 * `Input.Text` for the prompt, `ActionSet`/`Action.Submit` for buttons,
 * `Container` for grouping. The result is the JSON a host adapter attaches as
 * a `application/vnd.microsoft.card.adaptive` attachment.
 *
 * See https://adaptivecards.io/explorer/
 */
import {
  ActionId,
  PROMPT_INPUT_ID,
  type ModelOption,
  type PanelSpec,
  type QuickAction,
} from './spec';

export const ADAPTIVE_CARD_SCHEMA =
  'http://adaptivecards.io/schemas/adaptive-card.json';
export const ADAPTIVE_CARD_VERSION = '1.5';

/** Minimal structural types for the Adaptive Card elements we emit. */
export interface AdaptiveElement {
  type: string;
  [key: string]: unknown;
}

export interface AdaptiveAction {
  type: string;
  [key: string]: unknown;
}

export interface AdaptiveCard {
  $schema: string;
  type: 'AdaptiveCard';
  version: string;
  body: AdaptiveElement[];
  actions: AdaptiveAction[];
}

function choice(o: ModelOption): { title: string; value: string } {
  return { title: o.label ?? o.id, value: o.id };
}

function submit(title: string, actionId: string, data: Record<string, unknown>, style?: 'positive' | 'default'): AdaptiveAction {
  const action: AdaptiveAction = {
    type: 'Action.Submit',
    title,
    // `id` is the Action id; `data.action` carries the stable ActionId so the
    // host handler can dispatch uniformly across hosts.
    id: actionId,
    data: { action: actionId, ...data },
  };
  if (style) action.style = style;
  return action;
}

/**
 * Emit a Teams Adaptive Card for a {@link PanelSpec}.
 */
export function toAdaptiveCard(spec: PanelSpec): AdaptiveCard {
  const body: AdaptiveElement[] = [];
  const actions: AdaptiveAction[] = [];

  // Header: title + optional icon (URL) as a two-column set, subtitle beneath.
  if (spec.icon && isUrl(spec.icon)) {
    body.push({
      type: 'ColumnSet',
      columns: [
        {
          type: 'Column',
          width: 'auto',
          items: [{ type: 'Image', url: spec.icon, size: 'Small', altText: spec.title }],
        },
        {
          type: 'Column',
          width: 'stretch',
          verticalContentAlignment: 'Center',
          items: [{ type: 'TextBlock', text: spec.title, weight: 'Bolder', size: 'Large', wrap: true }],
        },
      ],
    });
  } else {
    const title = spec.icon ? `${spec.icon} ${spec.title}` : spec.title;
    body.push({ type: 'TextBlock', text: title, weight: 'Bolder', size: 'Large', wrap: true });
  }
  if (spec.subtitle) {
    body.push({ type: 'TextBlock', text: spec.subtitle, isSubtle: true, spacing: 'None', wrap: true });
  }

  if (spec.signedIn === false) {
    body.push({
      type: 'TextBlock',
      text: spec.signInPrompt ?? 'Sign in to Hanzo to use the assistant.',
      wrap: true,
      separator: true,
    });
    actions.push(submit(spec.signInLabel ?? 'Sign in', ActionId.SignIn, {}, 'positive'));
    if (spec.footer) {
      body.push({ type: 'TextBlock', text: spec.footer, isSubtle: true, size: 'Small', wrap: true, separator: true });
    }
    return card(body, actions);
  }

  // Model picker.
  if (spec.modelPicker && spec.modelPicker.options.length > 0) {
    const mp = spec.modelPicker;
    body.push({ type: 'TextBlock', text: mp.label ?? 'Model', weight: 'Bolder', spacing: 'Medium', wrap: true });
    body.push({
      type: 'Input.ChoiceSet',
      id: ActionId.ModelSelect,
      style: 'compact',
      value: mp.value,
      choices: mp.options.map(choice),
    });
  }

  // Quick actions: an ActionSet inline in the body.
  if (spec.quickActions && spec.quickActions.length > 0) {
    body.push({
      type: 'ActionSet',
      spacing: 'Medium',
      actions: spec.quickActions.map((a: QuickAction) =>
        submit(a.label, `${ActionId.QuickAction}:${a.id}`, { chip: a.id }, a.style === 'primary' ? 'positive' : 'default'),
      ),
    });
  }

  // Output: a wrapped TextBlock. Adaptive Cards render a markdown subset.
  if (spec.output) {
    body.push({
      type: 'Container',
      separator: true,
      spacing: 'Medium',
      items: [{ type: 'TextBlock', text: spec.output, wrap: true }],
    });
  }

  // Prompt input + submit button (card-level action).
  if (spec.input) {
    const inp = spec.input;
    body.push({
      type: 'Input.Text',
      id: PROMPT_INPUT_ID,
      placeholder: inp.placeholder ?? 'Ask Hanzo…',
      isMultiline: inp.multiline ?? true,
      spacing: 'Medium',
      ...(inp.value ? { value: inp.value } : {}),
    });
    actions.push(submit(inp.submitLabel ?? 'Send', ActionId.PromptSubmit, {}, 'positive'));
  }

  // Footer.
  if (spec.footer) {
    body.push({ type: 'TextBlock', text: spec.footer, isSubtle: true, size: 'Small', wrap: true, separator: true });
  }

  return card(body, actions);
}

function card(body: AdaptiveElement[], actions: AdaptiveAction[]): AdaptiveCard {
  return {
    $schema: ADAPTIVE_CARD_SCHEMA,
    type: 'AdaptiveCard',
    version: ADAPTIVE_CARD_VERSION,
    body,
    actions,
  };
}

function isUrl(s: string): boolean {
  return /^https?:\/\//i.test(s);
}
