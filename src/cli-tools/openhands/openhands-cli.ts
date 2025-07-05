import { BaseCLITool, CLIToolConfig } from '../common/base-cli';
import * as vscode from 'vscode';
import { execSync } from 'child_process';
import * as path from 'path';
import * as fs from 'fs';

export class OpenHandsCLI extends BaseCLITool {
    constructor() {
        super({
            name: 'OpenHands CLI',
            command: 'openhands',
            args: [],
            env: {
                OPENAI_API_KEY: process.env.OPENAI_API_KEY || '',
                ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY || ''
            },
            model: 'gpt-4',
            apiKeyEnvVar: 'OPENAI_API_KEY',
            maxTokens: 8192,
            temperature: 0.7
        });
    }

    async install(): Promise<boolean> {
        try {
            // Check if Docker is installed (required for OpenHands)
            const hasDocker = await this.commandExists('docker');
            if (!hasDocker) {
                throw new Error('Docker is required for OpenHands. Please install Docker first.');
            }
            
            // Install via pip
            const hasPip = await this.commandExists('pip3');
            if (hasPip) {
                await this.runCommand('pip3', ['install', 'openhands']);
            } else {
                // Clone and install from source
                const installDir = path.join(process.env.HOME || '', '.hanzo-dev', 'tools');
                fs.mkdirSync(installDir, { recursive: true });
                
                await this.runCommand('git', [
                    'clone',
                    'https://github.com/All-Hands-AI/OpenHands.git',
                    path.join(installDir, 'openhands')
                ]);
                
                await this.runCommand('pip3', ['install', '-e', '.'], {
                    cwd: path.join(installDir, 'openhands')
                });
            }
            
            return true;
        } catch (error) {
            console.error('Failed to install OpenHands:', error);
            return false;
        }
    }

    async checkInstallation(): Promise<boolean> {
        return this.commandExists('openhands') || 
               fs.existsSync(path.join(process.env.HOME || '', '.hanzo-dev', 'tools', 'openhands'));
    }

    generatePrompt(task: string, context?: any): string {
        const workspace = context?.workspace || process.cwd();
        const model = context?.model || this.config.model;
        
        // OpenHands uses a different prompt format
        return `--task "${task}" --workspace "${workspace}" --model ${model}`;
    }

    protected getApiKey(): string {
        const config = vscode.workspace.getConfiguration('hanzo');
        
        // OpenHands can use multiple API keys
        const openaiKey = config.get<string>('openaiApiKey') || process.env.OPENAI_API_KEY;
        const anthropicKey = config.get<string>('anthropicApiKey') || process.env.ANTHROPIC_API_KEY;
        
        // Return the appropriate key based on model
        if (this.config.model?.includes('claude')) {
            return anthropicKey || '';
        }
        return openaiKey || '';
    }

    private async commandExists(command: string): Promise<boolean> {
        try {
            execSync(`which ${command}`, { stdio: 'ignore' });
            return true;
        } catch {
            return false;
        }
    }

    // OpenHands-specific methods
    async createAgent(task: string, workspace: string, config?: any): Promise<string> {
        const args = [
            '--task', task,
            '--workspace', workspace,
            '--model', config?.model || this.config.model
        ];
        
        if (config?.maxIterations) {
            args.push('--max-iterations', config.maxIterations);
        }
        
        if (config?.agentClass) {
            args.push('--agent-class', config.agentClass);
        }
        
        const result = await this.execute('', {
            env: {
                ...process.env,
                OPENHANDS_ARGS: args.join(' ')
            }
        });
        
        return result.output || '';
    }

    async runInDocker(task: string, workspace: string): Promise<string> {
        const dockerArgs = [
            'run', '-it', '--rm',
            '-v', `${workspace}:/workspace`,
            '-e', `OPENAI_API_KEY=${this.getApiKey()}`,
            'ghcr.io/all-hands-ai/openhands:latest',
            '--task', task
        ];
        
        const result = await this.execute('', {
            env: {
                ...process.env,
                DOCKER_COMMAND: 'docker',
                DOCKER_ARGS: dockerArgs.join(' ')
            }
        });
        
        return result.output || '';
    }

    async executeCodeAction(action: string, code: string, language: string): Promise<string> {
        const validActions = ['implement', 'debug', 'refactor', 'test', 'document'];
        if (!validActions.includes(action)) {
            throw new Error(`Invalid action: ${action}. Must be one of: ${validActions.join(', ')}`);
        }
        
        const task = `${action} this ${language} code:\n\n${code}`;
        const result = await this.execute(task);
        return result.output || '';
    }

    async generateTests(code: string, language: string, framework?: string): Promise<string> {
        const task = `Generate comprehensive unit tests for this ${language} code${framework ? ` using ${framework}` : ''}:\n\n${code}`;
        const result = await this.execute(task);
        return result.output || '';
    }

    async reviewPullRequest(prUrl: string): Promise<string> {
        const task = `Review this pull request and provide feedback: ${prUrl}`;
        const result = await this.execute(task);
        return result.output || '';
    }

    async explainCodebase(directory: string, focus?: string): Promise<string> {
        const task = focus 
            ? `Explain the ${focus} functionality in the codebase at ${directory}`
            : `Provide an overview of the codebase architecture at ${directory}`;
        
        const result = await this.execute(task, { cwd: directory });
        return result.output || '';
    }

    async implementFeature(description: string, targetFile?: string): Promise<string> {
        const task = targetFile
            ? `Implement this feature in ${targetFile}: ${description}`
            : `Implement this feature: ${description}`;
        
        const result = await this.execute(task);
        return result.output || '';
    }
}