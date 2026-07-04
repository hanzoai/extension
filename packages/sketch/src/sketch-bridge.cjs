// The Sketch/dom boundary: read the selection into the plain shapes design-core
// consumes (TextLayer/Selection), and write action results back onto the
// document (layer.text = …, insert a note layer). Everything the model cares
// about is a plain object here, so design-core stays pure and testable; this
// file is the ONLY place that touches the `sketch/dom` API.
//
// Sketch plugins run on JavaScriptCore (via CocoaScript), not Node — CommonJS
// (`.cjs`), not ESM. This module is required by command.cjs; it imports
// `sketch/dom` lazily inside functions so the pure exports (collectTextLayers,
// noteFrame) can be exercised in tests with a fake layer tree.

// A Sketch Text layer reports `.type === 'Text'` and carries a `.text` string.
// Groups/Artboards/SymbolInstances have `.layers`. We flatten to just the text
// layers, in document order, because the design actions operate on copy.
function collectTextLayers(layers) {
  var out = [];
  walk(layers, out);
  return out;
}

function walk(layers, out) {
  if (!layers) return;
  for (var i = 0; i < layers.length; i++) {
    var layer = layers[i];
    if (!layer) continue;
    if (layer.type === 'Text') {
      out.push({ id: layer.id, name: layer.name || '', text: layer.text || '' });
    } else if (layer.layers && layer.layers.length) {
      // Group / Artboard / SymbolMaster — recurse into children.
      walk(layer.layers, out);
    }
  }
}

// readSelection turns the current document selection into the Selection shape
// design-core expects: the flattened text layers plus the total count of
// selected layers (so critique can note non-text layers). Touches sketch/dom.
function readSelection() {
  var sketch = require('sketch/dom');
  var document = sketch.getSelectedDocument();
  if (!document) return { layers: [], totalCount: 0 };
  var selected = document.selectedLayers;
  var selectedLayers = selected ? selected.layers : [];
  return {
    layers: collectTextLayers(selectedLayers),
    totalCount: selectedLayers ? selectedLayers.length : 0,
  };
}

// applyLayerEdits writes per-layer text replacements back onto the document.
// Each edit carries the layer id from readSelection, so we look the layer up by
// id and set `.text`. Returns the count actually written. Touches sketch/dom.
function applyLayerEdits(edits) {
  var sketch = require('sketch/dom');
  var document = sketch.getSelectedDocument();
  if (!document || !edits || !edits.length) return 0;
  var byId = indexLayersById(document);
  var written = 0;
  for (var i = 0; i < edits.length; i++) {
    var edit = edits[i];
    var layer = byId[edit.id];
    if (layer && layer.type === 'Text') {
      layer.text = edit.text;
      written++;
    }
  }
  return written;
}

// indexLayersById builds an id→layer map across every page so an edit's layer
// id resolves regardless of nesting. Touches sketch/dom.
function indexLayersById(document) {
  var map = {};
  var pages = document.pages || [];
  for (var p = 0; p < pages.length; p++) {
    indexWalk(pages[p].layers, map);
  }
  return map;
}

function indexWalk(layers, map) {
  if (!layers) return;
  for (var i = 0; i < layers.length; i++) {
    var layer = layers[i];
    if (!layer) continue;
    map[layer.id] = layer;
    if (layer.layers && layer.layers.length) indexWalk(layer.layers, map);
  }
}

// insertNote drops a prose result (critique/answer) onto the canvas as a new
// Text layer near the selection, so the note is visible in the design rather
// than only in the panel. Placed on the current page just below the selection's
// bounding box. Touches sketch/dom.
function insertNote(note) {
  var sketch = require('sketch/dom');
  var document = sketch.getSelectedDocument();
  if (!document) return null;
  var page = document.selectedPage;
  var selected = document.selectedLayers ? document.selectedLayers.layers : [];
  var frame = noteFrame(selected);
  var text = new sketch.Text({
    parent: page,
    text: note.heading + '\n\n' + note.body,
    frame: frame,
    name: note.heading,
  });
  return text;
}

// noteFrame computes where to drop an inserted note: below the union of the
// selected layers' frames, or a default corner when nothing is selected. Pure
// over plain {frame:{x,y,width,height}} shapes, so it is unit-testable.
function noteFrame(selectedLayers) {
  var DEFAULT = { x: 0, y: 0, width: 360, height: 200 };
  if (!selectedLayers || !selectedLayers.length) return DEFAULT;
  var minX = Infinity;
  var maxY = -Infinity;
  var maxRight = -Infinity;
  for (var i = 0; i < selectedLayers.length; i++) {
    var f = selectedLayers[i] && selectedLayers[i].frame;
    if (!f) continue;
    minX = Math.min(minX, f.x);
    maxY = Math.max(maxY, f.y + f.height);
    maxRight = Math.max(maxRight, f.x + f.width);
  }
  if (minX === Infinity) return DEFAULT;
  var width = Math.max(360, maxRight - minX);
  return { x: minX, y: maxY + 24, width: width, height: 200 };
}

module.exports = {
  collectTextLayers: collectTextLayers,
  readSelection: readSelection,
  applyLayerEdits: applyLayerEdits,
  insertNote: insertNote,
  noteFrame: noteFrame,
};
