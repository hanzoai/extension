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
            // Debug auth state functionality not implemented
            vscode.window.showInformationMessage('Auth debug not implemented');
        }),
        vscode.commands.registerCommand('hanzo.debug.clearAuth', async () => {
            await authManager?.logout();
            vscode.window.showInformationMessage('Auth data cleared');
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

    // Initialize authentication and show status
    // Check authentication status on startup
    const isAuth = await authManager.isAuthenticated();
    if (!isAuth) {
        vscode.window.showInformationMessage('Please login to use Hanzo AI features');
    }
    
    // Auto-open manager on startup if configured
    const autoOpenManager = vscode.workspace.getConfiguration('hanzo').get<boolean>('autoOpenManager', false);
    if (autoOpenManager) {
        openProjectManager(context);
    }

    // Initialize reminder service
    // Reminder service starts automatically in constructor
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