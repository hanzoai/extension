import * as vscode from 'vscode';
import { SessionTracker } from '../core/session-tracker';

export function registerSessionCommands(context: vscode.ExtensionContext) {
    const tracker = SessionTracker.getInstance(context);
    
    // View session statistics
    context.subscriptions.push(
        vscode.commands.registerCommand('hanzo.viewSessionStats', async () => {
            const stats = await tracker.getStatistics();
            
            const message = `
Session Statistics:
- Total Sessions: ${stats.totalSessions}
- Total Events: ${stats.totalEvents}
- Commands Used: ${Object.keys(stats.commandUsage).length}
- Tools Used: ${Object.keys(stats.toolUsage).length}
- Errors: ${stats.errors}
- Average Session Duration: ${Math.round(stats.averageSessionDuration / 1000 / 60)} minutes
`;
            
            const selection = await vscode.window.showInformationMessage(
                message,
                'View Details',
                'Export Sessions',
                'Close'
            );
            
            if (selection === 'View Details') {
                await showDetailedStats(tracker);
            } else if (selection === 'Export Sessions') {
                await exportSessions(tracker);
            }
        })
    );
    
    // Search session history
    context.subscriptions.push(
        vscode.commands.registerCommand('hanzo.searchSessionHistory', async () => {
            const query = await vscode.window.showInputBox({
                prompt: 'Enter search query',
                placeHolder: 'Search in session history...'
            });
            
            if (!query) return;
            
            const results = await tracker.searchSessions(query, { limit: 20 });
            
            if (results.length === 0) {
                vscode.window.showInformationMessage('No results found');
                return;
            }
            
            const items = results.map(event => ({
                label: `${event.type}: ${event.action}`,
                description: new Date(event.timestamp).toLocaleString(),
                detail: event.details ? JSON.stringify(event.details).substring(0, 100) : undefined,
                event
            }));
            
            const selected = await vscode.window.showQuickPick(items, {
                placeHolder: 'Select an event to view details'
            });
            
            if (selected) {
                await showEventDetails(selected.event);
            }
        })
    );
    
    // End current session
    context.subscriptions.push(
        vscode.commands.registerCommand('hanzo.endSession', async () => {
            await tracker.endSession();
            vscode.window.showInformationMessage('Session ended');
        })
    );
}

async function showDetailedStats(tracker: SessionTracker) {
    const stats = await tracker.getStatistics();
    
    // Create a webview to show detailed statistics
    const panel = vscode.window.createWebviewPanel(
        'sessionStats',
        'Session Statistics',
        vscode.ViewColumn.One,
        {}
    );
    
    panel.webview.html = `
<!DOCTYPE html>
<html>
<head>
    <style>
        body { font-family: var(--vscode-font-family); padding: 20px; }
        h1 { color: var(--vscode-editor-foreground); }
        .stat-card { 
            background: var(--vscode-editor-background);
            border: 1px solid var(--vscode-panel-border);
            padding: 15px;
            margin: 10px 0;
            border-radius: 5px;
        }
        .stat-value { font-size: 24px; font-weight: bold; }
        table { width: 100%; border-collapse: collapse; margin-top: 20px; }
        th, td { 
            text-align: left; 
            padding: 8px;
            border-bottom: 1px solid var(--vscode-panel-border);
        }
        th { background: var(--vscode-editor-selectionBackground); }
    </style>
</head>
<body>
    <h1>Session Statistics</h1>
    
    <div class="stat-card">
        <h3>Overview</h3>
        <p>Total Sessions: <span class="stat-value">${stats.totalSessions}</span></p>
        <p>Total Events: <span class="stat-value">${stats.totalEvents}</span></p>
        <p>Total Errors: <span class="stat-value">${stats.errors}</span></p>
    </div>
    
    <div class="stat-card">
        <h3>Event Types</h3>
        <table>
            <tr><th>Type</th><th>Count</th></tr>
            ${Object.entries(stats.eventTypes)
                .map(([type, count]) => `<tr><td>${type}</td><td>${count}</td></tr>`)
                .join('')}
        </table>
    </div>
    
    <div class="stat-card">
        <h3>Top Commands</h3>
        <table>
            <tr><th>Command</th><th>Usage</th></tr>
            ${Object.entries(stats.commandUsage)
                .sort(([,a], [,b]) => (b as number) - (a as number))
                .slice(0, 10)
                .map(([cmd, count]) => `<tr><td>${cmd}</td><td>${count}</td></tr>`)
                .join('')}
        </table>
    </div>
    
    <div class="stat-card">
        <h3>Top Tools</h3>
        <table>
            <tr><th>Tool</th><th>Usage</th></tr>
            ${Object.entries(stats.toolUsage)
                .sort(([,a], [,b]) => (b as number) - (a as number))
                .slice(0, 10)
                .map(([tool, count]) => `<tr><td>${tool}</td><td>${count}</td></tr>`)
                .join('')}
        </table>
    </div>
</body>
</html>
`;
}

async function showEventDetails(event: any) {
    const panel = vscode.window.createWebviewPanel(
        'eventDetails',
        'Event Details',
        vscode.ViewColumn.One,
        {}
    );
    
    panel.webview.html = `
<!DOCTYPE html>
<html>
<head>
    <style>
        body { font-family: var(--vscode-font-family); padding: 20px; }
        pre { 
            background: var(--vscode-textCodeBlock-background);
            padding: 10px;
            border-radius: 5px;
            overflow-x: auto;
        }
    </style>
</head>
<body>
    <h1>Event Details</h1>
    <p><strong>Type:</strong> ${event.type}</p>
    <p><strong>Action:</strong> ${event.action}</p>
    <p><strong>Timestamp:</strong> ${new Date(event.timestamp).toLocaleString()}</p>
    
    ${event.details ? `
        <h3>Details</h3>
        <pre>${JSON.stringify(event.details, null, 2)}</pre>
    ` : ''}
    
    ${event.metadata ? `
        <h3>Metadata</h3>
        <pre>${JSON.stringify(event.metadata, null, 2)}</pre>
    ` : ''}
</body>
</html>
`;
}

async function exportSessions(tracker: SessionTracker) {
    const uri = await vscode.window.showSaveDialog({
        defaultUri: vscode.Uri.file('session-export.json'),
        filters: {
            'JSON files': ['json']
        }
    });
    
    if (uri) {
        await tracker.exportSessions(uri.fsPath);
        vscode.window.showInformationMessage(`Sessions exported to ${uri.fsPath}`);
    }
}