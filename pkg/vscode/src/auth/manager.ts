import * as vscode from 'vscode';
import * as crypto from 'crypto';
import axios from 'axios';
import { getConfig } from '../config';

interface AuthState {
    client_id: string;
    authorization_session_id: string;
}

export class AuthManager {
    private context: vscode.ExtensionContext;
    private static instance: AuthManager;
    private pollingInterval?: NodeJS.Timeout;
    private config = getConfig();

    private constructor(context: vscode.ExtensionContext) {
        this.context = context;
    }

    public static getInstance(context: vscode.ExtensionContext): AuthManager {
        if (!AuthManager.instance) {
            AuthManager.instance = new AuthManager(context);
        }
        return AuthManager.instance;
    }

    private generateRandomToken(length: number = 32): string {
        return crypto.randomBytes(length).toString('hex');
    }

    private async getOrCreateClientId(): Promise<string> {
        let clientId = await this.context.secrets.get('client_id');
        if (!clientId) {
            clientId = this.generateRandomToken();
            await this.context.secrets.store('client_id', clientId);
        }
        return clientId;
    }

    private async getStoredToken(): Promise<string | undefined> {
        return this.context.secrets.get('auth_token');
    }

    private async storeToken(token: string): Promise<void> {
        await this.context.secrets.store('auth_token', token);
    }

    private async clearToken(): Promise<void> {
        await this.context.secrets.delete('auth_token');
    }

    public async isAuthenticated(): Promise<boolean> {
        const token = await this.getStoredToken();
        return !!token;
    }

    public async getAuthToken(): Promise<string | null> {
        const token = await this.getStoredToken();
        if (token) {
            return token;
        }
        return null;
    }

    private async startPolling(authState: AuthState): Promise<void> {
        if (this.pollingInterval) {
            clearInterval(this.pollingInterval);
        }

        return new Promise<void>((resolve, reject) => {
            let attempts = 0;
            const maxAttempts = 120; // 10 minutes maximum polling time

            this.pollingInterval = setInterval(async () => {
                try {
                    attempts++;
                    if (attempts > maxAttempts) {
                        clearInterval(this.pollingInterval);
                        reject(new Error('Authentication timed out'));
                        return;
                    }

                    const response = await axios.post('https://auth.hanzo.ai/api/check-auth', {
                        client_id: authState.client_id,
                        authorization_session_id: authState.authorization_session_id
                    });

                    if (response.data?.token) {
                        clearInterval(this.pollingInterval);
                        await this.storeToken(response.data.token);
                        resolve();
                    }
                } catch (error) {
                    console.error('[Hanzo] Auth polling error:', error);
                    // Don't reject here, continue polling
                }
            }, 5000); // Poll every 5 seconds
        });
    }

    public async initiateAuth(): Promise<void> {
        try {
            const clientId = await this.getOrCreateClientId();
            const authState: AuthState = {
                client_id: clientId,
                authorization_session_id: this.generateRandomToken()
            };

            // Store the auth state temporarily
            await this.context.globalState.update('auth_state', authState);

            // Open browser for authentication
            const authUrl = new URL('https://auth.hanzo.ai/start');
            authUrl.searchParams.append('client_id', authState.client_id);
            authUrl.searchParams.append('authorization_session_id', authState.authorization_session_id);
            await vscode.env.openExternal(vscode.Uri.parse(authUrl.toString()));

            // Start polling for auth completion
            await this.startPolling(authState);

            // Clear temporary auth state
            await this.context.globalState.update('auth_state', undefined);
        } catch (error) {
            console.error('[Hanzo] Auth initiation error:', error);
            throw new Error('Failed to initiate authentication');
        }
    }

    public async logout(): Promise<void> {
        await this.clearToken();
        if (this.pollingInterval) {
            clearInterval(this.pollingInterval);
        }
    }
}