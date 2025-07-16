import * as vscode from 'vscode';
import { MCPPrompt } from '../server';

export function createPrompts(context: vscode.ExtensionContext): MCPPrompt[] {
    const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || '';
    
    return [
        {
            name: 'project_system',
            description: 'Get system prompt for project context',
            handler: async (args: any) => {
                const gitInfo = await getGitInfo(workspaceRoot);
                const envInfo = getEnvironmentInfo();
                
                return `You are working in a project at: ${workspaceRoot}

Git Information:
${gitInfo}

Environment:
${envInfo}

Available tools: read, write, edit, multi_edit, directory_tree, find_files, grep, search, symbols, git_search, run_command, process, todo, think, batch

When working with files:
- Always use absolute paths
- Verify file existence before editing
- Follow project conventions from .cursorrules or similar files
- Consider using the 'rules' tool to understand project conventions`;
            }
        },
        
        {
            name: 'compact_conversation',
            description: 'Generate a compact summary of conversation',
            arguments: [
                {
                    name: 'messages',
                    description: 'Conversation messages to summarize',
                    required: true
                }
            ],
            handler: async (args: { messages?: any[] }) => {
                if (!args.messages || args.messages.length === 0) {
                    return 'No messages to summarize';
                }
                
                return `Conversation Summary:

Total messages: ${args.messages.length}
Topics discussed:
- [Analyze messages to extract main topics]
- [List key decisions made]
- [Note any unresolved issues]

Key outcomes:
- [List main achievements]
- [Note any created/modified files]
- [Highlight important findings]

Next steps:
- [Suggest logical next actions]`;
            }
        },
        
        {
            name: 'create_release',
            description: 'Template for creating a release',
            arguments: [
                {
                    name: 'version',
                    description: 'Version number',
                    required: true
                },
                {
                    name: 'changes',
                    description: 'List of changes',
                    required: false
                }
            ],
            handler: async (args: { version?: string; changes?: string[] }) => {
                const version = args.version || 'X.Y.Z';
                const date = new Date().toISOString().split('T')[0];
                
                return `# Release ${version} (${date})

## 🚀 Features
- [Add new features here]

## 🐛 Bug Fixes
- [List bug fixes]

## 📚 Documentation
- [Documentation updates]

## 🔧 Maintenance
- [Internal improvements]

${args.changes ? '\n## Changes from input:\n' + args.changes.map(c => `- ${c}`).join('\n') : ''}

## Installation
\`\`\`bash
# Update to latest version
npm update @hanzo/extension
\`\`\`

## Breaking Changes
- [List any breaking changes]

## Migration Guide
[If there are breaking changes, provide migration steps]`;
            }
        },
        
        {
            name: 'todo_reminder',
            description: 'Generate reminder about pending todos',
            handler: async (args: any) => {
                // This would normally read actual todos
                return `📋 Todo Reminder

You have pending tasks in your todo list. Use the 'todo' tool to:
- View all tasks: todo action:read
- Add new tasks: todo action:write tasks:[...]
- Update task status: todo action:write tasks:[{id: "...", status: "completed"}]

Remember to:
- Break down large tasks into smaller, manageable items
- Set appropriate priorities (high, medium, low)
- Regularly update task status as you progress
- Clean up completed tasks periodically`;
            }
        }
    ];
}

async function getGitInfo(workspaceRoot: string): Promise<string> {
    try {
        const { exec } = require('child_process');
        const { promisify } = require('util');
        const execAsync = promisify(exec);
        
        const branch = await execAsync('git branch --show-current', { cwd: workspaceRoot });
        const status = await execAsync('git status --short', { cwd: workspaceRoot });
        const remote = await execAsync('git remote -v', { cwd: workspaceRoot });
        
        return `Branch: ${branch.stdout.trim()}
Status: ${status.stdout ? status.stdout.trim() : 'Clean'}
Remotes: ${remote.stdout.trim().split('\n')[0] || 'No remotes'}`;
    } catch {
        return 'Not a git repository';
    }
}

function getEnvironmentInfo(): string {
    return `Platform: ${process.platform}
Node: ${process.version}
VS Code: ${vscode.version}
Workspace: ${vscode.workspace.name || 'Untitled'}`;
}