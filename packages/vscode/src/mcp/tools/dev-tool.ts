import * as vscode from 'vscode';
import { spawn, ChildProcess, SpawnOptions } from 'child_process';
import * as path from 'path';
import * as fs from 'fs';
import { execSync } from 'child_process';

interface DevAgent {
    id: string;
    name: string;
    model: string;
    process?: ChildProcess;
    worktree?: string;
    branch?: string;
    task?: string;
    status: 'idle' | 'running' | 'completed' | 'failed';
    output: string[];
    startTime?: Date;
    endTime?: Date;
}

interface DevToolOptions {
    agent: 'claude' | 'codex' | 'gemini' | 'gpt4' | 'llama';
    task: string;
    branch?: string;
    parallel?: boolean;
    watch?: boolean;
    autoMerge?: boolean;
}

export class DevToolManager {
    private agents: Map<string, DevAgent> = new Map();
    private outputChannel: vscode.OutputChannel;
    private workspaceRoot: string;
    private gitRoot: string;

    constructor() {
        this.outputChannel = vscode.window.createOutputChannel('Hanzo Dev Agents');
        this.workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || '';
        this.gitRoot = this.findGitRoot();
    }

    private findGitRoot(): string {
        let current = this.workspaceRoot;
        while (current && current !== path.dirname(current)) {
            if (fs.existsSync(path.join(current, '.git'))) {
                return current;
            }
            current = path.dirname(current);
        }
        return this.workspaceRoot;
    }

    async spawnAgent(options: DevToolOptions): Promise<string> {
        const agentId = `${options.agent}-${Date.now()}`;
        const branchName = options.branch || `ai/${options.agent}/${agentId}`;
        
        // Create worktree for agent
        const worktreePath = path.join(this.gitRoot, '.worktrees', agentId);
        
        try {
            // Create worktree with new branch
            execSync(`git worktree add -b ${branchName} "${worktreePath}"`, {
                cwd: this.gitRoot
            });

            const agent: DevAgent = {
                id: agentId,
                name: options.agent,
                model: this.getModelForAgent(options.agent),
                worktree: worktreePath,
                branch: branchName,
                task: options.task,
                status: 'idle',
                output: [],
                startTime: new Date()
            };

            this.agents.set(agentId, agent);
            
            // Start the agent
            await this.startAgent(agent, options);
            
            this.outputChannel.appendLine(`[${agent.name}] Spawned agent ${agentId} on branch ${branchName}`);
            
            if (options.watch) {
                this.watchAgent(agent);
            }

            return agentId;
        } catch (error) {
            throw new Error(`Failed to spawn agent: ${error.message}`);
        }
    }

    private getModelForAgent(agent: string): string {
        const modelMap = {
            'claude': 'claude-3-opus-20240229',
            'codex': 'code-davinci-002',
            'gemini': 'gemini-pro',
            'gpt4': 'gpt-4-turbo-preview',
            'llama': 'llama-2-70b-chat'
        };
        return modelMap[agent] || 'gpt-4';
    }

    private async startAgent(agent: DevAgent, options: DevToolOptions) {
        agent.status = 'running';
        
        // Create agent script
        const agentScript = this.generateAgentScript(agent, options);
        const scriptPath = path.join(agent.worktree!, 'agent-task.js');
        fs.writeFileSync(scriptPath, agentScript);

        // Spawn agent process
        const spawnOptions: SpawnOptions = {
            cwd: agent.worktree,
            env: {
                ...process.env,
                HANZO_AGENT_ID: agent.id,
                HANZO_AGENT_MODEL: agent.model,
                HANZO_AGENT_TASK: agent.task || '',
                HANZO_API_KEY: vscode.workspace.getConfiguration('hanzo').get('apiKey')
            }
        };

        agent.process = spawn('node', [scriptPath], spawnOptions);

        // Capture output
        agent.process.stdout?.on('data', (data) => {
            const output = data.toString();
            agent.output.push(output);
            this.outputChannel.appendLine(`[${agent.name}] ${output}`);
        });

        agent.process.stderr?.on('data', (data) => {
            const error = data.toString();
            agent.output.push(`ERROR: ${error}`);
            this.outputChannel.appendLine(`[${agent.name}] ERROR: ${error}`);
        });

        agent.process.on('exit', (code) => {
            agent.status = code === 0 ? 'completed' : 'failed';
            agent.endTime = new Date();
            this.outputChannel.appendLine(`[${agent.name}] Agent ${agent.id} exited with code ${code}`);
            
            if (options.autoMerge && code === 0) {
                this.autoMergeAgent(agent);
            }
        });
    }

    private generateAgentScript(agent: DevAgent, options: DevToolOptions): string {
        return `
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

// Agent configuration
const agentId = process.env.HANZO_AGENT_ID;
const model = process.env.HANZO_AGENT_MODEL;
const task = process.env.HANZO_AGENT_TASK;

console.log(\`Starting \${agentId} with model \${model}\`);
console.log(\`Task: \${task}\`);

// Simulate AI agent work
async function runAgent() {
    try {
        // Analyze codebase
        console.log('Analyzing codebase...');
        const files = execSync('find . -name "*.js" -o -name "*.ts" | head -20', { encoding: 'utf-8' });
        console.log(\`Found \${files.split('\\n').length} files to analyze\`);

        // Simulate task execution
        console.log('Executing task...');
        
        // Create some changes based on task
        const changesFile = \`// Changes by \${agentId}\\n// Task: \${task}\\n\\nexport const agentChanges = {\\n  agent: '\${agentId}',\\n  task: '\${task}',\\n  timestamp: new Date().toISOString()\\n};\\n\`;
        
        fs.writeFileSync(\`agent-\${agentId}-changes.js\`, changesFile);
        
        // Commit changes
        execSync('git add .');
        execSync(\`git commit -m "[\${agentId}] \${task}"\`, { stdio: 'inherit' });
        
        console.log('Task completed successfully!');
    } catch (error) {
        console.error('Agent error:', error.message);
        process.exit(1);
    }
}

runAgent().catch(console.error);
`;
    }

    private watchAgent(agent: DevAgent) {
        const watcher = vscode.workspace.createFileSystemWatcher(
            new vscode.RelativePattern(agent.worktree!, '**/*')
        );

        watcher.onDidCreate((uri) => {
            this.outputChannel.appendLine(`[${agent.name}] Created: ${uri.fsPath}`);
        });

        watcher.onDidChange((uri) => {
            this.outputChannel.appendLine(`[${agent.name}] Modified: ${uri.fsPath}`);
        });

        watcher.onDidDelete((uri) => {
            this.outputChannel.appendLine(`[${agent.name}] Deleted: ${uri.fsPath}`);
        });
    }

    async listAgents(): Promise<DevAgent[]> {
        return Array.from(this.agents.values());
    }

    async getAgentStatus(agentId: string): Promise<DevAgent | undefined> {
        return this.agents.get(agentId);
    }

    async stopAgent(agentId: string): Promise<void> {
        const agent = this.agents.get(agentId);
        if (agent?.process) {
            agent.process.kill();
            agent.status = 'completed';
            agent.endTime = new Date();
        }
    }

    async mergeAgent(agentId: string): Promise<void> {
        const agent = this.agents.get(agentId);
        if (!agent) {
            throw new Error(`Agent ${agentId} not found`);
        }

        try {
            // Switch to main branch
            execSync('git checkout main', { cwd: this.gitRoot });
            
            // Merge agent branch
            execSync(`git merge ${agent.branch} --no-ff -m "Merge ${agent.branch}"`, { 
                cwd: this.gitRoot 
            });
            
            // Remove worktree
            execSync(`git worktree remove "${agent.worktree}"`, { cwd: this.gitRoot });
            
            // Delete branch
            execSync(`git branch -d ${agent.branch}`, { cwd: this.gitRoot });
            
            this.outputChannel.appendLine(`[${agent.name}] Successfully merged ${agent.branch}`);
        } catch (error) {
            throw new Error(`Failed to merge agent: ${error.message}`);
        }
    }

    private async autoMergeAgent(agent: DevAgent) {
        try {
            await this.mergeAgent(agent.id);
        } catch (error) {
            this.outputChannel.appendLine(`[${agent.name}] Auto-merge failed: ${error.message}`);
        }
    }

    async runBatchTasks(tasks: string[], options: Partial<DevToolOptions> = {}): Promise<void> {
        const agents = ['claude', 'codex', 'gemini', 'gpt4', 'llama'] as const;
        const agentIds: string[] = [];

        // Spawn agents for each task
        for (let i = 0; i < tasks.length; i++) {
            const task = tasks[i];
            const agent = agents[i % agents.length];
            
            const agentId = await this.spawnAgent({
                agent,
                task,
                parallel: true,
                ...options
            });
            
            agentIds.push(agentId);
        }

        // Wait for all agents to complete
        const checkInterval = setInterval(() => {
            const allCompleted = agentIds.every(id => {
                const agent = this.agents.get(id);
                return agent?.status === 'completed' || agent?.status === 'failed';
            });

            if (allCompleted) {
                clearInterval(checkInterval);
                this.outputChannel.appendLine('All batch tasks completed!');
                
                // Generate summary
                this.generateBatchSummary(agentIds);
            }
        }, 1000);
    }

    private generateBatchSummary(agentIds: string[]) {
        this.outputChannel.appendLine('\n=== Batch Task Summary ===');
        
        for (const id of agentIds) {
            const agent = this.agents.get(id);
            if (agent) {
                const duration = agent.endTime && agent.startTime 
                    ? (agent.endTime.getTime() - agent.startTime.getTime()) / 1000 
                    : 0;
                
                this.outputChannel.appendLine(
                    `${agent.name} (${agent.id}): ${agent.status} - ${duration}s`
                );
            }
        }
    }

    showOutput() {
        this.outputChannel.show();
    }

    dispose() {
        // Clean up all agents
        for (const agent of this.agents.values()) {
            if (agent.process) {
                agent.process.kill();
            }
        }
        this.outputChannel.dispose();
    }
}

// Export for MCP tools
export function createDevTools(devManager: DevToolManager) {
    return [
        {
            name: 'dev_spawn',
            description: 'Spawn an AI development agent in a git worktree',
            inputSchema: {
                type: 'object',
                properties: {
                    agent: {
                        type: 'string',
                        enum: ['claude', 'codex', 'gemini', 'gpt4', 'llama'],
                        description: 'The AI agent to spawn'
                    },
                    task: {
                        type: 'string',
                        description: 'The task for the agent to perform'
                    },
                    branch: {
                        type: 'string',
                        description: 'Optional branch name (auto-generated if not provided)'
                    },
                    watch: {
                        type: 'boolean',
                        description: 'Watch for file changes',
                        default: true
                    },
                    autoMerge: {
                        type: 'boolean',
                        description: 'Automatically merge when complete',
                        default: false
                    }
                },
                required: ['agent', 'task']
            },
            handler: async (args: any) => {
                const agentId = await devManager.spawnAgent(args);
                return {
                    agentId,
                    message: `Spawned ${args.agent} agent with ID ${agentId}`
                };
            }
        },
        {
            name: 'dev_list',
            description: 'List all active development agents',
            inputSchema: {
                type: 'object',
                properties: {}
            },
            handler: async () => {
                const agents = await devManager.listAgents();
                return {
                    agents: agents.map(a => ({
                        id: a.id,
                        name: a.name,
                        status: a.status,
                        branch: a.branch,
                        task: a.task
                    }))
                };
            }
        },
        {
            name: 'dev_status',
            description: 'Get status of a specific agent',
            inputSchema: {
                type: 'object',
                properties: {
                    agentId: {
                        type: 'string',
                        description: 'The agent ID'
                    }
                },
                required: ['agentId']
            },
            handler: async (args: any) => {
                const agent = await devManager.getAgentStatus(args.agentId);
                if (!agent) {
                    throw new Error(`Agent ${args.agentId} not found`);
                }
                return {
                    agent: {
                        id: agent.id,
                        name: agent.name,
                        status: agent.status,
                        branch: agent.branch,
                        task: agent.task,
                        output: agent.output.slice(-10) // Last 10 outputs
                    }
                };
            }
        },
        {
            name: 'dev_stop',
            description: 'Stop a running agent',
            inputSchema: {
                type: 'object',
                properties: {
                    agentId: {
                        type: 'string',
                        description: 'The agent ID to stop'
                    }
                },
                required: ['agentId']
            },
            handler: async (args: any) => {
                await devManager.stopAgent(args.agentId);
                return {
                    message: `Stopped agent ${args.agentId}`
                };
            }
        },
        {
            name: 'dev_merge',
            description: 'Merge an agent\'s changes back to main',
            inputSchema: {
                type: 'object',
                properties: {
                    agentId: {
                        type: 'string',
                        description: 'The agent ID to merge'
                    }
                },
                required: ['agentId']
            },
            handler: async (args: any) => {
                await devManager.mergeAgent(args.agentId);
                return {
                    message: `Merged agent ${args.agentId} changes`
                };
            }
        },
        {
            name: 'dev_batch',
            description: 'Run multiple tasks in parallel with different agents',
            inputSchema: {
                type: 'object',
                properties: {
                    tasks: {
                        type: 'array',
                        items: { type: 'string' },
                        description: 'List of tasks to run in parallel'
                    },
                    autoMerge: {
                        type: 'boolean',
                        description: 'Automatically merge successful agents',
                        default: false
                    }
                },
                required: ['tasks']
            },
            handler: async (args: any) => {
                await devManager.runBatchTasks(args.tasks, { autoMerge: args.autoMerge });
                return {
                    message: `Started batch processing of ${args.tasks.length} tasks`
                };
            }
        }
    ];
}