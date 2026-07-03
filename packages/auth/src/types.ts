// The runtime-agnostic contracts a surface implements. The flow (flow.ts) is
// written ONCE against these; browser / office / vscode / cli differ only in the
// adapter they pass. This is what makes "one auth, many surfaces" real.

// TokenSet is the persisted credential — the OIDC token response, normalized.
export interface TokenSet {
  accessToken: string;
  refreshToken?: string;
  idToken?: string;
  // expiresAt is an absolute epoch-ms deadline (NOT the relative expires_in),
  // so validity is a pure comparison with the clock, storable and portable.
  expiresAt?: number;
  tokenType?: string;
  scope?: string;
}

// TokenStore is the per-surface persistence: chrome.storage (browser),
// SecretStorage (vscode), roamingSettings (office), a 0600 file (cli). Async so
// every backend fits. clear() removes the credential (logout).
export interface TokenStore {
  get(): Promise<TokenSet | null>;
  set(tokens: TokenSet): Promise<void>;
  clear(): Promise<void>;
}

// Opener drives the interactive leg: open the authorize URL and resolve with the
// full redirect URL IAM lands on (carrying ?code=&state=). Browser: a tab +
// tabs.onUpdated. Office: the Dialog API. VS Code: env.openExternal + a Uri
// handler. CLI: a loopback HTTP server. The flow never knows which.
export interface Opener {
  open(authorizeUrl: string, redirectUri: string): Promise<string>;
}
