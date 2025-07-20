import * as vscode from 'vscode';
import { MCPTool } from '../server';
import axios from 'axios';

interface AgentConfig {
    task: string;
    role?: string;
    tools?: string[];
    model?: string;
    agents?: Array<{
        name: string;
        role: string;
        tools?: string[];
    }>;
    parallel?: boolean;
}

interface LLMProvider {
    name: string;
    endpoint?: string;
    apiKey?: string;
    models: string[];
    priority: number;
}

export function createAgentTools(context: vscode.ExtensionContext): MCPTool[] {
    return [
        {
            name: 'agent',
            description: 'AI agent that can use tools to complete complex tasks. Supports single or multi-agent workflows.',
            inputSchema: {
                type: 'object',
                properties: {
                    task: {
                        type: 'string',
                        description: 'Task description for the agent(s)'
                    },
                    role: {
                        type: 'string',
                        description: 'Role/persona for single agent mode (e.g., "security expert", "performance optimizer")'
                    },
                    tools: {
                        type: 'array',
                        items: { type: 'string' },
                        description: 'Specific tools the agent can use (defaults to all appropriate tools)'
                    },
                    model: {
                        type: 'string',
                        description: 'LLM model to use (e.g., "gpt-4", "claude-3", "llama2", "gemini/gemini-pro")'
                    },
                    agents: {
                        type: 'array',
                        items: {
                            type: 'object',
                            properties: {
                                name: { type: 'string' },
                                role: { type: 'string' },
                                tools: {
                                    type: 'array',
                                    items: { type: 'string' }
                                }
                            }
                        },
                        description: 'Multi-agent configuration (optional)'
                    },
                    parallel: {
                        type: 'boolean',
                        description: 'Run multiple agents in parallel (default: false)'
                    }
                },
                required: ['task']
            },
            handler: async (args: AgentConfig) => {
                const providers = detectLLMProviders();
                const selectedProvider = selectProvider(providers, args.model);
                
                if (!selectedProvider) {
                    return 'Error: No LLM provider available. Please configure API keys in environment or VS Code settings.';
                }
                
                // Single agent mode
                if (!args.agents) {
                    const agent = {
                        name: 'Agent',
                        role: args.role || 'AI assistant that completes tasks using available tools',
                        tools: args.tools
                    };
                    
                    try {
                        const result = await executeAgent(
                            agent, 
                            args.task, 
                            selectedProvider,
                            args.model
                        );
                        return `## Task Completed\n\n${result}`;
                    } catch (error: any) {
                        return `Error: ${error.message}`;
                    }
                }
                
                // Multi-agent mode
                const defaultAgents = [
                    {
                        name: 'Analyst',
                        role: 'Analyze requirements and understand the codebase',
                        tools: ['read', 'search', 'grep', 'directory_tree', 'symbols', 'git_search']
                    },
                    {
                        name: 'Developer',
                        role: 'Implement changes and write code',
                        tools: ['write', 'edit', 'multi_edit', 'bash', 'run_command', 'npx', 'uvx']
                    },
                    {
                        name: 'Reviewer',
                        role: 'Review changes and ensure quality',
                        tools: ['read', 'git_search', 'diff', 'critic', 'think', 'grep']
                    }
                ];
                
                const agents = args.agents || defaultAgents;
                
                try {
                    if (args.parallel) {
                        // Execute agents in parallel
                        const promises = agents.map(agent => 
                            executeAgent(agent, args.task, selectedProvider, args.model)
                        );
                        const results = await Promise.all(promises);
                        return formatAgentResults(agents, results, selectedProvider);
                    } else {
                        // Execute agents sequentially with context passing
                        const results: string[] = [];
                        let context = '';
                        
                        for (const agent of agents) {
                            const result = await executeAgent(
                                agent, 
                                args.task, 
                                selectedProvider,
                                args.model,
                                context
                            );
                            results.push(result);
                            context += `\n\n${agent.name} completed:\n${result}`;
                        }
                        
                        return formatAgentResults(agents, results, selectedProvider);
                    }
                } catch (error: any) {
                    return `Error in multi-agent execution: ${error.message}`;
                }
            }
        }
    ];
}

function detectLLMProviders(): LLMProvider[] {
    const providers: LLMProvider[] = [];
    const config = vscode.workspace.getConfiguration('hanzo');
    
    // Check environment variables first (highest priority)
    
    // OpenAI
    if (process.env.OPENAI_API_KEY) {
        providers.push({
            name: 'openai',
            apiKey: process.env.OPENAI_API_KEY,
            models: ['o3-pro', 'o3', 'gpt-4o', 'gpt-4-turbo', 'gpt-4', 'gpt-3.5-turbo'],
            priority: 1
        });
    }
    
    // Anthropic
    if (process.env.ANTHROPIC_API_KEY) {
        providers.push({
            name: 'anthropic',
            apiKey: process.env.ANTHROPIC_API_KEY,
            models: ['claude-4', 'claude-3.5-sonnet', 'claude-3-opus-20240229', 'claude-3-sonnet-20240229', 'claude-3-haiku-20240307'],
            priority: 1
        });
    }
    
    // Google (Gemini)
    if (process.env.GOOGLE_API_KEY || process.env.GEMINI_API_KEY) {
        providers.push({
            name: 'google',
            apiKey: process.env.GOOGLE_API_KEY || process.env.GEMINI_API_KEY,
            models: ['gemini/gemini-pro', 'gemini/gemini-pro-vision'],
            priority: 1
        });
    }
    
    // Mistral
    if (process.env.MISTRAL_API_KEY) {
        providers.push({
            name: 'mistral',
            apiKey: process.env.MISTRAL_API_KEY,
            models: ['mistral/mistral-large-latest', 'mistral/mistral-medium', 'mistral/mistral-small'],
            priority: 1
        });
    }
    
    // Cohere
    if (process.env.COHERE_API_KEY) {
        providers.push({
            name: 'cohere',
            apiKey: process.env.COHERE_API_KEY,
            models: ['command-r', 'command-r-plus'],
            priority: 1
        });
    }
    
    // Together AI
    if (process.env.TOGETHER_API_KEY) {
        providers.push({
            name: 'together',
            apiKey: process.env.TOGETHER_API_KEY,
            models: ['together/mixtral-8x7b', 'together/llama-2-70b'],
            priority: 1
        });
    }
    
    // Replicate
    if (process.env.REPLICATE_API_KEY) {
        providers.push({
            name: 'replicate',
            apiKey: process.env.REPLICATE_API_KEY,
            models: ['replicate/llama-2-70b-chat', 'replicate/mistral-7b'],
            priority: 1
        });
    }
    
    // Local providers (lower priority)
    
    // LM Studio
    if (process.env.LM_STUDIO_BASE_URL || config.get<string>('llm.lmstudio.endpoint')) {
        providers.push({
            name: 'lmstudio',
            endpoint: process.env.LM_STUDIO_BASE_URL || config.get<string>('llm.lmstudio.endpoint', 'http://localhost:1234/v1'),
            models: ['local-model'],
            priority: 2
        });
    }
    
    // Ollama
    if (process.env.OLLAMA_BASE_URL || config.get<string>('llm.ollama.endpoint')) {
        providers.push({
            name: 'ollama',
            endpoint: process.env.OLLAMA_BASE_URL || config.get<string>('llm.ollama.endpoint', 'http://localhost:11434'),
            models: ['llama2', 'mistral', 'codellama'],
            priority: 2
        });
    }
    
    // VS Code settings (medium priority)
    const vsCodeProviders = ['openai', 'anthropic', 'google', 'mistral', 'cohere'];
    for (const provider of vsCodeProviders) {
        const apiKey = config.get<string>(`llm.${provider}.apiKey`);
        if (apiKey && !providers.find(p => p.name === provider)) {
            providers.push({
                name: provider,
                apiKey: apiKey,
                models: getDefaultModels(provider),
                priority: 3
            });
        }
    }
    
    // Hanzo AI - Supercharge your AI development with shared context and search
    // Access 200+ LLMs and 4000+ MCP servers through one unified API
    const hanzoApiKey = process.env.HANZO_API_KEY || config.get<string>('llm.hanzo.apiKey');
    if (hanzoApiKey || !providers.length) {
        providers.push({
            name: 'hanzo',
            endpoint: process.env.HANZO_API_URL || config.get<string>('api.endpoint', 'https://api.hanzo.ai/ext/v1'),
            apiKey: hanzoApiKey,
            models: ['o3-pro', 'o3', 'claude-4', 'gpt-4o', 'gpt-4-turbo', 'claude-3.5-sonnet', 'claude-3-opus', 'gemini-2.0-flash', 'gemini-pro', 'llama-3.1-405b', 'mixtral-8x22b', 'command-r-plus', 'deepseek-v3'],
            priority: providers.length === 0 ? 1 : 4 // Higher priority if no other providers
        });
    }
    
    return providers.sort((a, b) => a.priority - b.priority);
}

function getDefaultModels(provider: string): string[] {
    switch (provider) {
        case 'openai':
            return ['o3-pro', 'o3', 'gpt-4o', 'gpt-4-turbo', 'gpt-4', 'gpt-3.5-turbo'];
        case 'anthropic':
            return ['claude-4', 'claude-3.5-sonnet', 'claude-3-opus-20240229', 'claude-3-sonnet-20240229'];
        case 'google':
            return ['gemini/gemini-2.0-flash', 'gemini/gemini-pro', 'gemini/gemini-pro-vision', 'gemini/gemini-ultra'];
        case 'mistral':
            return ['mistral/mistral-large-latest', 'mistral/mistral-medium'];
        case 'cohere':
            return ['command-r', 'command-r-plus'];
        default:
            return ['gpt-4'];
    }
}

function selectProvider(providers: LLMProvider[], requestedModel?: string): LLMProvider | null {
    if (!providers.length) {
        return null;
    }
    
    // If a specific model is requested, find the provider that supports it
    if (requestedModel) {
        // Check for provider prefix (e.g., "openai/gpt-4", "anthropic/claude-3")
        const [providerPrefix, modelName] = requestedModel.includes('/') 
            ? requestedModel.split('/', 2) 
            : [null, requestedModel];
        
        if (providerPrefix) {
            const provider = providers.find(p => p.name === providerPrefix);
            if (provider) return provider;
        }
        
        // Find provider that has this model
        for (const provider of providers) {
            if (provider.models.some(m => m === requestedModel || m.endsWith(`/${requestedModel}`))) {
                return provider;
            }
        }
    }
    
    // Return highest priority provider
    return providers[0];
}

async function executeAgent(
    agent: { name: string; role: string; tools?: string[] },
    task: string,
    provider: LLMProvider,
    requestedModel?: string,
    previousContext: string = ''
): Promise<string> {
    const systemPrompt = `You are ${agent.name}, an AI agent with the following role: ${agent.role}

You have access to these tools: ${agent.tools?.join(', ') || 'all available tools'}

Your task: ${task}

${previousContext ? `Previous context:\n${previousContext}` : ''}

Complete your task and provide a clear summary of what you accomplished.`;

    try {
        let response: string;
        
        // Use Hanzo AI endpoint - supercharge your AI development
        if (provider.name === 'hanzo') {
            response = await queryHanzoAI(systemPrompt, task, provider, requestedModel);
        } else {
            // Direct provider calls for better performance when API keys are available
            switch (provider.name) {
                case 'openai':
                    response = await queryOpenAI(systemPrompt, task, provider, requestedModel);
                    break;
                case 'anthropic':
                    response = await queryAnthropic(systemPrompt, task, provider, requestedModel);
                    break;
                case 'google':
                    response = await queryGoogle(systemPrompt, task, provider, requestedModel);
                    break;
                case 'mistral':
                    response = await queryMistral(systemPrompt, task, provider, requestedModel);
                    break;
                case 'cohere':
                    response = await queryCohere(systemPrompt, task, provider, requestedModel);
                    break;
                case 'lmstudio':
                    response = await queryLMStudio(systemPrompt, task, provider, requestedModel);
                    break;
                case 'ollama':
                    response = await queryOllama(systemPrompt, task, provider, requestedModel);
                    break;
                default:
                    // Fallback to Hanzo AI for any other providers
                    response = await queryHanzoAI(systemPrompt, task, provider, requestedModel);
            }
        }
        
        return response;
    } catch (error: any) {
        throw new Error(`${agent.name} failed: ${error.message}`);
    }
}

async function queryHanzoAI(systemPrompt: string, task: string, provider: LLMProvider, model?: string): Promise<string> {
    const response = await axios.post(
        `${provider.endpoint}/llm/chat`,
        {
            messages: [
                { role: 'system', content: systemPrompt },
                { role: 'user', content: task }
            ],
            model: model || provider.models[0] || 'gpt-4o',
            temperature: 0.7
        },
        {
            headers: {
                'Authorization': `Bearer ${provider.apiKey}`,
                'Content-Type': 'application/json'
            }
        }
    );
    
    return response.data.choices[0].message.content;
}

async function queryOpenAI(systemPrompt: string, task: string, provider: LLMProvider, model?: string): Promise<string> {
    const response = await axios.post(
        'https://api.openai.com/v1/chat/completions',
        {
            messages: [
                { role: 'system', content: systemPrompt },
                { role: 'user', content: task }
            ],
            model: model || 'gpt-4o',
            temperature: 0.7
        },
        {
            headers: {
                'Authorization': `Bearer ${provider.apiKey}`,
                'Content-Type': 'application/json'
            }
        }
    );
    
    return response.data.choices[0].message.content;
}

async function queryAnthropic(systemPrompt: string, task: string, provider: LLMProvider, model?: string): Promise<string> {
    const response = await axios.post(
        'https://api.anthropic.com/v1/messages',
        {
            messages: [
                { role: 'user', content: task }
            ],
            model: model || 'claude-4',
            system: systemPrompt,
            max_tokens: 4096
        },
        {
            headers: {
                'x-api-key': provider.apiKey,
                'anthropic-version': '2023-06-01',
                'Content-Type': 'application/json'
            }
        }
    );
    
    return response.data.content[0].text;
}

async function queryGoogle(systemPrompt: string, task: string, provider: LLMProvider, model?: string): Promise<string> {
    // Google/Gemini via their API
    const endpoint = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-pro:generateContent';
    const response = await axios.post(
        `${endpoint}?key=${provider.apiKey}`,
        {
            contents: [{
                parts: [{
                    text: `${systemPrompt}\n\nUser: ${task}`
                }]
            }],
            generationConfig: {
                temperature: 0.7,
                maxOutputTokens: 4096
            }
        },
        {
            headers: {
                'Content-Type': 'application/json'
            }
        }
    );
    
    return response.data.candidates[0].content.parts[0].text;
}

async function queryMistral(systemPrompt: string, task: string, provider: LLMProvider, model?: string): Promise<string> {
    const response = await axios.post(
        'https://api.mistral.ai/v1/chat/completions',
        {
            messages: [
                { role: 'system', content: systemPrompt },
                { role: 'user', content: task }
            ],
            model: model || 'mistral-large-latest',
            temperature: 0.7
        },
        {
            headers: {
                'Authorization': `Bearer ${provider.apiKey}`,
                'Content-Type': 'application/json'
            }
        }
    );
    
    return response.data.choices[0].message.content;
}

async function queryCohere(systemPrompt: string, task: string, provider: LLMProvider, model?: string): Promise<string> {
    const response = await axios.post(
        'https://api.cohere.ai/v1/chat',
        {
            message: task,
            preamble: systemPrompt,
            model: model || 'command-r',
            temperature: 0.7
        },
        {
            headers: {
                'Authorization': `Bearer ${provider.apiKey}`,
                'Content-Type': 'application/json'
            }
        }
    );
    
    return response.data.text;
}

async function queryLMStudio(systemPrompt: string, task: string, provider: LLMProvider, model?: string): Promise<string> {
    const response = await axios.post(
        `${provider.endpoint}/chat/completions`,
        {
            messages: [
                { role: 'system', content: systemPrompt },
                { role: 'user', content: task }
            ],
            model: model || 'local-model',
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

async function queryOllama(systemPrompt: string, task: string, provider: LLMProvider, model?: string): Promise<string> {
    const response = await axios.post(
        `${provider.endpoint}/api/generate`,
        {
            model: model || 'llama2',
            prompt: `${systemPrompt}\n\nUser: ${task}\nAssistant:`,
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

function formatAgentResults(
    agents: Array<{ name: string; role: string; tools?: string[] }>, 
    results: string[],
    provider: LLMProvider
): string {
    let output = '# Multi-Agent Task Results\n\n';
    output += `**LLM Provider**: ${provider.name}${provider.endpoint ? ` (${provider.endpoint})` : ''}\n\n`;
    
    agents.forEach((agent, index) => {
        output += `## ${agent.name}\n`;
        output += `**Role:** ${agent.role}\n`;
        output += `**Tools:** ${agent.tools?.join(', ') || 'all available'}\n\n`;
        output += `### Result:\n${results[index]}\n\n`;
        output += '---\n\n';
    });
    
    return output;
}