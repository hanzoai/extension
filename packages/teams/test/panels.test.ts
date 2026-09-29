import { describe, it, expect } from 'vitest';
import { ActionId, PROMPT_INPUT_ID, ADAPTIVE_CARD_VERSION } from '@hanzo/cards';
import {
  welcomePanel,
  resultPanel,
  signedOutPanel,
  renderCard,
  systemPromptFor,
  QUICK_ACTIONS,
  QuickActionId,
} from '../src/panels';

const opts = { models: ['zen5-flash', 'zen5'], model: 'zen5-flash' };

// Walk an Adaptive Card body/actions tree collecting every element.type.
function collectTypes(card: ReturnType<typeof renderCard>): string[] {
  const types: string[] = [];
  const visit = (el: any) => {
    if (!el || typeof el !== 'object') return;
    if (typeof el.type === 'string') types.push(el.type);
    for (const key of ['body', 'items', 'columns', 'actions', 'choices']) {
      if (Array.isArray(el[key])) el[key].forEach(visit);
    }
  };
  card.body.forEach(visit);
  card.actions.forEach(visit);
  return types;
}

// Collect every `data.action` from Action.Submit elements in the card.
function collectActions(card: ReturnType<typeof renderCard>): string[] {
  const actions: string[] = [];
  const visit = (el: any) => {
    if (!el || typeof el !== 'object') return;
    if (el.type === 'Action.Submit' && el.data && typeof el.data.action === 'string') {
      actions.push(el.data.action);
    }
    for (const key of ['body', 'items', 'columns', 'actions']) {
      if (Array.isArray(el[key])) el[key].forEach(visit);
    }
  };
  card.body.forEach(visit);
  card.actions.forEach(visit);
  return actions;
}

describe('QUICK_ACTIONS', () => {
  it('are the four assistant actions with stable ids', () => {
    expect(QUICK_ACTIONS.map((a) => a.id)).toEqual([
      QuickActionId.Draft,
      QuickActionId.Summarize,
      QuickActionId.Explain,
      QuickActionId.ActionItems,
    ]);
  });
});

describe('systemPromptFor', () => {
  it('returns a prompt for each known action', () => {
    for (const id of Object.values(QuickActionId)) {
      expect(systemPromptFor(id)).toBeTypeOf('string');
    }
  });
  it('returns undefined for an unknown action', () => {
    expect(systemPromptFor('nope')).toBeUndefined();
  });
});

describe('welcomePanel → Adaptive Card', () => {
  const card = renderCard(welcomePanel(opts));

  it('is an AdaptiveCard at the expected schema version', () => {
    expect(card.type).toBe('AdaptiveCard');
    expect(card.version).toBe(ADAPTIVE_CARD_VERSION);
  });

  it('renders a model ChoiceSet keyed by ModelSelect with the choices', () => {
    const choiceSet = card.body.find(
      (el: any) => el.type === 'Input.ChoiceSet' && el.id === ActionId.ModelSelect,
    ) as any;
    expect(choiceSet).toBeDefined();
    expect(choiceSet.value).toBe('zen5-flash');
    expect(choiceSet.choices.map((c: any) => c.value)).toEqual(['zen5-flash', 'zen5']);
  });

  it('renders the prompt Input.Text keyed by PROMPT_INPUT_ID', () => {
    const types = collectTypes(card);
    expect(types).toContain('Input.Text');
    const input = card.body.find((el: any) => el.id === PROMPT_INPUT_ID);
    expect(input).toBeDefined();
  });

  it('emits a submit for each quick action plus the prompt submit', () => {
    const actions = collectActions(card);
    expect(actions).toContain(ActionId.PromptSubmit);
    for (const qa of QUICK_ACTIONS) {
      expect(actions).toContain(`${ActionId.QuickAction}:${qa.id}`);
    }
  });
});

describe('resultPanel → Adaptive Card', () => {
  it('includes the output text in the body', () => {
    const card = renderCard(resultPanel(opts, 'the answer'));
    const flat = JSON.stringify(card);
    expect(flat).toContain('the answer');
  });
});

describe('signedOutPanel → Adaptive Card', () => {
  const card = renderCard(signedOutPanel({ models: opts.models, model: opts.model }));

  it('shows a sign-in submit and hides the prompt/model widgets', () => {
    const actions = collectActions(card);
    expect(actions).toEqual([ActionId.SignIn]);
    const types = collectTypes(card);
    expect(types).not.toContain('Input.Text');
    expect(types).not.toContain('Input.ChoiceSet');
  });
});
