/**
 * Authentication Manager
 * Handles all authentication flows for different providers
 */

import { EventEmitter } from 'events';
import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs';
import { SecureStorage } from './storage';
import { OAuthFlow } from './oauth';

export interface AuthCredentials {
  type: 'api_key' | 'oauth' | 'browser' | 'cli';
  provider: string;
  credentials: any;
  expiresAt?: Date;
  refreshToken?: string;
}

export interface AuthProvider {
  name: string;
  type: string;
  authMethods: ('api_key' | 'oauth' | 'browser' | 'cli')[];
  
  authenticate(method: string, credentials?: any): Promise<AuthCredentials>;
  refresh(credentials: AuthCredentials): Promise<AuthCredentials>;
  validate(credentials: AuthCredentials): Promise<boolean>;
  revoke(credentials: AuthCredentials): Promise<void>;
}

export class AuthManager extends EventEmitter {
  private storage: SecureStorage;
  private providers: Map<string, AuthProvider> = new Map();
  private sessions: Map<string, AuthCredentials> = new Map();
  private configDir: string;
  
  constructor() {
    super();
    this.configDir = path.join(os.homedir(), '.hanzo', 'auth');
    this.ensureConfigDir();
    this.storage = new SecureStorage(path.join(this.configDir, 'credentials.enc'));
  }
  
  private ensureConfigDir(): void {
    fs.mkdirSync(this.configDir, { recursive: true });
  }
  
  registerProvider(provider: AuthProvider): void {
    this.providers.set(provider.type, provider);
  }
  
  async authenticate(providerType: string, method?: string): Promise<AuthCredentials> {
    const provider = this.providers.get(providerType);
    if (!provider) {
      throw new Error(`Auth provider '${providerType}' not found`);
    }
    
    // Check for existing valid credentials
    const existing = await this.getCredentials(providerType);
    if (existing && await provider.validate(existing)) {
      this.sessions.set(providerType, existing);
      return existing;
    }
    
    // Determine auth method
    const authMethod = method || provider.authMethods[0];
    if (!provider.authMethods.includes(authMethod as any)) {
      throw new Error(`Auth method '${authMethod}' not supported by ${provider.name}`);
    }
    
    // Perform authentication
    const credentials = await provider.authenticate(authMethod);
    
    // Store credentials
    await this.storage.set(providerType, credentials);
    this.sessions.set(providerType, credentials);
    
    this.emit('authenticated', { provider: providerType, method: authMethod });
    
    return credentials;
  }
  
  async getCredentials(providerType: string): Promise<AuthCredentials | null> {
    // Check session first
    if (this.sessions.has(providerType)) {
      return this.sessions.get(providerType)!;
    }
    
    // Load from storage
    const stored = await this.storage.get(providerType);
    if (stored) {
      this.sessions.set(providerType, stored);
      return stored;
    }
    
    return null;
  }
  
  async refreshCredentials(providerType: string): Promise<AuthCredentials> {
    const provider = this.providers.get(providerType);
    if (!provider) {
      throw new Error(`Auth provider '${providerType}' not found`);
    }
    
    const current = await this.getCredentials(providerType);
    if (!current) {
      throw new Error(`No credentials found for ${providerType}`);
    }
    
    if (!current.refreshToken) {
      throw new Error(`Cannot refresh credentials for ${providerType}`);
    }
    
    const refreshed = await provider.refresh(current);
    
    // Update storage and session
    await this.storage.set(providerType, refreshed);
    this.sessions.set(providerType, refreshed);
    
    this.emit('refreshed', { provider: providerType });
    
    return refreshed;
  }
  
  async revokeCredentials(providerType: string): Promise<void> {
    const provider = this.providers.get(providerType);
    if (!provider) {
      throw new Error(`Auth provider '${providerType}' not found`);
    }
    
    const credentials = await this.getCredentials(providerType);
    if (credentials) {
      await provider.revoke(credentials);
    }
    
    // Remove from storage and session
    await this.storage.delete(providerType);
    this.sessions.delete(providerType);
    
    this.emit('revoked', { provider: providerType });
  }
  
  async listAuthenticated(): Promise<string[]> {
    const authenticated: string[] = [];
    
    for (const [type, provider] of this.providers) {
      const creds = await this.getCredentials(type);
      if (creds && await provider.validate(creds)) {
        authenticated.push(type);
      }
    }
    
    return authenticated;
  }
  
  // Environment variable support
  loadFromEnvironment(): void {
    const envMappings = {
      'ANTHROPIC_API_KEY': { provider: 'anthropic', type: 'api_key' },
      'OPENAI_API_KEY': { provider: 'openai', type: 'api_key' },
      'GOOGLE_API_KEY': { provider: 'gemini', type: 'api_key' },
      'GEMINI_API_KEY': { provider: 'gemini', type: 'api_key' },
      'GROK_API_KEY': { provider: 'grok', type: 'api_key' },
      'HANZO_API_KEY': { provider: 'hanzo', type: 'api_key' },
    };
    
    for (const [envVar, config] of Object.entries(envMappings)) {
      const value = process.env[envVar];
      if (value) {
        const credentials: AuthCredentials = {
          type: 'api_key',
          provider: config.provider,
          credentials: { apiKey: value }
        };
        
        this.sessions.set(config.provider, credentials);
        this.emit('loaded-from-env', { provider: config.provider });
      }
    }
  }
  
  // OAuth flow helper
  async authenticateOAuth(providerType: string, config: {
    clientId: string;
    clientSecret?: string;
    redirectUri: string;
    scopes: string[];
  }): Promise<AuthCredentials> {
    const oauth = new OAuthFlow(providerType, config);
    const tokens = await oauth.authenticate();
    
    const credentials: AuthCredentials = {
      type: 'oauth',
      provider: providerType,
      credentials: tokens,
      expiresAt: tokens.expiresAt,
      refreshToken: tokens.refreshToken
    };
    
    await this.storage.set(providerType, credentials);
    this.sessions.set(providerType, credentials);
    
    return credentials;
  }
}

// Global instance
export const authManager = new AuthManager();