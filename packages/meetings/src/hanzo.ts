// The Hanzo call and its request/response shaping — pure, host-agnostic, and
// fully unit-testable (no zoomSdk, no Meet SDK, no DOM). The panel and the
// server are the thin glue that read the meeting transcript/context and hand it
// here. Speaks the OpenAI-compatible /v1 wire protocol the whole Hanzo suite
// uses (identical to @hanzo/pdf and @hanzo/office-addin) so the gateway sees one
// shape from every surface.
//
// On @hanzo/ai: the meetings package depends on @hanzo/ai + @hanzo/iam (the
// shared headless client + identity), and the browser panel is free to route
// through createAiClient(). This module is the transcript-aware core the client
// wraps — the windowing/truncation and summary-prompt assembly that a *meeting*
// surface adds on top of a generic chat call, kept pure so it can be tested and
// reused by both the panel and the (browser-less) webhook server.

import {
  chatCompletionsURL,
  modelsURL,
  DEFAULT_MODEL,
  TRANSCRIPT_CHAR_BUDGET,
} from './config.js';

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

// SYSTEM_PROMPT grounds every meeting answer in the transcript. It forbids
// inventing statements nobody made (the failure mode that makes a meeting
// assistant untrustworthy), asks for speaker attribution when the transcript
// carries it, and stays honest about a truncated transcript.
export const SYSTEM_PROMPT =
  'You are Hanzo AI, an assistant inside a live video meeting (Zoom or Google Meet). ' +
  'Answer ONLY from the meeting transcript and context provided below — never invent ' +
  'statements, decisions, or attributions that are not supported by the transcript. ' +
  'Attribute points to speakers when the transcript names them. Be concise and ' +
  'structured. If the transcript is marked truncated and a complete answer needs the ' +
  'omitted part, say so plainly rather than guessing.';

// ---- Transcript windowing / truncation -----------------------------------
//
// A transcript arrives as ordered segments (one utterance each), optionally with
// a speaker and a timestamp. We window them down to what we will actually send,
// newest-relevant first is NOT what we want for a summary (order carries
// meaning), so we walk IN ORDER from the start and stop at the budget — always
// including at least the first segment.

// One utterance in a transcript. speaker/ts are optional because Zoom's VTT and
// Meet's captions do not always carry both.
export interface TranscriptSegment {
  speaker?: string;
  /** Free-form timestamp label as it appears in the source (e.g. "00:04:12"). */
  ts?: string;
  text: string;
}

// The result of windowing a transcript down to what we'll attach: the rendered
// text, how many of the source segments it covers, and whether anything was
// dropped (so the prompt and UI can say so honestly).
export interface TranscriptContext {
  text: string;
  totalSegments: number;
  includedSegments: number;
  truncated: boolean;
}

// renderSegment turns one utterance into a single transcript line. Pure so the
// exact rendering (used to measure the budget) is what we also send.
export function renderSegment(seg: TranscriptSegment): string {
  const who = seg.speaker ? seg.speaker.trim() : '';
  const t = seg.ts ? seg.ts.trim() : '';
  const prefix = who && t ? `[${t}] ${who}: ` : who ? `${who}: ` : t ? `[${t}] ` : '';
  return `${prefix}${seg.text.trim()}`;
}

// buildTranscriptContext caps the rendered transcript at `budget` characters. It
// walks segments IN ORDER and stops when adding the next line would exceed the
// budget — always including at least the first segment (hard-cut to the budget
// if that one line alone is over). `truncated` is true whenever not every
// segment made it in. Pure and total: deterministic, no I/O.
export function buildTranscriptContext(
  segments: TranscriptSegment[],
  budget: number = TRANSCRIPT_CHAR_BUDGET,
): TranscriptContext {
  const total = segments.length;
  if (total === 0) {
    return { text: '', totalSegments: 0, includedSegments: 0, truncated: false };
  }

  const lines: string[] = [];
  let used = 0;
  let hardCut = false;

  for (let i = 0; i < total; i++) {
    const line = renderSegment(segments[i]);
    const addition = (lines.length === 0 ? '' : '\n') + line;
    if (used + addition.length > budget) {
      if (lines.length === 0) {
        // First line overflows alone — hard-cut so we always return something.
        lines.push(line.slice(0, budget));
        used = budget;
        hardCut = true;
      }
      break;
    }
    lines.push(addition);
    used += addition.length;
  }

  const includedSegments = hardCut ? 1 : lines.length;
  const truncated = includedSegments < total || hardCut;
  return { text: lines.join(''), totalSegments: total, includedSegments, truncated };
}

// parseVtt parses a WebVTT transcript (the format Zoom's cloud-recording
// transcript download returns) into ordered segments. It is lenient: it reads
// cue timing lines for the start timestamp, treats a leading "Name:" on the cue
// text as the speaker, and skips the WEBVTT header, NOTE blocks, and numeric
// cue ids. Pure — the network fetch that gets the VTT lives in the server; this
// is the parse it feeds. Unknown/blank input yields an empty array (honest: no
// throw, the caller sees "no transcript").
export function parseVtt(vtt: string): TranscriptSegment[] {
  const segments: TranscriptSegment[] = [];
  // Cues are separated by blank lines. Normalize newlines first.
  const blocks = vtt.replace(/\r\n/g, '\n').split(/\n\n+/);
  for (const block of blocks) {
    const lines = block.split('\n').map((l) => l.trim()).filter((l) => l.length > 0);
    if (lines.length === 0) continue;
    if (lines[0].toUpperCase().startsWith('WEBVTT')) continue;
    if (lines[0].toUpperCase().startsWith('NOTE')) continue;

    let idx = 0;
    // Optional numeric/string cue id line (no '-->').
    if (!lines[idx].includes('-->')) idx++;
    // Timing line: "00:00:01.000 --> 00:00:04.000 ...".
    let ts: string | undefined;
    if (idx < lines.length && lines[idx].includes('-->')) {
      ts = lines[idx].split('-->')[0].trim().split('.')[0]; // start, drop ms
      idx++;
    }
    const textLines = lines.slice(idx);
    if (textLines.length === 0) continue;
    let text = textLines.join(' ').trim();
    if (text.length === 0) continue;

    // "Speaker Name: utterance" → split speaker off the front.
    let speaker: string | undefined;
    const m = text.match(/^([^:]{1,60}):\s+(.*)$/);
    if (m) {
      speaker = m[1].trim();
      text = m[2].trim();
    }
    if (text.length === 0) continue;
    segments.push({ speaker, ts, text });
  }
  return segments;
}

// contextNote is the one honest sentence prepended to the transcript so the
// model (and, echoed in the panel, the user) knows the scope of what it sees.
// Never claim the whole meeting was sent when it wasn't.
export function contextNote(ctx: TranscriptContext): string {
  if (ctx.totalSegments === 0) return 'No transcript is available for this meeting yet.';
  return ctx.truncated
    ? `Transcript: ${ctx.includedSegments} of ${ctx.totalSegments} segments (truncated to fit — answer only from what is shown and say so if the omitted part is needed).`
    : `Transcript: the full meeting (${ctx.totalSegments} segment${ctx.totalSegments === 1 ? '' : 's'}).`;
}

// ---- Prompt assembly ------------------------------------------------------

// Optional structured context about the meeting that the SDKs can supply
// (participants, topic, id). Attached as a short header above the transcript so
// answers can reference who was present without the model guessing.
export interface MeetingContext {
  topic?: string;
  participants?: string[];
  meetingId?: string;
}

function meetingHeader(meta: MeetingContext | undefined): string {
  if (!meta) return '';
  const parts: string[] = [];
  if (meta.topic) parts.push(`Meeting: ${meta.topic}`);
  if (meta.participants && meta.participants.length > 0) {
    parts.push(`Participants: ${meta.participants.join(', ')}`);
  }
  return parts.length > 0 ? parts.join('\n') + '\n\n' : '';
}

// buildMessages turns a task (the user's instruction, or one of the quick-action
// prompts) plus the windowed transcript + optional meeting metadata into the
// OpenAI-compatible message list. The transcript is fenced so the model treats
// it as data, not instructions, and the honest context note rides inside the
// user turn so it is never lost.
export function buildMessages(
  task: string,
  ctx: TranscriptContext,
  meta?: MeetingContext,
): ChatMessage[] {
  const system: ChatMessage = { role: 'system', content: SYSTEM_PROMPT };
  const header = meetingHeader(meta);
  const user: ChatMessage = {
    role: 'user',
    content:
      `${header}${contextNote(ctx)}\n\n` +
      `---- meeting transcript ----\n${ctx.text}\n---- end transcript ----\n\n` +
      `---- task ----\n${task}`,
  };
  return [system, user];
}

// Quick actions — the chips the panel offers. Named so both the panel UI and the
// webhook summary path draw the exact same wording (DRY: the auto-summary a
// recording.completed event produces is the same "Summarize" the user clicks).
export const QUICK_ACTIONS = {
  summary:
    'Write a concise summary of this meeting: the purpose, the key points discussed, ' +
    'and the decisions made. Use short paragraphs or bullets.',
  actionItems:
    'Extract the action items from this meeting as a checklist. For each: the owner ' +
    '(if named), the task, and any due date mentioned. If none were assigned, say so.',
  followupEmail:
    'Draft a short, professional follow-up email to the participants: thank them, ' +
    'recap the decisions, and list next steps with owners. Return only the email body.',
} as const;

export interface ChatOptions {
  model?: string;
  temperature?: number;
  /** Request an SSE stream. Defaults to false (one-shot completion). */
  stream?: boolean;
  signal?: AbortSignal;
}

// requestBody is the exact JSON the gateway receives. Separated so a test can
// assert the wire shape (model default, stream flag, messages) without a network
// call. `stream` defaults to false — the one-shot contract.
export function requestBody(messages: ChatMessage[], opts: ChatOptions = {}): Record<string, unknown> {
  return {
    model: opts.model || DEFAULT_MODEL,
    messages,
    stream: opts.stream === true,
    ...(opts.temperature !== undefined ? { temperature: opts.temperature } : {}),
  };
}

// extractContent pulls the assistant text out of an OpenAI-compatible completion
// response, tolerating the shapes the gateway returns. Throws on an error
// payload so the caller surfaces the real gateway message.
export function extractContent(data: any): string {
  if (data && data.error) {
    const msg = typeof data.error === 'string' ? data.error : data.error.message || 'unknown error';
    throw new Error(`Hanzo API error: ${msg}`);
  }
  const choice = data?.choices?.[0];
  const content = choice?.message?.content ?? choice?.text ?? data?.content ?? '';
  if (typeof content !== 'string' || content === '') {
    throw new Error('Hanzo API returned no content');
  }
  return content;
}

// ask runs one non-streaming completion and returns the answer. token may be
// empty (the gateway serves anonymous/limited models); when present it is the
// bearer (a pasted sk- key or an IAM token).
export async function ask(
  task: string,
  ctx: TranscriptContext,
  token: string,
  meta?: MeetingContext,
  opts: ChatOptions = {},
): Promise<string> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  const resp = await fetch(chatCompletionsURL(), {
    method: 'POST',
    headers,
    body: JSON.stringify(requestBody(buildMessages(task, ctx, meta), opts)),
    signal: opts.signal,
  });
  const text = await resp.text();
  let data: any;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error(`Hanzo API ${resp.status}: ${text.slice(0, 200)}`);
  }
  if (!resp.ok) {
    try {
      return extractContent(data);
    } catch {
      const m = data?.error?.message || data?.error || `HTTP ${resp.status}`;
      throw new Error(`Hanzo API ${resp.status}: ${m}`);
    }
  }
  return extractContent(data);
}

// streamDelta pulls the incremental text out of one OpenAI-compatible SSE frame
// payload (the JSON after `data: `). Pure, so the SSE parse is unit-testable.
export function streamDelta(payload: string): string {
  const json = JSON.parse(payload);
  return json?.choices?.[0]?.delta?.content ?? '';
}

// askStream runs a streaming completion, invoking onDelta with each text chunk
// as it arrives, and resolves with the full concatenated text. Same inputs as
// `ask`; the panel uses it for live-typing output. Throws on a non-2xx.
export async function askStream(
  task: string,
  ctx: TranscriptContext,
  token: string,
  onDelta: (text: string) => void,
  meta?: MeetingContext,
  opts: ChatOptions = {},
): Promise<string> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  const resp = await fetch(chatCompletionsURL(), {
    method: 'POST',
    headers,
    body: JSON.stringify(requestBody(buildMessages(task, ctx, meta), { ...opts, stream: true })),
    signal: opts.signal,
  });
  if (!resp.ok || !resp.body) {
    const detail = await resp.text().catch(() => '');
    throw new Error(`Hanzo API ${resp.status}${detail ? `: ${detail.slice(0, 200)}` : ''}`);
  }
  const reader = resp.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let full = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const parts = buffer.split('\n');
    buffer = parts.pop() ?? '';
    for (const line of parts) {
      const trimmed = line.trim();
      if (!trimmed.startsWith('data:')) continue;
      const payload = trimmed.slice(5).trim();
      if (payload === '[DONE]') return full;
      try {
        const delta = streamDelta(payload);
        if (delta) {
          full += delta;
          onDelta(delta);
        }
      } catch {
        // partial SSE frame — wait for the next chunk
      }
    }
  }
  return full;
}

// summarizeTranscript is the server-side one-shot: window the transcript, build
// the summary prompt, and return the summary. This is what the recording.completed
// webhook calls after downloading the VTT — no browser, no streaming, one bearer.
export async function summarizeTranscript(
  segments: TranscriptSegment[],
  token: string,
  meta?: MeetingContext,
  opts: ChatOptions = {},
): Promise<string> {
  const ctx = buildTranscriptContext(segments);
  return ask(QUICK_ACTIONS.summary, ctx, token, meta, opts);
}

// listModels returns the model ids the caller may route to, from /v1/models. The
// endpoint is org-scoped by the bearer; an empty token lists public models.
export async function listModels(token: string): Promise<string[]> {
  const headers: Record<string, string> = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  const resp = await fetch(modelsURL(), { headers });
  if (!resp.ok) throw new Error(`Hanzo API ${resp.status}: model list failed`);
  const data: any = await resp.json();
  const items = data?.data ?? data?.models ?? (Array.isArray(data) ? data : []);
  return items
    .map((m: any) => (typeof m === 'string' ? m : m?.id))
    .filter((id: unknown): id is string => typeof id === 'string' && id.length > 0);
}
