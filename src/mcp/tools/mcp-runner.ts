import * as vscode from 'vscode';
import * as cp from 'child_process';
import * as path from 'path';
import { MCPTool } from '../server';

interface MCPServer {
    name: string;
    command: string;
    args?: string[];
    env?: Record<string, string>;
    process?: cp.ChildProcess;
    transport: 'stdio' | 'tcp';
    host?: string;
    port?: number;
    status: 'stopped' | 'starting' | 'running' | 'error';
    error?: string;
    logs: string[];
}

export class MCPRunnerTools {
    private context: vscode.ExtensionContext;
    private servers: Map<string, MCPServer> = new Map();

    constructor(context: vscode.ExtensionContext) {
        this.context = context;
        this.loadServers();
    }

    private loadServers() {
        const savedServers = this.context.globalState.get<MCPServer[]>('hanzo.mcpServers', []);
        for (const server of savedServers) {
            // Don't restore process, just configuration
            this.servers.set(server.name, {
                ...server,
                process: undefined,
                status: 'stopped'
            });
        }
    }

    private saveServers() {
        const serversArray = Array.from(this.servers.values()).map(s => ({
            name: s.name,
            command: s.command,
            args: s.args,
            env: s.env,
            transport: s.transport,
            host: s.host,
            port: s.port,
            status: s.status,
            error: s.error
        }));
        this.context.globalState.update('hanzo.mcpServers', serversArray);
    }

    getTools(): MCPTool[] {
        return [
            {
                name: 'mcp',
                description: 'Manage and run arbitrary MCP servers. Actions: add, remove, start, stop, list, logs, call',
                inputSchema: {
                    type: 'object',
                    properties: {
                        action: {
                            type: 'string',
                            enum: ['add', 'remove', 'start', 'stop', 'list', 'logs', 'call'],
                            description: 'Action to perform'
                        },
                        name: {
                            type: 'string',
                            description: 'Server name'
                        },
                        command: {
                            type: 'string',
                            description: 'Command to run the MCP server (for add action)'
                        },
                        args: {
                            type: 'array',
                            items: { type: 'string' },
                            description: 'Command arguments (for add action)'
                        },
                        env: {
                            type: 'object',
                            description: 'Environment variables (for add action)'
                        },
                        transport: {
                            type: 'string',
                            enum: ['stdio', 'tcp'],
                            description: 'Transport type (default: stdio)'
                        },
                        host: {
                            type: 'string',
                            description: 'TCP host (for tcp transport)'
                        },
                        port: {
                            type: 'number',
                            description: 'TCP port (for tcp transport)'
                        },
                        tool: {
                            type: 'string',
                            description: 'Tool name to call (for call action)'
                        },
                        tool_args: {
                            type: 'object',
                            description: 'Arguments for tool call (for call action)'
                        },
                        lines: {
                            type: 'number',
                            description: 'Number of log lines to show (for logs action, default: 50)'
                        }
                    },
                    required: ['action']
                },
                handler: this.mcpHandler.bind(this)
            }
        ];
    }

    private async mcpHandler(args: any): Promise<string> {
        const { action } = args;

        switch (action) {
            case 'add': {
                const { name, command, args: cmdArgs, env, transport = 'stdio', host, port } = args;
                
                if (this.servers.has(name)) {
                    throw new Error(`MCP server '${name}' already exists`);
                }
                
                const server: MCPServer = {
                    name,
                    command,
                    args: cmdArgs,
                    env,
                    transport,
                    host,
                    port,
                    status: 'stopped',
                    logs: []
                };
                
                this.servers.set(name, server);
                this.saveServers();
                
                return `Added MCP server '${name}'\nCommand: ${command} ${(cmdArgs || []).join(' ')}\nTransport: ${transport}`;
            }
            
            case 'remove': {
                const { name } = args;
                const server = this.servers.get(name);
                
                if (!server) {
                    throw new Error(`MCP server '${name}' not found`);
                }
                
                if (server.status === 'running' && server.process) {
                    server.process.kill();
                }
                
                this.servers.delete(name);
                this.saveServers();
                
                return `Removed MCP server '${name}'`;
            }
            
            case 'start': {
                const { name } = args;
                const server = this.servers.get(name);
                
                if (!server) {
                    throw new Error(`MCP server '${name}' not found`);
                }
                
                if (server.status === 'running') {
                    return `MCP server '${name}' is already running`;
                }
                
                return this.startServer(server);
            }
            
            case 'stop': {
                const { name } = args;
                const server = this.servers.get(name);
                
                if (!server) {
                    throw new Error(`MCP server '${name}' not found`);
                }
                
                if (server.status !== 'running' || !server.process) {
                    return `MCP server '${name}' is not running`;
                }
                
                server.process.kill();
                server.status = 'stopped';
                server.process = undefined;
                this.saveServers();
                
                return `Stopped MCP server '${name}'`;
            }
            
            case 'list': {
                if (this.servers.size === 0) {
                    return 'No MCP servers configured';
                }
                
                let output = 'MCP Servers:\n\n';
                
                for (const [name, server] of this.servers) {
                    output += `**${name}** (${server.status})\n`;
                    output += `  Command: ${server.command} ${(server.args || []).join(' ')}\n`;
                    output += `  Transport: ${server.transport}`;
                    if (server.transport === 'tcp') {
                        output += ` (${server.host || 'localhost'}:${server.port || 3000})`;
                    }
                    output += '\n';
                    if (server.error) {
                        output += `  Error: ${server.error}\n`;
                    }
                    output += '\n';
                }
                
                return output.trim();
            }
            
            case 'logs': {
                const { name, lines = 50 } = args;
                const server = this.servers.get(name);
                
                if (!server) {
                    throw new Error(`MCP server '${name}' not found`);
                }
                
                if (server.logs.length === 0) {
                    return `No logs available for '${name}'`;
                }
                
                const recentLogs = server.logs.slice(-lines);
                return `Logs for '${name}' (last ${recentLogs.length} lines):\n\n${recentLogs.join('\n')}`;
            }
            
            case 'call': {
                const { name, tool, tool_args } = args;
                const server = this.servers.get(name);
                
                if (!server) {
                    throw new Error(`MCP server '${name}' not found`);
                }
                
                if (server.status !== 'running') {
                    throw new Error(`MCP server '${name}' is not running`);
                }
                
                // In a real implementation, this would use the MCP protocol to call the tool
                // For now, we'll return a placeholder
                return `Tool call to '${tool}' on server '${name}' not yet implemented\n\nThis would call the tool with args: ${JSON.stringify(tool_args, null, 2)}`;
            }
            
            default:
                throw new Error(`Unknown action: ${action}`);
        }
    }

    private async startServer(server: MCPServer): Promise<string> {
        return new Promise((resolve, reject) => {
            try {
                server.status = 'starting';
                server.logs = [];
                server.error = undefined;
                
                const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
                const cwd = workspaceFolder?.uri.fsPath || process.cwd();
                
                // Prepare environment
                const env = {
                    ...process.env,
                    ...server.env
                };
                
                if (server.transport === 'stdio') {
                    // For stdio transport, spawn the process
                    const proc = cp.spawn(server.command, server.args || [], {
                        cwd,
                        env,
                        shell: true
                    });
                    
                    server.process = proc;
                    
                    // Capture output
                    proc.stdout?.on('data', (data) => {
                        const lines = data.toString().split('\n').filter((l: string) => l);
                        server.logs.push(...lines.map((l: string) => `[stdout] ${l}`));
                        if (server.logs.length > 1000) {
                            server.logs.splice(0, server.logs.length - 1000);
                        }
                    });
                    
                    proc.stderr?.on('data', (data) => {
                        const lines = data.toString().split('\n').filter((l: string) => l);
                        server.logs.push(...lines.map((l: string) => `[stderr] ${l}`));
                        if (server.logs.length > 1000) {
                            server.logs.splice(0, server.logs.length - 1000);
                        }
                    });
                    
                    proc.on('error', (error) => {
                        server.status = 'error';
                        server.error = error.message;
                        server.logs.push(`[error] ${error.message}`);
                        this.saveServers();
                    });
                    
                    proc.on('exit', (code) => {
                        server.status = 'stopped';
                        server.process = undefined;
                        server.logs.push(`[exit] Process exited with code ${code}`);
                        this.saveServers();
                    });
                    
                    // Wait a bit to see if it starts successfully
                    setTimeout(() => {
                        if (proc.killed) {
                            reject(new Error('Server failed to start'));
                        } else {
                            server.status = 'running';
                            this.saveServers();
                            resolve(`Started MCP server '${server.name}' with PID ${proc.pid}\nTransport: stdio`);
                        }
                    }, 1000);
                    
                } else if (server.transport === 'tcp') {
                    // For TCP transport, spawn the process
                    const host = server.host || 'localhost';
                    const port = server.port || 3000;
                    
                    // Add host and port to environment
                    env.MCP_HOST = host;
                    env.MCP_PORT = port.toString();
                    
                    const proc = cp.spawn(server.command, server.args || [], {
                        cwd,
                        env,
                        shell: true
                    });
                    
                    server.process = proc;
                    
                    // Similar event handling as stdio
                    proc.stdout?.on('data', (data) => {
                        const lines = data.toString().split('\n').filter((l: string) => l);
                        server.logs.push(...lines.map((l: string) => `[stdout] ${l}`));
                    });
                    
                    proc.stderr?.on('data', (data) => {
                        const lines = data.toString().split('\n').filter((l: string) => l);
                        server.logs.push(...lines.map((l: string) => `[stderr] ${l}`));
                    });
                    
                    proc.on('error', (error) => {
                        server.status = 'error';
                        server.error = error.message;
                        this.saveServers();
                    });
                    
                    proc.on('exit', (code) => {
                        server.status = 'stopped';
                        server.process = undefined;
                        this.saveServers();
                    });
                    
                    setTimeout(() => {
                        if (proc.killed) {
                            reject(new Error('Server failed to start'));
                        } else {
                            server.status = 'running';
                            this.saveServers();
                            resolve(`Started MCP server '${server.name}' with PID ${proc.pid}\nTransport: tcp://${host}:${port}`);
                        }
                    }, 1000);
                }
                
            } catch (error: any) {
                server.status = 'error';
                server.error = error.message;
                this.saveServers();
                reject(error);
            }
        });
    }
}

export function createMCPRunnerTools(context: vscode.ExtensionContext): MCPTool[] {
    const runner = new MCPRunnerTools(context);
    return runner.getTools();
}