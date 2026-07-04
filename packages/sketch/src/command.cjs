// Plugin entry — one handler per manifest command. Each command reads the
// current selection (sketch-bridge → sketch/dom), opens the assistant WebView
// with that selection + the stored Hanzo key, and preselects the action. The
// WebView runs @hanzo/ai (the model call happens in the WebView, which has
// `fetch`), then posts results back over the bridge; this file writes them onto
// the document (layer.text = … / insert a note) via sketch-bridge.
//
// The Hanzo key is stored with `sketch/settings` (Sketch's per-plugin settings
// store) — never in the bundle, never in git.

var sketch = require('sketch');
var UI = require('sketch/ui');
var settings = require('sketch/settings');
var BrowserWindow = require('sketch-module-web-view');
var bridge = require('./sketch-bridge.cjs');

// The panel is a single WebView; opening a different action just re-focuses it
// and swaps the active action. One window identity so a user never stacks
// duplicate panels.
var WINDOW_IDENTIFIER = 'hanzo.sketch.assistant';

// Where the Hanzo key lives in the plugin settings store.
var KEY_SETTING = 'hanzoApiKey';
var MODEL_SETTING = 'hanzoModel';

function getKey() {
  return settings.settingForKey(KEY_SETTING) || '';
}

function getModel() {
  return settings.settingForKey(MODEL_SETTING) || '';
}

// open builds (or re-focuses) the assistant WebView for a given action, seeds it
// with the current selection + stored key/model, and wires the message bridge.
function open(context, action) {
  var selection = bridge.readSelection();
  if (!selection.layers.length && (action === 'rewrite' || action === 'translate' || action === 'contentfill')) {
    UI.message('Select one or more text layers first.');
    return;
  }

  var existing = BrowserWindow.fromId(WINDOW_IDENTIFIER);
  var win =
    existing ||
    new BrowserWindow({
      identifier: WINDOW_IDENTIFIER,
      title: 'Hanzo AI',
      width: 420,
      height: 640,
      minWidth: 360,
      minHeight: 420,
      show: false,
      alwaysOnTop: true,
      webPreferences: { devTools: false },
    });

  var webContents = win.webContents;

  // Bridge: the WebView asks the plugin to persist the key, to apply per-layer
  // edits, or to insert a note. Registered once per window open; safe to
  // re-register (replaces the prior handler) when re-focusing.
  webContents.on('saveKey', function (payload) {
    settings.setSettingForKey(KEY_SETTING, (payload && payload.key) || '');
    if (payload && typeof payload.model === 'string') {
      settings.setSettingForKey(MODEL_SETTING, payload.model);
    }
    UI.message('Hanzo key saved.');
  });

  webContents.on('applyEdits', function (payload) {
    var edits = (payload && payload.edits) || [];
    var n = bridge.applyLayerEdits(edits);
    UI.message(n + ' layer' + (n === 1 ? '' : 's') + ' updated.');
    webContents.executeJavaScript('window.__hanzoApplied && window.__hanzoApplied(' + n + ')');
  });

  webContents.on('insertNote', function (payload) {
    if (payload && payload.note) {
      bridge.insertNote(payload.note);
      UI.message('Note added to canvas.');
    }
  });

  webContents.on('refreshSelection', function () {
    seed(webContents, bridge.readSelection(), action);
  });

  win.loadURL(webviewURL(context));

  // Seed after the page is ready so the WebView has the selection/action/key
  // before it renders.
  webContents.on('did-finish-load', function () {
    seed(webContents, selection, action);
    win.show();
  });
  if (existing) {
    // Already loaded — seed immediately and refocus.
    seed(webContents, selection, action);
    win.show();
  }
}

// seed pushes the runtime state into the WebView: the selection to act on, the
// preselected action, and the stored key/model. The WebView owns the model call
// from here.
function seed(webContents, selection, action) {
  var payload = {
    selection: selection,
    action: action,
    key: getKey(),
    model: getModel(),
  };
  webContents.executeJavaScript(
    'window.__hanzoSeed && window.__hanzoSeed(' + JSON.stringify(payload) + ')',
  );
}

// webviewURL resolves the bundled webview.html inside the .sketchplugin
// Resources dir. context.plugin.urlForResourceNamed is the Sketch API for it.
function webviewURL(context) {
  var url = context.plugin.urlForResourceNamed('webview.html');
  return url ? url.absoluteString() : '';
}

// One exported handler per manifest command. Names match manifest.json.
module.exports = {
  onCritique: function (context) {
    open(context, 'critique');
  },
  onRewrite: function (context) {
    open(context, 'rewrite');
  },
  onTranslate: function (context) {
    open(context, 'translate');
  },
  onContentFill: function (context) {
    open(context, 'contentfill');
  },
  onAsk: function (context) {
    open(context, 'ask');
  },
};
