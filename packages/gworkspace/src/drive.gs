/**
 * drive.gs — Google Drive host glue.
 *
 * Acts on the files selected in Drive: read each one as text, run the task over
 * them, or draft a new Google Doc from them. The add-on holds two Drive scopes
 * and no others: drive.addons.metadata.readonly (the selection's id, title and
 * MIME type) and drive.file (the files the user allows from the card, and the
 * Docs the add-on creates). The restricted drive and drive.readonly scopes are
 * never requested. DriveApp needs the full drive scope, so files are read and
 * created through the Drive REST API with the script's own token.
 */

var DRIVE_FILES_URL = 'https://www.googleapis.com/drive/v3/files/';
var DRIVE_UPLOAD_URL = 'https://www.googleapis.com/upload/drive/v3/files';
var DOC_MIME = 'application/vnd.google-apps.document';

// DRIVE_EXPORTS: the text form each Google-native type exports to. A Sheet
// exports its first sheet only, which is the Drive API's CSV contract.
var DRIVE_EXPORTS = {
  'application/vnd.google-apps.document': 'text/plain',
  'application/vnd.google-apps.spreadsheet': 'text/csv',
  'application/vnd.google-apps.presentation': 'text/plain',
};

// MAX_FILE_CHARS bounds one file's share of the prompt, so one large Sheet
// cannot push the rest of the selection out of the model's context.
var MAX_FILE_CHARS = 100000;

/**
 * driveReadURL returns the Drive API URL that yields item's text: an export for
 * a Google Doc, Sheet or Slides deck, the bytes for a text file, '' for a type
 * with no text form (folders, PDFs, images).
 */
function driveReadURL(item) {
  var id = encodeURIComponent(item.id);
  var to = DRIVE_EXPORTS[item.mimeType];
  if (to) return DRIVE_FILES_URL + id + '/export?mimeType=' + encodeURIComponent(to);
  if (/^text\/|[/+](json|xml)$/.test(item.mimeType || '')) {
    return DRIVE_FILES_URL + id + '?alt=media&supportsAllDrives=true';
  }
  return '';
}

/**
 * driveContext joins files ({title, text}) into one model input, each under
 * its title and cut at MAX_FILE_CHARS with a marker the model can see.
 */
function driveContext(files) {
  return files
    .map(function (f) {
      var text = f.text.length > MAX_FILE_CHARS ? f.text.slice(0, MAX_FILE_CHARS) + '\n[truncated]' : f.text;
      return '## ' + f.title + '\n' + text;
    })
    .join('\n\n');
}

/** draftTitle names a Doc drafted from items: their titles, cut to 100 chars. */
function draftTitle(items) {
  var name = 'Hanzo draft: ' + items.map(function (item) { return item.title; }).join(', ');
  return name.length > 100 ? name.slice(0, 99) + '…' : name;
}

/**
 * multipartBody is a Drive multipart upload: the file's metadata, then its
 * content. Plain text under a Google Doc MIME type is converted to a Doc.
 */
function multipartBody(boundary, metadata, text) {
  return (
    '--' + boundary + '\r\n' +
    'Content-Type: application/json; charset=UTF-8\r\n\r\n' +
    JSON.stringify(metadata) + '\r\n' +
    '--' + boundary + '\r\n' +
    'Content-Type: text/plain; charset=UTF-8\r\n\r\n' +
    text + '\r\n' +
    '--' + boundary + '--'
  );
}

// ── Drive API calls (Apps Script only) ─────────────────────────────────────

/** driveItems returns the readable files in the event's Drive selection. */
function driveItems(e) {
  var items = (e && e.drive && e.drive.selectedItems) || [];
  return items.filter(function (item) {
    return driveReadURL(item) !== '';
  });
}

/** driveContextText reads every readable selected file into one model input. */
function driveContextText(e) {
  var items = driveItems(e);
  if (items.length === 0) throw new Error('Select a Doc, Sheet, Slides deck or text file in Drive.');
  return driveContext(
    items.map(function (item) {
      return { title: item.title, text: driveFetch_(driveReadURL(item), item.title) };
    })
  );
}

function driveFetch_(url, title) {
  var resp = UrlFetchApp.fetch(url, {
    headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() },
    muteHttpExceptions: true,
  });
  var code = resp.getResponseCode();
  if (code === 403 || code === 404) {
    throw new Error('Hanzo cannot open "' + title + '" yet. Allow it from the card first.');
  }
  if (code !== 200) throw new Error('Drive ' + code + ' reading "' + title + '"');
  return resp.getContentText();
}

/** driveCreateDoc creates a Google Doc holding text and returns its URL. */
function driveCreateDoc(title, text) {
  var boundary = 'hanzo-' + Utilities.getUuid();
  var resp = UrlFetchApp.fetch(DRIVE_UPLOAD_URL + '?uploadType=multipart&fields=webViewLink', {
    method: 'post',
    contentType: 'multipart/related; boundary=' + boundary,
    headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() },
    payload: multipartBody(boundary, { name: title, mimeType: DOC_MIME }, text),
    muteHttpExceptions: true,
  });
  if (resp.getResponseCode() !== 200) {
    throw new Error('Drive ' + resp.getResponseCode() + ' creating the Doc: ' + resp.getContentText().slice(0, 200));
  }
  return JSON.parse(resp.getContentText()).webViewLink;
}

// Node-only export for unit tests (inert in Apps Script — no `module` there).
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    MAX_FILE_CHARS: MAX_FILE_CHARS,
    driveReadURL: driveReadURL,
    driveContext: driveContext,
    draftTitle: draftTitle,
    multipartBody: multipartBody,
    driveItems: driveItems,
  };
}
