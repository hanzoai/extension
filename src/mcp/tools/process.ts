import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs/promises';
import * as os from 'os';
import { spawn, ChildProcess } from 'child_process';
// Use built-in crypto for UUID generation instead of external dependency
const uuidv4 = () => {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
        const r = Math.random() * 16 | 0;
        const v = c === 'x' ? r : (r & 0x3 | 0x8);
        return v.toString(16);
    });
};
import { MCPTool } from '../server';

interface ProcessInfo {
    id: string;
    pid?: number;
    name: string;
    command: string;
    startTime: Date;
    endTime?: Date;
    exitCode?: number;
    status: 'running' | 'completed' | 'failed';
    logFile: string;
    process?: ChildProcess;
}

// Global process registry
const processRegistry = new Map<string, ProcessInfo>();
const LOGS_DIR = path.join(os.homedir(), '.hanzo', 'logs');

// Ensure logs directory exists
async function ensureLogsDir() {
    try {
        await fs.mkdir(LOGS_DIR, { recursive: true });
    } catch (error) {
        // Directory might already exist
    }
}

export function createProcessTool(context: vscode.ExtensionContext): MCPTool {
    // Initialize logs directory
    ensureLogsDir();
    
    return {
        name: 'process',
        description: 'Unified process management (list, run, kill, logs)',
        inputSchema: {
            type: 'object',
            properties: {
                action: {
                    type: 'string',
                    enum: ['list', 'run', 'kill', 'logs', 'clean'],
                    description: 'Action to perform'
                },
                command: {
                    type: 'string',
                    description: 'Command to run (for run action)'
                },
                name: {
                    type: 'string',
                    description: 'Process name (for run action)'
                },
                id: {
                    type: 'string',
                    description: 'Process ID (for kill/logs actions)'
                },
                cwd: {
                    type: 'string',
                    description: 'Working directory (for run action)'
                },
                env: {
                    type: 'object',
                    description: 'Environment variables (for run action)'
                },
                tail: {
                    type: 'number',
                    description: 'Number of lines to tail (for logs action)'
                }
            },
            required: ['action']
        },
        handler: async (args: {
            action: string;
            command?: string;
            name?: string;
            id?: string;
            cwd?: string;
            env?: Record<string, string>;
            tail?: number;
        }) => {
            switch (args.action) {
                case 'list': {
                    if (processRegistry.size === 0) {
                        return 'No processes running';
                    }
                    
                    const processes = Array.from(processRegistry.values())
                        .sort((a, b) => b.startTime.getTime() - a.startTime.getTime());
                    
                    let output = 'ID                                   | Status    | Name                | Started\n';
                    output += '------------------------------------ | --------- | ------------------- | -------\n';
                    
                    for (const proc of processes) {
                        const runtime = proc.endTime 
                            ? `${((proc.endTime.getTime() - proc.startTime.getTime()) / 1000).toFixed(1)}s`
                            : `${((Date.now() - proc.startTime.getTime()) / 1000).toFixed(1)}s`;
                        
                        output += `${proc.id} | ${proc.status.padEnd(9)} | ${proc.name.padEnd(19).slice(0, 19)} | ${runtime}\n`;
                    }
                    
                    return output;
                }
                
                case 'run': {
                    if (!args.command) {
                        return 'Error: Command required for run action';
                    }
                    
                    const id = uuidv4();
                    const name = args.name || args.command.split(' ')[0];
                    const logFile = path.join(LOGS_DIR, `${id}.log`);
                    
                    // Create log file
                    const logStream = await fs.open(logFile, 'w');
                    
                    // Parse command
                    const [cmd, ...cmdArgs] = args.command.split(' ');
                    
                    // Spawn process
                    const proc = spawn(cmd, cmdArgs, {
                        cwd: args.cwd || vscode.workspace.workspaceFolders?.[0]?.uri.fsPath,
                        env: { ...process.env, ...args.env },
                        detached: true,
                        stdio: ['ignore', 'pipe', 'pipe']
                    });
                    
                    const processInfo: ProcessInfo = {
                        id,
                        pid: proc.pid,
                        name,
                        command: args.command,
                        startTime: new Date(),
                        status: 'running',
                        logFile,
                        process: proc
                    };
                    
                    processRegistry.set(id, processInfo);
                    
                    // Log output
                    proc.stdout?.on('data', async (data) => {
                        await logStream.write(`[stdout] ${data}`);
                    });
                    
                    proc.stderr?.on('data', async (data) => {
                        await logStream.write(`[stderr] ${data}`);
                    });
                    
                    proc.on('exit', async (code) => {
                        processInfo.endTime = new Date();
                        processInfo.exitCode = code ?? undefined;
                        processInfo.status = code === 0 ? 'completed' : 'failed';
                        delete processInfo.process;
                        
                        await logStream.write(`\n[Process exited with code ${code}]\n`);
                        await logStream.close();
                    });
                    
                    return `Started process ${id} (PID: ${proc.pid})\nName: ${name}\nCommand: ${args.command}\nLog file: ${logFile}`;
                }
                
                case 'kill': {
                    if (!args.id) {
                        return 'Error: Process ID required for kill action';
                    }
                    
                    const proc = processRegistry.get(args.id);
                    if (!proc) {
                        return `Error: Process ${args.id} not found`;
                    }
                    
                    if (proc.status !== 'running') {
                        return `Process ${args.id} is not running (status: ${proc.status})`;
                    }
                    
                    try {
                        proc.process?.kill();
                        return `Killed process ${args.id} (${proc.name})`;
                    } catch (error: any) {
                        return `Error killing process: ${error.message}`;
                    }
                }
                
                case 'logs': {
                    if (!args.id) {
                        return 'Error: Process ID required for logs action';
                    }
                    
                    const proc = processRegistry.get(args.id);
                    if (!proc) {
                        return `Error: Process ${args.id} not found`;
                    }
                    
                    try {
                        const content = await fs.readFile(proc.logFile, 'utf-8');
                        
                        if (args.tail && args.tail > 0) {
                            const lines = content.split('\n');
                            return lines.slice(-args.tail).join('\n');
                        }
                        
                        return content || 'No logs available';
                    } catch (error: any) {
                        return `Error reading logs: ${error.message}`;
                    }
                }
                
                case 'clean': {
                    const cleaned: string[] = [];
                    
                    for (const [id, proc] of processRegistry.entries()) {
                        if (proc.status !== 'running') {
                            processRegistry.delete(id);
                            cleaned.push(`${id} (${proc.name})`);
                            
                            // Optionally delete log file
                            try {
                                await fs.unlink(proc.logFile);
                            } catch {
                                // Ignore errors
                            }
                        }
                    }
                    
                    if (cleaned.length === 0) {
                        return 'No completed processes to clean';
                    }
                    
                    return `Cleaned ${cleaned.length} processes:\n${cleaned.join('\n')}`;
                }
                
                default:
                    return `Error: Unknown action '${args.action}'`;
            }
        }
    };
}