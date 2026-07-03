/**
 * slides.gs — Google Slides host glue.
 *
 * Read the selected text (a text range inside a shape, or the shapes of the
 * selected page), run the task, and insert. Mirrors the PowerPoint path in
 * packages/office/src/host.ts.
 */

/** slidesContextText returns the selected text — a text-range selection wins,
 *  else the concatenated text of the selected page's shapes. */
function slidesContextText() {
  var sel = SlidesApp.getActivePresentation().getSelection();
  if (!sel) return '';
  var textRange = sel.getTextRange();
  if (textRange && textRange.asString()) return textRange.asString();
  return pageShapesText_(sel);
}

// pageShapesText_ joins the text of every text-bearing shape on the selected
// page — the model's input when the user selected a slide, not a text range.
function pageShapesText_(sel) {
  var page = sel.getCurrentPage();
  if (!page) return '';
  var parts = [];
  var shapes = page.getShapes();
  for (var i = 0; i < shapes.length; i++) {
    var shape = shapes[i];
    if (!shape.getText) continue;
    var t = shape.getText().asString();
    if (t && t.trim()) parts.push(t.trim());
  }
  return parts.join('\n');
}

/**
 * slidesInsert writes the result into the selected text range (replacing it), or
 * into the first text-bearing shape on the selected page, or a new text box.
 */
function slidesInsert(text) {
  var presentation = SlidesApp.getActivePresentation();
  var sel = presentation.getSelection();
  var textRange = sel && sel.getTextRange();
  if (textRange) {
    textRange.setText(text);
    return;
  }
  var page = sel && sel.getCurrentPage();
  if (!page) page = presentation.getSlides()[0];
  var shapes = page.getShapes();
  for (var i = 0; i < shapes.length; i++) {
    if (shapes[i].getText) {
      shapes[i].getText().setText(text);
      return;
    }
  }
  var box = page.insertTextBox(text);
  box.setLeft(30).setTop(30).setWidth(400).setHeight(200);
}
