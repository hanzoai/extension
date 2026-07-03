import * as vscode from 'vscode';
import { MCPTool } from '../server';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

const CONFIG_PATH = path.join(os.homedir(), '.hanzo', 'mcp-servers.json');

interface MCPServerConfig {
    name: string;
    command: string;
    args?: string[];
    env?: Record<string, string>;
    enabled?: boolean;
    addedAt?: string;
}

function loadServers(): Record<string, MCPServerConfig> {
    try {
        if (fs.existsSync(CONFIG_PATH)) {return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf-8'));}
    } catch { /* best-effort — deliberately ignored */ }
    return {};
}

function saveServers(servers: Record<string, MCPServerConfig>): void {
    const dir = path.dirname(CONFIG_PATH);
    if (!fs.existsSync(dir)) {fs.mkdirSync(dir, { recursive: true });}
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(servers, null, 2) + '\n', 'utf-8');
}

export function createMCPManagementTools(context: vscode.ExtensionContext): MCPTool[] {
    return [
        {
            name: 'mcp',
            description: 'Manage MCP servers and tools',
            inputSchema: {
                type: 'object',
                properties: {
                    action: { type: 'string', enum: ['add', 'remove', 'list', 'stats'], description: 'MCP management action' },
                    server: { type: 'string', description: 'MCP server name or path' },
                    config: { type: 'object', description: 'Server configuration' }
                },
                required: ['action']
            },
            handler: async (args: { action: string; server?: string; config?: any }) => {
                switch (args.action) {
                    case 'list': {
                        const servers = loadServers();
                        const names = Object.keys(servers);
                        const lines = ['MCP Servers:', '  hanzo (built-in, always active)'];
                        names.forEach(name => {
                            const s = servers[name];
                            const status = s.enabled === false ? 'disabled' : 'enabled';
                            lines.push(`  ${name}: ${s.command} (${status})`);
                        });
                        lines.push(`\n${names.length + 1} server(s) configured`);
                        lines.push(`Config: ${CONFIG_PATH}`);
                        return lines.join('\n');
                    }

                    case 'add': {
                        if (!args.server || !args.config?.command) {
                            return 'Error: server name and config.command required.\nExample: mcp add --server my-server --config {"command": "npx @my/mcp-server"}';
                        }
                        const servers = loadServers();
                        servers[args.server] = {
                            name: args.server,
                            command: args.config.command,
                            args: args.config.args,
                            env: args.config.env,
                            enabled: true,
                            addedAt: new Date().toISOString()
                        };
                        saveServers(servers);
                        return `Added MCP server: ${args.server} (${args.config.command})`;
                    }

                    case 'remove': {
                        if (!args.server) {return 'Error: server name required';}
                        const servers = loadServers();
                        if (!servers[args.server]) {return `Error: Server not found: ${args.server}`;}
                        delete servers[args.server];
                        saveServers(servers);
                        return `Removed MCP server: ${args.server}`;
                    }

                    case 'stats': {
                        const servers = loadServers();
                        const total = Object.keys(servers).length + 1; // +1 for built-in hanzo
                        const enabled = Object.values(servers).filter(s => s.enabled !== false).length + 1;
                        const lines = [
                            'MCP Statistics:',
                            `  Total servers: ${total}`,
                            `  Enabled: ${enabled}`,
                            `  Disabled: ${total - enabled}`,
                            `  Config: ${CONFIG_PATH}`,
                            `  Config size: ${fs.existsSync(CONFIG_PATH) ? fs.statSync(CONFIG_PATH).size : 0} bytes`
                        ];
                        return lines.join('\n');
                    }

                    default:
                        throw new Error(`Unknown action: ${args.action}`);
                }
            }
        },

        {
            name: 'mcp_add',
            description: 'Add an external MCP server',
            inputSchema: {
                type: 'object',
                properties: {
                    name: { type: 'string', description: 'Server name' },
                    command: { type: 'string', description: 'Command to start the server' },
                    env: { type: 'object', description: 'Environment variables' }
                },
                required: ['name', 'command']
            },
            handler: async (args: { name: string; command: string; env?: any }) => {
                const servers = loadServers();
                servers[args.name] = {
                    name: args.name,
                    command: args.command,
                    env: args.env,
                    enabled: true,
                    addedAt: new Date().toISOString()
                };
                saveServers(servers);
                return `Added MCP server: ${args.name}\n  Command: ${args.command}${args.env ? `\n  Env: ${Object.keys(args.env).join(', ')}` : ''}`;
            }
        },

        {
            name: 'mcp_remove',
            description: 'Remove an MCP server',
            inputSchema: {
                type: 'object',
                properties: {
                    name: { type: 'string', description: 'Server name to remove' }
                },
                required: ['name']
            },
            handler: async (args: { name: string }) => {
                const servers = loadServers();
                if (!servers[args.name]) {return `Error: Server not found: ${args.name}\nUse 'mcp list' to see available servers.`;}
                const cmd = servers[args.name].command;
                delete servers[args.name];
                saveServers(servers);
                return `Removed MCP server: ${args.name} (was: ${cmd})`;
            }
        },

        {
            name: 'mcp_stats',
            description: 'Show MCP server statistics',
            inputSchema: {
                type: 'object',
                properties: {
                    server: { type: 'string', description: 'Server name (optional, shows all if not specified)' }
                }
            },
            handler: async (args: { server?: string }) => {
                const servers = loadServers();
                if (args.server) {
                    const s = servers[args.server];
                    if (!s) {return `Error: Server not found: ${args.server}`;}
                    return [
                        `Server: ${s.name}`,
                        `  Command: ${s.command}`,
                        `  Args: ${s.args?.join(' ') || '(none)'}`,
                        `  Enabled: ${s.enabled !== false}`,
                        `  Added: ${s.addedAt || 'unknown'}`,
                        `  Env vars: ${s.env ? Object.keys(s.env).join(', ') : '(none)'}`
                    ].join('\n');
                }

                const total = Object.keys(servers).length + 1;
                const lines = [
                    'MCP Server Statistics:',
                    '',
                    '  hanzo (built-in):',
                    '    Status: always active',
                    '    Tools: 200+',
                ];
                Object.entries(servers).forEach(([name, s]) => {
                    lines.push(`\n  ${name}:`);
                    lines.push(`    Command: ${s.command}`);
                    lines.push(`    Enabled: ${s.enabled !== false}`);
                    lines.push(`    Added: ${s.addedAt || 'unknown'}`);
                });
                lines.push(`\nTotal: ${total} servers`);
                return lines.join('\n');
            }
        }
    ];
}
