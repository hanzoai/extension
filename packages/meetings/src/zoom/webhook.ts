// Zoom webhook: signature verification, URL-validation challenge, and event
// routing — all pure over their inputs so they are unit-testable without an http
// server. server.ts is the thin http glue that reads the raw body + headers and
// calls these. Crypto is Node's stdlib (node:crypto), never a dependency.
//
// Zoom signs every webhook request. The signature header is:
//   x-zm-signature: v0=HMAC_SHA256(secretToken, `v0:${timestamp}:${rawBody}`)
// with the timestamp in x-zm-request-timestamp. We recompute it over the RAW
// body bytes (not a re-serialized object — key order would differ) and compare
// in constant time. This is the whole trust boundary: an event that fails here
// is discarded before any transcript is fetched.
//
// Zoom also validates the endpoint URL on save with an `endpoint.url_validation`
// event carrying a plainToken; the response must echo it plus its HMAC. That is
// the same secret and the same hash, so it lives here too.

import { createHmac, timingSafeEqual } from 'node:crypto';

// signPayload is the HMAC-SHA256 hex of a message under the secret token. The
// one crypto primitive; both the request signature and the URL-validation
// response are built from it.
export function signPayload(secret: string, message: string): string {
  return createHmac('sha256', secret).update(message).digest('hex');
}

// zoomSignature builds the value Zoom sends in x-zm-signature for a given raw
// body + timestamp: `v0=<hmac>`. Exposed so a test can construct a valid header
// the same way Zoom does.
export function zoomSignature(secret: string, timestamp: string, rawBody: string): string {
  return `v0=${signPayload(secret, `v0:${timestamp}:${rawBody}`)}`;
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

// verifySignature is the trust gate: recompute the expected x-zm-signature over
// the raw body + timestamp and compare in constant time. Returns false on any
// missing input rather than throwing, so a malformed request is a clean reject.
export function verifySignature(
  secret: string,
  signatureHeader: string | undefined,
  timestamp: string | undefined,
  rawBody: string,
): boolean {
  if (!secret || !signatureHeader || !timestamp) return false;
  const expected = zoomSignature(secret, timestamp, rawBody);
  return constantTimeEqual(signatureHeader, expected);
}

// The Zoom URL-validation event body shape.
export interface UrlValidationPayload {
  plainToken: string;
}

// urlValidationResponse builds the JSON body Zoom expects back for an
// `endpoint.url_validation` event: the plainToken echoed plus its HMAC under the
// secret. Returning this within a few seconds is how the marketplace verifies
// we own the webhook secret.
export function urlValidationResponse(
  secret: string,
  plainToken: string,
): { plainToken: string; encryptedToken: string } {
  return { plainToken, encryptedToken: signPayload(secret, plainToken) };
}

// ---- Event routing --------------------------------------------------------
//
// After a request is verified, we parse it into a discriminated action so the
// server can dispatch. We only act on the two events that produce a summary
// (a completed cloud recording, which has a downloadable transcript) and treat
// meeting.ended as a signal (the recording usually isn't ready yet, so we log it
// and wait for recording.completed). Everything else is acknowledged and ignored.

export type ZoomAction =
  | { kind: 'url_validation'; plainToken: string }
  | { kind: 'recording_completed'; meetingUuid: string; topic: string; transcriptUrl: string; downloadToken?: string }
  | { kind: 'meeting_ended'; meetingUuid: string; topic: string }
  | { kind: 'ignored'; event: string };

// A recording file entry as it appears in a recording.completed payload.
interface RecordingFile {
  file_type?: string;
  file_extension?: string;
  recording_type?: string;
  download_url?: string;
  status?: string;
}

// transcriptFileUrl finds the transcript among a recording's files. Zoom marks
// the closed-caption/transcript file with file_type "TRANSCRIPT" (extension VTT);
// we fall back to a .vtt/.transcript.vtt extension match. Returns '' if none —
// a recording without a transcript can't be summarized, and the server says so.
export function transcriptFileUrl(files: RecordingFile[] | undefined): string {
  if (!Array.isArray(files)) return '';
  const byType = files.find((f) => (f.file_type || '').toUpperCase() === 'TRANSCRIPT');
  if (byType?.download_url) return byType.download_url;
  const byExt = files.find((f) => (f.file_extension || '').toUpperCase() === 'VTT');
  return byExt?.download_url || '';
}

// routeEvent turns a PARSED, ALREADY-VERIFIED webhook body into a ZoomAction.
// Verification is the caller's job (verifySignature) — this is pure dispatch
// over the parsed JSON, so it is unit-testable with plain objects. Unknown
// events become { kind: 'ignored' } (still a 200 to Zoom — acknowledge, do
// nothing) rather than an error.
export function routeEvent(body: any): ZoomAction {
  const event: string = body?.event || '';

  if (event === 'endpoint.url_validation') {
    const plainToken = body?.payload?.plainToken;
    if (typeof plainToken === 'string' && plainToken.length > 0) {
      return { kind: 'url_validation', plainToken };
    }
    return { kind: 'ignored', event };
  }

  if (event === 'recording.completed') {
    const obj = body?.payload?.object || {};
    const transcriptUrl = transcriptFileUrl(obj.recording_files);
    return {
      kind: 'recording_completed',
      meetingUuid: obj.uuid || obj.meeting_uuid || '',
      topic: obj.topic || '',
      transcriptUrl,
      // Zoom includes a download_token in the payload for authenticated file
      // access on some plans; carry it through if present.
      downloadToken: body?.download_token || obj.download_token || undefined,
    };
  }

  if (event === 'meeting.ended') {
    const obj = body?.payload?.object || {};
    return { kind: 'meeting_ended', meetingUuid: obj.uuid || '', topic: obj.topic || '' };
  }

  return { kind: 'ignored', event };
}
