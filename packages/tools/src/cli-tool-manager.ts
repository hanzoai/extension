import * as vscode from 'vscode';
import * as path from 'path';
import { BaseCLITool } from './common/base-cli';
import { ClaudeCLI } from './claude/claude-cli';
import { CodexCLI } from './codex/codex-cli';
import { GeminiCLI } from './gemini/gemini-cli';
import { OpenHandsCLI } from './openhands/openhands-cli';
import { AiderCLI } from './aider/aider-cli';
import { AsyncToolWrapper, AsyncToolResult } from './platform/async-tool-wrapper';
import { HanzoAuth } from './auth/hanzo-auth';

export type CLIToolType = 'claude' | 'codex' | 'gemini' | 'openhands' | 'aider';

export interface CLIToolTask {
    tool: CLIToolType;
    task: string;
    context?: any;
    directory?: string;
    files?: string[];
}

export class CLIToolManager {
    private tools: Map<CLIToolType, BaseCLITool> = new Map();
    private asyncWrapper: AsyncToolWrapper;
    private outputChannel: vscode.OutputChannel;
    private initialized: boolean = false;
    private asyncJobs: Map<string, { toolType: CLIToolType; task: string }> = new Map();
    private auth: HanzoAuth;

    constructor(auth?: HanzoAuth) {
        this.outputChannel = vscode.window.createOutputChannel('Hanzo Dev Tools');
        this.asyncWrapper = new AsyncToolWrapper({
            idleTimeout: 5 * 60 * 1000, // 5 minutes
            maxRuntime: 30 * 60 * 1000, // 30 minutes
            persistResults: true,
            resultPath: path.join(process.cwd(), '.hanzo-dev', 'async-results')
        });
        
        this.auth = auth || new HanzoAuth();
        this.setupAsyncHandlers();
        this.setupAPIKeys();
    }

    async initialize(): Promise<void> {
        if (this.initialized) return;

        this.outputChannel.appendLine('Initializing CLI tools...');

        // Initialize all CLI tools
        const claudeCLI = new ClaudeCLI();
        const codexCLI = new CodexCLI();
        const geminiCLI = new GeminiCLI();
        const openhandsCLI = new OpenHandsCLI();
        const aiderCLI = new AiderCLI();

        // Set up event listeners
        [claudeCLI, codexCLI, geminiCLI, openhandsCLI, aiderCLI].forEach(tool => {
            tool.on('output', (data) => {
                this.outputChannel.append(`[${tool.getConfig().name}] ${data}`);
            });
            
            tool.on('error', (error) => {
                this.outputChannel.appendLine(`[${tool.getConfig().name}] ERROR: ${error}`);
            });
        });

        // Initialize tools
        await Promise.all([
            claudeCLI.initialize(),
            codexCLI.initialize(),
            geminiCLI.initialize(),
            openhandsCLI.initialize(),
            aiderCLI.initialize()
        ]);

        this.tools.set('claude', claudeCLI);
        this.tools.set('codex', codexCLI);
        this.tools.set('gemini', geminiCLI);
        this.tools.set('openhands', openhandsCLI);
        this.tools.set('aider', aiderCLI);

        this.initialized = true;
        this.outputChannel.appendLine('CLI tools initialized successfully!');
    }

    private async setupAPIKeys(): Promise<void> {
        // Set up API keys from Hanzo Auth
        if (this.auth.isAuthenticated()) {
            // Claude/Anthropic
            const anthropicKey = this.auth.getAPIKey('anthropic');
            if (anthropicKey) {
                process.env.ANTHROPIC_API_KEY = anthropicKey;
            }
            
            // OpenAI/Codex
            const openaiKey = this.auth.getAPIKey('openai');
            if (openaiKey) {
                process.env.OPENAI_API_KEY = openaiKey;
            }
            
            // Google/Gemini
            const googleKey = this.auth.getAPIKey('google');
            if (googleKey) {
                process.env.GOOGLE_API_KEY = googleKey;
            }
            
            this.outputChannel.appendLine('API keys loaded from Hanzo Auth');
        }
    }

    async executeTool(toolType: CLIToolType, task: string, options?: any): Promise<any> {
        await this.initialize();
        
        const tool = this.tools.get(toolType);
        if (!tool) {
            throw new Error(`Unknown tool type: ${toolType}`);
        }

        if (!tool.isReady()) {
            throw new Error(`${toolType} is not ready. Please check installation.`);
        }

        this.outputChannel.appendLine(`\n[${toolType}] Executing: ${task}`);
        const result = await tool.execute(task, options);
        
        if (result.success) {
            this.outputChannel.appendLine(`[${toolType}] Completed successfully in ${result.duration}ms`);
        } else {
            this.outputChannel.appendLine(`[${toolType}] Failed: ${result.error}`);
        }

        return result;
    }

    async executeParallel(tasks: CLIToolTask[]): Promise<Map<string, any>> {
        await this.initialize();
        
        const results = new Map<string, any>();
        const promises = tasks.map(async (taskConfig, index) => {
            const tool = this.tools.get(taskConfig.tool);
            if (!tool) {
                results.set(`task-${index}`, { 
                    error: `Unknown tool: ${taskConfig.tool}` 
                });
                return;
            }

            try {
                const result = await tool.execute(taskConfig.task, {
                    cwd: taskConfig.directory
                });
                results.set(`task-${index}`, result);
            } catch (error) {
                results.set(`task-${index}`, { 
                    error: error.message 
                });
            }
        });

        await Promise.all(promises);
        return results;
    }

    async compareResults(task: string, tools: CLIToolType[] = ['claude', 'codex', 'gemini']): Promise<Map<CLIToolType, any>> {
        await this.initialize();
        
        const results = new Map<CLIToolType, any>();
        
        this.outputChannel.appendLine(`\n=== Comparing results for: ${task} ===`);
        
        for (const toolType of tools) {
            const tool = this.tools.get(toolType);
            if (!tool || !tool.isReady()) {
                results.set(toolType, { 
                    error: `${toolType} not available` 
                });
                continue;
            }

            try {
                const result = await tool.execute(task);
                results.set(toolType, result);
                this.outputChannel.appendLine(`\n[${toolType}] Result:\n${result.output}`);
            } catch (error) {
                results.set(toolType, { 
                    error: error.message 
                });
            }
        }

        return results;
    }

    // Specialized methods for common tasks
    async generateCode(description: string, language: string, preferredTool?: CLIToolType): Promise<string> {
        const tool = preferredTool || 'codex';
        const codexCLI = this.tools.get(tool) as CodexCLI;
        
        if (codexCLI && codexCLI.generateCode) {
            return codexCLI.generateCode(description, language);
        }
        
        // Fallback to general execution
        const task = `Generate ${language} code for: ${description}`;
        const result = await this.executeTool(tool, task);
        return result.output || '';
    }

    async reviewCode(code: string, language: string, preferredTool?: CLIToolType): Promise<string> {
        const tool = preferredTool || 'claude';
        const claudeCLI = this.tools.get(tool) as ClaudeCLI;
        
        if (claudeCLI && claudeCLI.reviewCode) {
            return claudeCLI.reviewCode(code, language);
        }
        
        // Fallback
        const task = `Review this ${language} code:\n${code}`;
        const result = await this.executeTool(tool, task);
        return result.output || '';
    }

    async debugCode(code: string, error: string, language: string, preferredTool?: CLIToolType): Promise<string> {
        const tool = preferredTool || 'gemini';
        const geminiCLI = this.tools.get(tool) as GeminiCLI;
        
        if (geminiCLI && geminiCLI.debugCode) {
            return geminiCLI.debugCode(code, error, language);
        }
        
        // Fallback
        const task = `Debug this ${language} code with error: ${error}\n\nCode:\n${code}`;
        const result = await this.executeTool(tool, task);
        return result.output || '';
    }

    getAvailableTools(): CLIToolType[] {
        const available: CLIToolType[] = [];
        
        for (const [type, tool] of this.tools) {
            if (tool.isReady()) {
                available.push(type);
            }
        }
        
        return available;
    }

    showOutput(): void {
        this.outputChannel.show();
    }

    private setupAsyncHandlers(): void {
        this.asyncWrapper.on('job:created', (job) => {
            this.outputChannel.appendLine(`[Async] Job created: ${job.id} (${job.toolName})`);
        });
        
        this.asyncWrapper.on('job:completed', (job) => {
            this.outputChannel.appendLine(`[Async] Job completed: ${job.id} (${job.toolName})`);
            const jobInfo = this.asyncJobs.get(job.id);
            if (jobInfo) {
                vscode.window.showInformationMessage(
                    `Hanzo Dev: ${jobInfo.toolType} task completed`
                );
            }
        });
        
        this.asyncWrapper.on('job:failed', (job) => {
            this.outputChannel.appendLine(`[Async] Job failed: ${job.id} (${job.toolName})`);
        });
        
        this.asyncWrapper.on('job:idle', (job) => {
            this.outputChannel.appendLine(`[Async] Job idle: ${job.id} (${job.toolName})`);
        });
    }

    // Async execution methods
    async executeToolAsync(toolType: CLIToolType, task: string, options?: any): Promise<string> {
        await this.initialize();
        
        const tool = this.tools.get(toolType);
        if (!tool) {
            throw new Error(`Unknown tool type: ${toolType}`);
        }

        if (!tool.isReady()) {
            throw new Error(`${toolType} is not ready. Please check installation.`);
        }

        const command = tool.getConfig().command;
        const args = [...(tool.getConfig().args || []), tool.generatePrompt(task, options)];
        
        const jobId = await this.asyncWrapper.createAsyncTool(
            toolType,
            command,
            args,
            { toolType, task, options }
        );
        
        this.asyncJobs.set(jobId, { toolType, task });
        
        this.outputChannel.appendLine(`\n[${toolType}] Started async job: ${jobId}`);
        vscode.window.showInformationMessage(
            `Hanzo Dev: Started ${toolType} task (Job ID: ${jobId.substring(0, 8)}...)`
        );
        
        return jobId;
    }

    async queryAsyncJob(jobId: string): Promise<AsyncToolResult | null> {
        return this.asyncWrapper.queryJob(jobId);
    }

    async waitForAsyncJob(jobId: string, timeout?: number): Promise<AsyncToolResult | null> {
        return this.asyncWrapper.waitForJob(jobId, timeout);
    }

    keepAsyncJobAlive(jobId: string): void {
        this.asyncWrapper.keepAlive(jobId);
    }

    sendInputToAsyncJob(jobId: string, input: string): boolean {
        return this.asyncWrapper.sendInput(jobId, input);
    }

    cancelAsyncJob(jobId: string): void {
        this.asyncWrapper.cancelJob(jobId);
        this.asyncJobs.delete(jobId);
    }

    getActiveAsyncJobs(): Array<{ jobId: string; toolType: CLIToolType; task: string }> {
        const activeJobs = this.asyncWrapper.getActiveJobs();
        return activeJobs.map(job => {
            const jobInfo = this.asyncJobs.get(job.id);
            return {
                jobId: job.id,
                toolType: jobInfo?.toolType || 'unknown' as CLIToolType,
                task: jobInfo?.task || 'Unknown task'
            };
        });
    }

    // Execute multiple tools asynchronously and compare results
    async executeParallelAsync(
        tasks: CLIToolTask[]
    ): Promise<Map<string, string>> {
        await this.initialize();
        
        const jobIds = new Map<string, string>();
        
        for (const taskConfig of tasks) {
            try {
                const jobId = await this.executeToolAsync(
                    taskConfig.tool,
                    taskConfig.task,
                    {
                        cwd: taskConfig.directory,
                        ...taskConfig.context
                    }
                );
                jobIds.set(`${taskConfig.tool}-${Date.now()}`, jobId);
            } catch (error) {
                this.outputChannel.appendLine(`Failed to start ${taskConfig.tool}: ${error.message}`);
            }
        }
        
        return jobIds;
    }

    dispose(): void {
        // Cancel all async jobs
        for (const jobId of this.asyncJobs.keys()) {
            this.asyncWrapper.cancelJob(jobId);
        }
        
        for (const tool of this.tools.values()) {
            tool.stop();
        }
        
        this.asyncWrapper.dispose();
        this.outputChannel.dispose();
    }
}