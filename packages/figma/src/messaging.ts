// The typed postMessage protocol between the two halves of a Figma plugin: the
// main thread (code.ts — full `figma.*` document access, NO network/DOM) and the
// iframe (ui.ts — DOM + network to @hanzo/ai, NO document access). Figma wires
// them with `figma.ui.postMessage(msg)` / `onmessage` on the main side and
// `parent.postMessage({ pluginMessage: msg }, '*')` / `window.onmessage` on the
// iframe side. Everything crossing this boundary is plain, structured-clonable
// DATA — never a live SceneNode, only the serialized snapshot below — so the
// AI call happens in the iframe and the node mutations happen in the main thread,
// each in its own lane. This module is PURE type + tiny constructors: it is
// shared by both bundles and is the single source of truth for the wire shape.

// ---------------------------------------------------------------------------
// Serialized selection — the snapshot code.ts sends to the iframe as context.
// ---------------------------------------------------------------------------

/** One text node lifted out of the selection: a stable id to write back to, the
 *  layer name, the current characters, and where it sits in the tree (depth) so
 *  the model sees structure. Colors are captured for contrast/critique. */
export interface SerializedText {
  /** figma node id — the address code.ts uses to write the result back. */
  id: string;
  /** The layer name (also editable by the rename action). */
  name: string;
  /** The current text content. */
  characters: string;
  /** Nesting depth under the selection roots (0 = a selection root). */
  depth: number;
  /** Solid fill color as `#rrggbb`, when the node has one — for contrast notes. */
  color?: string;
}

/** One non-text node in the structure (frame, rectangle, group, …): enough to
 *  describe the layout and hierarchy for critique/rename without its geometry. */
export interface SerializedNode {
  id: string;
  /** figma node type, e.g. 'FRAME', 'RECTANGLE', 'GROUP', 'INSTANCE'. */
  type: string;
  name: string;
  depth: number;
  /** Solid fill color as `#rrggbb`, when the node has one. */
  color?: string;
}

/** The full snapshot of the current selection code.ts hands to the iframe. Text
 *  nodes are separated from other nodes because the writable actions (rewrite,
 *  translate, fill, rename) target text, while critique/rename read the whole
 *  structure. `truncated` is set when the budget dropped nodes, so the prompt
 *  and the panel can say so honestly. */
export interface SelectionSnapshot {
  /** How many nodes the user actually selected (the roots). */
  rootCount: number;
  /** Every text node under the selection, in document order. */
  texts: SerializedText[];
  /** Every non-text node under the selection, in document order. */
  nodes: SerializedNode[];
  /** True when the budget forced us to drop nodes from this snapshot. */
  truncated: boolean;
  /** Editor the plugin is running in, so the persona can adapt (figma/figjam). */
  editorType: 'figma' | 'figjam' | 'dev' | 'slides' | 'buzz';
}

// ---------------------------------------------------------------------------
// One text write-back — the result the iframe sends to code.ts to apply.
// ---------------------------------------------------------------------------

/** A single "set this node's text (and/or name) to this" instruction. The main
 *  thread loads the node by id, loads its fonts, and applies the change. */
export interface TextEdit {
  id: string;
  /** New text content, when the action rewrote the copy. */
  characters?: string;
  /** New layer name, when the action renamed the layer. */
  name?: string;
}

// ---------------------------------------------------------------------------
// Messages FROM the iframe (ui.ts) TO the main thread (code.ts).
// ---------------------------------------------------------------------------

export type UiToMain =
  /** UI booted and wants the current selection + the stored key/model. */
  | { type: 'ui-ready' }
  /** Re-serialize and resend the current selection (e.g. user clicked Refresh). */
  | { type: 'get-selection' }
  /** Persist the pasted key to clientStorage (empty string clears it). */
  | { type: 'save-key'; key: string }
  /** Persist the chosen model id to clientStorage. */
  | { type: 'save-model'; model: string }
  /** Apply text/name edits back onto the selected nodes. */
  | { type: 'apply-edits'; edits: TextEdit[] }
  /** Insert a fresh text node (a variant) onto the canvas near the selection. */
  | { type: 'insert-text'; text: string }
  /** Surface a short status line in Figma's toast (notify). */
  | { type: 'notify'; message: string; error?: boolean }
  /** Resize the plugin window to fit the panel. */
  | { type: 'resize'; width: number; height: number };

// ---------------------------------------------------------------------------
// Messages FROM the main thread (code.ts) TO the iframe (ui.ts).
// ---------------------------------------------------------------------------

export type MainToUi =
  /** The stored credentials/prefs, sent once on boot so the UI restores state. */
  | { type: 'init'; apiKey: string; model: string }
  /** A fresh selection snapshot for the panel to build context from. */
  | { type: 'selection'; snapshot: SelectionSnapshot }
  /** Confirmation that N edits were applied (or the reason none were). */
  | { type: 'applied'; count: number; message?: string };

/** Narrow a raw `figma.ui.onmessage` payload to a UiToMain. Boundary guard on the
 *  main thread — the iframe is less trusted than internal code. */
export function isUiToMain(msg: unknown): msg is UiToMain {
  return typeof msg === 'object' && msg !== null && typeof (msg as { type?: unknown }).type === 'string';
}

/** Narrow a raw `window.onmessage` `event.data.pluginMessage` to a MainToUi. */
export function isMainToUi(msg: unknown): msg is MainToUi {
  return typeof msg === 'object' && msg !== null && typeof (msg as { type?: unknown }).type === 'string';
}
