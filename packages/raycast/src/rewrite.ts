// Rewrite command (no-view): rewrite the selection (optional tweak via argument)
// and paste it back over the selection. Thin over the shared runner.

import { runQuickAction, type RunActionArgs } from "./run-action.js";

export default async function Rewrite(props: {
  arguments: RunActionArgs;
}): Promise<void> {
  await runQuickAction("rewrite", "paste", props.arguments);
}
