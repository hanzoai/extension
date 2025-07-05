import * as vscode from 'vscode';

interface AuthConfig {
    baseUrl: string;
    startEndpoint: string;
    checkEndpoint: string;
}

interface MCPConfig {
    enabled: boolean;
    port: number;
    transport: 'stdio' | 'tcp';
    allowedPaths?: string[];
    disableWriteTools?: boolean;
    disableSearchTools?: boolean;
    enabledTools?: string[];
    disabledTools?: string[];
}

interface Config {
    apiUrl: string;
    auth: AuthConfig;
    mcp: MCPConfig;
    debug: boolean;
}

interface Configs {
    [key: string]: Config;
}

const configs: Configs = {
    development: {
        apiUrl: 'http://localhost:3000/ext/v1',
        auth: {
            baseUrl: 'https://auth.hanzo.ai',
            startEndpoint: '/start',
            checkEndpoint: '/api/check-auth'
        },
        mcp: {
            enabled: true,
            port: 3000,
            transport: 'tcp',
            disableWriteTools: false,
            disableSearchTools: false
        },
        debug: true
    },
    production: {
        apiUrl: 'https://api.hanzo.ai/ext/v1',
        auth: {
            baseUrl: 'https://auth.hanzo.ai',
            startEndpoint: '/start',
            checkEndpoint: '/api/check-auth'
        },
        mcp: {
            enabled: true,
            port: 3000,
            transport: 'stdio',
            disableWriteTools: false,
            disableSearchTools: false
        },
        debug: false
    }
};

export const getConfig = (): Config => {
    const env = process.env.VSCODE_ENV || 'production';
    const baseConfig = configs[env] || configs.production;
    
    // Override with VS Code settings if available
    try {
        const vsConfig = vscode.workspace.getConfiguration('hanzo');
        
        return {
            ...baseConfig,
            apiUrl: vsConfig.get<string>('api.endpoint', baseConfig.apiUrl),
            mcp: {
                ...baseConfig.mcp,
                enabled: vsConfig.get<boolean>('mcp.enabled', baseConfig.mcp.enabled),
                port: vsConfig.get<number>('mcp.port', baseConfig.mcp.port),
                transport: vsConfig.get<string>('mcp.transport', baseConfig.mcp.transport) as 'stdio' | 'tcp',
                allowedPaths: vsConfig.get<string[]>('mcp.allowedPaths'),
                disableWriteTools: vsConfig.get<boolean>('mcp.disableWriteTools', baseConfig.mcp.disableWriteTools || false),
                disableSearchTools: vsConfig.get<boolean>('mcp.disableSearchTools', baseConfig.mcp.disableSearchTools || false),
                enabledTools: vsConfig.get<string[]>('mcp.enabledTools'),
                disabledTools: vsConfig.get<string[]>('mcp.disabledTools')
            },
            debug: vsConfig.get<boolean>('debug', baseConfig.debug)
        };
    } catch {
        // If VS Code API is not available (e.g., in tests), use base config
        return baseConfig;
    }
};