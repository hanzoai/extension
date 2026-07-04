// The Tauri I/O layer: read the system clipboard (the text the frontmost app
// copied), write a result back to it, and paste it over the frontmost app via the
// Rust `paste` command. This is the ONLY frontend module that imports Tauri APIs,
// so actions.ts (prompts/parsing), hanzo.ts (@hanzo/ai), and store.ts (settings)
// stay pure and unit-testable. The `chooseSubject` decision — which capture
// becomes the model's subject — is factored into actions.ts so it CAN be tested.

import { readText, writeText } from "@tauri-apps/plugin-clipboard-manager";
import { invoke } from "@tauri-apps/api/core";
import { chooseSubject, type ActionContext } from "./actions.js";

// captureSubject reads the system clipboard and returns the ActionContext to run
// an action against. readText resolves to "" when the clipboard is empty or holds
// non-text; either way chooseSubject collapses it to an empty context. This is the
// impure I/O the quick-action commands call first.
export async function captureSubject(): Promise<ActionContext> {
  let clipboard: string | null = null;
  try {
    clipboard = await readText();
  } catch {
    // Clipboard empty or non-text — treat as no subject.
    clipboard = null;
  }
  return chooseSubject(clipboard);
}

// copyResult copies the result to the clipboard — the outcome for a
// summarize/explain/ask where the user wants the answer on the clipboard, not
// injected over their document. The app calls this after parsing the reply.
export async function copyResult(text: string): Promise<void> {
  await writeText(text);
}

// pasteBack copies the result to the clipboard and asks the Rust shell to hide the
// assistant window and synthesize a paste keystroke into the frontmost app — the
// ergonomic outcome for a rewrite/fix/translate: the corrected text lands where
// the original was. The `paste` command is implemented in src-tauri; when the OS
// denies synthetic input (e.g. macOS Accessibility not yet granted) the text is
// still on the clipboard for a manual paste, and the command returns that state.
export async function pasteBack(text: string): Promise<void> {
  await writeText(text);
  await invoke("paste");
}

// hideWindow asks the Rust shell to hide the assistant window (the same as losing
// focus or pressing the hotkey again). The app calls this after a copy-only action
// so the panel gets out of the way.
export async function hideWindow(): Promise<void> {
  await invoke("hide_window");
}
