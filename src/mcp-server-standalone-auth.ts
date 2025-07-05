#!/usr/bin/env node

/**
 * Standalone MCP server with authentication for Hanzo extension
 * This can be run directly for Claude Desktop/Code integration
 */

import { createServer } from 'net';
import * as path from 'path';
import { StandaloneAuthManager } from './auth/standalone-auth';

// Dynamic imports to avoid bundling issues
let MCPClient: any;
let MCPTools: any;

// Parse command line arguments
const args = process.argv.slice(2);
const isAnonymous = args.includes('--anon') || args.includes('--anonymous');
const showHelp = args.includes('--help') || args.includes('-h');
const showVersion = args.includes('--version') || args.includes('-v');
const doLogout = args.includes('--logout');

// Show help
if (showHelp) {
    console.log(`
Hanzo MCP Server v1.5.4

Usage: hanzo-mcp [options]

Options:
  --anon, --anonymous    Run in anonymous mode (no authentication required)
  --logout              Log out from Hanzo account
  --version, -v         Show version
  --help, -h            Show this help message

Environment Variables:
  HANZO_WORKSPACE       Default workspace directory
  MCP_TRANSPORT         Transport method (stdio or tcp, default: stdio)
  MCP_PORT              Port for TCP transport (default: 3000)
  HANZO_IAM_ENDPOINT    IAM endpoint (default: https://iam.hanzo.ai)

Authentication:
  By default, the server requires authentication with your Hanzo account.
  Use --anon mode to run without authentication (limited features).

Examples:
  hanzo-mcp                    # Run with authentication
  hanzo-mcp --anon            # Run in anonymous mode
  HANZO_WORKSPACE=/path hanzo-mcp  # Set workspace directory
`);
    process.exit(0);
}

// Show version
if (showVersion) {
    console.log('Hanzo MCP Server v1.5.4');
    process.exit(0);
}

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

class AuthenticatedMCPServer {
    private client: any;
    private tools: any;
    private context: any;
    private authManager: StandaloneAuthManager;

    constructor(isAnonymous: boolean = false) {
        this.authManager = new StandaloneAuthManager(isAnonymous);
        
        // Load modules dynamically
        try {
            MCPClient = require('./mcp/client').MCPClient;
            MCPTools = require('./mcp/tools').MCPTools;
        } catch (error) {
            console.error('[Hanzo MCP] Failed to load modules:', error);
            process.exit(1);
        }
        
        // Create mock context with auth support
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
            subscriptions: [],
            // Add auth headers to context
            getAuthHeaders: () => this.authManager.getHeaders()
        };

        this.tools = new MCPTools(this.context);
        
        // Determine transport from environment
        const transport = process.env.MCP_TRANSPORT === 'tcp' ? 'tcp' : 'stdio';
        const port = parseInt(process.env.MCP_PORT || '3000');
        
        this.client = new MCPClient(transport, { port });
    }

    async start() {
        console.error('[Hanzo MCP] Starting authenticated server...');
        
        try {
            // Handle logout
            if (doLogout) {
                await this.authManager.logout();
                process.exit(0);
            }
            
            // Authenticate unless in anonymous mode
            if (!isAnonymous) {
                const authenticated = await this.authManager.authenticate();
                if (!authenticated) {
                    console.error('[Hanzo MCP] Authentication failed. Use --anon to run without authentication.');
                    process.exit(1);
                }
            } else {
                console.error('[Hanzo MCP] Running in anonymous mode. Some features may be limited.');
            }
            
            // Initialize tools with auth context
            await this.tools.initialize();
            
            // Connect client
            await this.client.connect();
            
            // Register all tools
            const tools = this.tools.getAllTools();
            
            // Filter tools based on auth status
            const filteredTools = tools.filter((tool: any) => {
                // In anonymous mode, disable cloud-dependent tools
                if (isAnonymous) {
                    const cloudTools = ['vector_store_insert', 'vector_store_query', 'database_query', 'database_schema'];
                    return !cloudTools.includes(tool.name);
                }
                return true;
            });
            
            for (const tool of filteredTools) {
                await this.client.registerTool(tool);
                console.error(`[Hanzo MCP] Registered tool: ${tool.name}`);
            }
            
            console.error(`[Hanzo MCP] Server ready with ${filteredTools.length} tools`);
            
            if (isAnonymous) {
                console.error('[Hanzo MCP] Note: Cloud features are disabled in anonymous mode.');
            }
            
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
    const server = new AuthenticatedMCPServer(isAnonymous);
    server.start().catch(console.error);
}

export { AuthenticatedMCPServer };