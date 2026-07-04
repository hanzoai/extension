/**
 * context.js — the pure context-shaping helpers, mirrored from Apex HanzoContext
 * so the Node side (build tooling, any future orchestrator) truncates a record
 * context identically to the platform. No Salesforce dependency — unit-tested
 * under vitest. The Apex copy in HanzoContext.truncate is the source of truth for
 * the running org; this keeps the two in lockstep and testable off-platform.
 *
 * Character budget: ~4 chars/token, so ~12k chars ≈ a few thousand tokens, well
 * under any model's context, leaving room for the system prompt + completion.
 */

export const MAX_CONTEXT_CHARS = 12000;

const MARKER = '\n… [truncated]';

/**
 * truncate keeps the head of a context block within a character budget, appending
 * a marker so the model knows content was elided. Byte-for-byte the same behavior
 * as Apex HanzoContext.truncate: length <= max passes through; otherwise keep
 * (max - markerLength) chars and append the marker so the result is exactly max.
 *
 * @param {string} text
 * @param {number} [maxChars=MAX_CONTEXT_CHARS]
 * @returns {string}
 */
export function truncate(text, maxChars = MAX_CONTEXT_CHARS) {
  if (text == null) {
    return '';
  }
  if (text.length <= maxChars) {
    return text;
  }
  const keep = Math.max(0, maxChars - MARKER.length);
  return text.slice(0, keep) + MARKER;
}
