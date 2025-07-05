import { BaseCLITool, CLIToolConfig } from '../common/base-cli';
import * as vscode from 'vscode';
import { execSync } from 'child_process';

export class ClaudeCLI extends BaseCLITool {
    constructor() {
        super({
            name: 'Claude CLI',
            command: 'claude',
            args: [],
            env: {},
            model: 'claude-3-opus-20240229',
            apiKeyEnvVar: 'ANTHROPIC_API_KEY',
            maxTokens: 4096,
            temperature: 0.7
        });
    }

    async install(): Promise<boolean> {
        try {
            // Check if pip/pipx is available
            const hasPipx = await this.commandExists('pipx');
            const hasPip = await this.commandExists('pip');
            
            if (hasPipx) {
                await this.runCommand('pipx', ['install', 'anthropic']);
            } else if (hasPip) {
                await this.runCommand('pip', ['install', '--user', 'anthropic']);
            } else {
                throw new Error('Neither pip nor pipx found. Please install Python first.');
            }
            
            return true;
        } catch (error) {
            console.error('Failed to install Claude CLI:', error);
            return false;
        }
    }

    async checkInstallation(): Promise<boolean> {
        return this.commandExists('claude');
    }

    generatePrompt(task: string, context?: any): string {
        const systemPrompt = context?.systemPrompt || 'You are a helpful AI assistant.';
        const prompt = `
System: ${systemPrompt}

Task: ${task}

Please provide a detailed response.
`;
        return prompt;
    }

    protected getApiKey(): string {
        // First check VS Code settings
        const config = vscode.workspace.getConfiguration('hanzo');
        const anthropicKey = config.get<string>('anthropicApiKey');
        if (anthropicKey) return anthropicKey;
        
        // Fall back to environment variable
        return process.env.ANTHROPIC_API_KEY || '';
    }

    private async commandExists(command: string): Promise<boolean> {
        try {
            execSync(`which ${command}`, { stdio: 'ignore' });
            return true;
        } catch {
            return false;
        }
    }

    // Claude-specific methods
    async chat(message: string, conversationId?: string): Promise<string> {
        const args = ['chat'];
        if (conversationId) {
            args.push('--conversation', conversationId);
        }
        args.push('--message', message);
        
        const result = await this.execute('', { 
            env: { ...process.env, CLAUDE_ARGS: args.join(' ') }
        });
        
        return result.output || '';
    }

    async completeCode(code: string, language: string): Promise<string> {
        const prompt = `Complete this ${language} code:\n\n${code}`;
        const result = await this.execute(prompt);
        return result.output || '';
    }

    async reviewCode(code: string, language: string): Promise<string> {
        const prompt = `Review this ${language} code for bugs, security issues, and improvements:\n\n${code}`;
        const result = await this.execute(prompt);
        return result.output || '';
    }

    async generateTests(code: string, language: string, framework?: string): Promise<string> {
        const prompt = `Generate comprehensive unit tests for this ${language} code${framework ? ` using ${framework}` : ''}:\n\n${code}`;
        const result = await this.execute(prompt);
        return result.output || '';
    }
}