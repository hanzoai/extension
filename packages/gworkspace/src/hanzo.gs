/**
 * hanzo.gs — the Hanzo API client for the Google Workspace add-on.
 *
 * Mirrors packages/office/src/{config,chat}.ts, adapted to Apps Script:
 * requests go through UrlFetchApp (no fetch/SSE, so one non-streaming
 * completion per call) and the api.hanzo.ai/v1 gateway. The API key lives in
 * PropertiesService.getUserProperties() (per-user, roams with the account).
 *
 * The pure functions (buildMessages, requestBody, extractContent) have no Apps
 * Script dependency and are the tested core — they are re-exported for Node
 * under the guarded module.exports at the bottom (inert in Apps Script).
 */

var API_BASE_URL = 'https://api.hanzo.ai';

// Default model. Overridable per-request; the gateway routes it.
var DEFAULT_MODEL = 'zen-1';

// PropertiesService key for the pasted Hanzo `hk-` API key.
var APIKEY_PROP = 'hanzo.apiKey';
// PropertiesService key for the preferred model id.
var MODEL_PROP = 'hanzo.model';

// chatCompletionsURL / modelsURL — the model gateway endpoints. api.hanzo.ai/v1
// only; never an /api/ prefix.
function chatCompletionsURL() {
  return API_BASE_URL + '/v1/chat/completions';
}
function modelsURL() {
  return API_BASE_URL + '/v1/models';
}

/**
 * buildMessages turns a task (the user's instruction) plus a selection into the
 * OpenAI-compatible message list. Empty selection = pure generation; non-empty =
 * an operation ON the text, fenced so the model treats it as data.
 */
function buildMessages(task, selection) {
  var system = {
    role: 'system',
    content:
      'You are Hanzo AI inside a Google Workspace document. Return ONLY the text ' +
      'to insert — no preamble, no markdown fences, no "Here is". Match the ' +
      "document's tone. When given a selection, operate on it directly.",
  };
  var trimmed = (selection || '').trim();
  var user = {
    role: 'user',
    content: trimmed ? task + '\n\n---- selected text ----\n' + selection : task,
  };
  return [system, user];
}

/**
 * requestBody is the exact JSON the gateway receives. stream is always false —
 * Apps Script has no streaming reader, so every call is one-shot.
 */
function requestBody(messages, opts) {
  opts = opts || {};
  var body = {
    model: opts.model || DEFAULT_MODEL,
    messages: messages,
    stream: false,
  };
  if (opts.temperature !== undefined) body.temperature = opts.temperature;
  return body;
}

/**
 * extractContent pulls the assistant text out of an OpenAI-compatible response,
 * tolerating the shapes the gateway returns. Throws on an error payload so the
 * card surfaces the real gateway message.
 */
function extractContent(data) {
  if (data && data.error) {
    var msg = typeof data.error === 'string' ? data.error : data.error.message || 'unknown error';
    throw new Error('Hanzo API error: ' + msg);
  }
  var choice = data && data.choices && data.choices[0];
  var content =
    (choice && choice.message && choice.message.content) ||
    (choice && choice.text) ||
    (data && data.content) ||
    '';
  if (typeof content !== 'string' || content === '') {
    throw new Error('Hanzo API returned no content');
  }
  return content;
}

/**
 * parseModels pulls the routable model ids out of a /v1/models response,
 * tolerating {data:[...]}, {models:[...]}, a bare array, and string-or-object
 * entries. Pure — the network read is in listModels.
 */
function parseModels(data) {
  var items =
    (data && data.data) || (data && data.models) || (Array.isArray(data) ? data : []);
  var ids = [];
  for (var i = 0; i < items.length; i++) {
    var m = items[i];
    var id = typeof m === 'string' ? m : m && m.id;
    if (typeof id === 'string' && id.length > 0) ids.push(id);
  }
  return ids;
}

// ── UrlFetchApp calls (Apps Script only) ──────────────────────────────────

/**
 * ask runs one non-streaming completion and returns the text to insert. token
 * may be empty (the gateway serves anonymous/limited models); when present it is
 * the Hanzo `hk-` key.
 */
function ask(task, selection, token, opts) {
  var headers = {};
  if (token) headers.Authorization = 'Bearer ' + token;
  var resp = UrlFetchApp.fetch(chatCompletionsURL(), {
    method: 'post',
    contentType: 'application/json',
    headers: headers,
    payload: JSON.stringify(requestBody(buildMessages(task, selection), opts)),
    muteHttpExceptions: true,
  });
  var code = resp.getResponseCode();
  var text = resp.getContentText();
  var data;
  try {
    data = JSON.parse(text);
  } catch (e) {
    throw new Error('Hanzo API ' + code + ': ' + text.slice(0, 200));
  }
  if (code < 200 || code >= 300) {
    try {
      return extractContent(data);
    } catch (e2) {
      var m = (data && data.error && (data.error.message || data.error)) || 'HTTP ' + code;
      throw new Error('Hanzo API ' + code + ': ' + m);
    }
  }
  return extractContent(data);
}

/**
 * listModels returns the routable model ids from /v1/models. Org-scoped by the
 * bearer; an empty token lists public models. Non-fatal for callers — returns []
 * on any failure so the picker falls back to the default.
 */
function listModels(token) {
  try {
    var headers = {};
    if (token) headers.Authorization = 'Bearer ' + token;
    var resp = UrlFetchApp.fetch(modelsURL(), {
      method: 'get',
      headers: headers,
      muteHttpExceptions: true,
    });
    if (resp.getResponseCode() !== 200) return [];
    return parseModels(JSON.parse(resp.getContentText()));
  } catch (e) {
    return [];
  }
}

// ── PropertiesService: per-user API key + model preference ─────────────────

function getApiKey() {
  return PropertiesService.getUserProperties().getProperty(APIKEY_PROP) || '';
}
function setApiKey(key) {
  var props = PropertiesService.getUserProperties();
  var trimmed = (key || '').trim();
  if (trimmed) props.setProperty(APIKEY_PROP, trimmed);
  else props.deleteProperty(APIKEY_PROP);
}
function getModel() {
  return PropertiesService.getUserProperties().getProperty(MODEL_PROP) || DEFAULT_MODEL;
}
function setModel(model) {
  var props = PropertiesService.getUserProperties();
  if (model && model !== DEFAULT_MODEL) props.setProperty(MODEL_PROP, model);
  else props.deleteProperty(MODEL_PROP);
}

/**
 * runTask is the single entry every host calls: read the stored key + model,
 * ask the gateway, return the text. One code path for Docs/Sheets/Slides/Gmail.
 */
function runTask(task, selection) {
  return ask(task, selection, getApiKey(), { model: getModel() });
}

// Node-only export for unit tests (inert in Apps Script — no `module` there).
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    API_BASE_URL: API_BASE_URL,
    DEFAULT_MODEL: DEFAULT_MODEL,
    chatCompletionsURL: chatCompletionsURL,
    modelsURL: modelsURL,
    buildMessages: buildMessages,
    requestBody: requestBody,
    extractContent: extractContent,
    parseModels: parseModels,
  };
}
