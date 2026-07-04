// The single command runner shared by every quick-action command (summarize,
// explain, rewrite, translate, fix-grammar). It wires the pure core to Raycast's
// feedback UI: validate the key, capture the subject, build the request, run it,
// parse the reply, and either paste it back or copy it — with a toast for
// progress and errors. Each per-command file is then a one-liner that names its
// action id and its output mode. One code path, no repetition.

import {
  showToast,
  Toast,
  showHUD,
  closeMainWindow,
  PopToRootType,
} from "@raycast/api";
import {
  buildActionMessages,
  parseResult,
  type ActionId,
  type ActionInputs,
} from "./actions.js";
import { runChat } from "./hanzo.js";
import {
  captureSubject,
  pasteBack,
  copyResult,
  preferences,
} from "./selection.js";
import { isHanzoKey } from "./config.js";

// Output mode: paste the result over the selection (rewrite/fix/translate) or
// copy it to the clipboard (summarize/explain). Chosen per command.
export type OutputMode = "paste" | "copy";

export interface RunActionArgs {
  /** Freeform text the user typed as a Raycast argument (a tweak, a language). */
  instruction?: string;
  /** Target language for translate. */
  language?: string;
}

// runQuickAction is the whole flow for a no-view quick-action command. It is
// resilient at every boundary: a missing/invalid key, an empty subject, and a
// gateway error each surface a clear Raycast toast rather than an opaque crash.
export async function runQuickAction(
  id: ActionId,
  mode: OutputMode,
  args: RunActionArgs = {},
): Promise<void> {
  const { apiKey, model } = preferences();
  if (!isHanzoKey(apiKey)) {
    await showToast({
      style: Toast.Style.Failure,
      title: "Set your Hanzo API key",
      message: "Add your hk- key in this extension’s preferences (⌘,).",
    });
    return;
  }

  const ctx = await captureSubject();
  if (!ctx.text) {
    await showToast({
      style: Toast.Style.Failure,
      title: "Nothing to work on",
      message:
        "Select text in the frontmost app or copy it to the clipboard first.",
    });
    return;
  }

  const toast = await showToast({
    style: Toast.Style.Animated,
    title: "Asking Hanzo…",
  });

  try {
    const inputs: ActionInputs = {
      instruction: args.instruction,
      language: args.language,
    };
    const messages = buildActionMessages(id, inputs, ctx);
    const reply = await runChat(messages, { token: apiKey, model });
    const result = parseResult(reply);
    if (!result) throw new Error("Hanzo returned an empty result");

    if (mode === "paste") {
      await pasteBack(result);
      await toast.hide();
      await closeMainWindow({ popToRootType: PopToRootType.Immediate });
      await showHUD("Pasted result");
    } else {
      await copyResult(result);
      await toast.hide();
      await closeMainWindow({ popToRootType: PopToRootType.Immediate });
      await showHUD("Copied result to clipboard");
    }
  } catch (err) {
    toast.style = Toast.Style.Failure;
    toast.title = "Hanzo request failed";
    toast.message = err instanceof Error ? err.message : String(err);
  }
}
