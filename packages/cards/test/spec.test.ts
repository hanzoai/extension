import { describe, it, expect } from 'vitest';
import { ActionId, PROMPT_INPUT_ID, assistantPanel, type PanelSpec } from '../src';

describe('ActionId contract', () => {
  it('exposes stable string ids', () => {
    expect(ActionId.ModelSelect).toBe('hanzo_model_select');
    expect(ActionId.PromptSubmit).toBe('hanzo_prompt_submit');
    expect(ActionId.QuickAction).toBe('hanzo_quick_action');
    expect(ActionId.SignIn).toBe('hanzo_sign_in');
    expect(PROMPT_INPUT_ID).toBe('hanzo_prompt');
  });
});

describe('assistantPanel', () => {
  it('builds a full signed-in panel from minimal input', () => {
    const spec = assistantPanel({
      models: ['zen-eco-3b', { id: 'zen-omni-30b', label: 'Zen Omni 30B' }],
      actions: [{ id: 'draft', label: 'Draft' }],
      output: '# Result\nhello',
    });

    expect(spec.title).toBe('Hanzo Assistant');
    expect(spec.signedIn).toBe(true);
    expect(spec.modelPicker?.options).toHaveLength(2);
    // First model becomes the default selection.
    expect(spec.modelPicker?.value).toBe('zen-eco-3b');
    // String models normalize to ModelOption.
    expect(spec.modelPicker?.options[0]).toEqual({ id: 'zen-eco-3b' });
    expect(spec.modelPicker?.options[1]).toEqual({ id: 'zen-omni-30b', label: 'Zen Omni 30B' });
    expect(spec.quickActions).toEqual([{ id: 'draft', label: 'Draft' }]);
    expect(spec.output).toBe('# Result\nhello');
    expect(spec.input).toMatchObject({ submitLabel: 'Send', multiline: true });
    expect(spec.footer).toBe('via api.hanzo.ai');
  });

  it('honors an explicit selected model', () => {
    const spec = assistantPanel({ models: ['a', 'b', 'c'], model: 'b' });
    expect(spec.modelPicker?.value).toBe('b');
  });

  it('omits the model picker when no models given', () => {
    const spec = assistantPanel({ output: 'hi' });
    expect(spec.modelPicker).toBeUndefined();
  });

  it('hides the input when input is false', () => {
    const spec = assistantPanel({ models: ['a'], input: false });
    expect(spec.input).toBeUndefined();
  });

  it('merges custom input options over defaults', () => {
    const spec = assistantPanel({ models: ['a'], input: { placeholder: 'Type…', submitLabel: 'Go' } });
    expect(spec.input).toEqual({ placeholder: 'Type…', submitLabel: 'Go', multiline: true });
  });

  it('produces a signed-out panel with a sign-in prompt', () => {
    const spec = assistantPanel({ signedIn: false });
    expect(spec.signedIn).toBe(false);
    expect(spec.modelPicker).toBeUndefined();
    expect(spec.quickActions).toBeUndefined();
    expect(spec.input).toBeUndefined();
    expect(spec.signInPrompt).toMatch(/sign in/i);
    expect(spec.signInLabel).toBe('Sign in');
    expect(spec.footer).toBe('via api.hanzo.ai');
  });

  it('lets callers override title, footer, and sign-in prompt', () => {
    const signedOut = assistantPanel({ title: 'Zoo', footer: 'via api.zoo.ngo', signedIn: false, signInPrompt: 'Connect Zoo' });
    expect(signedOut.title).toBe('Zoo');
    expect(signedOut.footer).toBe('via api.zoo.ngo');
    expect(signedOut.signInPrompt).toBe('Connect Zoo');
  });
});

/** A representative fully-populated spec reused across emitter tests. */
export const richSpec: PanelSpec = {
  title: 'Hanzo Assistant',
  subtitle: 'Frontier AI, everywhere',
  icon: '🤖',
  modelPicker: {
    label: 'Model',
    value: 'zen-omni-30b',
    options: [
      { id: 'zen-eco-3b', label: 'Zen Eco 3B' },
      { id: 'zen-omni-30b', label: 'Zen Omni 30B' },
    ],
  },
  quickActions: [
    { id: 'draft', label: 'Draft', style: 'primary' },
    { id: 'summarize', label: 'Summarize' },
    { id: 'explain', label: 'Explain' },
  ],
  output: '**Summary**\n- point one\n- point two',
  input: { placeholder: 'Ask Hanzo…', submitLabel: 'Send', multiline: true },
  footer: 'via api.hanzo.ai',
  signedIn: true,
};

export const signedOutSpec: PanelSpec = {
  title: 'Hanzo Assistant',
  footer: 'via api.hanzo.ai',
  signedIn: false,
  signInPrompt: 'Sign in to Hanzo to use the assistant.',
  signInLabel: 'Sign in',
};
