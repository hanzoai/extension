#!/usr/bin/env node

/**
 * Fixed MCP server using official SDK - auth is optional and happens in conversation
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import * as path from 'path';
import * as fs from 'fs';

// Import our existing tools
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
        file: (filePath: string) => ({ fsPath: filePath }),
        parse: (str: string) => ({ fsPath: str })
    },
    ExtensionContext: class {
        globalState = {
            get: (key: string, defaultValue?: any) => {
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

// Import tools after mocking vscode
import { MCPTools } from './mcp/tools';

async function main() {
    console.error('[Hanzo MCP] Starting server v1.5.7...');
    
    // Create the MCP server
    const server = new McpServer({
        name: 'hanzo-mcp',
        version: '1.5.7'
    });

    // Create mock context
    const context = new mockVscode.ExtensionContext();
    
    // Track auth state
    let isAuthenticated = false;
    let authToken: string | null = null;
    
    // Initialize tools
    const tools = new MCPTools(context as any);
    await tools.initialize();
    
    // Register the login tool
    server.registerTool(
        'hanzo_login',
        {
            title: 'Hanzo Login',
            description: 'Login to Hanzo AI for cloud features (optional)',
            inputSchema: z.object({})
        },
        async () => {
            const deviceCode = Math.random().toString(36).substring(2, 15);
            return {
                content: [{
                    type: 'text',
                    text: `🔐 To login to Hanzo AI and unlock cloud features:

1. Visit: https://hanzo.ai/device?code=${deviceCode}
2. Sign in with your Hanzo account
3. Enter device code: ${deviceCode}

Once authenticated, you'll have access to:
✨ Cloud-hosted MCP servers (4000+ tools)
✨ Hanzo AI router (200+ LLMs) 
✨ Vector storage and search
✨ Shared context across sessions
✨ Priority support

For now, continuing with local tools only. All core functionality works without login!`
                }]
            };
        }
    );
    
    // Register all the tools from MCPTools
    const allTools = tools.getAllTools();
    for (const tool of allTools) {
        server.registerTool(
            tool.name,
            {
                title: tool.title || tool.name,
                description: tool.description,
                inputSchema: tool.inputSchema
            },
            async (args) => {
                try {
                    const result = await tool.handler(args);
                    return {
                        content: [{
                            type: 'text',
                            text: typeof result === 'string' ? result : JSON.stringify(result, null, 2)
                        }]
                    };
                } catch (error: any) {
                    return {
                        content: [{
                            type: 'text',
                            text: `Error: ${error.message}`
                        }],
                        isError: true
                    };
                }
            }
        );
    }
    
    // Create and connect transport
    const transport = new StdioServerTransport();
    await server.connect(transport);
    
    console.error(`[Hanzo MCP] Server ready with ${allTools.length + 1} tools`);
    console.error('[Hanzo MCP] Auth is optional - use hanzo_login tool to enable cloud features');
}

// Handle errors gracefully
process.on('uncaughtException', (error) => {
    console.error('[Hanzo MCP] Uncaught exception:', error);
});

process.on('unhandledRejection', (reason, promise) => {
    console.error('[Hanzo MCP] Unhandled rejection:', reason);
});

// Start the server
main().catch((error) => {
    console.error('[Hanzo MCP] Fatal error:', error);
    process.exit(1);
});