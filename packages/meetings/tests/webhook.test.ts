import { describe, it, expect } from 'vitest';
import {
  signPayload,
  zoomSignature,
  constantTimeEqual,
  verifySignature,
  urlValidationResponse,
  transcriptFileUrl,
  routeEvent,
} from '../src/zoom/webhook';

const SECRET = 'super-secret-token';

describe('signPayload / zoomSignature', () => {
  it('is a deterministic HMAC-SHA256 hex', () => {
    const a = signPayload(SECRET, 'hello');
    const b = signPayload(SECRET, 'hello');
    expect(a).toBe(b);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
  });
  it('builds the v0=<hmac> header shape Zoom sends', () => {
    const sig = zoomSignature(SECRET, '1700000000', '{"event":"x"}');
    expect(sig.startsWith('v0=')).toBe(true);
    expect(sig.slice(3)).toBe(signPayload(SECRET, 'v0:1700000000:{"event":"x"}'));
  });
});

describe('constantTimeEqual', () => {
  it('is true for equal strings and false otherwise', () => {
    expect(constantTimeEqual('abc', 'abc')).toBe(true);
    expect(constantTimeEqual('abc', 'abd')).toBe(false);
  });
  it('is false for different lengths without throwing', () => {
    expect(constantTimeEqual('abc', 'abcd')).toBe(false);
  });
});

describe('verifySignature (trust gate)', () => {
  const ts = '1700000000';
  const body = JSON.stringify({ event: 'meeting.ended', payload: {} });
  const good = zoomSignature(SECRET, ts, body);

  it('accepts a correctly signed request', () => {
    expect(verifySignature(SECRET, good, ts, body)).toBe(true);
  });
  it('rejects a tampered body', () => {
    expect(verifySignature(SECRET, good, ts, body + ' ')).toBe(false);
  });
  it('rejects a wrong secret', () => {
    expect(verifySignature('other', good, ts, body)).toBe(false);
  });
  it('rejects a mismatched timestamp (replay of a different frame)', () => {
    expect(verifySignature(SECRET, good, '1700000001', body)).toBe(false);
  });
  it('rejects missing signature / timestamp / secret rather than throwing', () => {
    expect(verifySignature(SECRET, undefined, ts, body)).toBe(false);
    expect(verifySignature(SECRET, good, undefined, body)).toBe(false);
    expect(verifySignature('', good, ts, body)).toBe(false);
  });
});

describe('urlValidationResponse', () => {
  it('echoes the plainToken and its HMAC under the secret', () => {
    const r = urlValidationResponse(SECRET, 'plain-123');
    expect(r.plainToken).toBe('plain-123');
    expect(r.encryptedToken).toBe(signPayload(SECRET, 'plain-123'));
  });
});

describe('transcriptFileUrl', () => {
  it('prefers the TRANSCRIPT file_type', () => {
    const files = [
      { file_type: 'MP4', download_url: 'https://z/video' },
      { file_type: 'TRANSCRIPT', file_extension: 'VTT', download_url: 'https://z/transcript.vtt' },
    ];
    expect(transcriptFileUrl(files)).toBe('https://z/transcript.vtt');
  });
  it('falls back to a VTT file_extension', () => {
    const files = [{ file_extension: 'VTT', download_url: 'https://z/cc.vtt' }];
    expect(transcriptFileUrl(files)).toBe('https://z/cc.vtt');
  });
  it('returns empty when there is no transcript file', () => {
    expect(transcriptFileUrl([{ file_type: 'MP4', download_url: 'https://z/v' }])).toBe('');
    expect(transcriptFileUrl(undefined)).toBe('');
  });
});

describe('routeEvent (dispatch)', () => {
  it('routes endpoint.url_validation with the plainToken', () => {
    const a = routeEvent({ event: 'endpoint.url_validation', payload: { plainToken: 'p1' } });
    expect(a).toEqual({ kind: 'url_validation', plainToken: 'p1' });
  });

  it('ignores a url_validation with no plainToken', () => {
    const a = routeEvent({ event: 'endpoint.url_validation', payload: {} });
    expect(a.kind).toBe('ignored');
  });

  it('routes recording.completed with the transcript url and topic', () => {
    const a = routeEvent({
      event: 'recording.completed',
      download_token: 'dl-tok',
      payload: {
        object: {
          uuid: 'mtg-uuid',
          topic: 'Weekly Sync',
          recording_files: [
            { file_type: 'M4A', download_url: 'https://z/audio' },
            { file_type: 'TRANSCRIPT', download_url: 'https://z/t.vtt' },
          ],
        },
      },
    });
    expect(a).toEqual({
      kind: 'recording_completed',
      meetingUuid: 'mtg-uuid',
      topic: 'Weekly Sync',
      transcriptUrl: 'https://z/t.vtt',
      downloadToken: 'dl-tok',
    });
  });

  it('routes meeting.ended', () => {
    const a = routeEvent({ event: 'meeting.ended', payload: { object: { uuid: 'u2', topic: 'T' } } });
    expect(a).toEqual({ kind: 'meeting_ended', meetingUuid: 'u2', topic: 'T' });
  });

  it('ignores unknown events but keeps the name', () => {
    const a = routeEvent({ event: 'meeting.started', payload: {} });
    expect(a).toEqual({ kind: 'ignored', event: 'meeting.started' });
  });
});
