import { describe, it, expect } from 'vitest';
import type { AiClient } from '@hanzo/ai';
import {
  SYSTEM_PROMPT,
  stripHtml,
  buildProductContext,
  buildOrderContext,
  buildProductMessages,
  buildOrderMessages,
  runChat,
  askProduct,
  askOrder,
  listModels,
  type ChatMessage,
} from '../src/server/hanzo';
import type { ProductInfo, OrderInfo } from '../src/server/shopify-api';

const PRODUCT: ProductInfo = {
  id: 'gid://shopify/Product/1',
  title: 'Wool Beanie',
  handle: 'wool-beanie',
  descriptionHtml: '<p>A <strong>warm</strong> wool beanie.</p>',
  description: 'A warm wool beanie.',
  productType: 'Hats',
  vendor: 'Acme',
  tags: ['winter', 'wool'],
  status: 'ACTIVE',
  seoTitle: 'Wool Beanie',
  seoDescription: 'Warm wool beanie',
  options: [{ name: 'Color', values: ['Black', 'Grey'] }],
  variants: [{ title: 'Black', sku: 'WB-BLK', price: '24.00' }],
};

const ORDER: OrderInfo = {
  id: 'gid://shopify/Order/2',
  name: '#1002',
  note: 'Customer asked to expedite.',
  email: 'buyer@example.com',
  financialStatus: 'PAID',
  fulfillmentStatus: 'UNFULFILLED',
  createdAt: '2026-01-02T10:00:00Z',
  totalAmount: '48.00',
  currency: 'USD',
  customerName: 'Sam Lee',
  shipTo: 'Austin, Texas, United States',
  lineItems: [{ title: 'Wool Beanie', quantity: 2, sku: 'WB-BLK' }],
};

// A fake AiClient capturing the params passed to chat.completions.create and
// models.list. This is how we assert request shaping without a network.
function fakeClient(reply: string, models: string[] = ['zen5', 'zen5-mini']): {
  client: AiClient;
  calls: { params: any; options: any }[];
  modelCalls: number;
} {
  const calls: { params: any; options: any }[] = [];
  let modelCalls = 0;
  const client = {
    chat: {
      completions: {
        create: async (params: any, options: any) => {
          calls.push({ params, options });
          return {
            id: 'x',
            object: 'chat.completion',
            created: 0,
            model: params.model,
            choices: [{ index: 0, message: { role: 'assistant', content: reply }, finish_reason: 'stop' }],
          };
        },
      },
    },
    models: {
      list: async () => {
        modelCalls++;
        return models.map((id) => ({ id, object: 'model' }));
      },
    },
  } as unknown as AiClient;
  return { client, calls, get modelCalls() { return modelCalls; } } as any;
}

describe('stripHtml', () => {
  it('drops tags and decodes basic entities', () => {
    expect(stripHtml('<p>A <strong>warm</strong> &amp; cozy hat.</p>')).toBe('A warm & cozy hat.');
  });
});

describe('buildProductContext', () => {
  it('renders structured attributes + the stripped current description', () => {
    const ctx = buildProductContext(PRODUCT);
    expect(ctx.truncated).toBe(false);
    expect(ctx.text).toContain('Title: Wool Beanie');
    expect(ctx.text).toContain('Type: Hats');
    expect(ctx.text).toContain('Tags: winter, wool');
    expect(ctx.text).toContain('Option Color: Black, Grey');
    expect(ctx.text).toContain('Variants: Black — SKU WB-BLK — $24.00');
    expect(ctx.text).toContain('Current description: A warm wool beanie.');
    // No HTML leaked into the context.
    expect(ctx.text).not.toContain('<strong>');
  });
  it('truncates to the budget and flags it', () => {
    const big: ProductInfo = { ...PRODUCT, descriptionHtml: 'x'.repeat(50) };
    const ctx = buildProductContext(big, 40);
    expect(ctx.truncated).toBe(true);
    expect(ctx.text.length).toBe(40);
  });
});

describe('buildOrderContext', () => {
  it('renders the order fields', () => {
    const ctx = buildOrderContext(ORDER);
    expect(ctx.truncated).toBe(false);
    expect(ctx.text).toContain('Order: #1002');
    expect(ctx.text).toContain('Customer: Sam Lee');
    expect(ctx.text).toContain('Payment: PAID');
    expect(ctx.text).toContain('Total: 48.00 USD');
    expect(ctx.text).toContain('Items: 2× Wool Beanie (SKU WB-BLK)');
    expect(ctx.text).toContain('Internal note: Customer asked to expedite.');
  });
});

describe('prompt assembly', () => {
  it('buildProductMessages: system grounds, product is fenced as data, task last', () => {
    const msgs = buildProductMessages('Write a description.', PRODUCT);
    expect(msgs[0]).toEqual<ChatMessage>({ role: 'system', content: SYSTEM_PROMPT });
    expect(msgs[1].role).toBe('user');
    expect(msgs[1].content).toContain('---- product ----');
    expect(msgs[1].content).toContain('---- end product ----');
    expect(msgs[1].content).toContain('---- task ----\nWrite a description.');
  });
  it('buildOrderMessages: fences the order and carries the task', () => {
    const msgs = buildOrderMessages('Draft a reply.', ORDER);
    expect(msgs[1].content).toContain('---- order ----');
    expect(msgs[1].content).toContain('Draft a reply.');
  });
  it('prepends an honest truncation note when the context was cut', () => {
    const big: ProductInfo = { ...PRODUCT, descriptionHtml: 'x'.repeat(50000) };
    const msgs = buildProductMessages('Rewrite.', big);
    expect(msgs[1].content).toContain('truncated to fit');
  });
});

describe('runChat / ask (request shaping over @hanzo/ai)', () => {
  it('sends model + messages, stream:false, and returns the assistant content', async () => {
    const f = fakeClient('Generated copy.');
    const out = await runChat([{ role: 'user', content: 'hi' }], { client: f.client, model: 'zen5-mini', temperature: 0.4 });
    expect(out).toBe('Generated copy.');
    expect(f.calls).toHaveLength(1);
    expect(f.calls[0].params.model).toBe('zen5-mini');
    expect(f.calls[0].params.stream).toBe(false);
    expect(f.calls[0].params.temperature).toBe(0.4);
    expect(f.calls[0].params.messages).toEqual([{ role: 'user', content: 'hi' }]);
  });
  it('defaults the model to zen5 when none is given', async () => {
    const f = fakeClient('x');
    await runChat([{ role: 'user', content: 'hi' }], { client: f.client });
    expect(f.calls[0].params.model).toBe('zen5');
  });
  it('askProduct builds product messages and calls the model', async () => {
    const f = fakeClient('A description.');
    const out = await askProduct('Write a description.', PRODUCT, { client: f.client });
    expect(out).toBe('A description.');
    expect(f.calls[0].params.messages[1].content).toContain('Wool Beanie');
  });
  it('askOrder builds order messages and calls the model', async () => {
    const f = fakeClient('A reply.');
    const out = await askOrder('Draft a reply.', ORDER, { client: f.client });
    expect(out).toBe('A reply.');
    expect(f.calls[0].params.messages[1].content).toContain('#1002');
  });
  it('throws when the model returns empty content', async () => {
    const f = fakeClient('');
    await expect(runChat([{ role: 'user', content: 'x' }], { client: f.client })).rejects.toThrow(/no content/);
  });
  it('forwards the abort signal in options', async () => {
    const f = fakeClient('x');
    const controller = new AbortController();
    await runChat([{ role: 'user', content: 'x' }], { client: f.client, signal: controller.signal });
    expect(f.calls[0].options.signal).toBe(controller.signal);
  });
});

describe('listModels', () => {
  it('returns the model ids from the client', async () => {
    const f = fakeClient('x', ['zen5', 'zen5-mini', 'zen5-coder']);
    expect(await listModels({ client: f.client })).toEqual(['zen5', 'zen5-mini', 'zen5-coder']);
  });
});
