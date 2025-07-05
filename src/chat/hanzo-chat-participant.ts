import * as vscode from 'vscode';
import { MCPTools } from '../mcp/tools';
import axios from 'axios';
import { getConfig } from '../config';

interface LLMConfig {
    provider: 'hanzo' | 'lmstudio' | 'ollama' | 'openai' | 'anthropic';
    apiKey?: string;
    endpoint?: string;
    model?: string;
}

export class HanzoChatParticipant {
    private static readonly ID = 'hanzo';  // Lowercase for @hanzo
    private mcpTools: MCPTools;
    private llmConfig: LLMConfig;
    
    constructor(private context: vscode.ExtensionContext) {
        this.mcpTools = new MCPTools(context);
        this.llmConfig = this.getLLMConfig();
    }
    
    async initialize() {
        await this.mcpTools.initialize();
        
        // Register chat participant
        const participant = vscode.chat.createChatParticipant(
            HanzoChatParticipant.ID,
            this.handleChat.bind(this)
        );
        
        participant.iconPath = vscode.Uri.joinPath(
            vscode.Uri.file(__dirname),
            '..',
            '..',
            'images',
            'icon.png'
        );
        
        // Add follow-up provider
        participant.followupProvider = {
            provideFollowups: this.provideFollowups.bind(this)
        };
        
        return participant;
    }
    
    private getLLMConfig(): LLMConfig {
        const config = vscode.workspace.getConfiguration('hanzo');
        const llmProvider = config.get<string>('llm.provider', 'hanzo');
        
        switch (llmProvider) {
            case 'lmstudio':
                return {
                    provider: 'lmstudio',
                    endpoint: config.get<string>('llm.lmstudio.endpoint', 'http://localhost:1234/v1'),
                    model: config.get<string>('llm.lmstudio.model')
                };
            case 'ollama':
                return {
                    provider: 'ollama',
                    endpoint: config.get<string>('llm.ollama.endpoint', 'http://localhost:11434'),
                    model: config.get<string>('llm.ollama.model', 'llama2')
                };
            case 'openai':
                return {
                    provider: 'openai',
                    apiKey: config.get<string>('llm.openai.apiKey'),
                    model: config.get<string>('llm.openai.model', 'gpt-4')
                };
            case 'anthropic':
                return {
                    provider: 'anthropic',
                    apiKey: config.get<string>('llm.anthropic.apiKey'),
                    model: config.get<string>('llm.anthropic.model', 'claude-3-opus-20240229')
                };
            default:
                return {
                    provider: 'hanzo',
                    endpoint: config.get<string>('api.endpoint', 'https://api.hanzo.ai/ext/v1'),
                    apiKey: config.get<string>('llm.hanzo.apiKey')
                };
        }
    }
    
    private async handleChat(
        request: vscode.ChatRequest,
        context: vscode.ChatContext,
        stream: vscode.ChatResponseStream,
        token: vscode.CancellationToken
    ): Promise<void> {
        stream.progress('Processing your request...');
        
        try {
            // First check if this is a direct tool call
            const toolCalls = this.parseToolCalls(request.prompt);
            
            if (toolCalls.length > 0) {
                // Execute tool calls directly
                await this.executeToolCalls(toolCalls, stream);
            } else {
                // Use LLM to understand the request and potentially call tools
                const response = await this.queryLLM(request.prompt, context);
                
                if (response.toolCalls && response.toolCalls.length > 0) {
                    // LLM wants to use tools
                    await this.executeToolCalls(response.toolCalls, stream);
                } else if (response.content) {
                    // LLM provided a direct response
                    stream.markdown(response.content);
                } else {
                    // Fallback to showing available tools
                    stream.markdown(this.getToolsHelp());
                }
            }
        } catch (error: any) {
            stream.markdown(`❌ Error: ${error.message}`);
        }
    }
    
    private async executeToolCalls(
        toolCalls: Array<{ toolName: string; args: any }>,
        stream: vscode.ChatResponseStream
    ): Promise<void> {
        for (const { toolName, args } of toolCalls) {
            const tool = this.mcpTools.getTool(toolName);
            if (tool) {
                stream.progress(`Executing ${toolName}...`);
                
                try {
                    const result = await tool.handler(args);
                    
                    // Format and stream the result
                    if (toolName === 'read' || toolName === 'grep' || toolName === 'search') {
                        // For file content, use code blocks
                        stream.markdown(`\`\`\`\n${result}\n\`\`\``);
                    } else {
                        stream.markdown(result);
                    }
                } catch (error: any) {
                    stream.markdown(`❌ Error executing ${toolName}: ${error.message}`);
                }
            } else {
                stream.markdown(`❌ Unknown tool: ${toolName}`);
            }
        }
    }
    
    private async queryLLM(
        prompt: string,
        context: vscode.ChatContext
    ): Promise<{ content?: string; toolCalls?: Array<{ toolName: string; args: any }> }> {
        try {
            // Get all available tools for the system prompt
            const tools = this.mcpTools.getAllTools();
            const toolDescriptions = tools.map(t => `- ${t.name}: ${t.description}`).join('\n');
            
            const systemPrompt = `You are Hanzo, an AI assistant integrated into VS Code with access to powerful development tools.

Available tools:
${toolDescriptions}

When the user asks you to perform tasks, analyze their request and either:
1. Use the appropriate tools to complete the task
2. Provide a helpful response without tools
3. Ask for clarification if needed

To use a tool, respond with a JSON block like this:
\`\`\`json
{
  "toolCalls": [
    {
      "toolName": "read",
      "args": { "file_path": "/path/to/file" }
    }
  ]
}
\`\`\`

Otherwise, respond with:
\`\`\`json
{
  "content": "Your response here"
}
\`\`\``;

            // Query the LLM based on configuration
            let response: string;
            
            switch (this.llmConfig.provider) {
                case 'lmstudio':
                    response = await this.queryLMStudio(systemPrompt, prompt);
                    break;
                case 'ollama':
                    response = await this.queryOllama(systemPrompt, prompt);
                    break;
                case 'openai':
                    response = await this.queryOpenAI(systemPrompt, prompt);
                    break;
                case 'anthropic':
                    response = await this.queryAnthropic(systemPrompt, prompt);
                    break;
                default:
                    response = await this.queryHanzoAPI(systemPrompt, prompt);
            }
            
            // Parse the response
            try {
                const jsonMatch = response.match(/```json\n([\s\S]*?)\n```/);
                if (jsonMatch) {
                    return JSON.parse(jsonMatch[1]);
                }
            } catch (e) {
                // If parsing fails, treat as plain text response
            }
            
            return { content: response };
            
        } catch (error: any) {
            console.error('LLM query error:', error);
            // Fallback to direct tool parsing
            const toolCalls = this.parseToolCalls(prompt);
            if (toolCalls.length > 0) {
                return { toolCalls };
            }
            return { content: `Error querying LLM: ${error.message}. You can still use tools directly.` };
        }
    }
    
    private async queryHanzoAPI(systemPrompt: string, userPrompt: string): Promise<string> {
        const response = await axios.post(
            `${this.llmConfig.endpoint}/llm/chat`,
            {
                messages: [
                    { role: 'system', content: systemPrompt },
                    { role: 'user', content: userPrompt }
                ],
                model: this.llmConfig.model || 'gpt-4',
                temperature: 0.7
            },
            {
                headers: {
                    'Authorization': `Bearer ${this.llmConfig.apiKey}`,
                    'Content-Type': 'application/json'
                }
            }
        );
        
        return response.data.choices[0].message.content;
    }
    
    private async queryLMStudio(systemPrompt: string, userPrompt: string): Promise<string> {
        const response = await axios.post(
            `${this.llmConfig.endpoint}/chat/completions`,
            {
                messages: [
                    { role: 'system', content: systemPrompt },
                    { role: 'user', content: userPrompt }
                ],
                model: this.llmConfig.model || 'local-model',
                temperature: 0.7
            },
            {
                headers: {
                    'Content-Type': 'application/json'
                }
            }
        );
        
        return response.data.choices[0].message.content;
    }
    
    private async queryOllama(systemPrompt: string, userPrompt: string): Promise<string> {
        const response = await axios.post(
            `${this.llmConfig.endpoint}/api/generate`,
            {
                model: this.llmConfig.model || 'llama2',
                prompt: `${systemPrompt}\n\nUser: ${userPrompt}\nAssistant:`,
                stream: false
            },
            {
                headers: {
                    'Content-Type': 'application/json'
                }
            }
        );
        
        return response.data.response;
    }
    
    private async queryOpenAI(systemPrompt: string, userPrompt: string): Promise<string> {
        const response = await axios.post(
            'https://api.openai.com/v1/chat/completions',
            {
                messages: [
                    { role: 'system', content: systemPrompt },
                    { role: 'user', content: userPrompt }
                ],
                model: this.llmConfig.model || 'gpt-4',
                temperature: 0.7
            },
            {
                headers: {
                    'Authorization': `Bearer ${this.llmConfig.apiKey}`,
                    'Content-Type': 'application/json'
                }
            }
        );
        
        return response.data.choices[0].message.content;
    }
    
    private async queryAnthropic(systemPrompt: string, userPrompt: string): Promise<string> {
        const response = await axios.post(
            'https://api.anthropic.com/v1/messages',
            {
                messages: [
                    { role: 'user', content: userPrompt }
                ],
                model: this.llmConfig.model || 'claude-3-opus-20240229',
                system: systemPrompt,
                max_tokens: 4096
            },
            {
                headers: {
                    'x-api-key': this.llmConfig.apiKey,
                    'anthropic-version': '2023-06-01',
                    'Content-Type': 'application/json'
                }
            }
        );
        
        return response.data.content[0].text;
    }
    
    private parseToolCalls(prompt: string): Array<{ toolName: string; args: any }> {
        const toolCalls: Array<{ toolName: string; args: any }> = [];
        
        // Simple pattern matching for common commands
        const patterns = [
            // File operations
            { regex: /read\s+(.+)/, tool: 'read', args: (m: RegExpMatchArray) => ({ file_path: m[1].trim() }) },
            { regex: /write\s+(.+?)\s+content:\s*(.+)/s, tool: 'write', args: (m: RegExpMatchArray) => ({ file_path: m[1].trim(), content: m[2].trim() }) },
            { regex: /edit\s+(.+?)\s+replace\s+"(.+?)"\s+with\s+"(.+?)"/s, tool: 'edit', args: (m: RegExpMatchArray) => ({ file_path: m[1].trim(), old_string: m[2], new_string: m[3] }) },
            
            // Search operations
            { regex: /search\s+"(.+?)"(?:\s+in\s+(.+))?/, tool: 'search', args: (m: RegExpMatchArray) => ({ query: m[1], include: m[2]?.trim() }) },
            { regex: /grep\s+"(.+?)"(?:\s+(.+))?/, tool: 'grep', args: (m: RegExpMatchArray) => ({ pattern: m[1], include: m[2]?.trim() || '**/*' }) },
            
            // Shell operations
            { regex: /run\s+(.+)/, tool: 'run_command', args: (m: RegExpMatchArray) => ({ command: m[1].trim() }) },
            { regex: /bash\s+(.+)/, tool: 'bash', args: (m: RegExpMatchArray) => ({ command: m[1].trim() }) },
            
            // Directory operations
            { regex: /ls\s+(.+)/, tool: 'directory_tree', args: (m: RegExpMatchArray) => ({ path: m[1].trim() }) },
            { regex: /tree\s+(.+)/, tool: 'directory_tree', args: (m: RegExpMatchArray) => ({ path: m[1].trim() }) },
            
            // AI operations
            { regex: /agent\s+(.+)/, tool: 'agent', args: (m: RegExpMatchArray) => ({ task: m[1].trim() }) },
        ];
        
        for (const pattern of patterns) {
            const match = prompt.match(pattern.regex);
            if (match) {
                toolCalls.push({
                    toolName: pattern.tool,
                    args: pattern.args(match)
                });
                break; // Only process first match for now
            }
        }
        
        return toolCalls;
    }
    
    private provideFollowups(
        result: vscode.ChatResult,
        context: vscode.ChatContext,
        token: vscode.CancellationToken
    ): vscode.ProviderResult<vscode.ChatFollowup[]> {
        return [
            {
                prompt: 'Show available tools',
                label: 'Available Tools',
                command: 'help'
            },
            {
                prompt: 'Search for "TODO" in all files',
                label: 'Find TODOs',
                command: 'search'
            },
            {
                prompt: 'Show current directory structure',
                label: 'Directory Tree',
                command: 'tree'
            },
            {
                prompt: 'Configure LLM provider',
                label: 'LLM Settings',
                command: 'llm_manage'
            }
        ];
    }
    
    private getToolsHelp(): string {
        const tools = this.mcpTools.getAllTools();
        const categories: Record<string, string[]> = {
            'File Operations': ['read', 'write', 'edit', 'multi_edit'],
            'Search': ['search', 'grep', 'git_search', 'symbols'],
            'Shell': ['bash', 'run_command', 'processes'],
            'Directory': ['directory_tree', 'find_files'],
            'AI': ['llm', 'consensus', 'mode', 'agent'],
            'Development': ['todo_read', 'todo_write', 'critic', 'think']
        };
        
        let help = `# @hanzo AI Assistant

I have access to ${tools.length} tools to help you with development tasks.

## Current LLM Provider: ${this.llmConfig.provider}
${this.llmConfig.provider === 'hanzo' ? 'Using Hanzo AI Gateway (api.hanzo.ai)' : ''}
${this.llmConfig.provider === 'lmstudio' ? `Using LM Studio at ${this.llmConfig.endpoint}` : ''}
${this.llmConfig.provider === 'ollama' ? `Using Ollama at ${this.llmConfig.endpoint}` : ''}

## Available Tools by Category:\n\n`;
        
        for (const [category, toolNames] of Object.entries(categories)) {
            const categoryTools = toolNames
                .map(name => tools.find(t => t.name === name))
                .filter(Boolean);
            
            if (categoryTools.length > 0) {
                help += `### ${category}\n`;
                for (const tool of categoryTools) {
                    if (tool) {
                        help += `- **${tool.name}**: ${tool.description}\n`;
                    }
                }
                help += '\n';
            }
        }
        
        help += `## Example Commands:
- "read src/index.ts"
- "search for TODO"
- "grep 'function' in **/*.ts"
- "run npm test"
- "show directory tree for src"
- "agent analyze this codebase for security issues"

## LLM Configuration:
You can configure your LLM provider in VS Code settings:
- hanzo.llm.provider: Choose from 'hanzo', 'lmstudio', 'ollama', 'openai', 'anthropic'
- hanzo.llm.[provider].endpoint: Set custom endpoints for local providers
- hanzo.llm.[provider].model: Choose specific models

Ask me to use any of these tools to help with your development tasks!`;
        
        return help;
    }
}