import { describe, it, expect } from 'vitest';
import { ActionId } from '@hanzo/cards';
import {
  assistantPanelSpec,
  assistantBlocks,
  resultPanelSpec,
  resultBlocks,
  homeView,
  quickActionChips,
  toModelOptions,
} from '../src/panels.js';
import { QUICK_ACTIONS } from '../src/hanzo.js';

const MODELS = [
  { id: 'zen5', fullName: 'Zen 5' },
  { id: 'zen3-omni', fullName: 'Zen3 Omni' },
];

function actionIds(blocks: Array<Record<string, unknown>>): string[] {
  const ids: string[] = [];
  for (const b of blocks) {
    const elements = (b as { elements?: Array<{ action_id?: string }> }).elements;
    if (Array.isArray(elements)) {
      for (const el of elements) if (el.action_id) ids.push(el.action_id);
    }
    const accessory = (b as { accessory?: { action_id?: string } }).accessory;
    if (accessory?.action_id) ids.push(accessory.action_id);
  }
  return ids;
}

describe('quickActionChips', () => {
  it('is derived from the single QUICK_ACTIONS catalog', () => {
    const chips = quickActionChips();
    expect(chips.map((c) => c.id).sort()).toEqual(Object.keys(QUICK_ACTIONS).sort());
    const summarize = chips.find((c) => c.id === 'summarize');
    expect(summarize?.label).toBe('Summarize');
    expect(summarize?.style).toBe('primary');
  });
});

describe('toModelOptions', () => {
  it('maps fullName to label, falling back to id', () => {
    expect(toModelOptions([{ id: 'a', fullName: 'Alpha' }, { id: 'b' }])).toEqual([
      { id: 'a', label: 'Alpha' },
      { id: 'b', label: 'b' },
    ]);
  });
});

describe('assistantPanelSpec', () => {
  it('assembles picker, quick actions, and input when signed in', () => {
    const spec = assistantPanelSpec({
      models: MODELS,
      selectedModel: 'zen3-omni',
      signedIn: true,
    });
    expect(spec.modelPicker?.value).toBe('zen3-omni');
    expect(spec.modelPicker?.options.map((o) => o.id)).toEqual(['zen5', 'zen3-omni']);
    expect(spec.quickActions?.length).toBe(Object.keys(QUICK_ACTIONS).length);
    expect(spec.input).toBeDefined();
    expect(spec.signedIn).toBe(true);
  });

  it('renders a signed-out panel with no interactive widgets', () => {
    const spec = assistantPanelSpec({ models: [], selectedModel: 'zen5', signedIn: false });
    expect(spec.signedIn).toBe(false);
    expect(spec.modelPicker).toBeUndefined();
    expect(spec.input).toBeUndefined();
  });

  it('shows output when provided', () => {
    const spec = assistantPanelSpec({
      models: MODELS,
      selectedModel: 'zen5',
      signedIn: true,
      output: 'the answer',
    });
    expect(spec.output).toBe('the answer');
  });
});

describe('assistantBlocks → @hanzo/cards Block Kit', () => {
  it('emits the stable action ids from the card contract', () => {
    const blocks = assistantBlocks({ models: MODELS, selectedModel: 'zen5', signedIn: true }) as Array<
      Record<string, unknown>
    >;
    const ids = actionIds(blocks);
    expect(ids).toContain(ActionId.ModelSelect);
    expect(ids).toContain(ActionId.PromptSubmit);
    expect(ids).toContain(`${ActionId.QuickAction}:summarize`);
    expect(ids).toContain(`${ActionId.QuickAction}:action_items`);
    // First block is a header.
    expect(blocks[0]!.type).toBe('header');
  });

  it('signed-out blocks carry the sign-in action id', () => {
    const blocks = assistantBlocks({ models: [], selectedModel: 'zen5', signedIn: false }) as Array<
      Record<string, unknown>
    >;
    expect(actionIds(blocks)).toContain(ActionId.SignIn);
  });
});

describe('resultPanelSpec / resultBlocks', () => {
  it('shows output, quick actions, and no input field', () => {
    const spec = resultPanelSpec('done', 'zen5');
    expect(spec.output).toBe('done');
    expect(spec.input).toBeUndefined();
    expect(spec.subtitle).toBe('zen5');
    const blocks = resultBlocks('done', 'zen5') as Array<Record<string, unknown>>;
    // No plain_text_input block in a result panel.
    expect(blocks.some((b) => b.type === 'input')).toBe(false);
    // Output text present.
    expect(JSON.stringify(blocks)).toContain('done');
  });
});

describe('homeView', () => {
  it('wraps assistant blocks in a home view', () => {
    const view = homeView({ models: MODELS, selectedModel: 'zen5', signedIn: true });
    expect(view.type).toBe('home');
    expect(Array.isArray(view.blocks)).toBe(true);
    expect(view.blocks[0]!.type).toBe('header');
  });
});
