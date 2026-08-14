// The Raycast I/O layer: read the frontmost app's selected text (falling back to
// the clipboard), read the extension preferences (the `sk-` key + default model),
// and paste/copy a result back. This is the ONLY module that imports @raycast/api,
// so actions.ts (prompts/parsing) and hanzo.ts (@hanzo/ai) stay pure and
// unit-testable. The `chooseSubject` decision — which capture becomes the model's
// subject — is factored out pure so it CAN be tested here.

import { getPreferenceValues, getSelectedText, Clipboard } from "@raycast/api";
import { chooseSubject, type ActionContext } from "./actions.js";
import { DEFAULT_MODEL } from "./config.js";

// Preferences declared in package.json. `apiKey` is the Hanzo `sk-` key (a
// secure/password preference); `model` is the default model id sent to the
// gateway (a dropdown seeded from /v1/models, overridable). getPreferenceValues
// is typed against this shape.
export interface Preferences {
  apiKey: string;
  model?: string;
}

// preferences reads the extension preferences once. Trims the key (users paste
// with trailing whitespace) and falls back to DEFAULT_MODEL when the model
// preference is unset. The command validates the key with isHanzoKey before use.
export function preferences(): { apiKey: string; model: string } {
  const prefs = getPreferenceValues<Preferences>();
  return {
    apiKey: (prefs.apiKey ?? "").trim(),
    model: (prefs.model ?? "").trim() || DEFAULT_MODEL,
  };
}

// captureSubject reads the frontmost app's selection (or clipboard fallback) and
// returns the ActionContext to run an action against. getSelectedText throws when
// no app supports the selection API (or nothing is selected) — that is expected,
// not an error, so we swallow it and fall through to the clipboard. This is the
// impure I/O the quick-action commands call first.
export async function captureSubject(): Promise<ActionContext> {
  let selection: string | null = null;
  try {
    selection = await getSelectedText();
  } catch {
    // No selection available in the frontmost app — fall back to the clipboard.
    selection = null;
  }
  const clipboard = (await Clipboard.readText()) ?? null;
  return chooseSubject(selection, clipboard);
}

// pasteBack pastes the result into the frontmost app (replacing the selection
// when there is one), which is the ergonomic outcome for a rewrite/fix/translate:
// the corrected text lands exactly where the original was. The commands call this
// after parsing the reply.
export async function pasteBack(text: string): Promise<void> {
  await Clipboard.paste(text);
}

// copyResult copies the result to the clipboard instead of pasting — the outcome
// for a summarize/explain/ask where the user wants the answer on the clipboard,
// not injected over their document.
export async function copyResult(text: string): Promise<void> {
  await Clipboard.copy(text);
}
