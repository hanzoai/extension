import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs/promises';
import { spawn, ChildProcess } from 'child_process';
import { MCPClient } from './client';
import { MCPTools } from './tools';
import { getConfig } from '../config';
import { BrowserExtensionServer } from '../mcp-tools/browser-extension-server';

export class MCPServer {
    private context: vscode.ExtensionContext;
    private serverProcess?: ChildProcess;
    private client?: MCPClient;
    private tools: MCPTools;
    private config = getConfig();
    private browserExtensionServer?: BrowserExtensionServer;

    constructor(context: vscode.ExtensionContext) {
        this.context = context;
        this.tools = new MCPTools(context);
    }

    async initialize() {
        console.log('[MCPServer] Initializing MCP server integration');
        
        // Initialize tools
        await this.tools.initialize();
        
        // Start browser extension server if enabled
        if (this.config.browserExtension?.enabled !== false) {
            await this.startBrowserExtensionServer();
        }
        
        // Check if running as Claude Desktop extension
        if (this.isClaudeDesktopExtension()) {
            await this.initializeForClaudeDesktop();
        } else {
            // For VS Code/Cursor/Windsurf, start local MCP server
            await this.startLocalServer();
        }
    }

    private isClaudeDesktopExtension(): boolean {
        // Detect if running as Claude Desktop extension
        return process.env.MCP_TRANSPORT === 'stdio' || 
               process.env.CLAUDE_DESKTOP === 'true';
    }

    private async initializeForClaudeDesktop() {
        console.log('[MCPServer] Initializing for Claude Desktop');
        
        // When running as Claude Desktop extension, we communicate via stdio
        this.client = new MCPClient('stdio');
        await this.client.connect();
        
        // Register all tools with Claude Desktop
        await this.registerTools();
    }

    private async startLocalServer() {
        console.log('[MCPServer] Starting local MCP server');
        
        const serverPath = path.join(this.context.extensionPath, 'dist', 'mcp-server.js');
        
        // Check if server bundle exists
        try {
            await fs.access(serverPath);
        } catch {
            console.error('[MCPServer] MCP server bundle not found. Please build the extension.');
            return;
        }

        // Start the server process
        this.serverProcess = spawn('node', [serverPath], {
            env: {
                ...process.env,
                HANZO_EXTENSION_PATH: this.context.extensionPath,
                HANZO_WORKSPACE: vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || ''
            }
        });

        this.serverProcess.on('error', (error) => {
            console.error('[MCPServer] Server process error:', error);
            vscode.window.showErrorMessage(`MCP Server failed to start: ${error.message}`);
        });

        this.serverProcess.stdout?.on('data', (data) => {
            console.log('[MCPServer]', data.toString());
        });

        this.serverProcess.stderr?.on('data', (data) => {
            console.error('[MCPServer] Error:', data.toString());
        });

        // Connect client to local server
        this.client = new MCPClient('tcp', { port: this.config.mcp.port || 3000 });
        
        // Wait a bit for server to start
        await new Promise(resolve => setTimeout(resolve, 1000));
        
        try {
            await this.client.connect();
            await this.registerTools();
            console.log('[MCPServer] Successfully connected to local server');
        } catch (error) {
            console.error('[MCPServer] Failed to connect to local server:', error);
        }
    }

    private async registerTools() {
        if (!this.client) return;
        
        console.log('[MCPServer] Registering tools');
        
        // Get all available tools from MCPTools
        const tools = this.tools.getAllTools();
        
        for (const tool of tools) {
            try {
                await this.client.registerTool(tool);
                console.log(`[MCPServer] Registered tool: ${tool.name}`);
            } catch (error) {
                console.error(`[MCPServer] Failed to register tool ${tool.name}:`, error);
            }
        }
    }

    async executeCommand(command: string, args: any): Promise<any> {
        if (!this.client) {
            throw new Error('MCP client not initialized');
        }
        
        return this.client.executeCommand(command, args);
    }

    private async startBrowserExtensionServer() {
        try {
            const port = this.config.browserExtension?.port || 3001;
            const projectRoot = vscode.workspace.workspaceFolders?.[0].uri.fsPath || process.cwd();
            
            this.browserExtensionServer = new BrowserExtensionServer(port, projectRoot);
            
            // Handle element selection events
            this.browserExtensionServer.on('elementSelected', async (data) => {
                console.log('[MCPServer] Element selected:', data);
                
                // Open file in editor
                const doc = await vscode.workspace.openTextDocument(data.file);
                const editor = await vscode.window.showTextDocument(doc);
                
                // Jump to line
                const position = new vscode.Position(data.line - 1, data.column || 0);
                editor.selection = new vscode.Selection(position, position);
                editor.revealRange(new vscode.Range(position, position));
                
                // Show notification
                vscode.window.showInformationMessage(
                    `Navigated to ${path.basename(data.file)}:${data.line} (${data.framework || 'unknown'} component)`
                );
            });
            
            console.log(`[MCPServer] Browser extension server started on port ${port}`);
            
            // Show notification with instructions
            const action = await vscode.window.showInformationMessage(
                'Browser extension server running. Alt+click elements in your browser to navigate to source.',
                'Install Extension'
            );
            
            if (action === 'Install Extension') {
                await this.installBrowserExtension();
            }
        } catch (error) {
            console.error('[MCPServer] Failed to start browser extension server:', error);
        }
    }

    private async installBrowserExtension() {
        // Build the extension
        const terminal = vscode.window.createTerminal('Install Browser Extension');
        terminal.sendText('npm run build:browser-extension');
        terminal.show();
        
        // Show instructions
        vscode.window.showInformationMessage(
            'Browser extension built. Load it via chrome://extensions/ → Developer mode → Load unpacked → Select dist/browser-extension/',
            'Open Chrome Extensions'
        ).then(action => {
            if (action === 'Open Chrome Extensions') {
                vscode.env.openExternal(vscode.Uri.parse('chrome://extensions/'));
            }
        });
    }

    shutdown() {
        console.log('[MCPServer] Shutting down');
        
        if (this.browserExtensionServer) {
            this.browserExtensionServer.close();
        }
        
        if (this.client) {
            this.client.disconnect();
        }
        
        if (this.serverProcess) {
            this.serverProcess.kill();
            this.serverProcess = undefined;
        }
    }
}

// Export types for MCP tools
export interface MCPTool {
    name: string;
    description: string;
    inputSchema: {
        type: 'object';
        properties: Record<string, any>;
        required?: string[];
    };
    handler: (args: any) => Promise<any>;
}

export interface MCPPrompt {
    name: string;
    description: string;
    arguments?: Array<{
        name: string;
        description: string;
        required: boolean;
    }>;
    handler: (args: any) => Promise<string>;
}