import { describe, it, expect } from 'vitest';
import { analyzeEnvelope } from '../src/envelope';
import { apiBaseUrl } from '../src/docusign-oauth';
import type { PdfDoc, TextRun } from '../src/pdf-text';
import type { AiClient } from '../src/client';

const API = apiBaseUrl('https://demo.docusign.net');
const ACCT = 'acct-1';
const ENV = 'env-9';

// Fake DocuSign REST: the envelope metadata GET returns JSON; the combined
// document GET returns opaque PDF bytes (the fake pdf loader ignores them).
function fakeFetch(): typeof fetch {
  return (async (url: any) => {
    const u = String(url);
    if (u.endsWith(`/envelopes/${ENV}`)) {
      return new Response(JSON.stringify({ envelopeId: ENV, status: 'completed', emailSubject: 'Master Services Agreement' }), { status: 200 });
    }
    if (u.endsWith(`/envelopes/${ENV}/documents/combined`)) {
      return new Response(new Uint8Array([1, 2, 3, 4]), { status: 200, headers: { 'Content-Type': 'application/pdf' } });
    }
    return new Response('not found', { status: 404 });
  }) as unknown as typeof fetch;
}

// Fake pdf.js loader: two pages of agreement text.
const pdfLoader = async (): Promise<PdfDoc> => ({
  numPages: 2,
  async getPage(n: number) {
    const map: Record<number, TextRun[]> = {
      1: [{ str: 'This' }, { str: 'Agreement' }, { str: 'governs.', hasEOL: true }],
      2: [{ str: 'Payment' }, { str: 'is' }, { str: 'net-30.', hasEOL: true }],
    };
    return { async getTextContent() { return { items: map[n] }; } };
  },
});

// Fake Hanzo client: echoes the task + how much agreement text it saw.
function fakeClient(seen: { userContent?: string }): AiClient {
  return {
    chat: {
      completions: {
        async create(params) {
          seen.userContent = (params.messages[1] as { content: string }).content;
          return { choices: [{ message: { role: 'assistant', content: 'SUMMARY' } }] };
        },
      },
    },
    models: { async list() { return []; } },
  };
}

describe('analyzeEnvelope (full pipeline, all effects injected)', () => {
  it('fetches metadata + combined PDF, extracts text, and runs the action', async () => {
    const seen: { userContent?: string } = {};
    const out = await analyzeEnvelope({
      apiBase: API,
      accountId: ACCT,
      envelopeId: ENV,
      accessToken: 'AT',
      actionId: 'summarize',
      fetch: fakeFetch(),
      pdfLoader,
      ask: { client: fakeClient(seen) },
    });

    expect(out.result).toBe('SUMMARY');
    expect(out.envelope.emailSubject).toBe('Master Services Agreement');
    expect(out.totalPages).toBe(2);
    expect(out.includedPages).toBe(2);
    expect(out.truncated).toBe(false);
    // the extracted agreement text reached the model, titled by the envelope
    expect(seen.userContent).toContain('This Agreement governs.');
    expect(seen.userContent).toContain('Payment is net-30.');
    expect(seen.userContent).toContain('Agreement: Master Services Agreement');
  });

  it('surfaces a DocuSign error when the envelope fetch fails', async () => {
    const failing = (async () => new Response('nope', { status: 401 })) as unknown as typeof fetch;
    await expect(
      analyzeEnvelope({ apiBase: API, accountId: ACCT, envelopeId: ENV, accessToken: 'AT', actionId: 'summarize', fetch: failing, pdfLoader }),
    ).rejects.toThrow(/401/);
  });
});
