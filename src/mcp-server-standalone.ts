#!/usr/bin/env node

/**
 * Standalone MCP server for Hanzo extension
 * This can be run directly for Claude Desktop integration
 */

import { createServer } from 'net';
import * as path from 'path';

// Dynamic imports to avoid bundling issues
let MCPClient: any;
let MCPTools: any;

// Mock VS Code API for standalone operation
const mockVscode = {
    workspace: {
        workspaceFolders: process.env.HANZO_WORKSPACE ? [{
            uri: { fsPath: process.env.HANZO_WORKSPACE }
        }] : undefined,
        getConfiguration: (section: string) => ({
            get: (key: string, defaultValue: any) => {
                // Read from environment variables
                const envKey = `HANZO_${section.toUpperCase()}_${key.toUpperCase().replace(/\./g, '_')}`;
                return process.env[envKey] || defaultValue;
            }
        }),
        findFiles: async () => []
    },
    window: {
        showErrorMessage: console.error,
        showInformationMessage: console.log,
        visibleTextEditors: []
    },
    env: {
        openExternal: async (uri: any) => {
            console.log(`Opening: ${uri}`);
            return true;
        }
    },
    ExtensionContext: class {
        globalState = new Map();
        extensionPath = __dirname;
        subscriptions: any[] = [];
    },
    version: '1.0.0'
};

// Replace global vscode with mock
(global as any).vscode = mockVscode;

class StandaloneMCPServer {
    private client: any;
    private tools: any;
    private context: any;

    constructor() {
        // Load modules dynamically
        try {
            MCPClient = require('./mcp/client').MCPClient;
            MCPTools = require('./mcp/tools').MCPTools;
        } catch (error) {
            console.error('[Hanzo MCP] Failed to load modules:', error);
            process.exit(1);
        }
        // Create mock context
        this.context = {
            globalState: {
                get: (key: string, defaultValue?: any) => {
                    return defaultValue;
                },
                update: async (key: string, value: any) => {
                    // Store in memory for session
                    return true;
                }
            },
            extensionPath: path.dirname(__dirname),
            subscriptions: []
        };

        this.tools = new MCPTools(this.context);
        
        // Determine transport from environment
        const transport = process.env.MCP_TRANSPORT === 'tcp' ? 'tcp' : 'stdio';
        const port = parseInt(process.env.MCP_PORT || '3000');
        
        this.client = new MCPClient(transport, { port });
    }

    async start() {
        console.error('[Hanzo MCP] Starting standalone server...');
        
        try {
            // Initialize tools
            await this.tools.initialize();
            
            // Connect client
            await this.client.connect();
            
            // Register all tools
            const tools = this.tools.getAllTools();
            for (const tool of tools) {
                await this.client.registerTool(tool);
                console.error(`[Hanzo MCP] Registered tool: ${tool.name}`);
            }
            
            console.error(`[Hanzo MCP] Server ready with ${tools.length} tools`);
            
            // Keep server running
            process.on('SIGINT', () => {
                console.error('[Hanzo MCP] Shutting down...');
                this.client.disconnect();
                process.exit(0);
            });
            
            // Handle uncaught errors
            process.on('uncaughtException', (error) => {
                console.error('[Hanzo MCP] Uncaught exception:', error);
            });
            
            process.on('unhandledRejection', (reason, promise) => {
                console.error('[Hanzo MCP] Unhandled rejection:', reason);
            });
            
        } catch (error) {
            console.error('[Hanzo MCP] Failed to start server:', error);
            process.exit(1);
        }
    }
}

// Start server if run directly
if (require.main === module) {
    // Handle --version flag
    if (process.argv.includes('--version')) {
        console.log('Hanzo MCP Server v1.5.4');
        process.exit(0);
    }
    
    const server = new StandaloneMCPServer();
    server.start().catch(console.error);
}

export { StandaloneMCPServer };