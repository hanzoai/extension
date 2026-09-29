import * as vscode from 'vscode';

interface MCPConfig {
    enabled: boolean;
    port: number;
    transport: 'stdio' | 'tcp';
    backend: 'auto' | 'python' | 'typescript' | 'rust' | 'local-node';
    pythonCommand: string;
    rustBinary?: string;
    localNodeUrl?: string;
    allowedPaths?: string[];
    disableWriteTools?: boolean;
    disableSearchTools?: boolean;
    disableBrowserTool?: boolean;
    enabledTools?: string[];
    disabledTools?: string[];
}

interface Config {
    apiUrl: string;
    mcp: MCPConfig;
    debug: boolean;
}

interface Configs {
    [key: string]: Config;
}

const configs: Configs = {
    development: {
        apiUrl: 'http://localhost:3000/ext/v1',
        mcp: {
            enabled: true,
            port: 3000,
            transport: 'tcp',
            backend: 'auto',
            pythonCommand: 'uvx hanzo-mcp',
            disableWriteTools: false,
            disableSearchTools: false,
            disableBrowserTool: false
        },
        debug: true
    },
    production: {
        apiUrl: 'https://api.hanzo.ai/ext/v1',
        mcp: {
            enabled: true,
            port: 3000,
            transport: 'stdio',
            backend: 'auto',
            pythonCommand: 'uvx hanzo-mcp',
            disableWriteTools: false,
            disableSearchTools: false,
            disableBrowserTool: false
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
                backend: vsConfig.get<string>('mcp.backend', baseConfig.mcp.backend) as MCPConfig['backend'],
                pythonCommand: vsConfig.get<string>('mcp.pythonCommand', baseConfig.mcp.pythonCommand),
                rustBinary: vsConfig.get<string>('mcp.rustBinary'),
                localNodeUrl: vsConfig.get<string>('mcp.localNodeUrl'),
                allowedPaths: vsConfig.get<string[]>('mcp.allowedPaths'),
                disableWriteTools: vsConfig.get<boolean>('mcp.disableWriteTools', baseConfig.mcp.disableWriteTools || false),
                disableSearchTools: vsConfig.get<boolean>('mcp.disableSearchTools', baseConfig.mcp.disableSearchTools || false),
                disableBrowserTool: vsConfig.get<boolean>('mcp.disableBrowserTool', baseConfig.mcp.disableBrowserTool || false),
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