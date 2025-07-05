import * as vscode from 'vscode';
import * as cp from 'child_process';
import * as path from 'path';
import { MCPTool } from '../server';

interface BashSession {
    id: string;
    cwd: string;
    env: Record<string, string>;
    history: string[];
    created: Date;
}

export class BashTools {
    private context: vscode.ExtensionContext;
    private sessions: Map<string, BashSession> = new Map();
    private currentSessionId: string | null = null;

    constructor(context: vscode.ExtensionContext) {
        this.context = context;
        this.loadSessions();
    }

    private loadSessions() {
        const savedSessions = this.context.globalState.get<any[]>('hanzo.bashSessions', []);
        for (const session of savedSessions) {
            this.sessions.set(session.id, {
                ...session,
                created: new Date(session.created)
            });
        }
    }

    private saveSessions() {
        const sessionsArray = Array.from(this.sessions.values());
        this.context.globalState.update('hanzo.bashSessions', sessionsArray);
    }

    private createSession(id?: string): BashSession {
        const sessionId = id || `bash-${Date.now()}`;
        const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
        
        const session: BashSession = {
            id: sessionId,
            cwd: workspaceFolder?.uri.fsPath || process.cwd(),
            env: { ...Object.fromEntries(
                Object.entries(process.env).filter(([, v]) => v !== undefined)
            ) as Record<string, string> },
            history: [],
            created: new Date()
        };
        
        this.sessions.set(sessionId, session);
        this.currentSessionId = sessionId;
        this.saveSessions();
        
        return session;
    }

    getTools(): MCPTool[] {
        return [
            {
                name: 'bash',
                description: 'Execute bash commands with persistent session support',
                inputSchema: {
                    type: 'object',
                    properties: {
                        command: {
                            type: 'string',
                            description: 'Bash command to execute'
                        },
                        session_id: {
                            type: 'string',
                            description: 'Session ID for persistent state'
                        },
                        cwd: {
                            type: 'string',
                            description: 'Working directory (defaults to session cwd)'
                        },
                        env: {
                            type: 'object',
                            description: 'Environment variables to set'
                        },
                        timeout: {
                            type: 'number',
                            description: 'Timeout in milliseconds (default: 30000)'
                        }
                    },
                    required: ['command']
                },
                handler: this.bashHandler.bind(this)
            },
            {
                name: 'run_background',
                description: 'Run a command in the background',
                inputSchema: {
                    type: 'object',
                    properties: {
                        command: {
                            type: 'string',
                            description: 'Command to run in background'
                        },
                        name: {
                            type: 'string',
                            description: 'Process name for tracking'
                        },
                        cwd: {
                            type: 'string',
                            description: 'Working directory'
                        },
                        env: {
                            type: 'object',
                            description: 'Environment variables'
                        }
                    },
                    required: ['command', 'name']
                },
                handler: this.runBackgroundHandler.bind(this)
            },
            {
                name: 'processes',
                description: 'List running background processes',
                inputSchema: {
                    type: 'object',
                    properties: {
                        filter: {
                            type: 'string',
                            description: 'Filter processes by name or command'
                        }
                    }
                },
                handler: this.processesHandler.bind(this)
            },
            {
                name: 'pkill',
                description: 'Kill a background process',
                inputSchema: {
                    type: 'object',
                    properties: {
                        name: {
                            type: 'string',
                            description: 'Process name or PID'
                        },
                        signal: {
                            type: 'string',
                            enum: ['SIGTERM', 'SIGKILL', 'SIGINT'],
                            description: 'Signal to send (default: SIGTERM)'
                        }
                    },
                    required: ['name']
                },
                handler: this.pkillHandler.bind(this)
            },
            {
                name: 'logs',
                description: 'View logs from a background process',
                inputSchema: {
                    type: 'object',
                    properties: {
                        name: {
                            type: 'string',
                            description: 'Process name'
                        },
                        lines: {
                            type: 'number',
                            description: 'Number of lines to show (default: 50)'
                        },
                        follow: {
                            type: 'boolean',
                            description: 'Follow log output'
                        }
                    },
                    required: ['name']
                },
                handler: this.logsHandler.bind(this)
            },
            {
                name: 'npx',
                description: 'Run Node.js packages with npx',
                inputSchema: {
                    type: 'object',
                    properties: {
                        command: {
                            type: 'string',
                            description: 'NPX command to execute'
                        },
                        cwd: {
                            type: 'string',
                            description: 'Working directory'
                        },
                        background: {
                            type: 'boolean',
                            description: 'Run in background'
                        }
                    },
                    required: ['command']
                },
                handler: this.npxHandler.bind(this)
            },
            {
                name: 'uvx',
                description: 'Run Python packages with uvx',
                inputSchema: {
                    type: 'object',
                    properties: {
                        command: {
                            type: 'string',
                            description: 'UVX command to execute'
                        },
                        cwd: {
                            type: 'string',
                            description: 'Working directory'
                        },
                        background: {
                            type: 'boolean',
                            description: 'Run in background'
                        }
                    },
                    required: ['command']
                },
                handler: this.uvxHandler.bind(this)
            }
        ];
    }

    private async bashHandler(args: any): Promise<string> {
        const { command, session_id, cwd, env, timeout = 30000 } = args;
        
        // Get or create session
        let session = session_id ? this.sessions.get(session_id) : null;
        if (!session) {
            session = this.createSession(session_id);
        }
        
        // Update session state
        if (cwd) {
            session.cwd = cwd;
        }
        if (env) {
            session.env = { ...session.env, ...env };
        }
        
        // Handle cd commands specially
        if (command.trim().startsWith('cd ')) {
            const newDir = command.trim().substring(3).trim();
            const resolvedPath = path.resolve(session.cwd, newDir);
            
            try {
                await vscode.workspace.fs.stat(vscode.Uri.file(resolvedPath));
                session.cwd = resolvedPath;
                session.history.push(command);
                this.saveSessions();
                return `Changed directory to: ${resolvedPath}`;
            } catch {
                throw new Error(`Directory not found: ${resolvedPath}`);
            }
        }
        
        // Execute command
        return new Promise((resolve, reject) => {
            const proc = cp.exec(command, {
                cwd: session.cwd,
                env: session.env,
                timeout,
                maxBuffer: 10 * 1024 * 1024 // 10MB
            }, (error, stdout, stderr) => {
                // Save command to history
                session!.history.push(command);
                this.saveSessions();
                
                if (error) {
                    if (error.killed) {
                        reject(new Error(`Command timed out after ${timeout}ms`));
                    } else {
                        reject(new Error(`${error.message}\n${stderr}`));
                    }
                } else {
                    let output = stdout;
                    if (stderr) {
                        output += `\n[stderr]\n${stderr}`;
                    }
                    resolve(output || 'Command completed successfully');
                }
            });
        });
    }

    private backgroundProcesses: Map<string, cp.ChildProcess> = new Map();
    private processLogs: Map<string, string[]> = new Map();

    private async runBackgroundHandler(args: any): Promise<string> {
        const { command, name, cwd, env } = args;
        
        // Check if process already exists
        if (this.backgroundProcesses.has(name)) {
            throw new Error(`Process '${name}' is already running`);
        }
        
        const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
        const workingDir = cwd || workspaceFolder?.uri.fsPath || process.cwd();
        
        // Spawn process
        const proc = cp.spawn(command, [], {
            shell: true,
            cwd: workingDir,
            env: { ...process.env, ...env },
            detached: false
        });
        
        this.backgroundProcesses.set(name, proc);
        this.processLogs.set(name, []);
        
        // Capture output
        const logs = this.processLogs.get(name)!;
        
        proc.stdout?.on('data', (data) => {
            const lines = data.toString().split('\n').filter((l: string) => l);
            logs.push(...lines.map((l: string) => `[stdout] ${l}`));
            
            // Keep only last 1000 lines
            if (logs.length > 1000) {
                logs.splice(0, logs.length - 1000);
            }
        });
        
        proc.stderr?.on('data', (data) => {
            const lines = data.toString().split('\n').filter((l: string) => l);
            logs.push(...lines.map((l: string) => `[stderr] ${l}`));
            
            if (logs.length > 1000) {
                logs.splice(0, logs.length - 1000);
            }
        });
        
        proc.on('exit', (code) => {
            logs.push(`[exit] Process exited with code ${code}`);
            this.backgroundProcesses.delete(name);
        });
        
        return `Started background process '${name}' with PID ${proc.pid}`;
    }

    private async processesHandler(args: any): Promise<string> {
        const { filter } = args;
        
        const processes: string[] = [];
        
        for (const [name, proc] of this.backgroundProcesses) {
            if (filter && !name.includes(filter)) {
                continue;
            }
            
            const status = proc.killed ? 'killed' : 'running';
            processes.push(`${name} (PID: ${proc.pid}, Status: ${status})`);
        }
        
        if (processes.length === 0) {
            return filter ? `No processes matching '${filter}'` : 'No background processes running';
        }
        
        return `Running processes:\n${processes.join('\n')}`;
    }

    private async pkillHandler(args: any): Promise<string> {
        const { name, signal = 'SIGTERM' } = args;
        
        const proc = this.backgroundProcesses.get(name);
        if (!proc) {
            // Try to parse as PID
            const pid = parseInt(name);
            if (!isNaN(pid)) {
                for (const [procName, p] of this.backgroundProcesses) {
                    if (p.pid === pid) {
                        p.kill(signal as any);
                        return `Sent ${signal} to process '${procName}' (PID: ${pid})`;
                    }
                }
            }
            
            throw new Error(`Process '${name}' not found`);
        }
        
        proc.kill(signal as any);
        return `Sent ${signal} to process '${name}' (PID: ${proc.pid})`;
    }

    private async logsHandler(args: any): Promise<string> {
        const { name, lines = 50, follow } = args;
        
        const logs = this.processLogs.get(name);
        if (!logs) {
            throw new Error(`No logs found for process '${name}'`);
        }
        
        if (follow) {
            // In a real implementation, this would stream logs
            return 'Log following not implemented in VS Code environment';
        }
        
        const startIndex = Math.max(0, logs.length - lines);
        const recentLogs = logs.slice(startIndex);
        
        if (recentLogs.length === 0) {
            return `No logs available for process '${name}'`;
        }
        
        return `Logs for '${name}' (last ${recentLogs.length} lines):\n${recentLogs.join('\n')}`;
    }

    private async npxHandler(args: any): Promise<string> {
        const { command, cwd, background } = args;
        
        if (background) {
            const name = `npx-${Date.now()}`;
            return this.runBackgroundHandler({
                command: `npx ${command}`,
                name,
                cwd
            });
        }
        
        return this.bashHandler({
            command: `npx ${command}`,
            cwd,
            timeout: 60000 // 1 minute timeout for npx
        });
    }

    private async uvxHandler(args: any): Promise<string> {
        const { command, cwd, background } = args;
        
        if (background) {
            const name = `uvx-${Date.now()}`;
            return this.runBackgroundHandler({
                command: `uvx ${command}`,
                name,
                cwd
            });
        }
        
        return this.bashHandler({
            command: `uvx ${command}`,
            cwd,
            timeout: 60000 // 1 minute timeout for uvx
        });
    }
}

export function createBashTools(context: vscode.ExtensionContext): MCPTool[] {
    const bashTools = new BashTools(context);
    return bashTools.getTools();
}