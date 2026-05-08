/**
 * Keyboard-shortcut configuration shared between content scripts, the
 * popup recorder, and the background. A "shortcut" is a normalised
 * description of a keyboard chord (modifiers + key) that tells the
 * content script which combination toggles inspect / click-to-source
 * navigation. The default is **Ctrl** alone (Mac users would otherwise
 * need to hold Option, which interferes with native macOS character
 * input). Any combination is configurable through the popup.
 *
 * Storage shape: `chrome.storage.local["hanzo_shortcut_inspect"] = Shortcut`.
 */

export interface Shortcut {
  /** Whether Ctrl (or Cmd on macOS) is part of the chord. */
  ctrl: boolean;
  /** Cmd/Meta key (macOS) — bound separately from Ctrl. */
  meta: boolean;
  alt: boolean;
  shift: boolean;
  /** Optional letter or `Key*` value. Empty string means modifier-only. */
  key: string;
}

export const STORAGE_KEY_INSPECT = 'hanzo_shortcut_inspect';

/**
 * Default inspect-modifier: **Ctrl** (or Cmd on macOS) alone.
 *
 * Why not Alt/Option? On macOS, Option is the system-level character-
 * compose modifier (Option-c → ç, Option-3 → £). Using Option for our
 * inspector silently swallows real user keystrokes and corrupts text
 * input on every page that has us injected. Ctrl is the natural choice
 * for a developer-tools modifier (and matches DevTools' Inspect Element
 * behaviour on every browser).
 */
export const DEFAULT_INSPECT_SHORTCUT: Shortcut = {
  ctrl: true,
  meta: false,
  alt: false,
  shift: false,
  key: '',
};

/**
 * Match a keyboard / mouse event against a Shortcut. Returns true iff
 * every required modifier is held AND every non-required modifier is
 * NOT held AND the key matches (or `key === ''` for modifier-only).
 *
 * On macOS, ctrl matches `event.metaKey` if the saved shortcut has
 * meta=true OR ctrl=true (we treat Ctrl-on-Mac and Cmd as equivalent
 * for the default — many devs assume "Ctrl" really means "the platform
 * primary modifier"). To address explicitly, set ctrl=false meta=true.
 */
export function matchesShortcut(
  e: { ctrlKey?: boolean; metaKey?: boolean; altKey?: boolean; shiftKey?: boolean; key?: string },
  s: Shortcut,
): boolean {
  // Required modifiers — every truthy field of `s` must be set on the event.
  if (s.ctrl && !e.ctrlKey) return false;
  if (s.meta && !e.metaKey) return false;
  if (s.alt && !e.altKey) return false;
  if (s.shift && !e.shiftKey) return false;
  // Forbidden modifiers — every false field of `s` must NOT be set on
  // the event. Otherwise Ctrl-only would match Ctrl-Shift-X too, which
  // would surprise users who configured Ctrl alone.
  if (!s.ctrl && e.ctrlKey) return false;
  if (!s.meta && e.metaKey) return false;
  if (!s.alt && e.altKey) return false;
  if (!s.shift && e.shiftKey) return false;
  // Key match (case-insensitive). Empty key means the chord is
  // modifier-only — any subsequent key still satisfies it.
  if (s.key && (e.key || '').toLowerCase() !== s.key.toLowerCase()) return false;
  return true;
}

/**
 * Render a Shortcut as a human-readable string like "Ctrl+Shift+K" or
 * "⌘+Click". Used by the popup UI and any place we surface the chord
 * to the user.
 */
export function formatShortcut(s: Shortcut, opts?: { mac?: boolean; click?: boolean }): string {
  const mac = opts?.mac ?? (typeof navigator !== 'undefined' && /Mac/i.test(navigator.platform || ''));
  const parts: string[] = [];
  if (s.ctrl) parts.push(mac ? '⌃' : 'Ctrl');
  if (s.meta) parts.push(mac ? '⌘' : 'Meta');
  if (s.alt) parts.push(mac ? '⌥' : 'Alt');
  if (s.shift) parts.push(mac ? '⇧' : 'Shift');
  if (s.key) parts.push(s.key.length === 1 ? s.key.toUpperCase() : s.key);
  if (opts?.click) parts.push('Click');
  return parts.join('+') || '(unset)';
}

/**
 * Normalise a fresh keydown into a Shortcut payload. Drops Tab/Esc/etc.
 * (the recorder UI invites the user to press a chord, not to navigate
 * the page) and rejects pure modifier keydowns so the recorder doesn't
 * fire on every Shift press while the user is reaching for a letter.
 */
export function shortcutFromEvent(
  e: { ctrlKey?: boolean; metaKey?: boolean; altKey?: boolean; shiftKey?: boolean; key?: string },
): Shortcut | null {
  const k = e.key || '';
  // Modifier-only is a valid shortcut, but the keydown event for a pure
  // modifier (Control / Shift / Alt / Meta) reports `key` as the
  // modifier name — record those as modifier-only.
  if (['Control', 'Meta', 'Alt', 'Shift'].includes(k)) {
    return {
      ctrl: !!e.ctrlKey,
      meta: !!e.metaKey,
      alt: !!e.altKey,
      shift: !!e.shiftKey,
      key: '',
    };
  }
  // System keys we never want to bind.
  if (['Tab', 'Escape', 'Enter', ''].includes(k)) return null;
  return {
    ctrl: !!e.ctrlKey,
    meta: !!e.metaKey,
    alt: !!e.altKey,
    shift: !!e.shiftKey,
    key: k,
  };
}

/**
 * Read the inspect shortcut from extension storage; fall back to the
 * default if absent or malformed. Always returns a valid Shortcut so
 * callers don't have to defensively re-default.
 */
export async function loadInspectShortcut(
  storage: { get(keys: string[]): Promise<Record<string, any>> },
): Promise<Shortcut> {
  try {
    const raw = await storage.get([STORAGE_KEY_INSPECT]);
    const v = raw[STORAGE_KEY_INSPECT];
    if (v && typeof v === 'object'
        && typeof v.ctrl === 'boolean'
        && typeof v.alt === 'boolean'
        && typeof v.shift === 'boolean'
        && typeof v.meta === 'boolean'
        && typeof v.key === 'string') {
      return v as Shortcut;
    }
  } catch { /* fall through */ }
  return { ...DEFAULT_INSPECT_SHORTCUT };
}

export async function saveInspectShortcut(
  storage: { set(items: Record<string, unknown>): Promise<void> },
  s: Shortcut,
): Promise<void> {
  await storage.set({ [STORAGE_KEY_INSPECT]: s });
}
