/**
 * Tab ID resolution shared between Chrome (cdp-bridge.ts) and Firefox
 * (background-firefox.ts) so both bridges accept the same set of input
 * formats:
 *
 *   - number                   → returned as-is.
 *   - "tab-NNN"                → the targetId string returned by
 *                                Target.getTargets / the tabs MCP action.
 *   - "NNN"                    → bare numeric string.
 *   - undefined / null / other → null (caller falls back to active tab).
 *
 * Without this normalisation the bridges silently rejected anything that
 * wasn't already a number, which made multi-window automation impossible
 * because Target.getTargets returns string ids.
 */
export function parseTabId(raw: unknown): number | null {
  if (typeof raw === 'number' && Number.isFinite(raw)) return raw;
  if (typeof raw !== 'string') return null;
  if (raw === '') return null;                          // Number('') === 0, reject explicitly.
  // The whole string must be either "tab-NNN" or "NNN" — fully anchored
  // so a URL like "https://x.com/?tab-123" cannot be coerced into a tab id.
  const m = raw.match(/^(?:tab-)?(\d+)$/);
  if (!m) return null;
  const n = Number(m[1]);
  return Number.isFinite(n) ? n : null;
}

/**
 * Build the target portion of a sendRaw payload. Always returns an object
 * (so it composes cleanly with `tabTarget({...other_params})`). Empty when
 * the caller didn't specify any tab targeting — caller's downstream
 * handler then falls back to the active tab.
 *
 * Accepts both `tabId` (number / "tab-N" / "N") and `targetId` (string)
 * and `tabIndex` (number into current window). `tabId` wins over
 * `targetId`, `tabIndex` wins only when the others aren't present.
 */
export function tabTarget(
  source: Record<string, unknown> | undefined,
  extra?: Record<string, unknown>,
): Record<string, unknown> {
  const out: Record<string, unknown> = { ...(extra || {}) };
  if (!source) return out;
  if (source.tabId !== undefined && source.tabId !== null) {
    out.tabId = source.tabId;
  } else if (source.targetId !== undefined && source.targetId !== null) {
    out.tabId = source.targetId;
  }
  if (source.tabIndex !== undefined && source.tabIndex !== null) {
    out.tabIndex = source.tabIndex;
  }
  return out;
}

/**
 * Unwrap a CDP / extension `Runtime.evaluate` response to the bare value.
 * Handles every shape the Chrome and Firefox extensions can hand back:
 *
 *   - {result: {value: X}}                    → X       (Chrome / CDP)
 *   - {result: {value: X, type: 'number'}}    → X       (full CDP)
 *   - {result: X}                             → X       (legacy)
 *   - {value: X}                              → X       (Hanzo MCP tools)
 *   - {} (empty object from undefined Promise serialization in MV3)
 *                                              → undefined
 *   - bare value                              → value as-is
 *
 * Why: `executeScript` in Firefox MV3 returns `[undefined]` for async
 * results, which JSON-encodes to `{}`. Without explicit handling the
 * caller saw `result: {}` and couldn't tell the difference between
 * "evaluation produced an empty object" and "the bridge swallowed the
 * actual value". Now we return undefined for the empty-Promise case
 * and surface the real value for everything else.
 */
export function unwrapEvaluateResult(raw: unknown): unknown {
  if (raw === null || raw === undefined) return raw;
  if (typeof raw !== 'object') return raw;
  const obj = raw as Record<string, unknown>;
  // Most-specific shape first: {result: {value: ...}}
  const inner = obj.result;
  if (inner && typeof inner === 'object' && 'value' in (inner as object)) {
    return (inner as Record<string, unknown>).value;
  }
  // {result: bare}
  if ('result' in obj) return obj.result;
  // {value: bare} - hanzo-tools shape
  if ('value' in obj) return obj.value;
  // Empty {} -> undefined (MV3 Promise drop)
  if (Object.keys(obj).length === 0 && !Array.isArray(obj)) return undefined;
  return raw;
}
