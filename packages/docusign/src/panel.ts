// Pure panel logic: parsing the DocuSign launch context and turning pasted
// agreement text into pages. Split out of app.ts (the DOM glue) so it is
// unit-testable without a browser — app.ts imports these and only adds the
// impure DOM wiring.

import type { PageTextItem } from './hanzo.js';

// The envelope context DocuSign passes when it launches the panel. All optional:
// the panel still runs as a paste-in tool when opened outside DocuSign.
export interface LaunchContext {
  envelopeId: string;
  accountId: string;
  title: string;
}

// parseLaunchContext reads the launch URL's query into a LaunchContext. DocuSign
// custom actions / linked apps append the envelope context to the configured
// URL; we read the documented names (and their snake_case variants) and tolerate
// their absence. Pure — takes a query string so it is unit-tested without a DOM.
export function parseLaunchContext(search: string): LaunchContext {
  const q = new URLSearchParams(search);
  return {
    envelopeId: (q.get('envelopeId') || q.get('envelope_id') || '').trim(),
    accountId: (q.get('accountId') || q.get('account_id') || '').trim(),
    title: (q.get('title') || q.get('emailSubject') || '').trim(),
  };
}

// asPages turns the pasted/injected agreement text into the PageTextItem[] the
// windowing expects. When the panel is handed already-extracted text (not a PDF)
// there is one logical "page"; the windowing still applies the char budget. Pure.
export function asPages(text: string): PageTextItem[] {
  const t = text.trim();
  return t ? [{ page: 1, text: t }] : [];
}

// panelTitle chooses the header label for the agreement: its subject, else the
// envelope id, else a neutral default. Pure — the DOM glue just assigns it.
export function panelTitle(ctx: LaunchContext): string {
  if (ctx.title) return ctx.title;
  if (ctx.envelopeId) return `Envelope ${ctx.envelopeId}`;
  return 'Agreement';
}
