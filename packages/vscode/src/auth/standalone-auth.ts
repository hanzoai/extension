import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import axios from 'axios';
import { execSync } from 'child_process';

interface AuthToken {
    token: string;
    refreshToken?: string;
    expiresAt: number;
}

interface CasdoorConfig {
    endpoint: string;
    clientId: string;
    clientSecret?: string;
    applicationName: string;
    organizationName: string;
}

export class StandaloneAuthManager {
    private configDir: string;
    private tokenFile: string;
    private deviceIdFile: string;
    private casdoorConfig: CasdoorConfig;
    private isAnonymous: boolean;

    constructor(isAnonymous: boolean = false) {
        this.isAnonymous = isAnonymous;
        
        // Setup config directory
        this.configDir = path.join(os.homedir(), '.hanzo-mcp');
        if (!fs.existsSync(this.configDir)) {
            fs.mkdirSync(this.configDir, { recursive: true, mode: 0o700 });
        }
        
        this.tokenFile = path.join(this.configDir, 'auth.json');
        this.deviceIdFile = path.join(this.configDir, 'device.json');
        
        // Casdoor configuration for iam.hanzo.ai
        this.casdoorConfig = {
            endpoint: process.env.HANZO_IAM_ENDPOINT || 'https://iam.hanzo.ai',
            clientId: process.env.HANZO_IAM_CLIENT_ID || 'hanzo-mcp',
            clientSecret: process.env.HANZO_IAM_CLIENT_SECRET,
            applicationName: 'hanzo-mcp',
            organizationName: 'hanzo'
        };
    }

    private getDeviceId(): string {
        try {
            if (fs.existsSync(this.deviceIdFile)) {
                const data = JSON.parse(fs.readFileSync(this.deviceIdFile, 'utf-8'));
                return data.deviceId;
            }
        } catch (error) {
            // Ignore errors, generate new ID
        }

        // Generate new device ID
        const deviceId = crypto.randomBytes(16).toString('hex');
        fs.writeFileSync(this.deviceIdFile, JSON.stringify({ 
            deviceId, 
            createdAt: new Date().toISOString() 
        }));
        
        return deviceId;
    }

    private async getStoredToken(): Promise<AuthToken | null> {
        if (this.isAnonymous) return null;
        
        try {
            if (fs.existsSync(this.tokenFile)) {
                const data = JSON.parse(fs.readFileSync(this.tokenFile, 'utf-8'));
                
                // Check if token is expired
                if (data.expiresAt && Date.now() > data.expiresAt) {
                    if (data.refreshToken) {
                        return await this.refreshToken(data.refreshToken);
                    }
                    return null;
                }
                
                return data;
            }
        } catch (error) {
            console.error('Failed to read stored token:', error);
        }
        
        return null;
    }

    private async storeToken(token: AuthToken): Promise<void> {
        if (this.isAnonymous) return;
        
        fs.writeFileSync(this.tokenFile, JSON.stringify(token, null, 2));
        // Secure the file
        fs.chmodSync(this.tokenFile, 0o600);
    }

    private async refreshToken(refreshToken: string): Promise<AuthToken | null> {
        try {
            const response = await axios.post(`${this.casdoorConfig.endpoint}/api/refresh-token`, {
                grant_type: 'refresh_token',
                refresh_token: refreshToken,
                client_id: this.casdoorConfig.clientId,
                client_secret: this.casdoorConfig.clientSecret
            });

            if (response.data?.access_token) {
                const token: AuthToken = {
                    token: response.data.access_token,
                    refreshToken: response.data.refresh_token,
                    expiresAt: Date.now() + (response.data.expires_in || 3600) * 1000
                };
                
                await this.storeToken(token);
                return token;
            }
        } catch (error) {
            console.error('Failed to refresh token:', error);
        }
        
        return null;
    }

    public async isAuthenticated(): Promise<boolean> {
        if (this.isAnonymous) return true;
        
        const token = await this.getStoredToken();
        return !!token;
    }

    public async getAuthToken(): Promise<string | null> {
        if (this.isAnonymous) return null;
        
        const tokenData = await this.getStoredToken();
        return tokenData?.token || null;
    }

    public async authenticate(): Promise<boolean> {
        if (this.isAnonymous) {
            console.log('Running in anonymous mode. Some features may be limited.');
            return true;
        }

        // Check if already authenticated
        if (await this.isAuthenticated()) {
            console.log('Already authenticated.');
            return true;
        }

        console.log('\n🔐 Hanzo Authentication Required\n');
        console.log('Please authenticate to use Hanzo MCP with full features.');
        console.log('This will open your browser to complete authentication.\n');

        try {
            const deviceId = this.getDeviceId();
            const state = crypto.randomBytes(16).toString('hex');
            
            // Build OAuth URL for Casdoor
            const authUrl = new URL(`${this.casdoorConfig.endpoint}/login/oauth/authorize`);
            authUrl.searchParams.append('client_id', this.casdoorConfig.clientId);
            authUrl.searchParams.append('response_type', 'code');
            authUrl.searchParams.append('redirect_uri', 'http://localhost:8765/callback');
            authUrl.searchParams.append('scope', 'read write');
            authUrl.searchParams.append('state', state);
            authUrl.searchParams.append('device_id', deviceId);

            // Start local callback server
            const callbackServer = await this.startCallbackServer(state);
            
            // Open browser
            console.log('Opening browser for authentication...');
            this.openBrowser(authUrl.toString());

            // Wait for callback
            const authCode = await callbackServer;
            
            if (!authCode) {
                console.error('Authentication failed: No authorization code received');
                return false;
            }

            // Exchange code for token
            const tokenResponse = await axios.post(`${this.casdoorConfig.endpoint}/api/login/oauth/access_token`, {
                grant_type: 'authorization_code',
                code: authCode,
                client_id: this.casdoorConfig.clientId,
                client_secret: this.casdoorConfig.clientSecret,
                redirect_uri: 'http://localhost:8765/callback'
            });

            if (tokenResponse.data?.access_token) {
                const token: AuthToken = {
                    token: tokenResponse.data.access_token,
                    refreshToken: tokenResponse.data.refresh_token,
                    expiresAt: Date.now() + (tokenResponse.data.expires_in || 3600) * 1000
                };
                
                await this.storeToken(token);
                console.log('\n✅ Authentication successful!\n');
                return true;
            }
        } catch (error) {
            console.error('Authentication failed:', error);
        }

        return false;
    }

    private async startCallbackServer(expectedState: string): Promise<string | null> {
        return new Promise((resolve) => {
            const http = require('http');
            const url = require('url');
            
            const server = http.createServer((req: any, res: any) => {
                const parsedUrl = url.parse(req.url, true);
                
                if (parsedUrl.pathname === '/callback') {
                    const code = parsedUrl.query.code;
                    const state = parsedUrl.query.state;
                    
                    if (state === expectedState && code) {
                        res.writeHead(200, { 'Content-Type': 'text/html' });
                        res.end(`
                            <html>
                            <head>
                                <title>Authentication Successful</title>
                                <style>
                                    body { font-family: system-ui; text-align: center; padding: 50px; }
                                    h1 { color: #10b981; }
                                </style>
                            </head>
                            <body>
                                <h1>✅ Authentication Successful!</h1>
                                <p>You can now close this window and return to your terminal.</p>
                                <script>window.setTimeout(() => window.close(), 3000);</script>
                            </body>
                            </html>
                        `);
                        server.close();
                        resolve(code as string);
                    } else {
                        res.writeHead(400, { 'Content-Type': 'text/html' });
                        res.end('<h1>Authentication Failed</h1><p>Invalid state or missing code.</p>');
                        server.close();
                        resolve(null);
                    }
                }
            });
            
            server.listen(8765, 'localhost');
            
            // Timeout after 5 minutes
            setTimeout(() => {
                server.close();
                resolve(null);
            }, 300000);
        });
    }

    private openBrowser(url: string): void {
        const platform = os.platform();
        
        try {
            if (platform === 'darwin') {
                execSync(`open "${url}"`);
            } else if (platform === 'win32') {
                execSync(`start "" "${url}"`);
            } else {
                execSync(`xdg-open "${url}"`);
            }
        } catch (error) {
            console.error('Failed to open browser automatically.');
            console.log(`Please open this URL manually:\n${url}`);
        }
    }

    public async logout(): Promise<void> {
        if (this.isAnonymous) return;
        
        try {
            if (fs.existsSync(this.tokenFile)) {
                fs.unlinkSync(this.tokenFile);
            }
            console.log('Logged out successfully.');
        } catch (error) {
            console.error('Failed to logout:', error);
        }
    }

    public getHeaders(): Record<string, string> {
        if (this.isAnonymous) {
            return {
                'X-Hanzo-Mode': 'anonymous',
                'X-Hanzo-Device-Id': this.getDeviceId()
            };
        }
        
        const token = fs.existsSync(this.tokenFile) 
            ? JSON.parse(fs.readFileSync(this.tokenFile, 'utf-8')).token 
            : null;
            
        if (token) {
            return {
                'Authorization': `Bearer ${token}`,
                'X-Hanzo-Device-Id': this.getDeviceId()
            };
        }
        
        return {};
    }
}