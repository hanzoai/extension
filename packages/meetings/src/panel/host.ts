// PanelHost is the seam between the shared assistant panel and the two meeting
// platforms. The panel (panel/panel.ts) is host-agnostic: it renders the model
// picker, chips, prompt and streaming output, and asks the host for the two
// things only the platform can supply — the meeting's transcript and its
// metadata (topic/participants). Zoom and Meet each provide a PanelHost; the
// panel never imports a platform SDK.
//
// This is the "one way" the panel talks to a platform: values in, no coupling.

import type { TranscriptSegment, MeetingContext } from '../hanzo.js';

export interface PanelHost {
  /** Short label shown in the header (e.g. "Zoom", "Google Meet"). */
  readonly name: string;

  /**
   * The meeting transcript as ordered segments. In-panel live transcript access
   * is limited by each platform's SDK (see each host for what it can and cannot
   * read), so this may be empty during a call — the panel shows an honest note
   * and still answers general prompts. Returns [] when no transcript is
   * available rather than throwing.
   */
  getTranscript(): Promise<TranscriptSegment[]>;

  /** Meeting metadata (topic, participants, id) where the SDK permits. */
  getMeetingContext(): Promise<MeetingContext>;
}
