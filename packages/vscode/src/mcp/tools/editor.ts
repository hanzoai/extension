import * as vscode from 'vscode';
import { MCPTool } from '../server';
import { execSync } from 'child_process';

function nvimAvailable(): boolean {
    try { execSync('nvim --version', { stdio: 'pipe' }); return true; } catch { return false; }
}

function findNvimSocket(): string | null {
    try {
        const result = execSync("ls /tmp/nvim.*/0 2>/dev/null || ls ${XDG_RUNTIME_DIR:-/tmp}/nvim.*/0 2>/dev/null", { stdio: 'pipe', shell: '/bin/sh' }).toString().trim();
        return result.split('\n')[0] || null;
    } catch { return null; }
}

export function createEditorTools(context: vscode.ExtensionContext): MCPTool[] {
    return [
        {
            name: 'neovim_edit',
            description: 'Edit files using Neovim commands',
            inputSchema: {
                type: 'object',
                properties: {
                    path: {
                        type: 'string',
                        description: 'File path to edit'
                    },
                    commands: {
                        type: 'array',
                        items: { type: 'string' },
                        description: 'Neovim ex commands to execute (e.g., ["%s/foo/bar/g", "wq"])'
                    }
                },
                required: ['path', 'commands']
            },
            handler: async (args: { path: string; commands: string[] }) => {
                if (!nvimAvailable()) return 'Error: nvim not found in PATH';
                const cmds = args.commands.map(c => `+${JSON.stringify(c)}`).join(' ');
                try {
                    execSync(`nvim --headless ${cmds} +wq ${JSON.stringify(args.path)}`, {
                        stdio: 'pipe', timeout: 10000
                    });
                    return `Executed ${args.commands.length} command(s) on ${args.path}`;
                } catch (e: any) {
                    return `Error: ${e.message}`;
                }
            }
        },

        {
            name: 'neovim_command',
            description: 'Execute a Neovim command on a running instance via RPC',
            inputSchema: {
                type: 'object',
                properties: {
                    command: {
                        type: 'string',
                        description: 'Neovim command to execute'
                    },
                    server: {
                        type: 'string',
                        description: 'Neovim server address (auto-detected if omitted)'
                    }
                },
                required: ['command']
            },
            handler: async (args: { command: string; server?: string }) => {
                if (!nvimAvailable()) return 'Error: nvim not found in PATH';
                const addr = args.server || findNvimSocket();
                if (!addr) return 'Error: No running Neovim instance found. Start nvim with --listen /tmp/nvim.sock';
                try {
                    const result = execSync(
                        `nvim --server ${JSON.stringify(addr)} --remote-send ':${args.command}<CR>'`,
                        { stdio: 'pipe', timeout: 5000 }
                    );
                    return `Sent command to nvim@${addr}: ${args.command}`;
                } catch (e: any) {
                    return `Error: ${e.message}`;
                }
            }
        },

        {
            name: 'neovim_session',
            description: 'Manage Neovim sessions',
            inputSchema: {
                type: 'object',
                properties: {
                    action: {
                        type: 'string',
                        enum: ['create', 'list', 'attach', 'detach'],
                        description: 'Session action'
                    },
                    name: {
                        type: 'string',
                        description: 'Session name'
                    }
                },
                required: ['action']
            },
            handler: async (args: { action: string; name?: string }) => {
                if (!nvimAvailable()) return 'Error: nvim not found in PATH';
                switch (args.action) {
                    case 'list': {
                        try {
                            const sockets = execSync("ls /tmp/nvim.*/0 2>/dev/null || echo ''", { stdio: 'pipe', shell: '/bin/sh' }).toString().trim();
                            if (!sockets) return 'No active Neovim sessions found.';
                            const sessions = sockets.split('\n').filter(Boolean);
                            return `Active Neovim sessions (${sessions.length}):\n${sessions.map((s, i) => `  ${i}: ${s}`).join('\n')}`;
                        } catch { return 'No active Neovim sessions found.'; }
                    }
                    case 'create': {
                        const sock = `/tmp/nvim-${args.name || 'hanzo'}.sock`;
                        return `To create a session, run:\n  nvim --listen ${sock}\n\nThen use neovim_command with server="${sock}"`;
                    }
                    case 'attach': {
                        const addr = args.name || findNvimSocket();
                        if (!addr) return 'Error: No session to attach to. Specify a name or socket path.';
                        return `To attach to session, run:\n  nvim --server ${addr} --remote-ui`;
                    }
                    case 'detach':
                        return 'Detach by closing the terminal or pressing Ctrl-\\ Ctrl-N then :qa';
                    default:
                        throw new Error(`Unknown action: ${args.action}`);
                }
            }
        }
    ];
}
