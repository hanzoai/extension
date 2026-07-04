/**
 * Canonical panel specification for Hanzo card-host chat surfaces.
 *
 * ONE `PanelSpec` describes a Hanzo assistant panel. Host emitters
 * (`toSlackBlocks`, `toAdaptiveCard`, `toCardServiceJson`) turn it into each
 * host's native card format so the assistant looks and behaves the same across
 * Slack, Microsoft Teams, and Google Workspace while rendering host-natively.
 *
 * This module is pure: no network, no host SDKs, no secrets. It only shapes UI.
 */

/**
 * Stable action ids the host wires to handlers. These strings are the contract
 * between `@hanzo/cards` and a host adapter — they appear verbatim in every
 * emitted card and must not change casually.
 */
export const ActionId = {
  /** User picked a model in the model picker. Value is the model id. */
  ModelSelect: 'hanzo_model_select',
  /** User submitted the freeform prompt input. */
  PromptSubmit: 'hanzo_prompt_submit',
  /** User clicked a quick-action chip. The chip's own id qualifies it. */
  QuickAction: 'hanzo_quick_action',
  /** User clicked the sign-in button in the signed-out state. */
  SignIn: 'hanzo_sign_in',
} as const;

export type ActionId = (typeof ActionId)[keyof typeof ActionId];

/** Stable id for the freeform prompt input field. */
export const PROMPT_INPUT_ID = 'hanzo_prompt';

/** A selectable model in the model picker. */
export interface ModelOption {
  /** Model id sent to the AI client, e.g. `zen-eco-3b`. */
  id: string;
  /** Human label shown in the picker. Defaults to `id` when omitted. */
  label?: string;
}

/** The model picker widget. */
export interface ModelPicker {
  /** Models to choose from. */
  options: ModelOption[];
  /** Currently selected model id. Should match one of `options[].id`. */
  value: string;
  /** Label shown above/beside the picker. */
  label?: string;
}

/** A quick-action chip/button (e.g. Draft, Summarize, Explain). */
export interface QuickAction {
  /** Stable id passed back to the host handler as the chip's value. */
  id: string;
  /** Button text. */
  label: string;
  /** Style hint. Hosts map this to their nearest native emphasis. */
  style?: 'primary' | 'default';
}

/** The freeform prompt input + its submit button. */
export interface PromptInput {
  /** Placeholder text shown in the empty input. */
  placeholder?: string;
  /** Pre-filled value. */
  value?: string;
  /** Submit button text. Defaults to `Send`. */
  submitLabel?: string;
  /** Whether the input allows multiple lines. Defaults to `true`. */
  multiline?: boolean;
}

/**
 * The canonical Hanzo assistant panel.
 *
 * Card hosts are non-streaming: `output` is the FINAL AI text (markdown), never
 * a partial stream. A streaming adapter should render intermediate text in its
 * own surface and only build a `PanelSpec` for the finished result.
 */
export interface PanelSpec {
  /** Header title. */
  title: string;
  /** Optional header subtitle. */
  subtitle?: string;
  /**
   * Optional header icon. A URL renders as an image where the host supports it;
   * a short string (e.g. an emoji) renders as text otherwise.
   */
  icon?: string;
  /** Model picker. Omit to hide it. */
  modelPicker?: ModelPicker;
  /** Quick-action chips. Empty/omitted hides the row. */
  quickActions?: QuickAction[];
  /**
   * Final AI output as markdown. Card hosts do not stream, so this is the
   * completed text. Omit when there is nothing to show yet.
   */
  output?: string;
  /** Freeform prompt input + submit. Omit to hide it. */
  input?: PromptInput;
  /** Context footer text, e.g. `via api.hanzo.ai`. */
  footer?: string;
  /**
   * When `false`, the panel renders a signed-out state: a sign-in prompt and
   * button replace the interactive widgets. Defaults to `true`.
   */
  signedIn?: boolean;
  /** Sign-in prompt text shown when `signedIn` is false. */
  signInPrompt?: string;
  /** Sign-in button text shown when `signedIn` is false. Defaults to `Sign in`. */
  signInLabel?: string;
}

/** Options for {@link assistantPanel}. */
export interface AssistantPanelOptions {
  /** Header title. Defaults to `Hanzo Assistant`. */
  title?: string;
  /** Header subtitle. */
  subtitle?: string;
  /** Header icon (URL or emoji). */
  icon?: string;
  /** Model ids or options for the picker. */
  models?: Array<string | ModelOption>;
  /** Currently selected model id. Defaults to the first model. */
  model?: string;
  /** Quick-action chips. */
  actions?: QuickAction[];
  /** Final AI output (markdown). */
  output?: string;
  /** Prompt input config, or `false` to hide the input. Defaults to shown. */
  input?: PromptInput | false;
  /** Context footer. Defaults to `via api.hanzo.ai`. */
  footer?: string;
  /** Signed-in state. Defaults to `true`. */
  signedIn?: boolean;
  /** Sign-in prompt text (signed-out state). */
  signInPrompt?: string;
}

const DEFAULT_FOOTER = 'via api.hanzo.ai';

function normalizeModels(models: Array<string | ModelOption>): ModelOption[] {
  return models.map((m) => (typeof m === 'string' ? { id: m } : m));
}

/**
 * Ready-made builder for the standard Hanzo assistant panel so host adapters
 * don't hand-assemble a {@link PanelSpec}.
 *
 * Signed-out panels drop the interactive widgets and show a sign-in prompt.
 */
export function assistantPanel(opts: AssistantPanelOptions = {}): PanelSpec {
  const signedIn = opts.signedIn ?? true;
  const footer = opts.footer ?? DEFAULT_FOOTER;

  if (!signedIn) {
    return {
      title: opts.title ?? 'Hanzo Assistant',
      subtitle: opts.subtitle,
      icon: opts.icon,
      footer,
      signedIn: false,
      signInPrompt:
        opts.signInPrompt ?? 'Sign in to Hanzo to use the assistant.',
      signInLabel: 'Sign in',
    };
  }

  const models = normalizeModels(opts.models ?? []);
  const firstModel = models[0];
  const modelPicker: ModelPicker | undefined = firstModel
    ? {
        options: models,
        value: opts.model ?? firstModel.id,
        label: 'Model',
      }
    : undefined;

  const input: PromptInput | undefined =
    opts.input === false
      ? undefined
      : {
          placeholder: 'Ask Hanzo…',
          submitLabel: 'Send',
          multiline: true,
          ...(opts.input ?? {}),
        };

  return {
    title: opts.title ?? 'Hanzo Assistant',
    subtitle: opts.subtitle,
    icon: opts.icon,
    modelPicker,
    quickActions: opts.actions,
    output: opts.output,
    input,
    footer,
    signedIn: true,
  };
}
