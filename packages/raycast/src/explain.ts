// Explain command (no-view): explain the selection/clipboard in plain language
// and copy the explanation to the clipboard. Thin over the shared runner.

import { runQuickAction, type RunActionArgs } from "./run-action.js";

export default async function Explain(props: {
  arguments: RunActionArgs;
}): Promise<void> {
  await runQuickAction("explain", "copy", props.arguments);
}
