// Summarize command (no-view): summarize the selection/clipboard and copy the
// summary to the clipboard. Thin over the shared runner — all logic is in
// run-action.ts and the pure core.

import { runQuickAction, type RunActionArgs } from "./run-action.js";

export default async function Summarize(props: {
  arguments: RunActionArgs;
}): Promise<void> {
  await runQuickAction("summarize", "copy", props.arguments);
}
