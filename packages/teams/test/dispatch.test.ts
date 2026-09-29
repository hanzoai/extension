import { describe, it, expect } from 'vitest';
import { ActionId, PROMPT_INPUT_ID } from '@hanzo/cards';
import {
  dispatch,
  selectedModel,
  promptText,
  type SubmitData,
} from '../src/dispatch';

// Build a submit payload the way an Adaptive Card returns one: `data.action`
// plus the input fields keyed by their card ids.
function submit(action: string, extra: SubmitData = {}): SubmitData {
  return { action, ...extra };
}

describe('selectedModel / promptText', () => {
  it('reads the model picker value by ActionId.ModelSelect', () => {
    expect(selectedModel({ [ActionId.ModelSelect]: 'zen5' })).toBe('zen5');
    expect(selectedModel({})).toBeUndefined();
    expect(selectedModel({ [ActionId.ModelSelect]: '' })).toBeUndefined();
  });

  it('reads and trims the prompt input by PROMPT_INPUT_ID', () => {
    expect(promptText({ [PROMPT_INPUT_ID]: '  hi  ' })).toBe('hi');
    expect(promptText({ [PROMPT_INPUT_ID]: '   ' })).toBeUndefined();
    expect(promptText({})).toBeUndefined();
  });
});

describe('dispatch', () => {
  it('routes the sign-in action', () => {
    expect(dispatch(submit(ActionId.SignIn))).toEqual({ kind: 'sign_in' });
  });

  it('routes a model select carrying the picker value', () => {
    const data = submit(ActionId.ModelSelect, { [ActionId.ModelSelect]: 'zen5-mini' });
    expect(dispatch(data)).toEqual({ kind: 'model_select', model: 'zen5-mini' });
  });

  it('treats a model select with no value as unknown', () => {
    expect(dispatch(submit(ActionId.ModelSelect))).toEqual({
      kind: 'unknown',
      action: ActionId.ModelSelect,
    });
  });

  it('routes a prompt submit with the input text and selected model', () => {
    const data = submit(ActionId.PromptSubmit, {
      [PROMPT_INPUT_ID]: 'Explain OIDC',
      [ActionId.ModelSelect]: 'zen5',
    });
    expect(dispatch(data)).toEqual({
      kind: 'prompt',
      prompt: 'Explain OIDC',
      model: 'zen5',
    });
  });

  it('routes a prompt submit without a model when none selected', () => {
    const data = submit(ActionId.PromptSubmit, { [PROMPT_INPUT_ID]: 'hello' });
    expect(dispatch(data)).toEqual({ kind: 'prompt', prompt: 'hello' });
  });

  it('treats an empty prompt submit as unknown', () => {
    const data = submit(ActionId.PromptSubmit, { [PROMPT_INPUT_ID]: '   ' });
    expect(dispatch(data)).toEqual({ kind: 'unknown', action: ActionId.PromptSubmit });
  });

  it('routes a quick action from the prefixed action id and chip field', () => {
    // @hanzo/cards emits `hanzo_quick_action:<chip>` with data.chip = <chip>.
    const action = `${ActionId.QuickAction}:summarize`;
    const data = submit(action, { chip: 'summarize' });
    expect(dispatch(data)).toEqual({ kind: 'quick_action', chip: 'summarize' });
  });

  it('derives the chip from the action suffix when data.chip is absent', () => {
    const action = `${ActionId.QuickAction}:draft`;
    expect(dispatch(submit(action))).toEqual({ kind: 'quick_action', chip: 'draft' });
  });

  it('carries the prompt and model along with a quick action', () => {
    const action = `${ActionId.QuickAction}:action_items`;
    const data = submit(action, {
      chip: 'action_items',
      [PROMPT_INPUT_ID]: 'focus on blockers',
      [ActionId.ModelSelect]: 'zen5-flash',
    });
    expect(dispatch(data)).toEqual({
      kind: 'quick_action',
      chip: 'action_items',
      prompt: 'focus on blockers',
      model: 'zen5-flash',
    });
  });

  it('returns unknown for an unrecognized action', () => {
    expect(dispatch(submit('something_else'))).toEqual({
      kind: 'unknown',
      action: 'something_else',
    });
  });

  it('returns unknown with no action for an empty payload', () => {
    expect(dispatch({})).toEqual({ kind: 'unknown' });
  });
});
