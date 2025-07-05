import * as vscode from 'vscode';
import { EventEmitter } from 'events';
import { spawn, ChildProcess } from 'child_process';
import * as path from 'path';
import * as fs from 'fs';
import { execSync } from 'child_process';
import { CLIToolManager, CLIToolType } from '../cli-tool-manager';
import { DevMonitor } from './dev-monitor';
import { PlatformSyncService } from './sync-service';

export interface DevToolInstance {
    id: string;
    type: CLIToolType | 'openhands' | 'aider' | 'custom';
    sessionId: string;
    process?: ChildProcess;
    worktreePath?: string;
    branch?: string;
    status: 'initializing' | 'running' | 'stopped' | 'error';
    config: DevToolConfig;
    startTime: Date;
    lastActivity?: Date;
}

export interface DevToolConfig {
    name: string;
    command: string;
    args?: string[];
    env?: Record<string, string>;
    workingDirectory: string;
    useWorktree?: boolean;
    worktreePrefix?: string;
    autoSync?: boolean;
    sessionTimeout?: number;
}

export interface LauncherConfig {
    maxInstances: number;
    defaultTimeout: number;
    gitRoot: string;
    workspacePath: string;
    enableSync: boolean;
    syncConfig?: any;
}

export class DevLauncher extends EventEmitter {
    private instances: Map<string, DevToolInstance> = new Map();
    private cliManager: CLIToolManager;
    private monitor: DevMonitor;
    private syncService?: PlatformSyncService;
    private config: LauncherConfig;
    private outputChannel: vscode.OutputChannel;

    constructor(config: LauncherConfig) {
        super();
        this.config = config;
        this.cliManager = new CLIToolManager();
        this.monitor = new DevMonitor({
            logPath: path.join(config.workspacePath, '.hanzo-dev', 'logs'),
            maxLogSize: 10 * 1024 * 1024, // 10MB
            rotateInterval: 24 * 60 * 60 * 1000, // Daily
            metricsInterval: 5000, // 5 seconds
            enablePerfMonitoring: true
        });
        
        this.outputChannel = vscode.window.createOutputChannel('Hanzo Dev Launcher');
        
        if (config.enableSync && config.syncConfig) {
            this.syncService = new PlatformSyncService(config.syncConfig);
            this.setupSyncHandlers();
        }
    }

    async initialize(): Promise<void> {
        await this.cliManager.initialize();
        
        if (this.syncService) {
            await this.syncService.connect();
        }
        
        this.outputChannel.appendLine('Hanzo Dev Launcher initialized');
    }

    private setupSyncHandlers(): void {
        if (!this.syncService) return;
        
        this.syncService.on('command_request', (request) => {
            this.handleRemoteCommand(request);
        });
        
        this.syncService.on('file_synced', (data) => {
            this.outputChannel.appendLine(`File synced: ${data.filePath}`);
        });
    }

    async launchTool(
        type: DevToolInstance['type'],
        task: string,
        options: Partial<DevToolConfig> = {}
    ): Promise<string> {
        if (this.instances.size >= this.config.maxInstances) {
            throw new Error(`Maximum instances (${this.config.maxInstances}) reached`);
        }
        
        const instanceId = `${type}-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
        const sessionId = this.monitor.startSession(type, options.workingDirectory || this.config.workspacePath, options.name || 'main');
        
        const config: DevToolConfig = {
            name: options.name || `${type}-session`,
            command: this.getToolCommand(type),
            args: options.args || [],
            env: options.env || {},
            workingDirectory: options.workingDirectory || this.config.workspacePath,
            useWorktree: options.useWorktree ?? true,
            worktreePrefix: options.worktreePrefix || `ai/${type}`,
            autoSync: options.autoSync ?? true,
            sessionTimeout: options.sessionTimeout || this.config.defaultTimeout
        };
        
        const instance: DevToolInstance = {
            id: instanceId,
            type,
            sessionId,
            status: 'initializing',
            config,
            startTime: new Date()
        };
        
        this.instances.set(instanceId, instance);
        
        try {
            // Create worktree if requested
            if (config.useWorktree && this.isGitRepo()) {
                await this.createWorktree(instance);
            }
            
            // Launch the tool
            await this.startToolProcess(instance, task);
            
            // Register with sync service
            if (this.syncService && config.autoSync) {
                this.syncService.registerDevTool(instanceId, {
                    sessionId,
                    workingDirectory: instance.worktreePath || config.workingDirectory,
                    branch: instance.branch || 'main',
                    files: [],
                    lastActivity: new Date(),
                    metadata: { type, task }
                });
            }
            
            this.emit('tool:launched', instance);
            this.outputChannel.appendLine(`Launched ${type} instance: ${instanceId}`);
            
            return instanceId;
        } catch (error) {
            instance.status = 'error';
            this.monitor.endSession(sessionId, 'failed');
            this.monitor.log('error', 'launcher', `Failed to launch ${type}: ${error.message}`);
            throw error;
        }
    }

    private getToolCommand(type: DevToolInstance['type']): string {
        switch (type) {
            case 'claude':
                return 'claude';
            case 'codex':
                return 'openai';
            case 'gemini':
                return 'gemini';
            case 'openhands':
                return 'openhands';
            case 'aider':
                return 'aider';
            default:
                return type;
        }
    }

    private isGitRepo(): boolean {
        try {
            execSync('git rev-parse --git-dir', { 
                cwd: this.config.gitRoot,
                stdio: 'ignore'
            });
            return true;
        } catch {
            return false;
        }
    }

    private async createWorktree(instance: DevToolInstance): Promise<void> {
        const { worktreePrefix } = instance.config;
        const branchName = `${worktreePrefix}/${instance.id}`;
        const worktreePath = path.join(this.config.gitRoot, '.worktrees', instance.id);
        
        try {
            // Create worktree with new branch
            execSync(`git worktree add -b "${branchName}" "${worktreePath}"`, {
                cwd: this.config.gitRoot,
                stdio: 'pipe'
            });
            
            instance.branch = branchName;
            instance.worktreePath = worktreePath;
            instance.config.workingDirectory = worktreePath;
            
            this.outputChannel.appendLine(`Created worktree: ${worktreePath} (branch: ${branchName})`);
            this.monitor.log('info', 'launcher', `Created worktree for ${instance.type}`);
        } catch (error) {
            this.monitor.log('error', 'launcher', `Failed to create worktree: ${error.message}`);
            throw new Error(`Failed to create worktree: ${error.message}`);
        }
    }

    private async startToolProcess(instance: DevToolInstance, task: string): Promise<void> {
        const { command, args = [], env = {}, workingDirectory } = instance.config;
        
        // For known CLI tools, use the CLIToolManager
        if (['claude', 'codex', 'gemini'].includes(instance.type)) {
            const result = await this.cliManager.executeTool(
                instance.type as CLIToolType,
                task,
                { cwd: workingDirectory }
            );
            
            instance.status = result.success ? 'running' : 'error';
            this.monitor.recordCommand(instance.sessionId, command, [task]);
            this.monitor.recordCommandComplete(instance.sessionId, result.success);
            
            if (result.output) {
                this.monitor.log('info', instance.type, result.output);
            }
            
            return;
        }
        
        // For other tools, spawn directly
        const processEnv = {
            ...process.env,
            ...env,
            HANZO_DEV_SESSION: instance.sessionId,
            HANZO_DEV_INSTANCE: instance.id
        };
        
        // Special handling for specific tools
        let fullCommand = command;
        let fullArgs = [...args];
        
        switch (instance.type) {
            case 'aider':
                // Aider-specific setup
                fullArgs = ['--yes', '--auto-commits', ...args, task];
                break;
            case 'openhands':
                // OpenHands-specific setup
                fullArgs = ['--workspace', workingDirectory, '--task', task, ...args];
                break;
        }
        
        instance.process = spawn(fullCommand, fullArgs, {
            cwd: workingDirectory,
            env: processEnv,
            shell: true
        });
        
        instance.status = 'running';
        instance.lastActivity = new Date();
        
        // Handle process output
        instance.process.stdout?.on('data', (data) => {
            const output = data.toString();
            this.monitor.log('info', instance.type, output);
            
            if (this.syncService) {
                this.syncService.logOutput(instance.id, output);
            }
            
            instance.lastActivity = new Date();
            this.emit('tool:output', { instanceId: instance.id, output });
        });
        
        instance.process.stderr?.on('data', (data) => {
            const error = data.toString();
            this.monitor.log('error', instance.type, error);
            
            if (this.syncService) {
                this.syncService.logError(instance.id, error);
            }
            
            this.emit('tool:error', { instanceId: instance.id, error });
        });
        
        instance.process.on('exit', (code) => {
            instance.status = 'stopped';
            this.monitor.endSession(instance.sessionId, code === 0 ? 'completed' : 'failed');
            
            if (this.syncService) {
                this.syncService.updateStatus(instance.id, 'stopped', { exitCode: code });
            }
            
            this.emit('tool:stopped', { instanceId: instance.id, exitCode: code });
            
            // Clean up worktree after a delay
            if (instance.worktreePath) {
                setTimeout(() => this.cleanupWorktree(instance), 60000);
            }
        });
        
        // Set up session timeout
        if (instance.config.sessionTimeout) {
            setTimeout(() => {
                if (instance.status === 'running') {
                    this.stopTool(instance.id);
                }
            }, instance.config.sessionTimeout);
        }
        
        this.monitor.recordCommand(instance.sessionId, fullCommand, fullArgs);
    }

    async stopTool(instanceId: string): Promise<void> {
        const instance = this.instances.get(instanceId);
        if (!instance) return;
        
        if (instance.process) {
            instance.process.kill('SIGTERM');
            
            // Force kill after 5 seconds
            setTimeout(() => {
                if (instance.process && !instance.process.killed) {
                    instance.process.kill('SIGKILL');
                }
            }, 5000);
        }
        
        instance.status = 'stopped';
        this.monitor.endSession(instance.sessionId);
        
        if (this.syncService) {
            this.syncService.updateStatus(instanceId, 'stopped');
        }
        
        this.emit('tool:stopped', { instanceId });
    }

    async stopAllTools(): Promise<void> {
        const promises = Array.from(this.instances.keys()).map(
            id => this.stopTool(id)
        );
        await Promise.all(promises);
    }

    private async cleanupWorktree(instance: DevToolInstance): Promise<void> {
        if (!instance.worktreePath || !instance.branch) return;
        
        try {
            // Remove worktree
            execSync(`git worktree remove --force "${instance.worktreePath}"`, {
                cwd: this.config.gitRoot,
                stdio: 'pipe'
            });
            
            // Delete branch
            execSync(`git branch -D "${instance.branch}"`, {
                cwd: this.config.gitRoot,
                stdio: 'pipe'
            });
            
            this.outputChannel.appendLine(`Cleaned up worktree: ${instance.worktreePath}`);
        } catch (error) {
            this.monitor.log('warn', 'launcher', `Failed to cleanup worktree: ${error.message}`);
        }
        
        // Remove instance from map
        this.instances.delete(instance.id);
    }

    private async handleRemoteCommand(request: any): Promise<void> {
        const { toolId, command, args } = request.data;
        const instance = this.instances.get(toolId);
        
        if (!instance || !instance.process) {
            this.syncService?.logError(toolId, 'Instance not found or not running');
            return;
        }
        
        // Send command to process stdin
        if (instance.process.stdin) {
            instance.process.stdin.write(`${command} ${args.join(' ')}\n`);
            this.monitor.recordCommand(instance.sessionId, command, args);
        }
    }

    async launchParallel(
        tasks: Array<{ type: DevToolInstance['type']; task: string; options?: Partial<DevToolConfig> }>
    ): Promise<string[]> {
        const results = await Promise.allSettled(
            tasks.map(t => this.launchTool(t.type, t.task, t.options))
        );
        
        const instanceIds: string[] = [];
        
        for (const result of results) {
            if (result.status === 'fulfilled') {
                instanceIds.push(result.value);
            } else {
                this.monitor.log('error', 'launcher', `Failed to launch tool: ${result.reason}`);
            }
        }
        
        return instanceIds;
    }

    getInstance(instanceId: string): DevToolInstance | undefined {
        return this.instances.get(instanceId);
    }

    getActiveInstances(): DevToolInstance[] {
        return Array.from(this.instances.values()).filter(
            i => i.status === 'running'
        );
    }

    getAllInstances(): DevToolInstance[] {
        return Array.from(this.instances.values());
    }

    getInstancesByType(type: DevToolInstance['type']): DevToolInstance[] {
        return Array.from(this.instances.values()).filter(
            i => i.type === type
        );
    }

    showLauncherView(): void {
        this.outputChannel.show();
    }

    async dispose(): Promise<void> {
        await this.stopAllTools();
        
        if (this.syncService) {
            await this.syncService.disconnect();
        }
        
        this.monitor.dispose();
        this.cliManager.dispose();
        this.outputChannel.dispose();
    }
}