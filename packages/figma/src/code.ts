// The MAIN THREAD of the plugin. It has full `figma.*` document access but NO
// DOM and NO network — so it CANNOT call @hanzo/ai. Its whole job is:
//
//   1. serialize the current selection into a plain SelectionSnapshot (data,
//      never live nodes) and post it to the iframe, and
//   2. take the TextEdit[] / inserted text the iframe computed from the model's
//      reply and mutate the document (setCharacters after loading fonts, rename,
//      insert a text node on the canvas).
//
// All the AI + parsing logic lives in the iframe (ui.ts) over design-core; this
// file is deliberately thin glue with the tricky Figma bits (font loading,
// tree walking within a node budget) that design-core cannot own because they
// touch the live document. It is intentionally NOT unit-tested (figma.* is not
// mockable in vitest); its logic footprint is kept minimal for that reason.

import {
  isUiToMain,
  type MainToUi,
  type SelectionSnapshot,
  type SerializedText,
  type SerializedNode,
  type TextEdit,
} from './messaging.js';

// A generous cap on how many nodes we walk into the snapshot. The character
// budget (design-core) is the real limiter for what's SENT; this just bounds the
// tree walk so a 10k-node frame doesn't stall the main thread. Chosen so the
// serialized text comfortably overflows the char budget before we hit it.
const MAX_NODES = 400;

// ---------------------------------------------------------------------------
// Boot: open the iframe panel and hand the UI its stored prefs.
// ---------------------------------------------------------------------------

figma.showUI(__html__, { width: 380, height: 640, themeColors: true });

/** Post a typed message to the iframe. */
function toUi(msg: MainToUi): void {
  figma.ui.postMessage(msg);
}

/** The editor we're running in, narrowed to the SelectionSnapshot union. */
function editorType(): SelectionSnapshot['editorType'] {
  const e = figma.editorType;
  return e === 'figjam' || e === 'dev' || e === 'slides' || e === 'buzz' ? e : 'figma';
}

// ---------------------------------------------------------------------------
// Selection → SelectionSnapshot.
// ---------------------------------------------------------------------------

/** A node's first solid-paint color as `#rrggbb`, or undefined. Used for the
 *  contrast/critique context. Reads the FIRST solid fill only — enough to flag
 *  contrast risks without dumping every paint. */
function solidColor(node: SceneNode): string | undefined {
  const fills = (node as GeometryMixin).fills;
  if (!Array.isArray(fills)) return undefined;
  const solid = fills.find((p): p is SolidPaint => p.type === 'SOLID' && p.visible !== false);
  if (!solid) return undefined;
  const { r, g, b } = solid.color;
  const hex = (v: number) => Math.round(v * 255).toString(16).padStart(2, '0');
  return `#${hex(r)}${hex(g)}${hex(b)}`;
}

/** Walk the selection into flat text/other-node lists, in document order, up to
 *  MAX_NODES. `depth` is measured from each selected root. Marks `truncated`
 *  when the walk hit the node cap. */
function serializeSelection(): SelectionSnapshot {
  const roots = figma.currentPage.selection;
  const texts: SerializedText[] = [];
  const nodes: SerializedNode[] = [];
  let count = 0;
  let truncated = false;

  const visit = (node: SceneNode, depth: number): void => {
    if (count >= MAX_NODES) {
      truncated = true;
      return;
    }
    count++;
    if (node.type === 'TEXT') {
      texts.push({
        id: node.id,
        name: node.name,
        characters: node.characters,
        depth,
        color: solidColor(node),
      });
    } else {
      nodes.push({ id: node.id, type: node.type, name: node.name, depth, color: solidColor(node) });
    }
    if ('children' in node) {
      for (const child of node.children) {
        if (count >= MAX_NODES) {
          truncated = true;
          break;
        }
        visit(child, depth + 1);
      }
    }
  };

  for (const root of roots) visit(root, 0);

  return { rootCount: roots.length, texts, nodes, truncated, editorType: editorType() };
}

function sendSelection(): void {
  toUi({ type: 'selection', snapshot: serializeSelection() });
}

// ---------------------------------------------------------------------------
// Apply write-backs onto the live document.
// ---------------------------------------------------------------------------

/** Set a text node's characters, loading every font the node uses first (a
 *  mixed-font node needs each range's font loaded). Figma requires this before
 *  any setCharacters. */
async function setText(node: TextNode, characters: string): Promise<void> {
  const len = node.characters.length;
  const fonts =
    len === 0
      ? [node.fontName as FontName]
      : node.getRangeAllFontNames(0, len);
  await Promise.all(fonts.map((f) => figma.loadFontAsync(f)));
  node.characters = characters;
}

/** Apply a TextEdit[] to the document: rewrite text and/or rename layers. Loads
 *  each node by id (skipping any that vanished), and reports how many stuck. */
async function applyEdits(edits: TextEdit[]): Promise<number> {
  let applied = 0;
  for (const edit of edits) {
    const node = await figma.getNodeByIdAsync(edit.id);
    if (!node || !('type' in node)) continue;
    let changed = false;
    if (edit.characters !== undefined && node.type === 'TEXT') {
      await setText(node as TextNode, edit.characters);
      changed = true;
    }
    if (edit.name !== undefined && 'name' in node) {
      (node as SceneNode).name = edit.name;
      changed = true;
    }
    if (changed) applied++;
  }
  return applied;
}

/** Insert a fresh text node with `text`, placed just below the selection (or at
 *  the viewport center when nothing is selected), and select it. The node comes
 *  with the editor's own default face; load THAT rather than naming a family,
 *  which the editor may not have. */
async function insertText(text: string): Promise<void> {
  const node = figma.createText();
  await figma.loadFontAsync(node.fontName as FontName);
  node.characters = text;

  const sel = figma.currentPage.selection[0];
  if (sel) {
    node.x = sel.x;
    node.y = sel.y + ('height' in sel ? sel.height : 0) + 24;
  } else {
    node.x = figma.viewport.center.x;
    node.y = figma.viewport.center.y;
  }
  figma.currentPage.appendChild(node);
  figma.currentPage.selection = [node];
  figma.viewport.scrollAndZoomIntoView([node]);
}

// ---------------------------------------------------------------------------
// Message pump: everything the iframe asks for, dispatched here.
// ---------------------------------------------------------------------------

figma.ui.onmessage = async (raw: unknown) => {
  if (!isUiToMain(raw)) return;
  switch (raw.type) {
    case 'ui-ready': {
      const [apiKey, model] = await Promise.all([
        figma.clientStorage.getAsync('hanzo.figma.apiKey'),
        figma.clientStorage.getAsync('hanzo.figma.model'),
      ]);
      toUi({ type: 'init', apiKey: typeof apiKey === 'string' ? apiKey : '', model: typeof model === 'string' ? model : '' });
      sendSelection();
      break;
    }
    case 'get-selection':
      sendSelection();
      break;
    case 'save-key':
      if (raw.key) await figma.clientStorage.setAsync('hanzo.figma.apiKey', raw.key);
      else await figma.clientStorage.deleteAsync('hanzo.figma.apiKey');
      break;
    case 'save-model':
      await figma.clientStorage.setAsync('hanzo.figma.model', raw.model);
      break;
    case 'apply-edits': {
      const count = await applyEdits(raw.edits);
      toUi({ type: 'applied', count });
      figma.notify(count > 0 ? `Applied ${count} edit${count === 1 ? '' : 's'}.` : 'No edits applied.');
      break;
    }
    case 'insert-text':
      await insertText(raw.text);
      figma.notify('Inserted onto canvas.');
      break;
    case 'notify':
      figma.notify(raw.message, raw.error ? { error: true } : undefined);
      break;
    case 'resize':
      figma.ui.resize(Math.max(320, raw.width), Math.max(400, raw.height));
      break;
  }
};

// Keep the panel's selection context live as the designer clicks around.
figma.on('selectionchange', sendSelection);
