import { describe, it, expect } from 'vitest';
import { ActionId, PROMPT_INPUT_ID, toSlackBlocks, type SlackBlock } from '../src';
import { richSpec, signedOutSpec } from './spec.test';

function byType(blocks: SlackBlock[], type: string): SlackBlock[] {
  return blocks.filter((b) => b.type === type);
}

describe('toSlackBlocks — signed in', () => {
  const blocks = toSlackBlocks(richSpec);

  it('emits a header block carrying the title (with emoji icon inlined)', () => {
    const header = byType(blocks, 'header')[0]!;
    expect(header).toBeDefined();
    expect(header.text).toMatchObject({ type: 'plain_text' });
    expect((header.text as { text: string }).text).toContain('Hanzo Assistant');
    expect((header.text as { text: string }).text).toContain('🤖');
  });

  it('renders the subtitle in a context block', () => {
    const contexts = byType(blocks, 'context');
    const hasSubtitle = contexts.some((c) =>
      (c.elements as Array<{ text?: string }>).some((e) => e.text === 'Frontier AI, everywhere'),
    );
    expect(hasSubtitle).toBe(true);
  });

  it('renders the model picker as a section with a static_select accessory', () => {
    const section = byType(blocks, 'section').find(
      (s) => (s.accessory as { type?: string } | undefined)?.type === 'static_select',
    );
    expect(section).toBeDefined();
    const acc = section!.accessory as {
      type: string;
      action_id: string;
      options: Array<{ value: string }>;
      initial_option: { value: string };
    };
    expect(acc.type).toBe('static_select');
    expect(acc.action_id).toBe(ActionId.ModelSelect);
    expect(acc.options.map((o) => o.value)).toEqual(['zen-eco-3b', 'zen-omni-30b']);
    // Initial option reflects the current value.
    expect(acc.initial_option.value).toBe('zen-omni-30b');
  });

  it('renders quick actions as buttons in an actions block', () => {
    const actionBlocks = byType(blocks, 'actions');
    const chipBlock = actionBlocks.find((a) =>
      (a.elements as Array<{ action_id: string }>).some((e) => e.action_id.startsWith(ActionId.QuickAction)),
    );
    expect(chipBlock).toBeDefined();
    const els = chipBlock!.elements as Array<{ type: string; value: string; action_id: string; style?: string }>;
    expect(els).toHaveLength(3);
    expect(els.map((e) => e.type)).toEqual(['button', 'button', 'button']);
    expect(els.map((e) => e.value)).toEqual(['draft', 'summarize', 'explain']);
    // Stable per-chip action id.
    expect(els[0]!.action_id).toBe(`${ActionId.QuickAction}:draft`);
    // Primary style is carried through.
    expect(els[0]!.style).toBe('primary');
    expect(els[1]!.style).toBeUndefined();
  });

  it('renders the output as an mrkdwn section', () => {
    const outputSection = byType(blocks, 'section').find(
      (s) => (s.text as { text?: string } | undefined)?.text === richSpec.output,
    );
    expect(outputSection).toBeDefined();
    expect((outputSection!.text as { type: string }).type).toBe('mrkdwn');
  });

  it('renders the prompt input block with a dispatching plain_text_input', () => {
    const input = byType(blocks, 'input')[0]!;
    expect(input).toBeDefined();
    const el = input.element as { type: string; action_id: string; multiline: boolean };
    expect(el.type).toBe('plain_text_input');
    expect(el.action_id).toBe(PROMPT_INPUT_ID);
    expect(el.multiline).toBe(true);
  });

  it('renders a submit button wired to PromptSubmit', () => {
    const submit = byType(blocks, 'actions')
      .flatMap((a) => a.elements as Array<{ action_id: string }>)
      .find((e) => e.action_id === ActionId.PromptSubmit);
    expect(submit).toBeDefined();
  });

  it('renders the footer in a trailing context block', () => {
    const contexts = byType(blocks, 'context');
    const footer = contexts.some((c) =>
      (c.elements as Array<{ text?: string }>).some((e) => e.text === 'via api.hanzo.ai'),
    );
    expect(footer).toBe(true);
  });

  it('includes divider blocks for visual separation', () => {
    expect(byType(blocks, 'divider').length).toBeGreaterThan(0);
  });

  it('produces JSON-serializable blocks', () => {
    expect(() => JSON.stringify(blocks)).not.toThrow();
  });
});

describe('toSlackBlocks — signed out', () => {
  const blocks = toSlackBlocks(signedOutSpec);

  it('shows the sign-in prompt and a SignIn button, and no widgets', () => {
    const section = byType(blocks, 'section').find(
      (s) => (s.text as { text?: string } | undefined)?.text === signedOutSpec.signInPrompt,
    );
    expect(section).toBeDefined();

    const signIn = byType(blocks, 'actions')
      .flatMap((a) => a.elements as Array<{ action_id: string; style?: string }>)
      .find((e) => e.action_id === ActionId.SignIn);
    expect(signIn).toBeDefined();
    expect(signIn!.style).toBe('primary');

    // No model picker / input in signed-out state.
    const hasSelect = byType(blocks, 'section').some(
      (s) => (s.accessory as { type?: string } | undefined)?.type === 'static_select',
    );
    expect(hasSelect).toBe(false);
    expect(byType(blocks, 'input')).toHaveLength(0);
  });
});

describe('toSlackBlocks — image icon', () => {
  it('renders a URL icon as an image element in a context block', () => {
    const blocks = toSlackBlocks({ title: 'Hanzo', icon: 'https://hanzo.ai/logo.png', signedIn: true });
    const imageCtx = byType(blocks, 'context').find((c) =>
      (c.elements as Array<{ type: string }>).some((e) => e.type === 'image'),
    );
    expect(imageCtx).toBeDefined();
  });
});
