// The Hanzo call and its request/response shaping over a PRODUCT or ORDER —
// pure, host-agnostic, and fully unit-testable (no Shopify SDK, no DOM). The
// Polaris panel and the webhook server are the thin glue that read a product/
// order and hand it here.
//
// This is a THIN wrapper over the PUBLISHED headless client `@hanzo/ai`
// (createAiClient) — we do NOT reimplement the transport. This module owns only
// the commerce-aware layer: product/order context assembly + truncation + prompt
// building, kept pure so it is tested and reused by both the panel backend and
// the (browser-less) webhook. The AI actions (their prompt templates) live in
// actions.ts, layered on `ask`.

import { createAiClient, type AiClient } from '@hanzo/ai';
import { DEFAULT_MODEL, HANZO_API_BASE_URL, PRODUCT_CHAR_BUDGET } from '../config.js';
import type { ProductInfo, OrderInfo } from './shopify-api.js';

// A message in the OpenAI-compatible schema — the shape @hanzo/ai's
// chat.completions.create takes. Kept as a local alias so the prompt-assembly
// functions (buildProductMessages/buildOrderMessages) have a precise, testable
// return type independent of the SDK's broader union.
export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

// SYSTEM_PROMPT grounds every answer in the store data provided. It forbids
// inventing facts about the product or order (the failure mode that makes a
// commerce assistant dangerous — fake specs, fake shipping promises), and keeps
// output ready to paste into a Shopify field. Merchant-facing, brand-neutral.
export const SYSTEM_PROMPT =
  'You are Hanzo AI, an assistant for a Shopify merchant. You help write product ' +
  'content (descriptions, SEO titles and meta descriptions) and handle orders and ' +
  'support. Work ONLY from the product or order data provided below — never invent ' +
  'specifications, materials, prices, dates, shipping promises, or policies that ' +
  'are not supported by the data. Write in clear, natural, conversion-minded prose ' +
  'for product content, and a warm, professional tone for customer replies. Return ' +
  'only the requested content, ready to paste — no preamble, no meta commentary.';

// ---- Product context assembly ---------------------------------------------
//
// A product's attributes are assembled into a compact, labeled block the model
// reads as data (never as instructions). We include the existing description so
// "rewrite" has the current copy to improve, and cap the whole block at the
// budget — HTML descriptions can be long. Honest truncation, never silent drop.

// The result of rendering a product down to what we attach: the text and whether
// anything was truncated (so the prompt and UI can say so honestly).
export interface ProductContext {
  text: string;
  truncated: boolean;
}

// stripHtml reduces an HTML description to readable text for the context block
// (the model does not need the markup to understand the copy, and tags waste
// budget). Minimal + total: drop tags, collapse whitespace. Pure.
export function stripHtml(html: string): string {
  return html
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ')
    .trim();
}

// buildProductContext renders the product attributes into a labeled block,
// capped at `budget` characters. The current description is the last (and
// longest) field, so truncation trims it rather than the structured attributes
// the model most needs. Pure and total. `truncated` is true whenever the render
// was cut to fit.
export function buildProductContext(p: ProductInfo, budget: number = PRODUCT_CHAR_BUDGET): ProductContext {
  const lines: string[] = [];
  lines.push(`Title: ${p.title}`);
  if (p.productType) lines.push(`Type: ${p.productType}`);
  if (p.vendor) lines.push(`Vendor: ${p.vendor}`);
  if (p.tags.length) lines.push(`Tags: ${p.tags.join(', ')}`);
  for (const o of p.options) {
    if (o.name && o.values.length) lines.push(`Option ${o.name}: ${o.values.join(', ')}`);
  }
  if (p.variants.length) {
    const vs = p.variants
      .map((v) => [v.title, v.sku && `SKU ${v.sku}`, v.price && `$${v.price}`].filter(Boolean).join(' — '))
      .join('; ');
    lines.push(`Variants: ${vs}`);
  }
  if (p.seoTitle) lines.push(`Current SEO title: ${p.seoTitle}`);
  if (p.seoDescription) lines.push(`Current SEO description: ${p.seoDescription}`);
  const currentDesc = stripHtml(p.descriptionHtml || p.description);
  if (currentDesc) lines.push(`Current description: ${currentDesc}`);

  const full = lines.join('\n');
  if (full.length <= budget) return { text: full, truncated: false };
  return { text: full.slice(0, budget), truncated: true };
}

// ---- Order context assembly -----------------------------------------------

export interface OrderContext {
  text: string;
  truncated: boolean;
}

// buildOrderContext renders an order into a labeled block. Orders are small; the
// budget only bites on a huge line-item list or a long note, in which case we
// truncate the tail honestly. Pure and total.
export function buildOrderContext(o: OrderInfo, budget: number = PRODUCT_CHAR_BUDGET): OrderContext {
  const lines: string[] = [];
  lines.push(`Order: ${o.name}`);
  if (o.createdAt) lines.push(`Placed: ${o.createdAt}`);
  if (o.customerName) lines.push(`Customer: ${o.customerName}`);
  if (o.email) lines.push(`Email: ${o.email}`);
  if (o.financialStatus) lines.push(`Payment: ${o.financialStatus}`);
  if (o.fulfillmentStatus) lines.push(`Fulfillment: ${o.fulfillmentStatus}`);
  if (o.totalAmount) lines.push(`Total: ${o.totalAmount} ${o.currency}`.trim());
  if (o.shipTo) lines.push(`Ship to: ${o.shipTo}`);
  if (o.lineItems.length) {
    const items = o.lineItems
      .map((li) => `${li.quantity}× ${li.title}${li.sku ? ` (SKU ${li.sku})` : ''}`)
      .join('; ');
    lines.push(`Items: ${items}`);
  }
  if (o.note) lines.push(`Internal note: ${o.note}`);

  const full = lines.join('\n');
  if (full.length <= budget) return { text: full, truncated: false };
  return { text: full.slice(0, budget), truncated: true };
}

// ---- Prompt assembly ------------------------------------------------------

// contextNote is the one honest sentence prepended when the render was cut, so
// the model does not answer as though it saw everything.
function contextNote(truncated: boolean, kind: 'product' | 'order'): string {
  return truncated
    ? `Note: the ${kind} data below was truncated to fit — answer only from what is shown.`
    : '';
}

// buildMessages fences the store data as DATA (never instructions) and rides the
// honest note inside the user turn so it is never lost. Shared by product and
// order paths — one assembly, one shape. Pure.
export function buildMessages(task: string, contextText: string, note: string, fence: string): ChatMessage[] {
  const system: ChatMessage = { role: 'system', content: SYSTEM_PROMPT };
  const notePrefix = note ? `${note}\n\n` : '';
  const user: ChatMessage = {
    role: 'user',
    content:
      `${notePrefix}---- ${fence} ----\n${contextText}\n---- end ${fence} ----\n\n` +
      `---- task ----\n${task}`,
  };
  return [system, user];
}

// buildProductMessages / buildOrderMessages are the two public assemblers the
// actions + freeform ask use. Each windows its context and builds the message
// list. Pure — the whole prompt is asserted in a test.
export function buildProductMessages(task: string, p: ProductInfo): ChatMessage[] {
  const ctx = buildProductContext(p);
  return buildMessages(task, ctx.text, contextNote(ctx.truncated, 'product'), 'product');
}

export function buildOrderMessages(task: string, o: OrderInfo): ChatMessage[] {
  const ctx = buildOrderContext(o);
  return buildMessages(task, ctx.text, contextNote(ctx.truncated, 'order'), 'order');
}

// ---- The single call path -------------------------------------------------

export interface AskOptions {
  model?: string;
  temperature?: number;
  token?: string;
  baseURL?: string;
  /** Injected client (tests). Defaults to a real createAiClient. */
  client?: AiClient;
  signal?: AbortSignal;
}

// client resolves an AiClient: the injected one (tests) or a real published
// @hanzo/ai client pointed at the gateway with the caller's bearer. One place
// constructs it so the token/baseURL wiring is identical for every surface.
function client(opts: AskOptions): AiClient {
  return opts.client ?? createAiClient({ token: opts.token, baseUrl: opts.baseURL ?? HANZO_API_BASE_URL });
}

// runChat is the single path from a built message list to the model. Every
// Shopify surface (the actions, a freeform question, the webhook auto-draft)
// funnels here. Non-streaming: the panel renders the final text and the webhook
// stores a finished draft. token may be empty (the gateway serves anonymous/
// limited models).
export async function runChat(messages: ChatMessage[], opts: AskOptions = {}): Promise<string> {
  const res = await client(opts).chat.completions.create({
    model: opts.model ?? DEFAULT_MODEL,
    messages,
    temperature: opts.temperature,
    stream: false,
  }, { signal: opts.signal });
  const content = res.choices?.[0]?.message?.content;
  if (typeof content !== 'string' || content === '') {
    throw new Error('Hanzo API returned no content');
  }
  return content;
}

// askProduct / askOrder run ONE completion over a product/order with a freeform
// task. The actions in actions.ts resolve their prompt and call these.
export async function askProduct(task: string, p: ProductInfo, opts: AskOptions = {}): Promise<string> {
  return runChat(buildProductMessages(task, p), opts);
}

export async function askOrder(task: string, o: OrderInfo, opts: AskOptions = {}): Promise<string> {
  return runChat(buildOrderMessages(task, o), opts);
}

// listModels returns the model ids the caller may route to, from /v1/models via
// the headless client. Org-scoped by the bearer; an empty token lists public
// models.
export async function listModels(opts: AskOptions = {}): Promise<string[]> {
  const models = await client(opts).models.list({ signal: opts.signal });
  return models.map((m) => m.id);
}
