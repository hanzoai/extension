import * as vscode from 'vscode';
import { exec, spawn } from 'child_process';
import { promisify } from 'util';
import * as path from 'path';
import { MCPTool } from '../server';

const execAsync = promisify(exec);

export function createShellTools(context: vscode.ExtensionContext): MCPTool[] {
    const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || '';
    const activeProcesses = new Map<string, any>();

    return [
        {
            name: 'run_command',
            description: 'Execute a shell command',
            inputSchema: {
                type: 'object',
                properties: {
                    command: {
                        type: 'string',
                        description: 'The command to execute'
                    },
                    cwd: {
                        type: 'string',
                        description: 'Working directory for the command'
                    },
                    timeout: {
                        type: 'number',
                        description: 'Timeout in milliseconds (default: 120000)'
                    }
                },
                required: ['command']
            },
            handler: async (args: { command: string; cwd?: string; timeout?: number }) => {
                const cwd = args.cwd || workspaceRoot;
                const timeout = args.timeout || 120000;

                try {
                    const { stdout, stderr } = await execAsync(args.command, {
                        cwd,
                        timeout,
                        maxBuffer: 10 * 1024 * 1024 // 10MB
                    });

                    let result = '';
                    if (stdout) result += stdout;
                    if (stderr) result += '\n[stderr]\n' + stderr;
                    
                    return result.trim() || 'Command completed successfully';
                } catch (error: any) {
                    if (error.killed) {
                        throw new Error(`Command timed out after ${timeout}ms`);
                    }
                    throw new Error(`Command failed: ${error.message}\n${error.stdout || ''}\n${error.stderr || ''}`);
                }
            }
        },

        {
            name: 'bash',
            description: 'Execute a bash command (alias for run_command)',
            inputSchema: {
                type: 'object',
                properties: {
                    command: {
                        type: 'string',
                        description: 'The bash command to execute'
                    },
                    cwd: {
                        type: 'string',
                        description: 'Working directory for the command'
                    },
                    timeout: {
                        type: 'number',
                        description: 'Timeout in milliseconds (default: 120000)'
                    }
                },
                required: ['command']
            },
            handler: async (args: { command: string; cwd?: string; timeout?: number }) => {
                // Delegate to run_command
                const runCommand = createShellTools(context)[0];
                return runCommand.handler(args);
            }
        },

        {
            name: 'run_background',
            description: 'Run a command in the background',
            inputSchema: {
                type: 'object',
                properties: {
                    command: {
                        type: 'string',
                        description: 'The command to run in background'
                    },
                    name: {
                        type: 'string',
                        description: 'Name for the background process'
                    },
                    cwd: {
                        type: 'string',
                        description: 'Working directory for the command'
                    }
                },
                required: ['command', 'name']
            },
            handler: async (args: { command: string; name: string; cwd?: string }) => {
                if (activeProcesses.has(args.name)) {
                    throw new Error(`Process with name '${args.name}' already exists`);
                }

                const cwd = args.cwd || workspaceRoot;
                const [cmd, ...cmdArgs] = args.command.split(' ');
                
                const process = spawn(cmd, cmdArgs, {
                    cwd,
                    detached: true,
                    stdio: 'pipe'
                });

                const processInfo = {
                    pid: process.pid,
                    command: args.command,
                    startTime: new Date(),
                    output: '',
                    process,
                    exitCode: undefined as number | undefined,
                    endTime: undefined as Date | undefined
                };

                activeProcesses.set(args.name, processInfo);

                // Capture output
                process.stdout?.on('data', (data) => {
                    processInfo.output += data.toString();
                    // Keep only last 100KB of output
                    if (processInfo.output.length > 100000) {
                        processInfo.output = processInfo.output.slice(-100000);
                    }
                });

                process.stderr?.on('data', (data) => {
                    processInfo.output += '[stderr] ' + data.toString();
                });

                process.on('exit', (code) => {
                    processInfo.exitCode = code ?? undefined;
                    processInfo.endTime = new Date();
                });

                return `Started background process '${args.name}' with PID ${process.pid}`;
            }
        },

        {
            name: 'processes',
            description: 'List running background processes',
            inputSchema: {
                type: 'object',
                properties: {}
            },
            handler: async () => {
                if (activeProcesses.size === 0) {
                    return 'No background processes running';
                }

                const processList = Array.from(activeProcesses.entries()).map(([name, info]) => {
                    const status = info.exitCode !== undefined ? `Exited (${info.exitCode})` : 'Running';
                    const runtime = info.endTime ? 
                        `${(info.endTime - info.startTime) / 1000}s` : 
                        `${(Date.now() - info.startTime) / 1000}s`;
                    
                    return `${name}: ${status} (PID: ${info.pid}, Runtime: ${runtime})\n  Command: ${info.command}`;
                });

                return processList.join('\n\n');
            }
        },

        {
            name: 'pkill',
            description: 'Kill a background process by name',
            inputSchema: {
                type: 'object',
                properties: {
                    name: {
                        type: 'string',
                        description: 'Name of the process to kill'
                    }
                },
                required: ['name']
            },
            handler: async (args: { name: string }) => {
                const processInfo = activeProcesses.get(args.name);
                if (!processInfo) {
                    throw new Error(`No process found with name '${args.name}'`);
                }

                try {
                    processInfo.process.kill();
                    activeProcesses.delete(args.name);
                    return `Killed process '${args.name}' (PID: ${processInfo.pid})`;
                } catch (error: any) {
                    throw new Error(`Failed to kill process: ${error.message}`);
                }
            }
        },

        {
            name: 'logs',
            description: 'View output from a background process',
            inputSchema: {
                type: 'object',
                properties: {
                    name: {
                        type: 'string',
                        description: 'Name of the process'
                    },
                    tail: {
                        type: 'number',
                        description: 'Number of lines to show from the end'
                    }
                },
                required: ['name']
            },
            handler: async (args: { name: string; tail?: number }) => {
                const processInfo = activeProcesses.get(args.name);
                if (!processInfo) {
                    throw new Error(`No process found with name '${args.name}'`);
                }

                let output = processInfo.output;
                if (args.tail && args.tail > 0) {
                    const lines = output.split('\n');
                    output = lines.slice(-args.tail).join('\n');
                }

                return output || 'No output available';
            }
        },

        {
            name: 'open',
            description: 'Open a file or URL in the default application',
            inputSchema: {
                type: 'object',
                properties: {
                    path: {
                        type: 'string',
                        description: 'File path or URL to open'
                    }
                },
                required: ['path']
            },
            handler: async (args: { path: string }) => {
                try {
                    // Check if it's a URL
                    if (args.path.match(/^https?:\/\//)) {
                        await vscode.env.openExternal(vscode.Uri.parse(args.path));
                        return `Opened URL: ${args.path}`;
                    } else {
                        // It's a file path
                        const filePath = path.isAbsolute(args.path) ? 
                            args.path : 
                            path.join(workspaceRoot, args.path);
                        
                        const uri = vscode.Uri.file(filePath);
                        await vscode.env.openExternal(uri);
                        return `Opened file: ${filePath}`;
                    }
                } catch (error: any) {
                    throw new Error(`Failed to open: ${error.message}`);
                }
            }
        },

        {
            name: 'npx',
            description: 'Run a Node.js package directly',
            inputSchema: {
                type: 'object',
                properties: {
                    package: {
                        type: 'string',
                        description: 'Package name to run'
                    },
                    args: {
                        type: 'string',
                        description: 'Arguments to pass to the package'
                    }
                },
                required: ['package']
            },
            handler: async (args: { package: string; args?: string }) => {
                const command = `npx ${args.package} ${args.args || ''}`.trim();
                const runCommand = createShellTools(context)[0];
                return runCommand.handler({ command });
            }
        },

        {
            name: 'uvx',
            description: 'Run a Python package directly',
            inputSchema: {
                type: 'object',
                properties: {
                    package: {
                        type: 'string',
                        description: 'Python package name to run'
                    },
                    args: {
                        type: 'string',
                        description: 'Arguments to pass to the package'
                    }
                },
                required: ['package']
            },
            handler: async (args: { package: string; args?: string }) => {
                const command = `uvx ${args.package} ${args.args || ''}`.trim();
                const runCommand = createShellTools(context)[0];
                return runCommand.handler({ command });
            }
        }
    ];
}