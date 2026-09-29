import * as path from 'path';
import * as vscode from 'vscode';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

/**
 * Starts the bundled MCP server, dist/mcp-server.js, as a child of the
 * extension host and connects to it over the child's stdio. The child runs on
 * the extension host's own runtime: process.execPath is VS Code's Electron,
 * which ELECTRON_RUN_AS_NODE=1 turns into Node, or Node itself under a remote
 * host, so nothing needs Node on PATH. Closing the client stops the child.
 */
export async function startServer(context: vscode.ExtensionContext): Promise<Client> {
    const transport = new StdioClientTransport({
        command: process.execPath,
        args: [path.join(context.extensionPath, 'dist', 'mcp-server.js')],
        env: {
            ...process.env as Record<string, string>,
            ELECTRON_RUN_AS_NODE: '1',
            HANZO_WORKSPACE: vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? '',
            HANZO_CONFIG: JSON.stringify(vscode.workspace.getConfiguration('hanzo')),
        },
        stderr: 'pipe',
    });
    transport.stderr?.on('data', (chunk: Buffer) => console.error(`[hanzo-mcp] ${chunk.toString().trimEnd()}`));

    const client = new Client({ name: 'hanzo-ide', version: context.extension.packageJSON.version });
    await client.connect(transport);
    return client;
}

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
