/**
 * auth.gs — Hanzo IAM sign-in for the Workspace add-on.
 *
 * Authorization code + PKCE against hanzo.id, on the HIP-0111 paths under
 * /v1/iam, run by the OAuth2 for Apps Script library (appsscript.json
 * dependencies.libraries, userSymbol OAuth2). The client is hanzo-gworkspace,
 * a public client: it holds no secret, and the PKCE verifier proves the code
 * exchange. Its redirect is this script's own callback,
 * https://script.google.com/macros/d/<SCRIPT_ID>/usercallback, registered on
 * the client in the IAM app graph (universe iam-provision.yaml).
 *
 * The token set lives in the user's PropertiesService and the library refreshes
 * it under the user lock. IAM rotates refresh tokens and revokes the whole
 * family on a replayed one, so two executions refreshing at once would sign the
 * user out; the lock is what serializes them.
 */

var IAM_CLIENT_ID = 'hanzo-gworkspace';
var IAM_AUTHORIZE_URL = 'https://hanzo.id/v1/iam/oauth/authorize';
var IAM_TOKEN_URL = 'https://api.hanzo.ai/v1/iam/oauth/token';
var IAM_SCOPES = 'openid profile email offline_access';

/**
 * hanzoService_ is the one IAM OAuth2 service. The verifier is two UUIDs
 * (java.util.UUID, SecureRandom) rather than the library's generateCodeVerifier,
 * which draws from Math.random. The library carries it to the callback inside
 * the encrypted state token.
 */
function hanzoService_() {
  return OAuth2.createService('hanzo')
    .setAuthorizationBaseUrl(IAM_AUTHORIZE_URL)
    .setTokenUrl(IAM_TOKEN_URL)
    .setClientId(IAM_CLIENT_ID)
    .setScope(IAM_SCOPES)
    .setCallbackFunction('authCallback')
    .setCodeVerififer(Utilities.getUuid() + Utilities.getUuid())
    .setTokenPayloadHandler(publicPayload)
    .setPropertyStore(PropertiesService.getUserProperties())
    .setCache(CacheService.getUserCache())
    .setLock(LockService.getUserLock());
}

/**
 * publicPayload drops client_secret from a token request. The library always
 * sets the key, and with no secret configured its value is undefined; a public
 * client presents no secret at all, so IAM authenticates the exchange by PKCE.
 */
function publicPayload(payload) {
  delete payload.client_secret;
  return payload;
}

/**
 * accessToken returns a live IAM access token, refreshing an expired one. With
 * no session it throws the add-on's sign-in prompt, which the host renders in
 * place of the card that asked.
 */
function accessToken() {
  var service = hanzoService_();
  if (service.hasAccess()) return service.getAccessToken();
  CardService.newAuthorizationException()
    .setAuthorizationUrl(service.getAuthorizationUrl())
    .setResourceDisplayName('Hanzo')
    .setCustomUiCallback('onSignInCard')
    .throwException();
}

/** endSession drops the stored token set, so the next accessToken() prompts. */
function endSession() {
  hanzoService_().reset();
}

/** signOut ends the session and throws the sign-in prompt. */
function signOut() {
  endSession();
  accessToken();
}

/**
 * onSignInCard is the custom authorization prompt a public Marketplace listing
 * requires: who is asking, what it does once allowed, and a sign-in button whose
 * authorization action reloads the add-on when the window closes.
 */
function onSignInCard() {
  var url = hanzoService_().getAuthorizationUrl();
  var section = CardService.newCardSection()
    .addWidget(CardService.newImage().setImageUrl(ICON_URL).setAltText('Hanzo AI'))
    .addWidget(
      CardService.newTextParagraph().setText(
        'Sign in with your Hanzo account at <b>hanzo.id</b>. Hanzo AI then sends ' +
          'the text or files you pick here to your models at api.hanzo.ai and ' +
          'returns the answer. Nothing is sent until you run an action.'
      )
    )
    .addWidget(
      CardService.newTextButton()
        .setText('Sign in to Hanzo')
        .setTextButtonStyle(CardService.TextButtonStyle.FILLED)
        .setAuthorizationAction(CardService.newAuthorizationAction().setAuthorizationUrl(url))
    );
  return [CardService.newCardBuilder().addSection(section).build()];
}

/** authCallback completes the code exchange at the script's usercallback URL. */
function authCallback(request) {
  var message;
  try {
    message = hanzoService_().handleCallback(request)
      ? 'Signed in to Hanzo. This window closes itself.'
      : 'Sign-in was cancelled.';
  } catch (err) {
    message = 'Sign-in failed: ' + (err && err.message ? err.message : String(err));
  }
  return HtmlService.createHtmlOutput(
    '<p>' + escapeHtml_(message) + '</p><script>window.top.close()</script>'
  );
}

// Node-only export for unit tests (inert in Apps Script — no `module` there).
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    IAM_CLIENT_ID: IAM_CLIENT_ID,
    IAM_AUTHORIZE_URL: IAM_AUTHORIZE_URL,
    IAM_TOKEN_URL: IAM_TOKEN_URL,
    IAM_SCOPES: IAM_SCOPES,
    hanzoService_: hanzoService_,
    publicPayload: publicPayload,
    accessToken: accessToken,
    endSession: endSession,
    signOut: signOut,
  };
}
