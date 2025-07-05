"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || function (mod) {
    if (mod && mod.__esModule) return mod;
    var result = {};
    if (mod != null) for (var k in mod) if (k !== "default" && Object.prototype.hasOwnProperty.call(mod, k)) __createBinding(result, mod, k);
    __setModuleDefault(result, mod);
    return result;
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.AuthManager = void 0;
const vscode = __importStar(require("vscode"));
const crypto = __importStar(require("crypto"));
const axios_1 = __importDefault(require("axios"));
const config_1 = require("../config");
class AuthManager {
    constructor(context) {
        this.config = (0, config_1.getConfig)();
        this.context = context;
    }
    static getInstance(context) {
        if (!AuthManager.instance) {
            AuthManager.instance = new AuthManager(context);
        }
        return AuthManager.instance;
    }
    generateRandomToken(length = 32) {
        return crypto.randomBytes(length).toString('hex');
    }
    async getOrCreateClientId() {
        let clientId = await this.context.secrets.get('client_id');
        if (!clientId) {
            clientId = this.generateRandomToken();
            await this.context.secrets.store('client_id', clientId);
        }
        return clientId;
    }
    async getStoredToken() {
        return this.context.secrets.get('auth_token');
    }
    async storeToken(token) {
        await this.context.secrets.store('auth_token', token);
    }
    async clearToken() {
        await this.context.secrets.delete('auth_token');
    }
    async isAuthenticated() {
        const token = await this.getStoredToken();
        return !!token;
    }
    async getAuthToken() {
        const token = await this.getStoredToken();
        if (token) {
            return token;
        }
        return null;
    }
    async startPolling(authState) {
        if (this.pollingInterval) {
            clearInterval(this.pollingInterval);
        }
        return new Promise((resolve, reject) => {
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
                    const response = await axios_1.default.post('https://auth.hanzo.ai/api/check-auth', {
                        client_id: authState.client_id,
                        authorization_session_id: authState.authorization_session_id
                    });
                    if (response.data?.token) {
                        clearInterval(this.pollingInterval);
                        await this.storeToken(response.data.token);
                        resolve();
                    }
                }
                catch (error) {
                    console.error('[Hanzo] Auth polling error:', error);
                    // Don't reject here, continue polling
                }
            }, 5000); // Poll every 5 seconds
        });
    }
    async initiateAuth() {
        try {
            const clientId = await this.getOrCreateClientId();
            const authState = {
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
        }
        catch (error) {
            console.error('[Hanzo] Auth initiation error:', error);
            throw new Error('Failed to initiate authentication');
        }
    }
    async logout() {
        await this.clearToken();
        if (this.pollingInterval) {
            clearInterval(this.pollingInterval);
        }
    }
}
exports.AuthManager = AuthManager;
//# sourceMappingURL=manager.js.map