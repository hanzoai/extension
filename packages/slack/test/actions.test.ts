import { describe, it, expect } from 'vitest';
import { ActionId } from '@hanzo/cards';
import { parseActionId, quickActionIdFrom, QUICK_ACTION_RE } from '../src/actions.js';

describe('parseActionId', () => {
  it('classifies the four stable card action ids', () => {
    expect(parseActionId(ActionId.ModelSelect)).toEqual({ kind: 'model_select' });
    expect(parseActionId(ActionId.PromptSubmit)).toEqual({ kind: 'prompt_submit' });
    expect(parseActionId(ActionId.SignIn)).toEqual({ kind: 'sign_in' });
  });

  it('classifies quick actions and pulls the id', () => {
    expect(parseActionId('hanzo_quick_action:summarize')).toEqual({
      kind: 'quick_action',
      id: 'summarize',
    });
    expect(parseActionId('hanzo_quick_action:draft_reply')).toEqual({
      kind: 'quick_action',
      id: 'draft_reply',
    });
  });

  it('reports unknown ids without throwing', () => {
    expect(parseActionId('something_else')).toEqual({
      kind: 'unknown',
      actionId: 'something_else',
    });
  });

  it('uses the card contract action id, not a hard-coded string', () => {
    expect(ActionId.ModelSelect).toBe('hanzo_model_select');
    expect(ActionId.QuickAction).toBe('hanzo_quick_action');
  });
});

describe('quickActionIdFrom / QUICK_ACTION_RE', () => {
  it('extracts the id or returns null', () => {
    expect(quickActionIdFrom('hanzo_quick_action:explain')).toBe('explain');
    expect(quickActionIdFrom('hanzo_model_select')).toBeNull();
  });

  it('regex matches only the quick-action namespace', () => {
    expect(QUICK_ACTION_RE.test('hanzo_quick_action:x')).toBe(true);
    expect(QUICK_ACTION_RE.test('hanzo_prompt_submit')).toBe(false);
  });
});
