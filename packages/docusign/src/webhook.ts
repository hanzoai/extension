// DocuSign Connect webhook: HMAC signature verification and event routing — all
// pure over their inputs so they are unit-testable without an http server.
// server.ts is the thin http glue that reads the raw body + headers and calls
// these. Crypto is Node's stdlib (node:crypto), never a dependency.
//
// DocuSign Connect signs every message when HMAC security is enabled. For each
// configured HMAC key it adds a header:
//   X-DocuSign-Signature-1: base64(HMAC_SHA256(hmacKey, rawBody))
//   X-DocuSign-Signature-2: base64(HMAC_SHA256(hmacKey2, rawBody))  (2nd key)
// We recompute the digest over the RAW body bytes (not a re-serialized object —
// key order and whitespace would differ) and compare in constant time against
// EACH provided signature header. A message matching any configured key is
// authentic. This is the whole trust boundary: an event that fails here is
// discarded before any document is fetched.
// Docs: developers.docusign.com/platform/webhooks/connect/hmac.

import { createHmac, timingSafeEqual } from 'node:crypto';

// computeSignature is the one crypto primitive: base64(HMAC-SHA256(key, body)).
// Both verification and any test fixture are built from it, so the value we
// compare is produced exactly as DocuSign produces it.
export function computeSignature(hmacKey: string, rawBody: string): string {
  return createHmac('sha256', hmacKey).update(rawBody, 'utf8').digest('base64');
}

// constantTimeEqual compares two strings without leaking length/position via
// timing. Different-length inputs are unequal (and short-circuit safely — we
// never feed mismatched buffers to timingSafeEqual, which would throw).
export function constantTimeEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ba.length !== bb.length) return false;
  return timingSafeEqual(ba, bb);
}

// signatureHeaders collects the X-DocuSign-Signature-N values out of a header
// map, in order (1, 2, 3, …). Node lowercases header names; DocuSign may send
// one or several depending on how many HMAC keys are configured. Pure so the
// header-plucking is testable. Values that aren't strings are skipped.
export function signatureHeaders(headers: Record<string, unknown>): string[] {
  const out: string[] = [];
  for (let i = 1; ; i++) {
    const v = headers[`x-docusign-signature-${i}`];
    if (typeof v !== 'string' || v.length === 0) break;
    out.push(v);
  }
  return out;
}

// verifySignature is the trust gate: recompute base64(HMAC-SHA256(key, rawBody))
// and compare in constant time against EVERY provided X-DocuSign-Signature-*
// header. A match on any header means the message is authentic (DocuSign
// includes one signature per configured key; a listener that knows one key
// accepts messages signed with it). Returns false on any missing input rather
// than throwing, so a malformed request is a clean reject. `signatures` is the
// list from signatureHeaders(); pass a single key here (the one this listener
// was configured with).
export function verifySignature(
  hmacKey: string,
  signatures: string[],
  rawBody: string,
): boolean {
  if (!hmacKey || signatures.length === 0) return false;
  const expected = computeSignature(hmacKey, rawBody);
  for (const sig of signatures) {
    if (constantTimeEqual(sig, expected)) return true;
  }
  return false;
}

// ---- Event routing --------------------------------------------------------
//
// After a request is verified, we parse the DocuSign Connect message into a
// discriminated action so the server can dispatch. Connect's "aggregate" JSON
// payload nests the envelope under data.envelopeSummary (or data.envelopeId for
// the id). We act on the one event that produces a summary — an envelope reaching
// "completed", which has downloadable, fully-executed documents — and treat
// other statuses as signals to acknowledge and ignore. Everything unknown is a
// clean 200 (acknowledge, do nothing) rather than an error.

export type ConnectAction =
  | { kind: 'envelope_completed'; accountId: string; envelopeId: string; emailSubject: string; status: string }
  | { kind: 'ignored'; event: string; status: string };

// eventStatus extracts the envelope status from a Connect message, tolerating
// the two shapes Connect emits: the modern JSON "aggregate" payload
// (data.envelopeSummary.status) and the flatter event payload (status /
// data.status). Lowercased for a stable compare. Pure.
export function eventStatus(body: any): string {
  const s =
    body?.data?.envelopeSummary?.status ??
    body?.data?.status ??
    body?.status ??
    '';
  return String(s).toLowerCase();
}

// accountId / envelopeId pull the identifiers out of a Connect message. The
// aggregate payload carries accountId at the top level and envelopeId under
// data; older shapes nest them differently, so we check the documented
// locations in order. Pure.
export function messageAccountId(body: any): string {
  return String(body?.data?.accountId ?? body?.accountId ?? '');
}

export function messageEnvelopeId(body: any): string {
  return String(
    body?.data?.envelopeId ??
      body?.data?.envelopeSummary?.envelopeId ??
      body?.envelopeId ??
      '',
  );
}

// emailSubject pulls the envelope subject (title) for the summary header. Pure.
function messageEmailSubject(body: any): string {
  return String(
    body?.data?.envelopeSummary?.emailSubject ??
      body?.data?.emailSubject ??
      body?.emailSubject ??
      '',
  );
}

// routeEvent turns a PARSED, ALREADY-VERIFIED Connect message into a
// ConnectAction. Verification is the caller's job (verifySignature) — this is
// pure dispatch over the parsed JSON, so it is unit-testable with plain objects.
// Only a completed envelope triggers work; every other status is acknowledged
// and ignored.
export function routeEvent(body: any): ConnectAction {
  const event = String(body?.event ?? '');
  const status = eventStatus(body);
  if (status === 'completed') {
    return {
      kind: 'envelope_completed',
      accountId: messageAccountId(body),
      envelopeId: messageEnvelopeId(body),
      emailSubject: messageEmailSubject(body),
      status,
    };
  }
  return { kind: 'ignored', event, status };
}
