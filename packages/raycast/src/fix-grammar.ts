// Fix Grammar command (no-view): correct grammar/spelling/punctuation of the
// selection and paste the corrected text back over it. Thin over the shared
// runner.

import { runQuickAction } from "./run-action.js";

export default async function FixGrammar(): Promise<void> {
  await runQuickAction("fixGrammar", "paste");
}
