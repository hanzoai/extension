import { BaseCLITool, CLIToolConfig } from '../common/base-cli';
import * as vscode from 'vscode';
import { execSync } from 'child_process';

export class CodexCLI extends BaseCLITool {
    constructor() {
        super({
            name: 'Codex CLI',
            command: 'openai',
            args: ['api', 'completions.create'],
            env: {},
            model: 'code-davinci-002',
            apiKeyEnvVar: 'OPENAI_API_KEY',
            maxTokens: 2048,
            temperature: 0.3
        });
    }

    async install(): Promise<boolean> {
        try {
            // Install OpenAI CLI
            const hasNpm = await this.commandExists('npm');
            const hasYarn = await this.commandExists('yarn');
            
            if (hasNpm) {
                await this.runCommand('npm', ['install', '-g', 'openai-cli']);
            } else if (hasYarn) {
                await this.runCommand('yarn', ['global', 'add', 'openai-cli']);
            } else {
                // Try Python installation
                await this.runCommand('pip', ['install', '--user', 'openai']);
            }
            
            return true;
        } catch (error) {
            console.error('Failed to install Codex CLI:', error);
            return false;
        }
    }

    async checkInstallation(): Promise<boolean> {
        return this.commandExists('openai') || this.commandExists('python');
    }

    generatePrompt(task: string, context?: any): string {
        const language = context?.language || 'typescript';
        const purpose = context?.purpose || 'general';
        
        const prompt = `
Language: ${language}
Purpose: ${purpose}

Task: ${task}

Generate high-quality, production-ready code with comments.
`;
        return prompt;
    }

    protected getApiKey(): string {
        const config = vscode.workspace.getConfiguration('hanzo');
        const openaiKey = config.get<string>('openaiApiKey');
        if (openaiKey) return openaiKey;
        
        return process.env.OPENAI_API_KEY || '';
    }

    private async commandExists(command: string): Promise<boolean> {
        try {
            execSync(`which ${command}`, { stdio: 'ignore' });
            return true;
        } catch {
            return false;
        }
    }

    // Codex-specific methods
    async generateCode(description: string, language: string): Promise<string> {
        const prompt = `# ${language}\n# ${description}\n\n`;
        const result = await this.execute(prompt, {
            env: {
                ...process.env,
                OPENAI_MODEL: 'code-davinci-002',
                OPENAI_MAX_TOKENS: '2048',
                OPENAI_TEMPERATURE: '0.3'
            }
        });
        return result.output || '';
    }

    async explainCode(code: string, language: string): Promise<string> {
        const prompt = `Explain this ${language} code in detail:\n\n${code}\n\nExplanation:`;
        const result = await this.execute(prompt);
        return result.output || '';
    }

    async optimizeCode(code: string, language: string): Promise<string> {
        const prompt = `Optimize this ${language} code for performance and readability:\n\n${code}\n\nOptimized version:`;
        const result = await this.execute(prompt);
        return result.output || '';
    }

    async convertCode(code: string, fromLang: string, toLang: string): Promise<string> {
        const prompt = `Convert this ${fromLang} code to ${toLang}:\n\n${code}\n\n${toLang} version:`;
        const result = await this.execute(prompt);
        return result.output || '';
    }

    async generateDocumentation(code: string, language: string): Promise<string> {
        const prompt = `Generate comprehensive documentation for this ${language} code:\n\n${code}\n\nDocumentation:`;
        const result = await this.execute(prompt);
        return result.output || '';
    }

    async findBugs(code: string, language: string): Promise<string> {
        const prompt = `Find potential bugs and issues in this ${language} code:\n\n${code}\n\nBugs found:`;
        const result = await this.execute(prompt);
        return result.output || '';
    }
}