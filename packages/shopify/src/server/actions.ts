// The AI actions over a product or an order — each a prompt template applied to
// the assembled context via the single `askProduct` / `askOrder` primitives in
// hanzo.ts. There is exactly ONE code path to the model per subject: an action
// is (id → prompt + subject), and the panel, the picker, and the webhook all
// resolve an id here and call the matching ask. No action speaks to the gateway
// directly.

import { askOrder, askProduct, type AskOptions } from './hanzo.js';
import type { ProductInfo, OrderInfo } from './shopify-api.js';

// A product action's prompt is written to produce paste-ready content (a
// description, an SEO title, a meta description). Prompts are specific and
// output-shaped so results drop straight into the Shopify field.
export const PRODUCT_ACTIONS = {
  writeDescription: {
    label: 'Write description',
    prompt:
      'Write a compelling product description for this product. 2–4 short ' +
      'paragraphs (or a short intro plus a bullet list of key features/benefits). ' +
      'Lead with the benefit, ground every claim in the product data above, and ' +
      'match a confident, on-brand retail tone. Return only the description text, ' +
      'ready to paste.',
  },
  rewriteDescription: {
    label: 'Rewrite description',
    prompt:
      'Rewrite the current product description above to be clearer, more ' +
      'persuasive, and better structured, WITHOUT adding any fact not present in ' +
      'the product data. Keep it roughly the same length. Return only the rewritten ' +
      'description, ready to paste.',
  },
  seoTitle: {
    label: 'SEO title',
    prompt:
      'Write an SEO page title for this product: at most 60 characters, ' +
      'front-loading the most important keyword, natural (not keyword-stuffed), and ' +
      'accurate to the product. Return only the title text on a single line.',
  },
  seoDescription: {
    label: 'SEO meta description',
    prompt:
      'Write an SEO meta description for this product: 140–160 characters, one or ' +
      'two sentences, benefit-led, and accurate to the product data. Return only ' +
      'the meta description text on a single line.',
  },
} as const;

// An order action's prompt produces a summary, a customer reply, or an issue
// extraction — the support/order-insight surface.
export const ORDER_ACTIONS = {
  summarize: {
    label: 'Summarize order',
    prompt:
      'Summarize this order for a support agent at a glance: who ordered, what and ' +
      'how much, the payment and fulfillment status, where it ships, and anything ' +
      'notable in the note. Short bullets. No preamble.',
  },
  draftReply: {
    label: 'Draft customer reply',
    prompt:
      'Draft a warm, professional reply to the customer about this order. Address ' +
      'them by name if known, reference the order by its name/number, and speak ' +
      'only to what the order data supports (status, items, shipping). Do not ' +
      'promise dates, refunds, or policies that are not in the data. Return only ' +
      'the email body, ready to send.',
  },
  extractIssues: {
    label: 'Extract issues',
    prompt:
      'Read this order (especially the internal note) and extract any customer ' +
      'issues, requests, or risks as a short prioritized list. For each: a one-line ' +
      'description and a suggested next action. If nothing stands out, say so. Do ' +
      'not invent issues that are not supported by the data.',
  },
} as const;

// A product / order action id from the respective catalog.
export type ProductActionId = keyof typeof PRODUCT_ACTIONS;
export type OrderActionId = keyof typeof ORDER_ACTIONS;

// isProductActionId / isOrderActionId narrow an arbitrary string to a known id.
// Boundary guards — the panel and the server validate an inbound id here before
// running it.
export function isProductActionId(id: string): id is ProductActionId {
  return Object.prototype.hasOwnProperty.call(PRODUCT_ACTIONS, id);
}
export function isOrderActionId(id: string): id is OrderActionId {
  return Object.prototype.hasOwnProperty.call(ORDER_ACTIONS, id);
}

// productActionPrompt / orderActionPrompt resolve an id to its prompt. Each
// throws on an unknown id (a boundary error surfaced to the caller) rather than
// silently running a default.
export function productActionPrompt(id: string): string {
  if (!isProductActionId(id)) throw new Error(`Unknown product action: ${id}`);
  return PRODUCT_ACTIONS[id].prompt;
}
export function orderActionPrompt(id: string): string {
  if (!isOrderActionId(id)) throw new Error(`Unknown order action: ${id}`);
  return ORDER_ACTIONS[id].prompt;
}

// productActionList / orderActionList are the ordered catalogs for building the
// UI, derived from the action maps so the panel and the catalog can never drift.
export function productActionList(): Array<{ id: ProductActionId; label: string }> {
  return (Object.keys(PRODUCT_ACTIONS) as ProductActionId[]).map((id) => ({ id, label: PRODUCT_ACTIONS[id].label }));
}
export function orderActionList(): Array<{ id: OrderActionId; label: string }> {
  return (Object.keys(ORDER_ACTIONS) as OrderActionId[]).map((id) => ({ id, label: ORDER_ACTIONS[id].label }));
}

// runProductAction / runOrderAction are the single entry points each surface
// calls: resolve the action's prompt and run it over the assembled context via
// the matching ask. One code path from an id to the model per subject. Async so
// an unknown id surfaces as a rejected promise (not a synchronous throw), giving
// callers ONE way to handle failure: await/.catch.
export async function runProductAction(id: string, p: ProductInfo, opts: AskOptions = {}): Promise<string> {
  return askProduct(productActionPrompt(id), p, opts);
}
export async function runOrderAction(id: string, o: OrderInfo, opts: AskOptions = {}): Promise<string> {
  return askOrder(orderActionPrompt(id), o, opts);
}
