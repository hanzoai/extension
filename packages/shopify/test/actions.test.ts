import { describe, it, expect } from 'vitest';
import type { AiClient } from '@hanzo/ai';
import {
  PRODUCT_ACTIONS,
  ORDER_ACTIONS,
  isProductActionId,
  isOrderActionId,
  productActionPrompt,
  orderActionPrompt,
  productActionList,
  orderActionList,
  runProductAction,
  runOrderAction,
} from '../src/server/actions';
import type { ProductInfo, OrderInfo } from '../src/server/shopify-api';

const PRODUCT: ProductInfo = {
  id: 'gid://shopify/Product/1',
  title: 'Wool Beanie',
  handle: 'wool-beanie',
  descriptionHtml: '<p>Warm.</p>',
  description: 'Warm.',
  productType: 'Hats',
  vendor: 'Acme',
  tags: [],
  status: 'ACTIVE',
  seoTitle: '',
  seoDescription: '',
  options: [],
  variants: [],
};

const ORDER: OrderInfo = {
  id: 'gid://shopify/Order/2',
  name: '#1002',
  note: '',
  email: '',
  financialStatus: 'PAID',
  fulfillmentStatus: 'UNFULFILLED',
  createdAt: '',
  totalAmount: '10.00',
  currency: 'USD',
  customerName: 'Sam',
  shipTo: '',
  lineItems: [],
};

function capturingClient(): { client: AiClient; lastTask: () => string } {
  let lastMessages: any[] = [];
  const client = {
    chat: {
      completions: {
        create: async (params: any) => {
          lastMessages = params.messages;
          return { id: 'x', object: 'chat.completion', created: 0, model: params.model, choices: [{ index: 0, message: { role: 'assistant', content: 'ok' }, finish_reason: 'stop' }] };
        },
      },
    },
    models: { list: async () => [] },
  } as unknown as AiClient;
  // the task is the tail after "---- task ----\n"
  const lastTask = () => String(lastMessages[1]?.content ?? '').split('---- task ----\n')[1] ?? '';
  return { client, lastTask };
}

describe('action catalogs', () => {
  it('product actions expose the four content actions', () => {
    expect(Object.keys(PRODUCT_ACTIONS)).toEqual([
      'writeDescription',
      'rewriteDescription',
      'seoTitle',
      'seoDescription',
    ]);
  });
  it('order actions expose summarize / draftReply / extractIssues', () => {
    expect(Object.keys(ORDER_ACTIONS)).toEqual(['summarize', 'draftReply', 'extractIssues']);
  });
  it('lists are derived from the catalogs (labels never drift)', () => {
    expect(productActionList().map((a) => a.id)).toEqual(Object.keys(PRODUCT_ACTIONS));
    expect(orderActionList().map((a) => a.id)).toEqual(Object.keys(ORDER_ACTIONS));
    expect(productActionList()[0].label).toBe(PRODUCT_ACTIONS.writeDescription.label);
  });
});

describe('id guards', () => {
  it('narrow known ids and reject unknown', () => {
    expect(isProductActionId('writeDescription')).toBe(true);
    expect(isProductActionId('summarize')).toBe(false);
    expect(isOrderActionId('summarize')).toBe(true);
    expect(isOrderActionId('writeDescription')).toBe(false);
  });
});

describe('prompt resolution', () => {
  it('resolves a known product/order prompt', () => {
    expect(productActionPrompt('seoTitle')).toBe(PRODUCT_ACTIONS.seoTitle.prompt);
    expect(orderActionPrompt('draftReply')).toBe(ORDER_ACTIONS.draftReply.prompt);
  });
  it('throws on an unknown id', () => {
    expect(() => productActionPrompt('nope')).toThrow(/Unknown product action/);
    expect(() => orderActionPrompt('nope')).toThrow(/Unknown order action/);
  });
});

describe('runProductAction / runOrderAction', () => {
  it('runs the resolved prompt over the subject as the task', async () => {
    const p = capturingClient();
    await runProductAction('seoTitle', PRODUCT, { client: p.client });
    expect(p.lastTask()).toBe(PRODUCT_ACTIONS.seoTitle.prompt);

    const o = capturingClient();
    await runOrderAction('summarize', ORDER, { client: o.client });
    expect(o.lastTask()).toBe(ORDER_ACTIONS.summarize.prompt);
  });
  it('rejects (not throws synchronously) on an unknown id', async () => {
    await expect(runProductAction('nope', PRODUCT)).rejects.toThrow(/Unknown product action/);
    await expect(runOrderAction('nope', ORDER)).rejects.toThrow(/Unknown order action/);
  });
});
