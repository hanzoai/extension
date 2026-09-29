# @hanzo/cards

One canonical panel spec, three host card formats.

`@hanzo/cards` is the **presentation layer** for Hanzo's card-host chat surfaces
— Slack, Microsoft Teams, and Google Workspace. You describe a Hanzo assistant
panel once as a canonical **`PanelSpec`**, and each host emitter turns it into
that host's native card JSON. The assistant looks and behaves the same
everywhere while rendering host-natively.

It is a **pure library**: no network, no host SDK runtime dependencies, no
secrets. It does **not** call the AI or auth — those are `@hanzo/ai` (the
headless AI client) and `@hanzo/iam` (identity/tokens). `@hanzo/cards` only
shapes UI. A host adapter builds the `PanelSpec` (usually via `assistantPanel`),
calls the emitter, and posts the result with its own host SDK.

```
PanelSpec ──▶ toSlackBlocks     ──▶ Slack Block Kit blocks[]
          ──▶ toAdaptiveCard    ──▶ Teams Adaptive Card (v1.5)
          ──▶ toCardServiceJson ──▶ Google CardService JSON
```

## The `PanelSpec` model

`PanelSpec` covers everything a Hanzo assistant panel needs:

| Field | Purpose |
| --- | --- |
| `title`, `subtitle`, `icon` | Header. `icon` is an emoji (inlined into the title) or a URL (rendered as an image where the host supports it). |
| `modelPicker` | A model dropdown: `{ options: {id,label?}[], value, label? }`. Omit to hide. |
| `quickActions` | Chips/buttons: `{ id, label, style? }[]` (e.g. Draft / Summarize / Explain). |
| `output` | **Final** AI text as markdown (see streaming note below). |
| `input` | Freeform prompt + submit: `{ placeholder?, value?, submitLabel?, multiline? }`. |
| `footer` | Context footer, e.g. `via api.hanzo.ai`. |
| `signedIn` | When `false`, renders a signed-out state: a sign-in prompt + button replace the widgets. |
| `signInPrompt`, `signInLabel` | Text for the signed-out state. |

> **Streaming.** Card hosts are non-streaming. `output` is the **final** AI
> text, never a partial stream. If your adapter streams, render intermediate
> text in your own surface and build a `PanelSpec` only for the finished result.

### Stable action ids

Every emitted card wires interactions to **stable action id strings** — the
contract between `@hanzo/cards` and your host handler. They are exported as
`ActionId`:

| `ActionId` | Fires when |
| --- | --- |
| `hanzo_model_select` | User picks a model (value = model id). |
| `hanzo_prompt_submit` | User submits the prompt input. |
| `hanzo_quick_action` | User clicks a chip. Emitted as `hanzo_quick_action:<chipId>`. |
| `hanzo_sign_in` | User clicks sign-in (signed-out state). |

The prompt input field id is `PROMPT_INPUT_ID` (`hanzo_prompt`).

### Building a spec

Use the `assistantPanel` builder so adapters don't hand-assemble:

```ts
import { assistantPanel } from '@hanzo/cards';

const spec = assistantPanel({
  models: ['zen5-flash', { id: 'zen5', label: 'Zen5' }],
  model: 'zen5',                 // selected; defaults to the first model
  actions: [
    { id: 'draft', label: 'Draft', style: 'primary' },
    { id: 'summarize', label: 'Summarize' },
  ],
  output: '**Summary**\n- point one\n- point two',
  footer: 'via api.hanzo.ai',            // default
  signedIn: true,                        // default
});
```

`assistantPanel({ signedIn: false })` yields the signed-out panel. You can also
construct a `PanelSpec` object literal directly — the emitters take either.

## Emitters

### `toSlackBlocks(spec) → SlackBlock[]`

Slack Block Kit. Emits `header` / `section` for text, an `actions` block of
`button`s for chips, a `section` with a `static_select` accessory for the model
picker, an `input` block (`plain_text_input`, dispatching) for the prompt,
`context` for the footer, and `divider`s. Pass it straight to `chat.postMessage`
as `blocks`.

### `toAdaptiveCard(spec) → AdaptiveCard`

Microsoft Teams Adaptive Card (schema v1.5). Emits the
`{$schema, type:"AdaptiveCard", version, body, actions}` envelope with
`TextBlock`, `Input.ChoiceSet` (model picker), `ActionSet` of `Action.Submit`
(chips), `Container` (output), and `Input.Text` (prompt). Each `Action.Submit`
carries `data.action` = the stable ActionId so one handler dispatches uniformly.
Attach it as an `application/vnd.microsoft.card.adaptive` attachment.

### `toCardServiceJson(spec) → CardServiceJson`

Google Workspace CardService. Apps Script's `CardService` builds cards from
**runtime objects**, not JSON, so this emitter produces a documented declarative
shape (`header` + `sections[].widgets[]`) that an Apps Script host maps to the
matching `CardService.new*` calls. Widget `type` → factory:

| `type` | CardService factory |
| --- | --- |
| `textParagraph` | `newTextParagraph()` |
| `selectionInput` (`DROPDOWN`) | `newSelectionInput().setType(DROPDOWN)` |
| `textInput` | `newTextInput()` |
| `buttonList` | `newButtonSet()` of `newTextButton()` |
| `divider` | `newDivider()` |

Every action node carries `functionName` (the single dispatcher callback,
`CALLBACK_FUNCTION` = `onHanzoAction`) and `parameters` (`action` = the stable
ActionId + payload).

## How a host adapter consumes it

A host adapter imports the emitters, builds a spec, and posts with its own SDK.

### Slack

```ts
import { assistantPanel, toSlackBlocks, ActionId, PROMPT_INPUT_ID } from '@hanzo/cards';
import { WebClient } from '@slack/web-api';           // host SDK, not a dep of @hanzo/cards
import { createAiClient } from '@hanzo/ai';            // the AI client lives in the adapter

const slack = new WebClient(botToken);
const ai = createAiClient({ token });                  // defaults to https://api.hanzo.ai

// Render a panel:
const spec = assistantPanel({ models: ['zen5'], actions: [{ id: 'draft', label: 'Draft' }] });
await slack.chat.postMessage({ channel, blocks: toSlackBlocks(spec) });

// Handle interactions (Bolt-style): the action_id tells you what happened.
app.action(ActionId.PromptSubmit, async ({ ack, body, respond }) => {
  await ack();
  const prompt = body.state.values[`${PROMPT_INPUT_ID}_block`][PROMPT_INPUT_ID].value;
  const res = await ai.chat.completions.create({
    model: 'zen5',
    messages: [{ role: 'user', content: prompt }],
  });
  const answer = res.choices[0].message.content;
  await respond({ blocks: toSlackBlocks(assistantPanel({ models: ['zen5'], output: answer })) });
});
```

### Microsoft Teams

```ts
import { assistantPanel, toAdaptiveCard } from '@hanzo/cards';
import { CardFactory } from 'botbuilder';               // host SDK

async function sendPanel(context, output: string) {
  const card = toAdaptiveCard(assistantPanel({ models: ['zen5'], output }));
  await context.sendActivity({ attachments: [CardFactory.adaptiveCard(card)] });
}

// On a submit, `activity.value.action` is the stable ActionId; dispatch on it.
```

### Google Workspace (Apps Script)

The JSON from `toCardServiceJson` is generated server-side (or bundled) and the
Apps Script host walks `sections[].widgets[]`, calling the matching
`CardService.new*` factory for each `type` and binding every `onClick`/`onChange`
action to the single `onHanzoAction(e)` callback, dispatching on
`e.parameters.action`.

## Development

```sh
pnpm install --ignore-workspace
pnpm typecheck   # tsc --noEmit
pnpm test        # vitest run
pnpm build       # tsup → dist (cjs + esm + d.ts)
```
