import { BaseCLITool, CLIToolConfig } from '../common/base-cli';
import * as vscode from 'vscode';
import { execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

export class GeminiCLI extends BaseCLITool {
    constructor() {
        super({
            name: 'Gemini CLI',
            command: 'gemini',
            args: [],
            env: {},
            model: 'gemini-pro',
            apiKeyEnvVar: 'GOOGLE_API_KEY',
            maxTokens: 8192,
            temperature: 0.7
        });
    }

    async install(): Promise<boolean> {
        try {
            // Install Google AI Python SDK or Node.js package
            const hasNpm = await this.commandExists('npm');
            const hasPython = await this.commandExists('python3');
            
            if (hasNpm) {
                // Install Node.js Gemini CLI wrapper
                await this.runCommand('npm', ['install', '-g', '@google/generative-ai-cli']);
            } else if (hasPython) {
                // Install Python SDK
                await this.runCommand('pip', ['install', '--user', 'google-generativeai']);
                
                // Create a wrapper script
                const wrapperScript = `#!/usr/bin/env python3
import sys
import google.generativeai as genai
import os

genai.configure(api_key=os.environ.get('GOOGLE_API_KEY'))
model = genai.GenerativeModel('gemini-pro')

if len(sys.argv) > 1:
    prompt = ' '.join(sys.argv[1:])
    response = model.generate_content(prompt)
    print(response.text)
`;
                const wrapperPath = path.join(process.env.HOME || '', '.local', 'bin', 'gemini');
                fs.mkdirSync(path.dirname(wrapperPath), { recursive: true });
                fs.writeFileSync(wrapperPath, wrapperScript);
                fs.chmodSync(wrapperPath, '755');
            }
            
            return true;
        } catch (error) {
            console.error('Failed to install Gemini CLI:', error);
            return false;
        }
    }

    async checkInstallation(): Promise<boolean> {
        return this.commandExists('gemini') || 
               (await this.commandExists('python3') && await this.pythonPackageExists('google-generativeai'));
    }

    generatePrompt(task: string, context?: any): string {
        const role = context?.role || 'You are an expert AI assistant specialized in coding and development.';
        const constraints = context?.constraints || [];
        
        let prompt = `${role}\n\n`;
        
        if (constraints.length > 0) {
            prompt += `Constraints:\n${constraints.map(c => `- ${c}`).join('\n')}\n\n`;
        }
        
        prompt += `Task: ${task}\n\nPlease provide a comprehensive response.`;
        
        return prompt;
    }

    protected getApiKey(): string {
        const config = vscode.workspace.getConfiguration('hanzo');
        const googleKey = config.get<string>('googleApiKey');
        if (googleKey) return googleKey;
        
        return process.env.GOOGLE_API_KEY || '';
    }

    private async commandExists(command: string): Promise<boolean> {
        try {
            execSync(`which ${command}`, { stdio: 'ignore' });
            return true;
        } catch {
            return false;
        }
    }

    private async pythonPackageExists(packageName: string): Promise<boolean> {
        try {
            execSync(`python3 -c "import ${packageName.replace('-', '_')}"`, { stdio: 'ignore' });
            return true;
        } catch {
            return false;
        }
    }

    // Gemini-specific methods
    async analyzeCode(code: string, language: string): Promise<string> {
        const prompt = `Analyze this ${language} code and provide insights on:
1. Code quality
2. Performance characteristics
3. Security considerations
4. Best practices adherence
5. Potential improvements

Code:
${code}`;
        
        const result = await this.execute(prompt);
        return result.output || '';
    }

    async generateProject(description: string, stack: string[]): Promise<string> {
        const prompt = `Generate a complete project structure for:
Description: ${description}
Tech Stack: ${stack.join(', ')}

Include:
- Directory structure
- Key files with starter code
- Configuration files
- README with setup instructions`;
        
        const result = await this.execute(prompt);
        return result.output || '';
    }

    async refactorCode(code: string, language: string, goals: string[]): Promise<string> {
        const prompt = `Refactor this ${language} code to achieve:
${goals.map((g, i) => `${i + 1}. ${g}`).join('\n')}

Original code:
${code}

Provide the refactored code with explanations for changes.`;
        
        const result = await this.execute(prompt);
        return result.output || '';
    }

    async generateAPI(specification: string): Promise<string> {
        const prompt = `Generate a REST API based on this specification:
${specification}

Include:
- API endpoints
- Request/response schemas
- Authentication details
- Example implementations
- OpenAPI/Swagger documentation`;
        
        const result = await this.execute(prompt);
        return result.output || '';
    }

    async debugCode(code: string, error: string, language: string): Promise<string> {
        const prompt = `Debug this ${language} code that's producing an error:

Error:
${error}

Code:
${code}

Provide:
1. Root cause analysis
2. Fixed code
3. Explanation of the fix
4. Prevention tips`;
        
        const result = await this.execute(prompt);
        return result.output || '';
    }

    async compareApproaches(task: string, approaches: string[]): Promise<string> {
        const prompt = `Compare these approaches for: ${task}

Approaches:
${approaches.map((a, i) => `${i + 1}. ${a}`).join('\n')}

Analyze:
- Pros and cons of each
- Performance implications
- Maintainability
- Best use cases
- Recommendation with justification`;
        
        const result = await this.execute(prompt);
        return result.output || '';
    }
}