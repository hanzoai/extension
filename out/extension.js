"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.activate = activate;
exports.deactivate = deactivate;
const vscode = __importStar(require("vscode"));
const ProjectManager_1 = require("./ProjectManager");
const manager_1 = require("./auth/manager");
const StatusBarService_1 = require("./services/StatusBarService");
const ReminderService_1 = require("./services/ReminderService");
const HanzoMetricsService_1 = require("./services/HanzoMetricsService");
const server_1 = require("./mcp/server");
const config_1 = require("./config");
const content_1 = require("./webview/content");
const hanzo_chat_participant_1 = require("./chat/hanzo-chat-participant");
let projectManager;
let authManager;
let reminderService;
let statusBar;
let metricsService;
let mcpServer;
let chatParticipant;
async function activate(context) {
    console.log('Hanzo AI Extension is now active!');
    // Initialize services
    authManager = manager_1.AuthManager.getInstance(context);
    statusBar = StatusBarService_1.StatusBarService.getInstance();
    reminderService = new ReminderService_1.ReminderService(context);
    metricsService = HanzoMetricsService_1.HanzoMetricsService.getInstance(context);
    // Initialize MCP Server for Claude Desktop integration
    const config = (0, config_1.getConfig)();
    if (config.mcp.enabled) {
        mcpServer = new server_1.MCPServer(context);
        await mcpServer.initialize();
    }
    // Initialize VS Code Chat Participant
    try {
        chatParticipant = new hanzo_chat_participant_1.HanzoChatParticipant(context);
        const participant = await chatParticipant.initialize();
        context.subscriptions.push(participant);
        console.log('Hanzo Chat Participant registered successfully');
    }
    catch (error) {
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
    const autoOpenManager = vscode.workspace.getConfiguration('hanzo').get('autoOpenManager', false);
    if (autoOpenManager) {
        openProjectManager(context);
    }
    // Initialize reminder service
    // Reminder service starts automatically in constructor
}
function openProjectManager(context) {
    const panel = vscode.window.createWebviewPanel('hanzoProjectManager', 'Hanzo Project Manager', vscode.ViewColumn.One, {
        enableScripts: true,
        retainContextWhenHidden: true
    });
    projectManager = new ProjectManager_1.ProjectManager(panel, context);
    panel.webview.html = (0, content_1.getWebviewContent)(panel.webview, context.extensionUri);
    panel.webview.onDidReceiveMessage(async (message) => {
        if (projectManager) {
            await projectManager.handleMessage(message);
        }
    }, undefined, context.subscriptions);
    panel.onDidDispose(() => {
        projectManager = undefined;
    }, undefined, context.subscriptions);
}
function openWelcomeGuide(context) {
    const panel = vscode.window.createWebviewPanel('hanzoWelcomeGuide', 'Hanzo Welcome Guide', vscode.ViewColumn.One, {
        enableScripts: true
    });
    panel.webview.html = (0, content_1.getWebviewContent)(panel.webview, context.extensionUri, true);
}
function deactivate() {
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
//# sourceMappingURL=extension.js.map