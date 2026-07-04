// The envelope-analysis pipeline: given a DocuSign account + envelope + access
// token, fetch the combined PDF, extract its text, window it, and run an AI
// action over it. This is the shared core the webhook (auto-summarize on
// completion) and the panel's server-assisted path both use — one pipeline, no
// duplication. It composes the pure modules (docusign-api, pdf-text, hanzo,
// actions) and takes its `fetch`, `apiBase`, and pdf `loader` injected, so it is
// unit-testable end-to-end without a network or a real PDF parser.

import { getDocument, getEnvelope, parseEnvelope, type EnvelopeInfo } from './docusign-api.js';
import { extractPdfText, type PdfLoader } from './pdf-text.js';
import { buildDocumentContext, type AgreementMeta } from './hanzo.js';
import { runAction } from './actions.js';
import type { AskOptions } from './hanzo.js';

// The inputs the pipeline needs. `apiBase` is the eSignature REST root for the
// account (docusign-oauth.apiBaseUrl), `accessToken` authorizes the DocuSign
// reads, and the Hanzo bearer + model ride in `ask`.
export interface AnalyzeInput {
  apiBase: string;
  accountId: string;
  envelopeId: string;
  /** DocuSign OAuth access token — authorizes the envelope/document reads. */
  accessToken: string;
  /** The action to run (summarize | extractTerms | riskFlags | draftMemo). */
  actionId: string;
  /** Hanzo gateway options (bearer token, model, injected client for tests). */
  ask?: AskOptions;
  /** Injected fetch (tests). Defaults to global fetch. */
  fetch?: typeof fetch;
  /** Injected pdf.js loader (tests). Defaults to pdf-text's lazy loader. */
  pdfLoader?: PdfLoader;
}

// The pipeline result: the AI output plus the context that produced it, so the
// caller can show the agreement title and how much was analyzed.
export interface AnalyzeResult {
  result: string;
  envelope: EnvelopeInfo;
  totalPages: number;
  includedPages: number;
  truncated: boolean;
}

// fetchEnvelopeInfo GETs the envelope metadata. Throws with DocuSign's status on
// failure so the caller surfaces the real reason (e.g. 401 expired token).
async function fetchEnvelopeInfo(input: AnalyzeInput, doFetch: typeof fetch): Promise<EnvelopeInfo> {
  const req = getEnvelope(input.apiBase, input.accountId, input.envelopeId, input.accessToken);
  const resp = await doFetch(req.url, { headers: req.headers });
  if (!resp.ok) throw new Error(`DocuSign envelope fetch ${resp.status}`);
  return parseEnvelope(await resp.json());
}

// fetchCombinedPdf GETs the combined PDF (all documents merged) as bytes.
async function fetchCombinedPdf(input: AnalyzeInput, doFetch: typeof fetch): Promise<ArrayBuffer> {
  const req = getDocument(input.apiBase, input.accountId, input.envelopeId, input.accessToken);
  const resp = await doFetch(req.url, { headers: req.headers });
  if (!resp.ok) throw new Error(`DocuSign document fetch ${resp.status}`);
  return resp.arrayBuffer();
}

// analyzeEnvelope runs the whole pipeline: envelope metadata → combined PDF →
// text → windowed context → AI action. Pure composition over injected effects;
// every step's failure surfaces as a thrown Error the caller logs (the webhook)
// or shows (the panel). This is the ONE place the four surfaces converge on a
// finished analysis of an agreement.
export async function analyzeEnvelope(input: AnalyzeInput): Promise<AnalyzeResult> {
  const doFetch = input.fetch ?? fetch;

  const envelope = await fetchEnvelopeInfo(input, doFetch);
  const pdfBytes = await fetchCombinedPdf(input, doFetch);
  const pages = await extractPdfText(pdfBytes, input.pdfLoader);
  const ctx = buildDocumentContext(pages);

  const meta: AgreementMeta = {
    title: envelope.emailSubject,
    status: envelope.status,
    envelopeId: envelope.envelopeId || input.envelopeId,
  };
  const result = await runAction(input.actionId, ctx, meta, input.ask);

  return {
    result,
    envelope,
    totalPages: ctx.totalPages,
    includedPages: ctx.includedPages,
    truncated: ctx.truncated,
  };
}
