import { describe, it, expect } from 'vitest';
import { createHmac } from 'node:crypto';
import {
  computeSignature,
  constantTimeEqual,
  signatureHeaders,
  verifySignature,
  routeEvent,
  eventStatus,
  messageAccountId,
  messageEnvelopeId,
} from '../src/webhook';

const KEY = 'connect-hmac-key-abc';

// The reference computation DocuSign performs: base64(HMAC-SHA256(key, rawBody)).
function refSig(key: string, body: string): string {
  return createHmac('sha256', key).update(body, 'utf8').digest('base64');
}

describe('computeSignature', () => {
  it('is base64(HMAC-SHA256(key, rawBody)) — matches the DocuSign reference', () => {
    const body = '{"event":"envelope-completed"}';
    expect(computeSignature(KEY, body)).toBe(refSig(KEY, body));
  });
  it('is deterministic and base64', () => {
    const a = computeSignature(KEY, 'x');
    expect(a).toBe(computeSignature(KEY, 'x'));
    expect(a).toMatch(/^[A-Za-z0-9+/]+=*$/);
  });
});

describe('constantTimeEqual', () => {
  it('true for equal, false otherwise, false on different length without throwing', () => {
    expect(constantTimeEqual('abc', 'abc')).toBe(true);
    expect(constantTimeEqual('abc', 'abd')).toBe(false);
    expect(constantTimeEqual('abc', 'abcd')).toBe(false);
  });
});

describe('signatureHeaders', () => {
  it('collects X-DocuSign-Signature-1..N in order and stops at the first gap', () => {
    const headers = {
      'x-docusign-signature-1': 'sig1',
      'x-docusign-signature-2': 'sig2',
      'content-type': 'application/json',
    };
    expect(signatureHeaders(headers)).toEqual(['sig1', 'sig2']);
  });
  it('is empty when no signature header is present', () => {
    expect(signatureHeaders({ 'content-type': 'application/json' })).toEqual([]);
  });
});

describe('verifySignature (trust gate)', () => {
  const body = JSON.stringify({ event: 'envelope-completed', data: { envelopeId: 'e1' } });
  const good = refSig(KEY, body);

  it('accepts a request signed with our key (single header)', () => {
    expect(verifySignature(KEY, [good], body)).toBe(true);
  });
  it('accepts when our signature is one of several headers (multiple keys)', () => {
    expect(verifySignature(KEY, ['some-other-key-sig', good], body)).toBe(true);
  });
  it('rejects a tampered body', () => {
    expect(verifySignature(KEY, [good], body + ' ')).toBe(false);
  });
  it('rejects a wrong key', () => {
    expect(verifySignature('other-key', [good], body)).toBe(false);
  });
  it('rejects when no signatures are provided', () => {
    expect(verifySignature(KEY, [], body)).toBe(false);
  });
  it('rejects when the hmac key is empty', () => {
    expect(verifySignature('', [good], body)).toBe(false);
  });
});

describe('event routing', () => {
  it('reads status from the aggregate envelopeSummary shape', () => {
    expect(eventStatus({ data: { envelopeSummary: { status: 'Completed' } } })).toBe('completed');
  });
  it('reads status from the flat shape', () => {
    expect(eventStatus({ status: 'sent' })).toBe('sent');
  });

  it('routes a completed envelope to an actionable event with ids + subject', () => {
    const action = routeEvent({
      event: 'envelope-completed',
      data: {
        accountId: 'acct-1',
        envelopeId: 'env-9',
        envelopeSummary: { status: 'completed', emailSubject: 'MSA - please sign' },
      },
    });
    expect(action.kind).toBe('envelope_completed');
    if (action.kind === 'envelope_completed') {
      expect(action.accountId).toBe('acct-1');
      expect(action.envelopeId).toBe('env-9');
      expect(action.emailSubject).toBe('MSA - please sign');
    }
  });

  it('ignores non-completed statuses (still a clean ack)', () => {
    const action = routeEvent({ event: 'envelope-sent', data: { status: 'sent' } });
    expect(action.kind).toBe('ignored');
    if (action.kind === 'ignored') expect(action.status).toBe('sent');
  });

  it('pulls account/envelope ids from either documented location', () => {
    expect(messageAccountId({ accountId: 'a' })).toBe('a');
    expect(messageAccountId({ data: { accountId: 'b' } })).toBe('b');
    expect(messageEnvelopeId({ data: { envelopeSummary: { envelopeId: 'e' } } })).toBe('e');
  });
});
