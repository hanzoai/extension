import * as crypto from 'crypto';
import * as http from 'http';
import type { AddressInfo } from 'net';

/**
 * Sign-in against Hanzo IAM: OAuth 2.0 authorization code with PKCE (RFC 7636)
 * and a loopback redirect (RFC 8252 section 7.3).
 *
 * A person authorizes at hanzo.id; token, refresh, revoke and userinfo go to
 * api.hanzo.ai, where the IAM API is served. iam.hanzo.ai serves only the IAM
 * web app and answers every request with HTML.
 *
 * Nothing here imports vscode, so the flow runs under plain node in tests.
 */
export const LOGIN_URL = 'https://hanzo.id';
export const API_URL = 'https://api.hanzo.ai';
export const IAM_API_PATH = '/v1/iam';

// Registered in IAM with redirect http://127.0.0.1/callback; IAM accepts any
// port on it. localhost is not registered and answers invalid redirect_uri.
export const CLIENT_ID = 'hanzo-vscode';
export const SCOPES = 'openid profile email offline_access';

const LOOPBACK = '127.0.0.1';

/** expiresAt is epoch milliseconds, absent when IAM gave no lifetime. */
export interface Tokens {
    access: string;
    refresh?: string;
    expiresAt?: number;
}

/** IAM answered with a status outside 2xx. */
export class Rejected extends Error {
    constructor(readonly status: number, message: string) {
        super(message);
        this.name = 'Rejected';
    }
}

/** The person closed the sign-in before IAM redirected back. */
export class Canceled extends Error {
    constructor() {
        super('sign-in canceled');
        this.name = 'Canceled';
    }
}

/** True within a minute of expiry, so no request leaves with a token about to lapse. */
export function expired(tokens: Tokens, now = Date.now()): boolean {
    return tokens.expiresAt !== undefined && now >= tokens.expiresAt - 60_000;
}

export function verifier(): string {
    return crypto.randomBytes(32).toString('base64url');
}

export function challenge(verifier: string): string {
    return crypto.createHash('sha256').update(verifier, 'ascii').digest('base64url');
}

// Spaces encode as %20, not URLSearchParams' '+': vscode.Uri re-encodes the
// query on its way to the browser, and a '+' can come out the far side as %2B.
export function authorizeUrl(codeChallenge: string, state: string, redirect: string, login = LOGIN_URL): string {
    const query = Object.entries({
        response_type: 'code',
        client_id: CLIENT_ID,
        redirect_uri: redirect,
        scope: SCOPES,
        state,
        code_challenge: codeChallenge,
        code_challenge_method: 'S256',
    }).map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&');
    return `${login}${IAM_API_PATH}/oauth/authorize?${query}`;
}

export interface LoginOptions {
    api?: string;
    login?: string;
    timeoutMs?: number;
    signal?: AbortSignal;
}

/**
 * Opens the authorize page with browse, waits for IAM to redirect back to a
 * one-shot loopback listener, and trades the code for tokens. Settles when that
 * finishes, the signal aborts, or timeoutMs passes.
 */
export async function login(browse: (url: string) => unknown, opts: LoginOptions = {}): Promise<Tokens> {
    const codeVerifier = verifier();
    const state = crypto.randomBytes(16).toString('base64url');
    const { server, callback } = await listen(state);
    try {
        const redirect = `http://${LOOPBACK}:${(server.address() as AddressInfo).port}/callback`;
        await browse(authorizeUrl(challenge(codeVerifier), state, redirect, opts.login));
        const url = await settle(callback, opts.timeoutMs ?? 300_000, opts.signal);
        const error = url.searchParams.get('error');
        if (error) {
            throw new Error(`IAM refused sign-in: ${url.searchParams.get('error_description') || error}`);
        }
        if (url.searchParams.get('state') !== state) {
            throw new Error('sign-in callback carried the wrong state');
        }
        const code = url.searchParams.get('code');
        if (!code) {
            throw new Error('sign-in callback carried no code');
        }
        return await exchange(code, codeVerifier, redirect, opts.api);
    } finally {
        server.close();
        server.closeAllConnections();
    }
}

export async function exchange(code: string, codeVerifier: string, redirect: string, api = API_URL): Promise<Tokens> {
    return tokens(await post(`${api}${IAM_API_PATH}/oauth/token`, {
        grant_type: 'authorization_code',
        client_id: CLIENT_ID,
        code,
        code_verifier: codeVerifier,
        redirect_uri: redirect,
    }));
}

/** IAM may rotate the refresh token; when it does not, the old one stays. */
export async function refresh(refreshToken: string, api = API_URL): Promise<Tokens> {
    return tokens(await post(`${api}${IAM_API_PATH}/oauth/token`, {
        grant_type: 'refresh_token',
        client_id: CLIENT_ID,
        refresh_token: refreshToken,
    }), refreshToken);
}

/** RFC 7009: IAM answers 200 whether or not it knew the token. */
export async function revoke(refreshToken: string, api = API_URL): Promise<void> {
    await post(`${api}${IAM_API_PATH}/oauth/revoke`, {
        client_id: CLIENT_ID,
        token: refreshToken,
        token_type_hint: 'refresh_token',
    });
}

export async function userinfo(access: string, api = API_URL): Promise<Record<string, unknown>> {
    return call(`${api}${IAM_API_PATH}/oauth/userinfo`, { headers: { Authorization: `Bearer ${access}` } });
}

/** The stored form of Tokens; the inverse of decode. */
export function encode(t: Tokens): string {
    return JSON.stringify({ access_token: t.access, refresh_token: t.refresh, expires_at: t.expiresAt });
}

/** Undefined for anything encode did not write. */
export function decode(stored: string): Tokens | undefined {
    try {
        const o = JSON.parse(stored);
        if (typeof o?.access_token !== 'string' || o.access_token === '') {
            return undefined;
        }
        const t: Tokens = { access: o.access_token };
        if (typeof o.refresh_token === 'string') {
            t.refresh = o.refresh_token;
        }
        if (typeof o.expires_at === 'number') {
            t.expiresAt = o.expires_at;
        }
        return t;
    } catch {
        return undefined;
    }
}

/** Where a Session keeps its tokens: vscode.SecretStorage has this shape. */
export interface Secrets {
    get(key: string): PromiseLike<string | undefined>;
    store(key: string, value: string): PromiseLike<void>;
    delete(key: string): PromiseLike<void>;
}

export const SECRET = 'hanzo.iam';

/**
 * The signed-in IAM session, persisted in Secrets.
 *
 * Tokens are read from the store on every use rather than cached, because every
 * VS Code window shares one SecretStorage: a window that refreshed has already
 * retired the refresh token another window would otherwise present, and IAM
 * revokes the whole chain when a retired refresh token comes back.
 */
export class Session {
    private refreshing?: Promise<string | undefined>;

    constructor(private readonly secrets: Secrets, private readonly opts: Omit<LoginOptions, 'signal' | 'timeoutMs'> = {}) {}

    async tokens(): Promise<Tokens | undefined> {
        const stored = await this.secrets.get(SECRET);
        return stored ? decode(stored) : undefined;
    }

    /** Signs in through the browser and returns the account's email when IAM shares it. */
    async signIn(browse: (url: string) => unknown, opts: Pick<LoginOptions, 'signal' | 'timeoutMs'> = {}): Promise<string | undefined> {
        const signedIn = await login(browse, { ...this.opts, ...opts });
        const info = await userinfo(signedIn.access, this.opts.api);
        await this.secrets.store(SECRET, encode(signedIn));
        return typeof info.email === 'string' ? info.email : undefined;
    }

    /** The access token, refreshed first when it is about to expire. Undefined when signed out. */
    async token(now = Date.now()): Promise<string | undefined> {
        const current = await this.tokens();
        if (!current) {
            return undefined;
        }
        if (!expired(current, now)) {
            return current.access;
        }
        this.refreshing ??= this.renew(current).finally(() => {
            this.refreshing = undefined;
        });
        return this.refreshing;
    }

    /** Forgets the tokens here, then asks IAM to revoke the refresh token. */
    async signOut(): Promise<void> {
        const current = await this.tokens();
        await this.secrets.delete(SECRET);
        if (current?.refresh) {
            await revoke(current.refresh, this.opts.api);
        }
    }

    // A 400 or 401 is IAM refusing the refresh token (RFC 6749 section 5.2), so
    // the session is over. Anything else (a network failure, a 429, a 5xx) leaves
    // the tokens for the next attempt.
    private async renew(current: Tokens): Promise<string | undefined> {
        if (!current.refresh) {
            await this.secrets.delete(SECRET);
            return undefined;
        }
        try {
            const next = await refresh(current.refresh, this.opts.api);
            await this.secrets.store(SECRET, encode(next));
            return next.access;
        } catch (e) {
            if (e instanceof Rejected && (e.status === 400 || e.status === 401)) {
                await this.secrets.delete(SECRET);
                return undefined;
            }
            throw e;
        }
    }
}

function tokens(o: Record<string, unknown>, previousRefresh?: string, now = Date.now()): Tokens {
    if (typeof o.access_token !== 'string' || o.access_token === '') {
        throw new Error('IAM token response carried no access_token');
    }
    const t: Tokens = { access: o.access_token };
    const refreshToken = typeof o.refresh_token === 'string' && o.refresh_token !== '' ? o.refresh_token : previousRefresh;
    if (refreshToken !== undefined) {
        t.refresh = refreshToken;
    }
    const lifetime = typeof o.expires_in === 'number' || typeof o.expires_in === 'string' ? Number(o.expires_in) : NaN;
    if (Number.isFinite(lifetime)) {
        t.expiresAt = now + lifetime * 1000;
    }
    return t;
}

function post(url: string, form: Record<string, string>): Promise<Record<string, unknown>> {
    return call(url, { method: 'POST', body: new URLSearchParams(form) });
}

async function call(url: string, init: RequestInit): Promise<Record<string, unknown>> {
    const path = new URL(url).pathname;
    const resp = await fetch(url, { ...init, signal: AbortSignal.timeout(30_000) });
    const body = await resp.text();
    if (!resp.ok) {
        throw new Rejected(resp.status, `${path} answered ${resp.status}: ${body.slice(0, 200)}`);
    }
    let parsed: unknown;
    try {
        parsed = JSON.parse(body);
    } catch {
        parsed = undefined;
    }
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
        throw new Error(`${path} answered ${resp.headers.get('content-type')}, not JSON: ${body.slice(0, 80)}`);
    }
    return parsed as Record<string, unknown>;
}

// The loopback listener answers the first request to /callback, whatever it
// carries, and hands its URL to login to judge.
async function listen(state: string): Promise<{ server: http.Server; callback: Promise<URL> }> {
    let arrived!: (url: URL) => void;
    const callback = new Promise<URL>(resolve => {
        arrived = resolve;
    });
    const server = http.createServer((req, res) => {
        const url = new URL(req.url ?? '/', `http://${LOOPBACK}`);
        if (url.pathname !== '/callback') {
            res.writeHead(404).end();
            return;
        }
        const ok = url.searchParams.get('state') === state && url.searchParams.has('code');
        res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end(ok ? 'Signed in to Hanzo AI. You can close this tab.' : 'Hanzo AI sign-in did not finish. Return to VS Code.');
        arrived(url);
    });
    await new Promise<void>((resolve, reject) => {
        server.once('error', reject);
        server.listen(0, LOOPBACK, resolve);
    });
    return { server, callback };
}

function settle<T>(pending: Promise<T>, timeoutMs: number, signal?: AbortSignal): Promise<T> {
    let timer: NodeJS.Timeout | undefined;
    let cancel: (() => void) | undefined;
    return new Promise<T>((resolve, reject) => {
        cancel = () => reject(new Canceled());
        timer = setTimeout(() => reject(new Error('sign-in timed out')), timeoutMs);
        if (signal?.aborted) {
            cancel();
        }
        signal?.addEventListener('abort', cancel, { once: true });
        pending.then(resolve, reject);
    }).finally(() => {
        clearTimeout(timer);
        signal?.removeEventListener('abort', cancel!);
    });
}
