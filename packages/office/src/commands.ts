// The ribbon FunctionFile. Office loads commands.html (which loads this) for
// any Action of type ExecuteFunction. The Hanzo add-in's only ribbon control is
// ShowTaskpane (no ExecuteFunction), so this exists to satisfy the manifest's
// FunctionFile requirement and to host future one-click ribbon actions.

/* global Office */

Office.onReady(() => {
  /* no-op: the ribbon button opens the task pane directly */
});
