import * as vscode from 'vscode';
import { Canceled, Session } from './iam';

/** The signed-in Hanzo IAM session. Tokens live in VS Code's SecretStorage. */
export class AuthManager {
    private static instance: AuthManager;
    private readonly session: Session;
    private readonly changed = new vscode.EventEmitter<void>();
    /** Fires on signing in and out. */
    readonly onDidChange = this.changed.event;

    private constructor(context: vscode.ExtensionContext) {
        this.session = new Session(context.secrets);
    }

    public static getInstance(context: vscode.ExtensionContext): AuthManager {
        if (!AuthManager.instance) {
            AuthManager.instance = new AuthManager(context);
        }
        return AuthManager.instance;
    }

    public async isAuthenticated(): Promise<boolean> {
        return (await this.session.tokens()) !== undefined;
    }

    /** The access token, refreshed first when it is about to expire. Null when signed out. */
    public async getAuthToken(): Promise<string | null> {
        try {
            return (await this.session.token()) ?? null;
        } catch (error) {
            console.warn('[Hanzo] Token refresh failed:', error);
            return null;
        }
    }

    /**
     * The bearer for api.hanzo.ai: the session's access token, else an IAM API
     * key from HANZO_API_KEY or the hanzo.llm.hanzo.apiKey setting.
     */
    public async bearer(): Promise<string | undefined> {
        return (await this.getAuthToken())
            || process.env.HANZO_API_KEY
            || vscode.workspace.getConfiguration('hanzo').get<string>('llm.hanzo.apiKey')
            || undefined;
    }

    /** Signs in through the browser. Resolves true once signed in. */
    public async initiateAuth(): Promise<boolean> {
        try {
            const email = await vscode.window.withProgress(
                {
                    location: vscode.ProgressLocation.Notification,
                    title: 'Signing in to Hanzo AI in your browser',
                    cancellable: true,
                },
                (_progress, cancel) => {
                    const abort = new AbortController();
                    cancel.onCancellationRequested(() => abort.abort());
                    return this.session.signIn(
                        url => vscode.env.openExternal(vscode.Uri.parse(url)),
                        { signal: abort.signal },
                    );
                },
            );
            this.changed.fire();
            vscode.window.showInformationMessage(email ? `Signed in to Hanzo AI as ${email}.` : 'Signed in to Hanzo AI.');
            return true;
        } catch (error) {
            if (!(error instanceof Canceled)) {
                vscode.window.showErrorMessage(`Hanzo AI sign-in failed: ${error instanceof Error ? error.message : String(error)}`);
            }
            return false;
        }
    }

    public async logout(): Promise<void> {
        try {
            await this.session.signOut();
        } catch (error) {
            console.warn('[Hanzo] IAM did not revoke the refresh token:', error);
        }
        this.changed.fire();
    }

    /** One line on the session, for the hanzo.debug.authState command. */
    public async describe(): Promise<string> {
        const tokens = await this.session.tokens();
        if (!tokens) {
            return 'Signed out of Hanzo AI.';
        }
        const expiry = tokens.expiresAt === undefined
            ? 'has no expiry'
            : `expires ${new Date(tokens.expiresAt).toLocaleString()}`;
        return `Signed in to Hanzo AI. The access token ${expiry}; ${tokens.refresh ? 'a refresh token renews it' : 'no refresh token renews it'}.`;
    }
}
