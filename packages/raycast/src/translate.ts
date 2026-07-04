// Translate command (no-view): translate the selection into a target language
// (passed as a Raycast argument, e.g. "Spanish") and paste it back. Thin over the
// shared runner — the language flows into the translate action's prompt builder.

import { runQuickAction } from "./run-action.js";

export default async function Translate(props: {
  arguments: { language?: string };
}): Promise<void> {
  await runQuickAction("translate", "paste", {
    language: props.arguments.language,
  });
}
