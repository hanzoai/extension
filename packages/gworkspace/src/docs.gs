/**
 * docs.gs — Google Docs host glue.
 *
 * Read the selection (or the whole body when nothing is selected), run the
 * task, and insert/replace at the cursor. Mirrors the Word path in
 * packages/office/src/host.ts.
 */

/** docsSelectionText returns the selected text, or '' when nothing is selected. */
function docsSelectionText() {
  var doc = DocumentApp.getActiveDocument();
  var sel = doc.getSelection();
  if (!sel) return '';
  var parts = [];
  var elements = sel.getRangeElements();
  for (var i = 0; i < elements.length; i++) {
    var el = elements[i];
    var e = el.getElement();
    if (!e.editAsText) continue;
    var t = e.asText().getText();
    if (el.isPartial()) t = t.substring(el.getStartOffset(), el.getEndOffsetInclusive() + 1);
    if (t) parts.push(t);
  }
  return parts.join('\n');
}

/** docsContextText is the selection if present, else the full body — the model's input. */
function docsContextText() {
  var sel = docsSelectionText();
  if (sel) return sel;
  return DocumentApp.getActiveDocument().getBody().getText();
}

/**
 * docsInsert writes the result into the doc. When there is a selection we
 * replace it; otherwise we insert at the cursor (or append to the body when
 * there is no cursor, e.g. right after a programmatic selection).
 */
function docsInsert(text) {
  var doc = DocumentApp.getActiveDocument();
  var sel = doc.getSelection();
  if (sel) {
    replaceSelection_(sel, text);
    return;
  }
  var cursor = doc.getCursor();
  if (cursor) {
    var inserted = cursor.insertText(text);
    if (inserted) doc.setCursor(doc.newPosition(inserted, text.length));
    return;
  }
  doc.getBody().appendParagraph(text);
}

// replaceSelection_ deletes the selected content and inserts the result in its
// place, at the first partial/whole element of the selection.
function replaceSelection_(sel, text) {
  var elements = sel.getRangeElements();
  var anchor = null;
  var anchorOffset = 0;
  for (var i = 0; i < elements.length; i++) {
    var el = elements[i];
    var e = el.getElement();
    if (!e.editAsText) continue;
    var t = e.asText();
    if (el.isPartial()) {
      if (anchor === null) {
        anchor = t;
        anchorOffset = el.getStartOffset();
      }
      t.deleteText(el.getStartOffset(), el.getEndOffsetInclusive());
    } else if (i === 0) {
      anchor = t;
      anchorOffset = 0;
      t.setText('');
    } else if (e.getParent() && e.getParent().getChildIndex) {
      var parent = e.getParent();
      if (parent.getNumChildren && parent.getNumChildren() > 1) e.removeFromParent();
      else t.setText('');
    }
  }
  if (anchor) anchor.insertText(anchorOffset, text);
  else DocumentApp.getActiveDocument().getBody().appendParagraph(text);
}
