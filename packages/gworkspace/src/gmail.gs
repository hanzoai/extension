/**
 * gmail.gs — Gmail host glue.
 *
 * Read the open message / thread from the contextual-trigger event and run a
 * task. The gmail.addons.current.* scopes give per-message access; the
 * current-message token must be set before reading via GmailApp. The UI action
 * handlers (ui.gs) call these, then render or draft with the result.
 */

/** gmailCurrentMessage_ resolves the GmailMessage for the current event, after
 *  authorizing the per-message access token. Returns null when there is none. */
function gmailCurrentMessage_(e) {
  if (!e || !e.gmail || !e.gmail.messageId) return null;
  if (e.gmail.accessToken) GmailApp.setCurrentMessageAccessToken(e.gmail.accessToken);
  return GmailApp.getMessageById(e.gmail.messageId);
}

/** gmailMessageText returns the plain-text body of the message in the event e. */
function gmailMessageText(e) {
  var message = gmailCurrentMessage_(e);
  if (!message) return '';
  return message.getPlainBody() || message.getBody() || '';
}

/** gmailThreadText joins the plain-text bodies of every message in the thread,
 *  each tagged with its sender — the model's input for "summarize the thread". */
function gmailThreadText(e) {
  var message = gmailCurrentMessage_(e);
  if (!message) return '';
  var messages = message.getThread().getMessages();
  var parts = [];
  for (var i = 0; i < messages.length; i++) {
    var m = messages[i];
    parts.push('From: ' + m.getFrom() + '\n' + (m.getPlainBody() || m.getBody() || ''));
  }
  return parts.join('\n\n---\n\n');
}

/** gmailDraftReply builds a compose ActionResponse that opens a reply draft on
 *  the current message, prefilled with `text`. */
function gmailDraftReply(e, text) {
  var message = gmailCurrentMessage_(e);
  var draft = message.createDraftReply(text);
  return CardService.newComposeActionResponseBuilder().setGmailDraft(draft).build();
}
