import * as vscode from 'vscode';
import * as os from 'os';
import { MCPTool } from '../server';
import { MCPTools } from './index';

export function createSystemTools(context: vscode.ExtensionContext): MCPTool[] {
    return [

        {
            name: 'stats',
            description: 'Display system and usage statistics',
            inputSchema: {
                type: 'object',
                properties: {}
            },
            handler: async () => {
                const mcpTools = new MCPTools(context);
                const toolStats = mcpTools.getToolStats();
                
                // System info
                const systemInfo = {
                    platform: os.platform(),
                    arch: os.arch(),
                    cpus: os.cpus().length,
                    totalMemory: Math.round(os.totalmem() / 1024 / 1024 / 1024) + ' GB',
                    freeMemory: Math.round(os.freemem() / 1024 / 1024 / 1024) + ' GB',
                    uptime: Math.round(os.uptime() / 3600) + ' hours'
                };
                
                // VS Code info
                const vscodeInfo = {
                    version: vscode.version,
                    workspace: vscode.workspace.name || 'No workspace',
                    workspaceFolders: vscode.workspace.workspaceFolders?.length || 0,
                    openEditors: vscode.window.visibleTextEditors.length
                };
                
                // Extension info
                const thoughts = context.globalState.get<string[]>('hanzo.thoughts', []);
                const todos = context.globalState.get<string>('hanzo.todos');
                let todoCount = 0;
                try {
                    const parsed = JSON.parse(todos || '[]');
                    todoCount = parsed.length;
                } catch {}
                
                const extensionInfo = {
                    thoughtsRecorded: thoughts.length,
                    todosActive: todoCount,
                    toolsEnabled: toolStats.enabled,
                    toolsTotal: toolStats.total
                };
                
                return `=== System Information ===
Platform: ${systemInfo.platform} (${systemInfo.arch})
CPUs: ${systemInfo.cpus}
Memory: ${systemInfo.freeMemory} free / ${systemInfo.totalMemory} total
Uptime: ${systemInfo.uptime}

=== VS Code Information ===
Version: ${vscodeInfo.version}
Workspace: ${vscodeInfo.workspace}
Workspace Folders: ${vscodeInfo.workspaceFolders}
Open Editors: ${vscodeInfo.openEditors}

=== Extension Information ===
Thoughts Recorded: ${extensionInfo.thoughtsRecorded}
Active Todos: ${extensionInfo.todosActive}
Tools Enabled: ${extensionInfo.toolsEnabled} / ${extensionInfo.toolsTotal}

=== Tool Categories ===
Filesystem: ${toolStats.categories.filesystem} tools
Search: ${toolStats.categories.search} tools
Shell: ${toolStats.categories.shell} tools
AI: ${toolStats.categories.ai} tools
Development: ${toolStats.categories.development} tools`;
            }
        }
    ];
}