import { describe, it, expect } from 'vitest';
import {
  ActionId,
  PROMPT_INPUT_ID,
  ADAPTIVE_CARD_SCHEMA,
  ADAPTIVE_CARD_VERSION,
  toAdaptiveCard,
  type AdaptiveElement,
} from '../src';
import { richSpec, signedOutSpec } from './spec.test';

function findByType(items: AdaptiveElement[], type: string): AdaptiveElement[] {
  return items.filter((i) => i.type === type);
}

describe('toAdaptiveCard — envelope', () => {
  const card = toAdaptiveCard(richSpec);

  it('is a valid AdaptiveCard envelope', () => {
    expect(card.$schema).toBe(ADAPTIVE_CARD_SCHEMA);
    expect(card.type).toBe('AdaptiveCard');
    expect(card.version).toBe(ADAPTIVE_CARD_VERSION);
    expect(Array.isArray(card.body)).toBe(true);
    expect(Array.isArray(card.actions)).toBe(true);
  });

  it('is JSON-serializable', () => {
    expect(() => JSON.stringify(card)).not.toThrow();
  });
});

describe('toAdaptiveCard — signed in', () => {
  const card = toAdaptiveCard(richSpec);

  it('renders the title (with emoji icon inlined) as a bold TextBlock', () => {
    const title = findByType(card.body, 'TextBlock').find((t) =>
      String(t.text).includes('Hanzo Assistant'),
    );
    expect(title).toBeDefined();
    expect(title!.weight).toBe('Bolder');
    expect(String(title!.text)).toContain('🤖');
  });

  it('renders the subtitle as a subtle TextBlock', () => {
    const subtitle = findByType(card.body, 'TextBlock').find((t) => t.text === 'Frontier AI, everywhere');
    expect(subtitle).toBeDefined();
    expect(subtitle!.isSubtle).toBe(true);
  });

  it('renders the model picker as an Input.ChoiceSet with the current value', () => {
    const choiceSet = findByType(card.body, 'Input.ChoiceSet')[0]!;
    expect(choiceSet).toBeDefined();
    expect(choiceSet.id).toBe(ActionId.ModelSelect);
    expect(choiceSet.value).toBe('zen-omni-30b');
    const choices = choiceSet.choices as Array<{ title: string; value: string }>;
    expect(choices.map((c) => c.value)).toEqual(['zen-eco-3b', 'zen-omni-30b']);
    expect(choices[0]!.title).toBe('Zen Eco 3B');
  });

  it('renders quick actions as an ActionSet of Action.Submit', () => {
    const actionSet = findByType(card.body, 'ActionSet')[0]!;
    expect(actionSet).toBeDefined();
    const acts = actionSet.actions as Array<{ type: string; id: string; data: { action: string; chip: string }; style?: string }>;
    expect(acts).toHaveLength(3);
    expect(acts.every((a) => a.type === 'Action.Submit')).toBe(true);
    expect(acts[0]!.id).toBe(`${ActionId.QuickAction}:draft`);
    expect(acts[0]!.data.action).toBe(`${ActionId.QuickAction}:draft`);
    expect(acts[0]!.data.chip).toBe('draft');
    // Primary chip maps to positive style.
    expect(acts[0]!.style).toBe('positive');
    expect(acts[1]!.style).toBe('default');
  });

  it('renders the output in a Container with a wrapped TextBlock', () => {
    const container = findByType(card.body, 'Container')[0]!;
    expect(container).toBeDefined();
    const items = container.items as AdaptiveElement[];
    const text = findByType(items, 'TextBlock')[0]!;
    expect(text.text).toBe(richSpec.output);
    expect(text.wrap).toBe(true);
  });

  it('renders the prompt as a multiline Input.Text', () => {
    const input = findByType(card.body, 'Input.Text')[0]!;
    expect(input).toBeDefined();
    expect(input.id).toBe(PROMPT_INPUT_ID);
    expect(input.isMultiline).toBe(true);
  });

  it('renders a card-level submit action wired to PromptSubmit', () => {
    const submit = card.actions.find((a) => (a as { id?: string }).id === ActionId.PromptSubmit);
    expect(submit).toBeDefined();
    expect((submit as unknown as { data: { action: string } }).data.action).toBe(ActionId.PromptSubmit);
  });

  it('renders the footer as a subtle TextBlock', () => {
    const footer = findByType(card.body, 'TextBlock').find((t) => t.text === 'via api.hanzo.ai');
    expect(footer).toBeDefined();
    expect(footer!.isSubtle).toBe(true);
  });
});

describe('toAdaptiveCard — signed out', () => {
  const card = toAdaptiveCard(signedOutSpec);

  it('shows the sign-in prompt and a positive SignIn action, and no widgets', () => {
    const prompt = findByType(card.body, 'TextBlock').find((t) => t.text === signedOutSpec.signInPrompt);
    expect(prompt).toBeDefined();

    const signIn = card.actions.find((a) => (a as { id?: string }).id === ActionId.SignIn);
    expect(signIn).toBeDefined();
    expect((signIn as unknown as { style: string }).style).toBe('positive');

    // No interactive widgets in signed-out state.
    expect(findByType(card.body, 'Input.ChoiceSet')).toHaveLength(0);
    expect(findByType(card.body, 'Input.Text')).toHaveLength(0);
    expect(findByType(card.body, 'ActionSet')).toHaveLength(0);
  });
});

describe('toAdaptiveCard — image icon', () => {
  it('renders a URL icon as an Image inside a ColumnSet', () => {
    const card = toAdaptiveCard({ title: 'Hanzo', icon: 'https://hanzo.ai/logo.png', signedIn: true });
    const columnSet = findByType(card.body, 'ColumnSet')[0]!;
    expect(columnSet).toBeDefined();
    const cols = columnSet.columns as Array<{ items: AdaptiveElement[] }>;
    const image = cols.flatMap((c) => c.items).find((i) => i.type === 'Image');
    expect(image).toBeDefined();
    expect(image!.url).toBe('https://hanzo.ai/logo.png');
  });
});
