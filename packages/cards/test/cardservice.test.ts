import { describe, it, expect } from 'vitest';
import {
  ActionId,
  PROMPT_INPUT_ID,
  CALLBACK_FUNCTION,
  toCardServiceJson,
  type CardWidget,
  type CardSection,
} from '../src';
import { richSpec, signedOutSpec } from './spec.test';

function widgets(sections: CardSection[]): CardWidget[] {
  return sections.flatMap((s) => s.widgets);
}
function widgetOfType(sections: CardSection[], type: CardWidget['type']): CardWidget[] {
  return widgets(sections).filter((w) => w.type === type);
}

describe('toCardServiceJson — signed in', () => {
  const card = toCardServiceJson(richSpec);

  it('has a header and sections array', () => {
    expect(card.header).toBeDefined();
    expect(Array.isArray(card.sections)).toBe(true);
    expect(card.sections.length).toBeGreaterThan(0);
  });

  it('renders the title (emoji icon inlined) and subtitle', () => {
    expect(card.header.title).toContain('Hanzo Assistant');
    expect(card.header.title).toContain('🤖');
    expect(card.header.subtitle).toBe('Frontier AI, everywhere');
  });

  it('renders the model picker as a DROPDOWN selectionInput with the current selection', () => {
    const sel = widgetOfType(card.sections, 'selectionInput')[0]!;
    expect(sel).toBeDefined();
    expect(sel.selectionType).toBe('DROPDOWN');
    expect(sel.fieldName).toBe(ActionId.ModelSelect);
    const items = sel.items as Array<{ value: string; selected: boolean }>;
    expect(items.map((i) => i.value)).toEqual(['zen-eco-3b', 'zen-omni-30b']);
    expect(items.find((i) => i.value === 'zen-omni-30b')!.selected).toBe(true);
    expect(items.find((i) => i.value === 'zen-eco-3b')!.selected).toBe(false);
    // onChange routes to the dispatcher with the ModelSelect action.
    const onChange = sel.onChangeAction as { functionName: string; parameters: { action: string } };
    expect(onChange.functionName).toBe(CALLBACK_FUNCTION);
    expect(onChange.parameters.action).toBe(ActionId.ModelSelect);
  });

  it('renders quick actions as a buttonList wired to per-chip actions', () => {
    const buttonLists = widgetOfType(card.sections, 'buttonList');
    const chipList = buttonLists.find((bl) =>
      (bl.buttons as Array<{ onClick: { parameters: { action: string } } }>).some((b) =>
        b.onClick.parameters.action.startsWith(ActionId.QuickAction),
      ),
    );
    expect(chipList).toBeDefined();
    const buttons = chipList!.buttons as Array<{
      text: string;
      filled: boolean;
      onClick: { functionName: string; parameters: { action: string; chip: string } };
    }>;
    expect(buttons).toHaveLength(3);
    expect(buttons.map((b) => b.text)).toEqual(['Draft', 'Summarize', 'Explain']);
    expect(buttons[0]!.filled).toBe(true); // primary
    expect(buttons[1]!.filled).toBe(false);
    expect(buttons[0]!.onClick.functionName).toBe(CALLBACK_FUNCTION);
    expect(buttons[0]!.onClick.parameters.action).toBe(`${ActionId.QuickAction}:draft`);
    expect(buttons[0]!.onClick.parameters.chip).toBe('draft');
  });

  it('renders the output as a textParagraph', () => {
    const paras = widgetOfType(card.sections, 'textParagraph');
    expect(paras.some((p) => p.text === richSpec.output)).toBe(true);
  });

  it('renders the prompt input as a textInput and a submit button', () => {
    const textInput = widgetOfType(card.sections, 'textInput')[0]!;
    expect(textInput).toBeDefined();
    expect(textInput.fieldName).toBe(PROMPT_INPUT_ID);
    expect(textInput.multiline).toBe(true);

    const submit = widgetOfType(card.sections, 'buttonList')
      .flatMap((bl) => bl.buttons as Array<{ onClick: { parameters: { action: string } } }>)
      .find((b) => b.onClick.parameters.action === ActionId.PromptSubmit);
    expect(submit).toBeDefined();
  });

  it('renders the footer as a textParagraph', () => {
    const paras = widgetOfType(card.sections, 'textParagraph');
    expect(paras.some((p) => p.text === 'via api.hanzo.ai')).toBe(true);
  });

  it('is JSON-serializable', () => {
    expect(() => JSON.stringify(card)).not.toThrow();
  });
});

describe('toCardServiceJson — signed out', () => {
  const card = toCardServiceJson(signedOutSpec);

  it('shows the sign-in prompt and a SignIn button, no widgets', () => {
    const paras = widgetOfType(card.sections, 'textParagraph');
    expect(paras.some((p) => p.text === signedOutSpec.signInPrompt)).toBe(true);

    const signIn = widgetOfType(card.sections, 'buttonList')
      .flatMap((bl) => bl.buttons as Array<{ onClick: { parameters: { action: string } } }>)
      .find((b) => b.onClick.parameters.action === ActionId.SignIn);
    expect(signIn).toBeDefined();

    expect(widgetOfType(card.sections, 'selectionInput')).toHaveLength(0);
    expect(widgetOfType(card.sections, 'textInput')).toHaveLength(0);
  });
});

describe('toCardServiceJson — image icon', () => {
  it('renders a URL icon as header.imageUrl and keeps the plain title', () => {
    const card = toCardServiceJson({ title: 'Hanzo', icon: 'https://hanzo.ai/logo.png', signedIn: true });
    expect(card.header.imageUrl).toBe('https://hanzo.ai/logo.png');
    expect(card.header.title).toBe('Hanzo');
  });
});
