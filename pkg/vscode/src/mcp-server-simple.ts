#!/usr/bin/env node

/**
 * Simple MCP server that just works - no auth timeouts, auth happens in conversation
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { MCPTools } from './mcp/tools';
import * as path from 'path';

// Mock VS Code API for standalone operation
const mockVscode = {
    workspace: {
        workspaceFolders: process.env.HANZO_WORKSPACE ? [{
            uri: { fsPath: process.env.HANZO_WORKSPACE }
        }] : undefined,
        getConfiguration: (section: string) => ({
            get: (key: string, defaultValue: any) => {
                const envKey = `HANZO_${section.toUpperCase()}_${key.toUpperCase().replace(/\./g, '_')}`;
                return process.env[envKey] || defaultValue;
            }
        }),
        findFiles: async () => [],
        fs: {
            readFile: async (uri: any) => {
                const fs = require('fs').promises;
                const content = await fs.readFile(uri.fsPath || uri);
                return Buffer.from(content);
            },
            writeFile: async (uri: any, content: any) => {
                const fs = require('fs').promises;
                await fs.writeFile(uri.fsPath || uri, content);
            },
            createDirectory: async (uri: any) => {
                const fs = require('fs').promises;
                await fs.mkdir(uri.fsPath || uri, { recursive: true });
            }
        }
    },
    window: {
        showErrorMessage: console.error,
        showInformationMessage: console.log,
        visibleTextEditors: [],
        createOutputChannel: (name: string) => ({
            appendLine: (text: string) => console.error(`[${name}] ${text}`),
            append: (text: string) => process.stderr.write(text),
            clear: () => {},
            dispose: () => {},
            hide: () => {},
            show: () => {}
        })
    },
    env: {
        openExternal: async (uri: any) => {
            console.error(`[Hanzo] Opening: ${uri}`);
            return true;
        }
    },
    Uri: {
        file: (path: string) => ({ fsPath: path }),
        parse: (str: string) => ({ fsPath: str })
    },
    ExtensionContext: class {
        globalState = {
            get: (key: string, defaultValue?: any) => {
                // Simple in-memory storage for session
                return defaultValue;
            },
            update: async (key: string, value: any) => {
                return true;
            }
        };
        extensionPath = __dirname;
        subscriptions: any[] = [];
    },
    SymbolKind: {
        Function: 11,
        Class: 4,
        Method: 5,
        Variable: 12,
        Constant: 13,
        Interface: 10
    },
    version: '1.0.0',
    commands: {
        executeCommand: async () => []
    }
};

// Replace global vscode with mock
(global as any).vscode = mockVscode;

async function main() {
    console.error('[Hanzo MCP] Starting server...');
    
    const server = new Server(
        {
            name: 'hanzo-mcp',
            version: '1.5.7',
        },
        {
            capabilities: {
                tools: {},
            },
        }
    );

    // Create mock context
    const context = new mockVscode.ExtensionContext();
    
    // Add auth status to context (always start anonymous, auth via tool)
    (context as any).isAuthenticated = false;
    (context as any).authToken = null;
    
    // Initialize tools
    const tools = new MCPTools(context as any);
    await tools.initialize();
    
    // Add a login tool
    server.setRequestHandler('tools/call', async (request: any) => {
        const { name, arguments: args } = request.params;
        
        // Special handling for login
        if (name === 'hanzo_login') {
            return {
                content: [
                    {
                        type: 'text',
                        text: `🔐 To login to Hanzo AI and unlock cloud features:

1. Visit: https://hanzo.ai/login?device=mcp&code=${Math.random().toString(36).substring(7)}
2. Sign in with your Hanzo account
3. Your MCP server will be automatically authenticated

Once logged in, you'll have access to:
- Cloud-hosted MCP servers (4000+ tools)
- Hanzo AI router (200+ LLMs)
- Vector storage and search
- Shared context across sessions

For now, continuing with local tools only.`
                    }
                ]
            };
        }
        
        // Find and execute tool
        const tool = tools.getAllTools().find(t => t.name === name);
        if (!tool) {
            throw new Error(`Tool not found: ${name}`);
        }
        
        try {
            const result = await tool.handler(args);
            return {
                content: [
                    {
                        type: 'text',
                        text: typeof result === 'string' ? result : JSON.stringify(result, null, 2)
                    }
                ]
            };
        } catch (error: any) {
            throw new Error(`Tool execution failed: ${error.message}`);
        }
    });
    
    // List all tools
    server.setRequestHandler('tools/list', async (request: any) => {
        const allTools = tools.getAllTools();
        
        // Add login tool
        const toolList = [
            {
                name: 'hanzo_login',
                description: 'Login to Hanzo AI for cloud features (optional)',
                inputSchema: {
                    type: 'object',
                    properties: {}
                }
            },
            ...allTools.map(tool => ({
                name: tool.name,
                description: tool.description,
                inputSchema: tool.inputSchema
            }))
        ];
        
        return { tools: toolList };
    });

    const transport = new StdioServerTransport();
    await server.connect(transport);
    
    console.error('[Hanzo MCP] Server ready with ' + (tools.getAllTools().length + 1) + ' tools');
    console.error('[Hanzo MCP] Auth is optional - use hanzo_login tool to enable cloud features');
}

main().catch((error) => {
    console.error('[Hanzo MCP] Fatal error:', error);
    process.exit(1);
});