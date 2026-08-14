// The app's local settings store: the pasted `sk-` key and the default model,
// persisted in the webview's localStorage. The pure serialization (parse / merge /
// serialize) is factored out so it is unit-testable with no DOM; the DOM adapter
// (loadSettings / saveSettings) is the thin boundary that touches localStorage.
//
// The `sk-` key never leaves this machine — it is written only to the webview's
// origin-scoped localStorage and sent only to api.hanzo.ai as the bearer via
// @hanzo/ai. No secret is bundled, no secret is committed.

import { DEFAULT_MODEL, STORE_KEY, isHanzoKey } from "./config.js";

// Settings the app persists. `apiKey` is the Hanzo `sk-` key (empty until the user
// pastes one); `model` is the default model id sent to the gateway.
export interface Settings {
  apiKey: string;
  model: string;
}

// DEFAULT_SETTINGS is the state of a fresh install: no key yet, the default Zen
// model. loadSettings falls back to this when nothing (or garbage) is stored.
export const DEFAULT_SETTINGS: Settings = { apiKey: "", model: DEFAULT_MODEL };

// parseSettings turns a raw stored string into Settings, tolerating anything: null
// (nothing stored), invalid JSON, a non-object, or missing/wrong-typed fields all
// collapse to DEFAULT_SETTINGS-filled values. Pure and total — the boundary guard
// for what may be sitting in localStorage. A stored key that no longer matches the
// `sk-` shape is dropped (treated as absent) so a corrupted key can't be sent.
export function parseSettings(raw: string | null): Settings {
  if (!raw) return { ...DEFAULT_SETTINGS };
  let obj: unknown;
  try {
    obj = JSON.parse(raw);
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
  if (typeof obj !== "object" || obj === null) return { ...DEFAULT_SETTINGS };
  const rec = obj as Record<string, unknown>;
  const rawKey = typeof rec.apiKey === "string" ? rec.apiKey.trim() : "";
  const apiKey = isHanzoKey(rawKey) ? rawKey : "";
  const model =
    typeof rec.model === "string" && rec.model.trim()
      ? rec.model.trim()
      : DEFAULT_MODEL;
  return { apiKey, model };
}

// mergeSettings applies a partial update over the current settings, trimming the
// key and normalizing an empty/blank model back to the default. Pure — the single
// place a settings edit is validated before it is serialized. An invalid key
// (wrong shape) is rejected here and returned in `error` so the settings pane can
// show it without persisting garbage.
export function mergeSettings(
  current: Settings,
  patch: Partial<Settings>,
): { settings: Settings; error?: string } {
  const next: Settings = { ...current };
  if (patch.apiKey !== undefined) {
    const key = patch.apiKey.trim();
    if (key === "") {
      next.apiKey = "";
    } else if (isHanzoKey(key)) {
      next.apiKey = key;
    } else {
      return {
        settings: current,
        error: "Not a Hanzo key — expected an sk- key from hanzo.id.",
      };
    }
  }
  if (patch.model !== undefined) {
    next.model = patch.model.trim() || DEFAULT_MODEL;
  }
  return { settings: next };
}

// serializeSettings is the single settings→string path written to localStorage.
// Pure; the inverse of parseSettings.
export function serializeSettings(s: Settings): string {
  return JSON.stringify(s);
}

// ---- DOM adapter ----------------------------------------------------------
//
// The two impure functions the app calls. They are the ONLY code here that touches
// localStorage; everything above is pure and tested. localStorage is unavailable
// only in a non-DOM context (it always exists in the Tauri webview), so these
// guard defensively and fall back to defaults rather than throw.

// loadSettings reads and parses the stored settings, or DEFAULT_SETTINGS on a
// fresh install / unavailable storage.
export function loadSettings(): Settings {
  try {
    return parseSettings(globalThis.localStorage?.getItem(STORE_KEY) ?? null);
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

// saveSettings serializes and writes the settings. Best-effort; a storage failure
// is swallowed (the in-memory settings still drive the session).
export function saveSettings(s: Settings): void {
  try {
    globalThis.localStorage?.setItem(STORE_KEY, serializeSettings(s));
  } catch {
    // Storage unavailable / quota — the session's in-memory settings still apply.
  }
}
