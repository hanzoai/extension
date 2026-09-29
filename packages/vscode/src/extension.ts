import * as vscode from 'vscode';
import { ProjectManager } from './ProjectManager';
import { AuthManager } from './auth/manager';
import { StatusBarService } from './services/StatusBarService';
import { ReminderService } from './services/ReminderService';
import { HanzoMetricsService } from './services/HanzoMetricsService';
import { MCPServer } from './mcp/server';
import { getConfig } from './config';
import { getWebviewContent } from './webview/content';
import { HanzoChatParticipant } from './chat/hanzo-chat-participant';
import { PythonSdkSetup } from './mcp/python-setup';

let projectManager: ProjectManager | undefined;
let authManager: AuthManager | undefined;
let reminderService: ReminderService | undefined;
let statusBar: StatusBarService | undefined;
let metricsService: HanzoMetricsService | undefined;
let mcpServer: MCPServer | undefined;
let chatParticipant: HanzoChatParticipant | undefined;

export async function activate(context: vscode.ExtensionContext) {
    console.log('Hanzo AI Extension is now active!');

    // Initialize services
    authManager = AuthManager.getInstance(context);
    statusBar = StatusBarService.getInstance();
    reminderService = new ReminderService(context);
    metricsService = HanzoMetricsService.getInstance(context);

    // Initialize MCP Server for Claude Desktop integration
    const config = getConfig();
    if (config.mcp.enabled) {
        mcpServer = new MCPServer(context);
        await mcpServer.initialize();
    }

    // Initialize VS Code Chat Participant
    try {
        chatParticipant = new HanzoChatParticipant(context);
        const participant = await chatParticipant.initialize();
        context.subscriptions.push(participant);
        console.log('Hanzo Chat Participant registered successfully');
    } catch (error) {
        console.error('Failed to register chat participant:', error);
        vscode.window.showErrorMessage(`Hanzo: Failed to initialize chat participant. ${error instanceof Error ? error.message : String(error)}`);
    }

    // Register commands
    const disposables = [
        vscode.commands.registerCommand('hanzo.openManager', () => {
            openProjectManager(context);
        }),
        vscode.commands.registerCommand('hanzo.openWelcomeGuide', () => {
            openWelcomeGuide(context);
        }),
        vscode.commands.registerCommand('hanzo.reanalyzeProject', async () => {
            if (projectManager) {
                await projectManager.analyzeProject();
            }
        }),
        vscode.commands.registerCommand('hanzo.triggerReminder', () => {
            reminderService?.triggerManually();
        }),
        vscode.commands.registerCommand('hanzo.login', async () => {
            await authManager?.initiateAuth();
        }),
        vscode.commands.registerCommand('hanzo.logout', async () => {
            await authManager?.logout();
        }),
        vscode.commands.registerCommand('hanzo.debug.authState', async () => {
            vscode.window.showInformationMessage(await authManager.describe());
        }),
        vscode.commands.registerCommand('hanzo.debug.clearAuth', async () => {
            await authManager?.logout();
            vscode.window.showInformationMessage('Signed out of Hanzo AI.');
        }),
        vscode.commands.registerCommand('hanzo.checkMetrics', () => {
            const metrics = metricsService?.getDetailedSummary();
            if (metrics) {
                vscode.window.showInformationMessage(metrics);
            }
        }),
        vscode.commands.registerCommand('hanzo.resetMetrics', () => {
            metricsService?.resetMetrics();
        })
    ];

    context.subscriptions.push(...disposables);

    // Not awaited: the prompt stays up until answered, and activation must not wait on it.
    if (!(await authManager.isAuthenticated())) {
        vscode.window.showInformationMessage('Sign in to use Hanzo AI.', 'Sign in').then(choice => {
            if (choice) {
                authManager?.initiateAuth();
            }
        });
    }

    // Auto-open manager on startup if configured
    const autoOpenManager = vscode.workspace.getConfiguration('hanzo').get<boolean>('autoOpenManager', false);
    if (autoOpenManager) {
        openProjectManager(context);
    }

    // Initialize reminder service
    // Reminder service starts automatically in constructor

    // Setup Python SDK (Auto-discovery)
    const pythonSetup = new PythonSdkSetup(context);
    // Don't await this to avoid blocking activation
    pythonSetup.setup().catch(console.error);
}

function openProjectManager(context: vscode.ExtensionContext) {
    const panel = vscode.window.createWebviewPanel(
        'hanzoProjectManager',
        'Hanzo Project Manager',
        vscode.ViewColumn.One,
        {
            enableScripts: true,
            retainContextWhenHidden: true
        }
    );

    projectManager = new ProjectManager(panel, context);

    panel.webview.html = getWebviewContent(panel.webview, context.extensionUri);

    panel.webview.onDidReceiveMessage(
        async message => {
            if (projectManager) {
                await projectManager.handleMessage(message);
            }
        },
        undefined,
        context.subscriptions
    );

    panel.onDidDispose(
        () => {
            projectManager = undefined;
        },
        undefined,
        context.subscriptions
    );
}

function openWelcomeGuide(context: vscode.ExtensionContext) {
    const panel = vscode.window.createWebviewPanel(
        'hanzoWelcomeGuide',
        'Hanzo Welcome Guide',
        vscode.ViewColumn.One,
        {
            enableScripts: true
        }
    );

    panel.webview.html = getWebviewContent(panel.webview, context.extensionUri, true);
}

export function deactivate() {
    if (mcpServer) {
        mcpServer.shutdown();
    }
    if (reminderService) {
        reminderService.dispose();
    }
    if (statusBar) {
        statusBar.dispose();
    }
}