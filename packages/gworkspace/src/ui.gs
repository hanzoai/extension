/**
 * ui.gs — CardService UI + every add-on entry point.
 *
 * The manifest's runFunction names all resolve here: homepage triggers per host,
 * the Gmail contextual + compose triggers, the settings/universal actions, and
 * the button callbacks. The cards read/write through hanzo.gs (the API client)
 * and the per-host glue (docs/sheets/slides/gmail.gs).
 *
 * The quick actions mirror the office task pane's chips: Draft, Summarize,
 * Explain, Tighten (redline), Continue — plus Gmail-specific reply/actions.
 */

// QUICK_ACTIONS: the preset instructions, one source of truth for every host's
// action chips. { key, label, task } — task is empty for Draft (free prompt).
var QUICK_ACTIONS = [
  { key: 'draft', label: 'Draft', task: '' },
  { key: 'summarize', label: 'Summarize', task: 'Summarize the selection concisely.' },
  { key: 'explain', label: 'Explain', task: 'Explain the selection in plain language.' },
  {
    key: 'tighten',
    label: 'Tighten (redline)',
    task: 'Tighten and clarify the selection as a redline edit. Keep the meaning; cut the fluff.',
  },
  { key: 'continue', label: 'Continue', task: 'Continue writing from where the selection ends.' },
];

// GMAIL_ACTIONS: Gmail-specific presets over the open message/thread.
var GMAIL_ACTIONS = [
  {
    key: 'summarize_thread',
    label: 'Summarize thread',
    task: 'Summarize this email thread: the ask, the decisions, and the open questions.',
  },
  {
    key: 'action_items',
    label: 'Extract action items',
    task: 'Extract the concrete action items from this email as a short bullet list. Who owes what.',
  },
  {
    key: 'draft_reply',
    label: 'Draft a reply',
    task: 'Draft a professional reply to this email. Return only the reply body.',
  },
];

// ── Colors / branding ──────────────────────────────────────────────────────

var BRAND = 'Hanzo AI';
var ICON_URL = 'https://hanzo.ai/assets/icon-128.png';

// ── Homepage triggers (one per host + the common fallback) ─────────────────

function onHomepage(e) {
  return buildHomeCard_(hostFromEvent_(e), null);
}
function onDocsHomepage(e) {
  return buildHomeCard_('docs', null);
}
function onSheetsHomepage(e) {
  return buildHomeCard_('sheets', null);
}
function onSlidesHomepage(e) {
  return buildHomeCard_('slides', null);
}
function onGmailHomepage(e) {
  return buildHomeCard_('gmail', null);
}

// onGmailMessage — Gmail contextual trigger: an open message. Same card, with a
// note that the actions read the open message.
function onGmailMessage(e) {
  return buildHomeCard_('gmail', null);
}

// hostFromEvent_ reads the host from the common event; defaults to a generic card.
function hostFromEvent_(e) {
  var host = e && e.commonEventObject && e.commonEventObject.hostApp;
  if (host === 'DOCS') return 'docs';
  if (host === 'SHEETS') return 'sheets';
  if (host === 'SLIDES') return 'slides';
  if (host === 'GMAIL') return 'gmail';
  return 'docs';
}

// ── Home card ──────────────────────────────────────────────────────────────

/**
 * buildHomeCard_ renders the sidebar: header, an onboarding hint when no key is
 * set, the model picker, a free-prompt field, the quick-action buttons, and (on
 * a prior run) the result with Insert. `state` carries prompt/output between
 * button clicks (CardService is stateless — we thread it through form inputs).
 */
function buildHomeCard_(host, state) {
  var hasKey = !!getApiKey();
  var card = CardService.newCardBuilder().setHeader(
    CardService.newCardHeader().setTitle(BRAND).setImageUrl(ICON_URL).setSubtitle(hostLabel_(host))
  );

  if (!hasKey) {
    card.addSection(onboardingSection_());
    return card.build();
  }

  card.addSection(promptSection_(host, state));
  card.addSection(actionsSection_(host));
  if (state && state.output) card.addSection(outputSection_(host, state));
  card.setFixedFooter(settingsFooter_());
  return card.build();
}

// onboardingSection_ — shown until an API key is saved: a one-tap path to keys +
// the paste field.
function onboardingSection_() {
  var section = CardService.newCardSection().setHeader('Get started');
  section.addWidget(
    CardService.newTextParagraph().setText(
      'Paste a Hanzo API key to use your models. Create one at ' +
        '<b>console.hanzo.ai/api-keys</b>.'
    )
  );
  section.addWidget(
    CardService.newTextButton()
      .setText('Get an API key')
      .setOpenLink(CardService.newOpenLink().setUrl('https://console.hanzo.ai/api-keys'))
  );
  section.addWidget(apiKeyInput_(''));
  section.addWidget(
    CardService.newTextButton()
      .setText('Save key')
      .setOnClickAction(CardService.newAction().setFunctionName('onSaveKey'))
  );
  return section;
}

// promptSection_ — the model picker + the free-prompt textarea.
function promptSection_(host, state) {
  var section = CardService.newCardSection();
  section.addWidget(modelPicker_());
  section.addWidget(
    CardService.newTextInput()
      .setFieldName('prompt')
      .setTitle('Ask Hanzo')
      .setHint('e.g. "draft an NDA mutual-confidentiality clause"')
      .setMultiline(true)
      .setValue(state && state.prompt ? state.prompt : '')
  );
  section.addWidget(
    CardService.newTextButton()
      .setText('Run')
      .setTextButtonStyle(CardService.TextButtonStyle.FILLED)
      .setOnClickAction(actionFor_('onRun', host, ''))
  );
  return section;
}

// actionsSection_ — the quick-action chips (per host). Each button runs its
// preset task through the current host's read → ask → (output card) path.
function actionsSection_(host) {
  var section = CardService.newCardSection().setHeader('Quick actions');
  var actions = host === 'gmail' ? GMAIL_ACTIONS : QUICK_ACTIONS;
  for (var i = 0; i < actions.length; i++) {
    var a = actions[i];
    if (a.key === 'draft') continue; // Draft = the free prompt above
    var fn = a.key === 'draft_reply' ? 'onDraftReply' : 'onRun';
    section.addWidget(
      CardService.newTextButton().setText(a.label).setOnClickAction(actionFor_(fn, host, a.task))
    );
  }
  return section;
}

// outputSection_ — the last result with Insert (host-specific) + Copy hint.
function outputSection_(host, state) {
  var section = CardService.newCardSection().setHeader('Result');
  section.addWidget(CardService.newTextParagraph().setText(escapeHtml_(state.output)));
  if (host !== 'gmail') {
    section.addWidget(
      CardService.newTextButton()
        .setText('Insert into document')
        .setTextButtonStyle(CardService.TextButtonStyle.FILLED)
        .setOnClickAction(actionFor_('onInsert', host, '').setParameters({ output: state.output }))
    );
  }
  return section;
}

// settingsFooter_ — persistent footer button to the settings card. Uses the
// card-action handler (pushCard), NOT the universal action (which returns a
// different response type).
function settingsFooter_() {
  return CardService.newFixedFooter().setPrimaryButton(
    CardService.newTextButton()
      .setText('Settings')
      .setOnClickAction(CardService.newAction().setFunctionName('onOpenSettings'))
  );
}

// ── Model picker + inputs ──────────────────────────────────────────────────

function modelPicker_() {
  var current = getModel();
  var picker = CardService.newSelectionInput()
    .setType(CardService.SelectionInputType.DROPDOWN)
    .setTitle('Model')
    .setFieldName('model')
    .setOnChangeAction(CardService.newAction().setFunctionName('onSelectModel'));
  var ids = listModels(getApiKey());
  if (ids.indexOf(current) === -1) ids.unshift(current);
  if (ids.length === 0) ids = [DEFAULT_MODEL];
  for (var i = 0; i < ids.length; i++) {
    picker.addItem(ids[i], ids[i], ids[i] === current);
  }
  return picker;
}

function apiKeyInput_(value) {
  return CardService.newTextInput()
    .setFieldName('apikey')
    .setTitle('Hanzo API key (sk-…)')
    .setHint('Stored per-user, never leaves your account.')
    .setValue(value || '');
}

// ── Settings card ──────────────────────────────────────────────────────────

// settingsCard_ builds the settings card — one definition, two entry points
// (the universal action and the in-card footer button) that wrap it in their
// respective response types.
function settingsCard_() {
  var card = CardService.newCardBuilder().setHeader(
    CardService.newCardHeader().setTitle('Hanzo AI — Settings')
  );
  var section = CardService.newCardSection().setHeader('API key');
  section.addWidget(
    CardService.newTextParagraph().setText(
      'Create a key at <b>console.hanzo.ai/api-keys</b> and paste it below. ' +
        'It is stored in your per-user properties and sent only to api.hanzo.ai.'
    )
  );
  section.addWidget(apiKeyInput_(getApiKey()));
  section.addWidget(
    CardService.newTextButton()
      .setText('Save key')
      .setTextButtonStyle(CardService.TextButtonStyle.FILLED)
      .setOnClickAction(CardService.newAction().setFunctionName('onSaveKey'))
  );
  section.addWidget(
    CardService.newTextButton()
      .setText('Clear key')
      .setOnClickAction(CardService.newAction().setFunctionName('onClearKey'))
  );
  card.addSection(section);
  return card.build();
}

// onSettings — the manifest universal action. Returns a UniversalActionResponse.
function onSettings(e) {
  return CardService.newUniversalActionResponseBuilder()
    .displayAddOnCards([settingsCard_()])
    .build();
}

// onOpenSettings — the in-card footer button. Returns an ActionResponse that
// pushes the settings card onto the navigation stack.
function onOpenSettings(e) {
  return CardService.newActionResponseBuilder()
    .setNavigation(CardService.newNavigation().pushCard(settingsCard_()))
    .build();
}

// ── Action handlers ────────────────────────────────────────────────────────

// onSaveKey persists the pasted key. From the settings sub-card we pop back to
// the home card underneath (already the right host); from the onboarding card
// (no card beneath) we render a fresh home card so the prompt UI appears.
function onSaveKey(e) {
  var key = formValue_(e, 'apikey');
  setApiKey(key);
  return notifyAndReturn_(e, key ? 'API key saved.' : 'API key cleared.');
}

function onClearKey(e) {
  setApiKey('');
  return notifyAndReturn_(e, 'API key cleared.');
}

// onSelectModel persists the picked model (no reload needed — the choice sticks
// via PropertiesService and the next Run/action reads it).
function onSelectModel(e) {
  setModel(formValue_(e, 'model'));
  return CardService.newActionResponseBuilder()
    .setNotification(CardService.newNotification().setText('Model set.'))
    .build();
}

/**
 * onRun is the single button handler for the free prompt AND every quick action
 * across Docs/Sheets/Slides/Gmail. It reads the host's context, asks the
 * gateway, and re-renders the home card with the result.
 */
function onRun(e) {
  var host = paramHost_(e);
  var presetTask = paramTask_(e);
  var prompt = presetTask || formValue_(e, 'prompt');
  if (!prompt) return notify_('Type an instruction or pick an action first.');
  try {
    var context = readContext_(host, e);
    var output = runTask(prompt, context);
    return CardService.newActionResponseBuilder()
      .setNavigation(
        CardService.newNavigation().updateCard(
          buildHomeCard_(host, { prompt: prompt, output: output })
        )
      )
      .build();
  } catch (err) {
    return notify_(errMessage_(err));
  }
}

/**
 * onInsert writes the last result into the host document (Docs/Sheets/Slides).
 * The output was threaded through the button's parameters.
 */
function onInsert(e) {
  var host = paramHost_(e);
  var output = e && e.parameters && e.parameters.output;
  if (!output) return notify_('Nothing to insert.');
  try {
    insertResult_(host, output);
    return notify_('Inserted into the ' + hostLabel_(host) + '.');
  } catch (err) {
    return notify_(errMessage_(err));
  }
}

/**
 * onDraftReply (Gmail) generates a reply and opens it as a Gmail draft — the
 * compose ActionResponse.
 */
function onDraftReply(e) {
  try {
    var body = gmailThreadText(e) || gmailMessageText(e);
    var task = 'Draft a professional reply to this email. Return only the reply body.';
    var reply = runTask(task, body);
    return gmailDraftReply(e, reply);
  } catch (err) {
    return notify_(errMessage_(err));
  }
}

/**
 * onGmailCompose (compose trigger, from the manifest composeTrigger) drafts body
 * text for the message the user is composing and inserts it into the open draft.
 * The compose context has no "current message"; it drafts from the recipients /
 * subject the user already typed, or a brief professional email otherwise.
 */
function onGmailCompose(e) {
  try {
    var draft = e && e.draftMetadata;
    var hint = draft
      ? 'To: ' + (draft.toRecipients || []).join(', ') + '\nSubject: ' + (draft.subject || '')
      : '';
    var task =
      'Draft a professional email body. Return only the body text — no subject, no signature.';
    var body = runTask(task, hint);
    return CardService.newUpdateDraftActionResponseBuilder()
      .setUpdateDraftBodyAction(
        CardService.newUpdateDraftBodyAction()
          .addUpdateContent(body, CardService.ContentType.PLAIN_TEXT)
          .setUpdateType(CardService.UpdateDraftBodyType.IN_PLACE_INSERT)
      )
      .build();
  } catch (err) {
    return notify_(errMessage_(err));
  }
}

// ── Host read/insert dispatch ──────────────────────────────────────────────

function readContext_(host, e) {
  switch (host) {
    case 'docs':
      return docsContextText();
    case 'sheets':
      return sheetsContextText();
    case 'slides':
      return slidesContextText();
    case 'gmail':
      return gmailThreadText(e) || gmailMessageText(e);
    default:
      return '';
  }
}

function insertResult_(host, text) {
  switch (host) {
    case 'docs':
      docsInsert(text);
      return;
    case 'sheets':
      sheetsInsert(text);
      return;
    case 'slides':
      slidesInsert(text);
      return;
    default:
      throw new Error('This host does not support insert.');
  }
}

// ── Small helpers ──────────────────────────────────────────────────────────

// actionFor_ builds an Action for `fn` carrying the host + task as parameters
// (CardService actions can only pass string params, so we thread state here).
function actionFor_(fn, host, task) {
  return CardService.newAction()
    .setFunctionName(fn)
    .setParameters({ host: host, task: task || '' });
}

function paramHost_(e) {
  return (e && e.parameters && e.parameters.host) || hostFromEvent_(e);
}
function paramTask_(e) {
  return (e && e.parameters && e.parameters.task) || '';
}

// formValue_ reads a form input value from the CardService event.
function formValue_(e, field) {
  if (!e || !e.commonEventObject || !e.commonEventObject.formInputs) return '';
  var input = e.commonEventObject.formInputs[field];
  if (!input || !input.stringInputs || !input.stringInputs.value) return '';
  return input.stringInputs.value[0] || '';
}

function notify_(text) {
  return CardService.newActionResponseBuilder()
    .setNotification(CardService.newNotification().setText(text))
    .build();
}

// notifyAndReturn_ shows a toast and rebuilds the host's home card in place, so
// saving a key from onboarding reveals the prompt UI and saving from settings
// returns to a current home card (root card — replaces the whole stack).
function notifyAndReturn_(e, text) {
  var host = hostFromEvent_(e);
  return CardService.newActionResponseBuilder()
    .setNotification(CardService.newNotification().setText(text))
    .setNavigation(CardService.newNavigation().updateCard(buildHomeCard_(host, null)))
    .setStateChanged(true)
    .build();
}

function hostLabel_(host) {
  return { docs: 'Docs', sheets: 'Sheets', slides: 'Slides', gmail: 'Gmail' }[host] || 'Workspace';
}

function escapeHtml_(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function errMessage_(err) {
  return err && err.message ? String(err.message) : String(err);
}
