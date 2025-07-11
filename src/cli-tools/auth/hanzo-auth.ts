import fetch from "node-fetch";import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { execSync, spawn } from 'child_process';
import { EventEmitter } from 'events';
import * as http from 'http';
import * as crypto from 'crypto';

export interface HanzoAuthConfig {
    apiUrl: string;
    iamUrl: string;
    clientId: string;
    scope: string;
    configPath?: string;
}

export interface HanzoCredentials {
    apiKey?: string;
    accessToken?: string;
    refreshToken?: string;
    expiresAt?: number;
    userId?: string;
    email?: string;
    settings?: Record<string, any>;
}

export interface APIKeyInfo {
    name: string;
    key: string;
    provider: string;
    enabled: boolean;
    masked?: string;
}

export class HanzoAuth extends EventEmitter {
    private config: HanzoAuthConfig;
    private credentialsPath: string;
    private settingsPath: string;
    private credentials: HanzoCredentials | null = null;
    private server?: http.Server;

    constructor(config: Partial<HanzoAuthConfig> = {}) {
        super();
        this.config = {
            apiUrl: config.apiUrl || 'https://api.hanzo.ai',
            iamUrl: config.iamUrl || 'https://iam.hanzo.ai',
            clientId: config.clientId || 'hanzo-dev-cli',
            scope: config.scope || 'api:access tools:manage',
            configPath: config.configPath || path.join(os.homedir(), '.hanzo')
        };

        // Ensure config directory exists
        fs.mkdirSync(this.config.configPath!, { recursive: true });
        
        this.credentialsPath = path.join(this.config.configPath!, 'credentials.json');
        this.settingsPath = path.join(this.config.configPath!, 'settings.json');
        
        // Load existing credentials
        this.loadCredentials();
    }

    private loadCredentials(): void {
        try {
            if (fs.existsSync(this.credentialsPath)) {
                const data = fs.readFileSync(this.credentialsPath, 'utf-8');
                this.credentials = JSON.parse(data);
                
                // Check if token is expired
                if (this.credentials?.expiresAt && this.credentials.expiresAt < Date.now()) {
                    this.emit('token:expired');
                }
            }
        } catch (error) {
            console.error('Failed to load credentials:', error);
        }
    }

    private saveCredentials(): void {
        try {
            fs.writeFileSync(
                this.credentialsPath,
                JSON.stringify(this.credentials, null, 2),
                { mode: 0o600 } // Secure file permissions
            );
        } catch (error) {
            console.error('Failed to save credentials:', error);
        }
    }

    async login(): Promise<boolean> {
        return new Promise((resolve, reject) => {
            // Generate PKCE challenge
            const codeVerifier = this.generateCodeVerifier();
            const codeChallenge = this.generateCodeChallenge(codeVerifier);
            const state = crypto.randomBytes(16).toString('hex');
            
            // Start local server for OAuth callback
            const port = 51234;
            this.server = http.createServer(async (req, res) => {
                const url = new URL(req.url!, `http://localhost:${port}`);
                
                if (url.pathname === '/callback') {
                    const code = url.searchParams.get('code');
                    const returnedState = url.searchParams.get('state');
                    
                    if (returnedState !== state) {
                        res.writeHead(400);
                        res.end('Invalid state parameter');
                        this.server?.close();
                        reject(new Error('Invalid state parameter'));
                        return;
                    }
                    
                    if (code) {
                        // Exchange code for tokens
                        try {
                            await this.exchangeCodeForTokens(code, codeVerifier);
                            
                            // Success response
                            res.writeHead(200, { 'Content-Type': 'text/html' });
                            res.end(`
                                <html>
                                <head>
                                    <title>Hanzo Dev - Login Successful</title>
                                    <style>
                                        body { font-family: system-ui; display: flex; align-items: center; justify-content: center; height: 100vh; margin: 0; background: #1a1a1a; color: white; }
                                        .container { text-align: center; }
                                        .success { color: #4ade80; font-size: 48px; margin-bottom: 20px; }
                                    </style>
                                </head>
                                <body>
                                    <div class="container">
                                        <div class="success">✓</div>
                                        <h1>Login Successful!</h1>
                                        <p>You can now close this window and return to your terminal.</p>
                                    </div>
                                    <script>setTimeout(() => window.close(), 3000);</script>
                                </body>
                                </html>
                            `);
                            
                            this.server?.close();
                            resolve(true);
                        } catch (error) {
                            res.writeHead(500);
                            res.end('Failed to exchange code for tokens');
                            this.server?.close();
                            reject(error);
                        }
                    } else {
                        res.writeHead(400);
                        res.end('No authorization code received');
                        this.server?.close();
                        reject(new Error('No authorization code received'));
                    }
                }
            });
            
            this.server.listen(port, () => {
                // Build authorization URL
                const authUrl = new URL('/oauth/authorize', this.config.iamUrl);
                authUrl.searchParams.set('client_id', this.config.clientId);
                authUrl.searchParams.set('response_type', 'code');
                authUrl.searchParams.set('redirect_uri', `http://localhost:${port}/callback`);
                authUrl.searchParams.set('scope', this.config.scope);
                authUrl.searchParams.set('state', state);
                authUrl.searchParams.set('code_challenge', codeChallenge);
                authUrl.searchParams.set('code_challenge_method', 'S256');
                
                // Open browser
                this.openBrowser(authUrl.toString());
                
                console.log('Opening browser for authentication...');
                console.log('If browser doesn\'t open, visit:', authUrl.toString());
            });
            
            // Timeout after 5 minutes
            setTimeout(() => {
                if (this.server) {
                    this.server.close();
                    reject(new Error('Login timeout'));
                }
            }, 5 * 60 * 1000);
        });
    }

    private async exchangeCodeForTokens(code: string, codeVerifier: string): Promise<void> {
        const response = await fetch(`${this.config.iamUrl}/oauth/token`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                grant_type: 'authorization_code',
                code,
                client_id: this.config.clientId,
                code_verifier: codeVerifier,
                redirect_uri: 'http://localhost:51234/callback'
            })
        });
        
        if (!response.ok) {
            throw new Error(`Failed to exchange code: ${response.statusText}`);
        }
        
        const data = await response.json() as any;
        
        this.credentials = {
            accessToken: data.access_token,
            refreshToken: data.refresh_token,
            expiresAt: Date.now() + (data.expires_in * 1000),
            ...this.credentials // Preserve existing settings
        };
        
        // Fetch user info
        await this.fetchUserInfo();
        
        // Fetch and sync API keys
        await this.syncAPIKeys();
        
        this.saveCredentials();
        this.emit('login:success', this.credentials);
    }

    private async fetchUserInfo(): Promise<void> {
        if (!this.credentials?.accessToken) return;
        
        const response = await fetch(`${this.config.iamUrl}/api/user`, {
            headers: {
                'Authorization': `Bearer ${this.credentials.accessToken}`
            }
        });
        
        if (response.ok) {
            const user = await response.json() as any;
            this.credentials.userId = user.id;
            this.credentials.email = user.email;
        }
    }

    async syncAPIKeys(): Promise<APIKeyInfo[]> {
        if (!this.credentials?.accessToken) {
            throw new Error('Not authenticated');
        }
        
        const response = await fetch(`${this.config.apiUrl}/v1/api-keys`, {
            headers: {
                'Authorization': `Bearer ${this.credentials.accessToken}`
            }
        });
        
        if (!response.ok) {
            throw new Error(`Failed to fetch API keys: ${response.statusText}`);
        }
        
        const apiKeys = await response.json() as any[];
        
        // Store API keys in settings (encrypted)
        const settings = this.loadSettings();
        settings.apiKeys = apiKeys.map((key: any) => ({
            name: key.name,
            provider: key.provider,
            enabled: key.enabled,
            // Store encrypted version locally
            encryptedKey: this.encryptData(key.key),
            masked: key.key.substring(0, 8) + '...' + key.key.substring(key.key.length - 4)
        }));
        
        this.saveSettings(settings);
        this.emit('apikeys:synced', apiKeys.length);
        
        return apiKeys;
    }

    getAPIKey(provider: string): string | null {
        const settings = this.loadSettings();
        const keyInfo = settings.apiKeys?.find((k: any) => 
            k.provider === provider && k.enabled
        );
        
        if (!keyInfo?.encryptedKey) {
            // Try environment variable as fallback
            const envKey = `${provider.toUpperCase()}_API_KEY`;
            return process.env[envKey] || null;
        }
        
        return this.decryptData(keyInfo.encryptedKey);
    }

    async refreshToken(): Promise<boolean> {
        if (!this.credentials?.refreshToken) {
            return false;
        }
        
        try {
            const response = await fetch(`${this.config.iamUrl}/oauth/token`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    grant_type: 'refresh_token',
                    refresh_token: this.credentials.refreshToken,
                    client_id: this.config.clientId
                })
            });
            
            if (!response.ok) {
                throw new Error(`Failed to refresh token: ${response.statusText}`);
            }
            
            const data = await response.json() as any;
            
            this.credentials = {
                ...this.credentials,
                accessToken: data.access_token,
                refreshToken: data.refresh_token || this.credentials.refreshToken,
                expiresAt: Date.now() + (data.expires_in * 1000)
            };
            
            this.saveCredentials();
            this.emit('token:refreshed');
            
            return true;
        } catch (error) {
            this.emit('token:refresh:failed', error);
            return false;
        }
    }

    async logout(): Promise<void> {
        if (this.credentials?.accessToken) {
            try {
                await fetch(`${this.config.iamUrl}/oauth/revoke`, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${this.credentials.accessToken}`
                    },
                    body: JSON.stringify({
                        token: this.credentials.refreshToken || this.credentials.accessToken
                    })
                });
            } catch (error) {
                console.error('Failed to revoke token:', error);
            }
        }
        
        // Clear credentials but keep settings
        this.credentials = null;
        if (fs.existsSync(this.credentialsPath)) {
            fs.unlinkSync(this.credentialsPath);
        }
        
        this.emit('logout');
    }

    isAuthenticated(): boolean {
        if (!this.credentials?.accessToken) {
            return false;
        }
        
        // Check if token is expired
        if (this.credentials.expiresAt && this.credentials.expiresAt < Date.now()) {
            return false;
        }
        
        return true;
    }

    getCredentials(): HanzoCredentials | null {
        return this.credentials;
    }

    async makeAuthenticatedRequest(url: string, options: RequestInit = {}): Promise<Response> {
        if (!this.isAuthenticated()) {
            // Try to refresh token
            if (this.credentials?.refreshToken) {
                const refreshed = await this.refreshToken();
                if (!refreshed) {
                    throw new Error('Not authenticated');
                }
            } else {
                throw new Error('Not authenticated');
            }
        }
        
        const headers = {
            ...options.headers,
            'Authorization': `Bearer ${this.credentials!.accessToken}`
        };
        
        return fetch(url, { ...options, headers });
    }

    private loadSettings(): Record<string, any> {
        try {
            if (fs.existsSync(this.settingsPath)) {
                return JSON.parse(fs.readFileSync(this.settingsPath, 'utf-8'));
            }
        } catch (error) {
            console.error('Failed to load settings:', error);
        }
        return {};
    }

    private saveSettings(settings: Record<string, any>): void {
        try {
            fs.writeFileSync(
                this.settingsPath,
                JSON.stringify(settings, null, 2),
                { mode: 0o600 }
            );
        } catch (error) {
            console.error('Failed to save settings:', error);
        }
    }

    private encryptData(data: string): string {
        // Use machine ID as encryption key
        const key = crypto.scryptSync(this.getMachineId(), 'salt', 32);
        const iv = crypto.randomBytes(16);
        const cipher = crypto.createCipheriv('aes-256-cbc', key, iv);
        
        let encrypted = cipher.update(data, 'utf8', 'hex');
        encrypted += cipher.final('hex');
        
        return iv.toString('hex') + ':' + encrypted;
    }

    private decryptData(encryptedData: string): string {
        const [ivHex, encrypted] = encryptedData.split(':');
        const key = crypto.scryptSync(this.getMachineId(), 'salt', 32);
        const iv = Buffer.from(ivHex, 'hex');
        const decipher = crypto.createDecipheriv('aes-256-cbc', key, iv);
        
        let decrypted = decipher.update(encrypted, 'hex', 'utf8');
        decrypted += decipher.final('utf8');
        
        return decrypted;
    }

    private getMachineId(): string {
        // Simple machine ID based on hostname and platform
        return crypto.createHash('sha256')
            .update(os.hostname())
            .update(os.platform())
            .update(os.homedir())
            .digest('hex')
            .substring(0, 32);
    }

    private generateCodeVerifier(): string {
        return crypto.randomBytes(32).toString('base64url');
    }

    private generateCodeChallenge(verifier: string): string {
        return crypto.createHash('sha256')
            .update(verifier)
            .digest('base64url');
    }

    private openBrowser(url: string): void {
        const platform = os.platform();
        
        try {
            if (platform === 'darwin') {
                spawn('open', [url], { detached: true });
            } else if (platform === 'win32') {
                spawn('start', ['', url], { shell: true, detached: true });
            } else {
                spawn('xdg-open', [url], { detached: true });
            }
        } catch (error) {
            console.error('Failed to open browser:', error);
        }
    }
}