import * as vscode from 'vscode';
import type { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { AuthManager } from './auth/manager';
import { startServer } from './mcp/server';
import { HanzoChatParticipant } from './chat/hanzo-chat-participant';
import { servers } from './lm/mcp';
import { Models } from './lm/models';

/** What activate() returns to other extensions: the client connected to the bundled MCP server. */
export interface Api {
    mcp?: Client;
}

let mcp: Client | undefined;

export async function activate(context: vscode.ExtensionContext): Promise<Api> {
    const authManager = AuthManager.getInstance(context);

    context.subscriptions.push(
        vscode.lm.registerMcpServerDefinitionProvider('hanzo', servers),
        vscode.lm.registerLanguageModelChatProvider('hanzo', new Models(authManager)),
    );

    if (vscode.workspace.getConfiguration('hanzo').get<boolean>('mcp.enabled', true)) {
        try {
            mcp = await startServer(context);
            const { tools } = await mcp.listTools();
            const server = mcp.getServerVersion();
            console.log(`[Hanzo] MCP server ${server?.name} ${server?.version} serves ${tools.length} tools`);
        } catch (error) {
            console.error('[Hanzo] MCP server failed to start:', error);
            vscode.window.showErrorMessage(`Hanzo: MCP server failed to start. ${error instanceof Error ? error.message : String(error)}`);
        }
    }

    try {
        const participant = await new HanzoChatParticipant(context).initialize();
        context.subscriptions.push(participant);
    } catch (error) {
        console.error('Failed to register chat participant:', error);
        vscode.window.showErrorMessage(`Hanzo: Failed to initialize chat participant. ${error instanceof Error ? error.message : String(error)}`);
    }

    context.subscriptions.push(
        vscode.commands.registerCommand('hanzo.login', async () => {
            await authManager.initiateAuth();
        }),
        vscode.commands.registerCommand('hanzo.logout', async () => {
            await authManager.logout();
        }),
        vscode.commands.registerCommand('hanzo.debug.authState', async () => {
            vscode.window.showInformationMessage(await authManager.describe());
        }),
        vscode.commands.registerCommand('hanzo.debug.clearAuth', async () => {
            await authManager.logout();
            vscode.window.showInformationMessage('Signed out of Hanzo AI.');
        }),
    );

    // Not awaited: the prompt stays up until answered, and activation must not wait on it.
    if (!(await authManager.isAuthenticated())) {
        vscode.window.showInformationMessage('Sign in to use Hanzo AI.', 'Sign in').then(choice => {
            if (choice) {
                authManager.initiateAuth();
            }
        });
    }

    return { mcp };
}

export async function deactivate() {
    await mcp?.close();
    mcp = undefined;
}
