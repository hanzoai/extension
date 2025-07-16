import { BaseCLITool, CLIToolConfig } from '../common/base-cli';
import * as vscode from 'vscode';
import { execSync } from 'child_process';
import * as path from 'path';
import * as fs from 'fs';

export class AiderCLI extends BaseCLITool {
    constructor() {
        super({
            name: 'Aider CLI',
            command: 'aider',
            args: [],
            env: {},
            model: 'gpt-4-turbo-preview',
            apiKeyEnvVar: 'OPENAI_API_KEY',
            maxTokens: 4096,
            temperature: 0.7
        });
    }

    async install(): Promise<boolean> {
        try {
            // Install via pip
            const hasPip = await this.commandExists('pip3');
            if (!hasPip) {
                throw new Error('Python pip is required to install Aider');
            }
            
            await this.runCommand('pip3', ['install', 'aider-chat']);
            
            // Set up git if needed
            const hasGit = await this.commandExists('git');
            if (!hasGit) {
                console.warn('Git is recommended for Aider to work optimally');
            }
            
            return true;
        } catch (error) {
            console.error('Failed to install Aider:', error);
            return false;
        }
    }

    async checkInstallation(): Promise<boolean> {
        return this.commandExists('aider');
    }

    generatePrompt(task: string, context?: any): string {
        // Aider takes the task as a direct message
        return task;
    }

    protected getApiKey(): string {
        const config = vscode.workspace.getConfiguration('hanzo');
        const openaiKey = config.get<string>('openaiApiKey');
        if (openaiKey) return openaiKey;
        
        const anthropicKey = config.get<string>('anthropicApiKey');
        if (anthropicKey && this.config.model?.includes('claude')) {
            return anthropicKey;
        }
        
        return process.env.OPENAI_API_KEY || process.env.ANTHROPIC_API_KEY || '';
    }

    private async commandExists(command: string): Promise<boolean> {
        try {
            execSync(`which ${command}`, { stdio: 'ignore' });
            return true;
        } catch {
            return false;
        }
    }

    // Aider-specific methods
    async startInteractiveSession(files: string[], options?: any): Promise<string> {
        const args = ['--yes']; // Auto-confirm prompts
        
        // Add model configuration
        if (options?.model) {
            args.push('--model', options.model);
        } else if (this.config.model) {
            args.push('--model', this.config.model);
        }
        
        // Add files to edit
        files.forEach(file => args.push(file));
        
        // Additional options
        if (options?.readOnly) {
            args.push('--read-only');
        }
        
        if (options?.autoCommit !== false) {
            args.push('--auto-commits');
        }
        
        if (options?.noPretty) {
            args.push('--no-pretty');
        }
        
        if (options?.showDiffs !== false) {
            args.push('--show-diffs');
        }
        
        const result = await this.execute('', {
            env: {
                ...process.env,
                AIDER_ARGS: args.join(' ')
            }
        });
        
        return result.output || '';
    }

    async editFiles(files: string[], instruction: string, options?: any): Promise<string> {
        const args = [
            '--yes',
            '--message', instruction
        ];
        
        // Add model
        if (options?.model || this.config.model) {
            args.push('--model', options?.model || this.config.model);
        }
        
        // Add files
        files.forEach(file => args.push(file));
        
        // Auto-commit by default
        if (options?.autoCommit !== false) {
            args.push('--auto-commits');
        }
        
        const result = await this.execute('', {
            env: {
                ...process.env,
                AIDER_COMMAND: instruction,
                AIDER_ARGS: args.join(' ')
            }
        });
        
        return result.output || '';
    }

    async addFiles(files: string[], readOnly: boolean = false): Promise<string> {
        const args = ['--add'];
        
        if (readOnly) {
            args.push('--read-only');
        }
        
        files.forEach(file => args.push(file));
        
        const result = await this.execute('', {
            env: {
                ...process.env,
                AIDER_ARGS: args.join(' ')
            }
        });
        
        return result.output || '';
    }

    async runWithGitRepo(task: string, repoPath: string, options?: any): Promise<string> {
        const args = [
            '--yes',
            '--message', task
        ];
        
        if (options?.model) {
            args.push('--model', options.model);
        }
        
        if (options?.darkMode) {
            args.push('--dark-mode');
        }
        
        if (options?.stream !== false) {
            args.push('--stream');
        }
        
        const result = await this.execute('', {
            cwd: repoPath,
            env: {
                ...process.env,
                AIDER_ARGS: args.join(' ')
            }
        });
        
        return result.output || '';
    }

    async askQuestion(question: string, context?: string[]): Promise<string> {
        const args = [
            '--yes',
            '--message', question,
            '--no-auto-commits' // Don't commit for questions
        ];
        
        // Add context files as read-only
        if (context && context.length > 0) {
            args.push('--read-only');
            context.forEach(file => args.push(file));
        }
        
        const result = await this.execute('', {
            env: {
                ...process.env,
                AIDER_ARGS: args.join(' ')
            }
        });
        
        return result.output || '';
    }

    async useAlternativeModel(model: string, task: string, files?: string[]): Promise<string> {
        const args = [
            '--yes',
            '--model', model,
            '--message', task
        ];
        
        if (files) {
            files.forEach(file => args.push(file));
        }
        
        const result = await this.execute('', {
            env: {
                ...process.env,
                AIDER_ARGS: args.join(' ')
            }
        });
        
        return result.output || '';
    }

    async showCostEstimate(files: string[]): Promise<string> {
        const args = ['--show-cost', '--dry-run'];
        files.forEach(file => args.push(file));
        
        const result = await this.execute('', {
            env: {
                ...process.env,
                AIDER_ARGS: args.join(' ')
            }
        });
        
        return result.output || '';
    }

    async applyChangesFromUrl(url: string, files?: string[]): Promise<string> {
        const task = `Apply the changes described in this URL: ${url}`;
        
        const args = [
            '--yes',
            '--message', task
        ];
        
        if (files) {
            files.forEach(file => args.push(file));
        }
        
        const result = await this.execute('', {
            env: {
                ...process.env,
                AIDER_ARGS: args.join(' ')
            }
        });
        
        return result.output || '';
    }
}