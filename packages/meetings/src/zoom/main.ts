// Zoom App entry — the in-meeting side panel. Runs inside Zoom's embedded
// webview. It configures the Zoom Apps SDK for the capabilities we use, builds a
// PanelHost over zoomSdk, and mounts the shared assistant panel.
//
// What the in-client SDK can supply: meeting context (topic + id), the meeting
// UUID, and the participant list (with the right scopes granted). What it CANNOT
// supply in-panel is the live transcript — Zoom exposes the transcript via the
// cloud-recording REST API AFTER the meeting (that path is the webhook in
// server.ts), not to an in-meeting app. So getTranscript() returns [] here and
// the panel answers general questions live, while the recording.completed
// webhook produces the grounded post-meeting summary. This is stated honestly in
// the panel's context note rather than faked.

import zoomSdk from '@zoom/appssdk';
import { mountPanel } from '../panel/panel.js';
import type { PanelHost } from '../panel/host.js';
import type { TranscriptSegment, MeetingContext } from '../hanzo.js';

// The JS APIs the panel needs. Declared up front so config() requests exactly
// these capabilities (Zoom gates each behind a granted scope). `as const` keeps
// each entry a literal so it satisfies the SDK's Apis union.
const CAPABILITIES = [
  'getMeetingContext',
  'getMeetingUUID',
  'getMeetingParticipants',
  'getRunningContext',
  'getUserContext',
] as const;

async function buildContextMeta(): Promise<MeetingContext> {
  const meta: MeetingContext = {};
  try {
    const ctx = await zoomSdk.getMeetingContext();
    if (ctx?.meetingTopic) meta.topic = ctx.meetingTopic;
    if (ctx?.meetingID) meta.meetingId = ctx.meetingID;
  } catch {
    /* not in a meeting, or scope not granted — leave unset (honest) */
  }
  try {
    const uuid = await zoomSdk.getMeetingUUID();
    if (uuid?.meetingUUID && !meta.meetingId) meta.meetingId = uuid.meetingUUID;
  } catch {
    /* ignore */
  }
  try {
    const res = await zoomSdk.getMeetingParticipants();
    const names = (res?.participants || [])
      .map((p: any) => p?.screenName || p?.displayName)
      .filter((n: unknown): n is string => typeof n === 'string' && n.length > 0);
    if (names.length > 0) meta.participants = names;
  } catch {
    /* participant scope not granted — leave unset */
  }
  return meta;
}

const host: PanelHost = {
  name: 'Zoom',
  // The in-meeting SDK does not expose the live transcript to an app; the
  // grounded transcript summary is produced by the cloud-recording webhook after
  // the call. Returning [] is the honest answer for the live panel.
  async getTranscript(): Promise<TranscriptSegment[]> {
    return [];
  },
  getMeetingContext: buildContextMeta,
};

async function boot(): Promise<void> {
  try {
    await zoomSdk.config({ capabilities: [...CAPABILITIES], version: '0.16.0' });
  } catch {
    // Outside the Zoom client (e.g. opened directly in a browser for dev), the
    // SDK config fails; the panel still mounts and works with a pasted key.
  }
  mountPanel(host);
}

if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => void boot());
  } else {
    void boot();
  }
}
