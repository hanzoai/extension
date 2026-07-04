/**
 * The Hanzo Teams bot.
 *
 * A botbuilder {@link TeamsActivityHandler} that brings Hanzo AI into Teams:
 *
 *  - **1:1 & channel chat** — a DM or `@Hanzo <prompt>` runs a completion and
 *    replies with a Hanzo assistant Adaptive Card panel.
 *  - **Adaptive Card actions** — the panel's model picker, quick-action chips,
 *    and prompt input all post `Action.Submit`; {@link dispatch} routes them.
 *  - **Message extension** — the "Ask Hanzo" action command on a message
 *    summarizes/drafts a reply; the compose command inserts an AI draft.
 *
 * The handler is a thin wire: it pulls context, calls {@link complete}, and
 * renders panels. All routing/shaping logic lives in the pure modules
 * (`dispatch`, `panels`, `context`, `hanzo`), which the tests exercise directly.
 */
import {
  CardFactory,
  MessageFactory,
  TeamsActivityHandler,
  type TurnContext,
} from 'botbuilder';
import type {
  AdaptiveCardInvokeResponse,
  AdaptiveCardInvokeValue,
  MessagingExtensionAction,
  MessagingExtensionActionResponse,
  MessagingExtensionQuery,
  MessagingExtensionResponse,
} from 'botbuilder';
import type { Config } from './config';
import {
  dispatch,
  type CardIntent,
  type SubmitData,
} from './dispatch';
import {
  promptFromActivity,
  textFromMessagePayload,
  truncate,
  type ActivityLike,
} from './context';
import {
  QUICK_ACTIONS,
  renderCard,
  resultPanel,
  signedOutPanel,
  systemPromptFor,
  welcomePanel,
} from './panels';
import { complete, type AiClient, type ChatMessage } from './hanzo';

/** Command ids declared in the manifest's messageExtensions. */
export const COMMAND = {
  /** Action command on a message: "Ask Hanzo". */
  Ask: 'askHanzo',
  /** Compose action: insert an AI draft. */
  Compose: 'composeHanzo',
} as const;

/** A completed answer plus the model that produced it. */
interface Answer {
  text: string;
  model: string;
}

/** The bot's collaborators, injected so the handler is testable. */
export interface BotDeps {
  /** Resolved configuration. */
  config: Config;
  /** Hanzo AI client (built from the config's API key). */
  ai: AiClient;
}

export class HanzoTeamsBot extends TeamsActivityHandler {
  private readonly config: Config;
  private readonly ai: AiClient;

  constructor(deps: BotDeps) {
    super();
    this.config = deps.config;
    this.ai = deps.ai;

    this.onMessage(async (context, next) => {
      await this.handleMessage(context);
      await next();
    });

    this.onMembersAdded(async (context, next) => {
      await this.greet(context);
      await next();
    });
  }

  // ── Chat ────────────────────────────────────────────────────────────────

  /** A message activity: either a card `Action.Submit` or a typed prompt. */
  private async handleMessage(context: TurnContext): Promise<void> {
    const value = context.activity.value as SubmitData | undefined;
    if (value && typeof value === 'object') {
      await this.handleSubmit(context, dispatch(value));
      return;
    }
    const prompt = promptFromActivity(context.activity as ActivityLike);
    if (!prompt) {
      await context.sendActivity(this.panelActivity(welcomePanel(this.panelOpts())));
      return;
    }
    const answer = await this.answer([{ role: 'user', content: prompt }], this.config.defaultModel);
    await context.sendActivity(this.resultActivity(answer));
  }

  /** Route a dispatched card intent to its effect. */
  private async handleSubmit(context: TurnContext, intent: CardIntent): Promise<void> {
    switch (intent.kind) {
      case 'sign_in':
        await context.sendActivity(this.panelActivity(signedOutPanel(this.panelOpts())));
        return;

      case 'model_select':
        // Re-render the panel with the newly selected model preserved.
        await context.sendActivity(
          this.panelActivity(welcomePanel(this.panelOpts(intent.model))),
        );
        return;

      case 'prompt': {
        const model = this.pickModel(intent.model);
        const answer = await this.answer([{ role: 'user', content: intent.prompt }], model);
        await context.sendActivity(this.resultActivity(answer));
        return;
      }

      case 'quick_action': {
        const system = systemPromptFor(intent.chip);
        if (!system) {
          await context.sendActivity(`Unknown action: ${intent.chip}`);
          return;
        }
        // A quick action in a bot card has no attached message context (that
        // path is the "Ask Hanzo" message extension). It operates on the text
        // typed into the prompt input, so it needs one.
        if (!intent.prompt) {
          await context.sendActivity(
            'Type what you want me to work on in the prompt box, then choose an action.',
          );
          return;
        }
        const answer = await this.answer(
          [
            { role: 'system', content: system },
            { role: 'user', content: intent.prompt },
          ],
          this.pickModel(intent.model),
        );
        await context.sendActivity(this.resultActivity(answer));
        return;
      }

      case 'unknown':
      default:
        await context.sendActivity(this.panelActivity(welcomePanel(this.panelOpts())));
        return;
    }
  }

  /** Send the welcome panel when the bot is added to a chat/team. */
  private async greet(context: TurnContext): Promise<void> {
    const botId = context.activity.recipient?.id;
    const added = context.activity.membersAdded ?? [];
    if (!added.some((m) => m.id !== botId)) return;
    await context.sendActivity(this.panelActivity(welcomePanel(this.panelOpts())));
  }

  // ── Message extension: "Ask Hanzo" on a message ─────────────────────────

  protected override async handleTeamsMessagingExtensionSubmitAction(
    _context: TurnContext,
    action: MessagingExtensionAction,
  ): Promise<MessagingExtensionActionResponse> {
    const data = (action.data ?? {}) as SubmitData;
    const chip = typeof data.chip === 'string' ? data.chip : 'summarize';
    // Fall back to the summarize prompt for any unrecognized chip.
    const system = systemPromptFor(chip) ?? systemPromptFor('summarize')!;
    const source = action.messagePayload
      ? textFromMessagePayload(action.messagePayload)
      : '';
    const messages: ChatMessage[] = [
      { role: 'system', content: system },
      {
        role: 'user',
        content: source
          ? `Message:\n\n${source}`
          : 'No message content was provided.',
      },
    ];
    const answer = await this.answer(messages, this.pickModel());
    return {
      composeExtension: {
        type: 'result',
        attachmentLayout: 'list',
        attachments: [this.card(answer)],
      },
    };
  }

  // ── Compose extension: insert an AI draft ───────────────────────────────

  protected override async handleTeamsMessagingExtensionQuery(
    _context: TurnContext,
    query: MessagingExtensionQuery,
  ): Promise<MessagingExtensionResponse> {
    const prompt = queryText(query);
    if (!prompt) {
      return { composeExtension: { type: 'result', attachmentLayout: 'list', attachments: [] } };
    }
    const answer = await this.answer(
      [{ role: 'user', content: prompt }],
      this.pickModel(),
    );
    return {
      composeExtension: {
        type: 'result',
        attachmentLayout: 'list',
        attachments: [this.card(answer)],
      },
    };
  }

  // ── Adaptive Card invoke (Action.Execute path) ──────────────────────────

  protected override async onAdaptiveCardInvoke(
    context: TurnContext,
    invokeValue: AdaptiveCardInvokeValue,
  ): Promise<AdaptiveCardInvokeResponse> {
    const data = (invokeValue.action?.data ?? {}) as SubmitData;
    await this.handleSubmit(context, dispatch(data));
    return { statusCode: 200, type: 'application/vnd.microsoft.card.adaptive', value: {} };
  }

  // ── Completion + rendering helpers ──────────────────────────────────────

  private async answer(messages: ChatMessage[], model: string): Promise<Answer> {
    const text = await complete(this.ai, {
      model,
      messages,
      maxTokens: 1024,
    });
    return { text: truncate(text), model };
  }

  private pickModel(candidate?: string): string {
    if (candidate && this.config.models.includes(candidate)) return candidate;
    return this.config.defaultModel;
  }

  private panelOpts(model?: string): { models: string[]; model: string } {
    return { models: this.config.models, model: this.pickModel(model) };
  }

  private card(answer: Answer) {
    const spec = resultPanel({ ...this.panelOpts(answer.model), signedIn: true }, answer.text);
    return CardFactory.adaptiveCard(renderCard(spec));
  }

  private resultActivity(answer: Answer) {
    return MessageFactory.attachment(this.card(answer));
  }

  private panelActivity(spec: ReturnType<typeof welcomePanel>) {
    return MessageFactory.attachment(CardFactory.adaptiveCard(renderCard(spec)));
  }
}

/** The compose-query text from a message-extension query's parameters. */
function queryText(query: MessagingExtensionQuery): string {
  const params = query.parameters ?? [];
  const values = params
    .map((p) => (typeof p.value === 'string' ? p.value : ''))
    .filter((v) => v.length > 0);
  return values.join(' ').trim();
}

/** The quick actions the manifest advertises; re-exported for the manifest step. */
export { QUICK_ACTIONS };
