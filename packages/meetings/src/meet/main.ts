// Google Meet add-on entry — the side-panel web app. Runs inside Meet's add-on
// iframe. It creates an add-on session, gets the side-panel client, builds a
// PanelHost over it, and mounts the shared assistant panel.
//
// What the Meet Add-ons SDK supplies in-panel: meeting info (meetingId +
// meetingCode) via getMeetingInfo(). Like Zoom, the SDK does NOT hand a live
// transcript to a side-panel add-on — Meet transcripts are produced by the Meet
// REST API / Workspace after the meeting, gated by admin policy and user
// consent. So getTranscript() returns [] and the panel answers live questions,
// staying honest about scope in its context note. (A future server path can
// pull the Meet REST transcript the same way the Zoom webhook pulls the VTT.)
//
// The add-on's Google Cloud project number is stamped at build time (the Meet
// SDK requires it to create a session) — see build.js / HANZO_MEET_GCP_PROJECT.

import { meet, type MeetSidePanelClient } from '@googleworkspace/meet-addons/meet.addons';
import { mountPanel } from '../panel/panel.js';
import type { PanelHost } from '../panel/host.js';
import type { TranscriptSegment, MeetingContext } from '../hanzo.js';

// Stamped by build.js from HANZO_MEET_GCP_PROJECT. The Meet SDK needs the
// add-on's Google Cloud project number to open a session.
declare const HANZO_MEET_GCP_PROJECT: string;

let sidePanel: MeetSidePanelClient | undefined;

async function buildContextMeta(): Promise<MeetingContext> {
  const meta: MeetingContext = {};
  if (!sidePanel) return meta;
  try {
    const info = await sidePanel.getMeetingInfo();
    if (info?.meetingId) meta.meetingId = info.meetingId;
    // Meet's meetingCode (aaa-bbbb-ccc) is the human-facing label; use it as the
    // topic when no richer title is available.
    if (info?.meetingCode) meta.topic = `Meet ${info.meetingCode}`;
  } catch {
    /* session not ready or info unavailable — leave unset (honest) */
  }
  return meta;
}

const host: PanelHost = {
  name: 'Google Meet',
  // The side-panel SDK does not expose the live transcript; a grounded summary
  // comes from the post-meeting REST transcript path. [] is the honest answer.
  async getTranscript(): Promise<TranscriptSegment[]> {
    return [];
  },
  getMeetingContext: buildContextMeta,
};

async function boot(): Promise<void> {
  try {
    const session = await meet.addon.createAddonSession({
      cloudProjectNumber: HANZO_MEET_GCP_PROJECT,
    });
    sidePanel = await session.createSidePanelClient();
  } catch {
    // Opened outside Meet (dev in a plain browser) — the panel still mounts and
    // works with a pasted key; getMeetingContext just returns empty metadata.
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
