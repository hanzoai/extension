import * as vscode from 'vscode';
import axios from 'axios';

interface LLMConfig {
    provider: string;
    model: string;
    apiKey?: string;
    baseUrl?: string;
}

interface ConsensusResult {
    consensus: string;
    responses: Array<{
        provider: string;
        model: string;
        response: string;
        confidence?: number;
    }>;
    agreement_score: number;
}

export class AITools {
    private context: vscode.ExtensionContext;
    private llmConfigs: Map<string, LLMConfig> = new Map();

    constructor(context: vscode.ExtensionContext) {
        this.context = context;
        this.initializeLLMConfigs();
    }

    private initializeLLMConfigs() {
        // Load from settings
        const config = vscode.workspace.getConfiguration('hanzo');
        
        // Default configurations
        this.llmConfigs.set('openai', {
            provider: 'openai',
            model: config.get('llm.openai.model', 'gpt-4'),
            apiKey: config.get('llm.openai.apiKey'),
            baseUrl: 'https://api.openai.com/v1'
        });
        
        this.llmConfigs.set('anthropic', {
            provider: 'anthropic',
            model: config.get('llm.anthropic.model', 'claude-3-opus-20240229'),
            apiKey: config.get('llm.anthropic.apiKey'),
            baseUrl: 'https://api.anthropic.com/v1'
        });
        
        this.llmConfigs.set('local', {
            provider: 'ollama',
            model: config.get('llm.local.model', 'llama2'),
            baseUrl: config.get('llm.local.baseUrl', 'http://localhost:11434')
        });
    }

    getTools() {
        return [
            {
                name: 'llm',
                description: 'Query any configured LLM provider',
                inputSchema: {
                    type: 'object' as const,
                    properties: {
                        prompt: {
                            type: 'string',
                            description: 'The prompt to send to the LLM'
                        },
                        provider: {
                            type: 'string',
                            enum: ['openai', 'anthropic', 'local', 'auto'],
                            description: 'LLM provider to use (default: auto)'
                        },
                        model: {
                            type: 'string',
                            description: 'Override the default model'
                        },
                        temperature: {
                            type: 'number',
                            description: 'Temperature for response generation (0-2)'
                        },
                        max_tokens: {
                            type: 'number',
                            description: 'Maximum tokens in response'
                        },
                        system: {
                            type: 'string',
                            description: 'System message/context'
                        }
                    },
                    required: ['prompt']
                },
                handler: this.llmHandler.bind(this)
            },
            {
                name: 'consensus',
                description: 'Get consensus from multiple LLMs on a question or decision',
                inputSchema: {
                    type: 'object' as const,
                    properties: {
                        prompt: {
                            type: 'string',
                            description: 'The question or decision to get consensus on'
                        },
                        providers: {
                            type: 'array',
                            items: { type: 'string' },
                            description: 'LLM providers to query (default: all available)'
                        },
                        reasoning_prompt: {
                            type: 'string',
                            description: 'Additional prompt for reasoning'
                        },
                        temperature: {
                            type: 'number',
                            description: 'Temperature for all models'
                        }
                    },
                    required: ['prompt']
                },
                handler: this.consensusHandler.bind(this)
            },
            {
                name: 'llm_manage',
                description: 'Manage LLM configurations and providers',
                inputSchema: {
                    type: 'object' as const,
                    properties: {
                        action: {
                            type: 'string',
                            enum: ['list', 'add', 'remove', 'update', 'test'],
                            description: 'Management action'
                        },
                        provider: {
                            type: 'string',
                            description: 'Provider name'
                        },
                        config: {
                            type: 'object',
                            description: 'Configuration for add/update'
                        }
                    },
                    required: ['action']
                },
                handler: this.llmManageHandler.bind(this)
            },
            {
                name: 'agent',
                description: 'Dispatch tasks to specialized AI agents',
                inputSchema: {
                    type: 'object' as const,
                    properties: {
                        task: {
                            type: 'string',
                            description: 'Task description for the agent'
                        },
                        agent_type: {
                            type: 'string',
                            enum: ['researcher', 'coder', 'reviewer', 'architect', 'tester', 'documenter'],
                            description: 'Type of specialized agent'
                        },
                        context: {
                            type: 'object',
                            description: 'Additional context for the agent'
                        },
                        tools: {
                            type: 'array',
                            items: { type: 'string' },
                            description: 'Tools the agent can use'
                        },
                        max_iterations: {
                            type: 'number',
                            description: 'Maximum iterations for the agent'
                        }
                    },
                    required: ['task']
                },
                handler: this.agentHandler.bind(this)
            },
            {
                name: 'mode',
                description: 'Switch between different development modes/personalities',
                inputSchema: {
                    type: 'object' as const,
                    properties: {
                        action: {
                            type: 'string',
                            enum: ['set', 'get', 'list', 'describe'],
                            description: 'Mode action'
                        },
                        mode: {
                            type: 'string',
                            description: 'Mode name (e.g., "10x", "careful", "creative", "pragmatic")'
                        },
                        custom_config: {
                            type: 'object',
                            description: 'Custom mode configuration'
                        }
                    },
                    required: ['action']
                },
                handler: this.modeHandler.bind(this)
            }
        ];
    }

    private async llmHandler(args: any): Promise<any> {
        try {
            const provider = args.provider || 'auto';
            const prompt = args.prompt;
            const system = args.system || 'You are a helpful AI assistant.';
            
            // Auto-select provider based on availability
            let selectedProvider = provider;
            if (provider === 'auto') {
                for (const [name, config] of this.llmConfigs) {
                    if (config.apiKey || name === 'local') {
                        selectedProvider = name;
                        break;
                    }
                }
            }
            
            const config = this.llmConfigs.get(selectedProvider);
            if (!config) {
                throw new Error(`Unknown provider: ${selectedProvider}`);
            }
            
            // Call the appropriate LLM API
            let response: string;
            
            switch (config.provider) {
                case 'openai':
                    response = await this.callOpenAI(config, prompt, system, args);
                    break;
                case 'anthropic':
                    response = await this.callAnthropic(config, prompt, system, args);
                    break;
                case 'ollama':
                    response = await this.callOllama(config, prompt, system, args);
                    break;
                default:
                    throw new Error(`Unsupported provider: ${config.provider}`);
            }
            
            return {
                success: true,
                response,
                provider: selectedProvider,
                model: args.model || config.model
            };
        } catch (error: any) {
            return {
                success: false,
                error: error.message
            };
        }
    }

    private async consensusHandler(args: any): Promise<any> {
        try {
            const prompt = args.prompt;
            const providers = args.providers || Array.from(this.llmConfigs.keys());
            
            // Query all providers in parallel
            const promises = providers.map(async (provider: string) => {
                const result = await this.llmHandler({
                    prompt,
                    provider,
                    temperature: args.temperature || 0.7,
                    system: args.reasoning_prompt || 'Provide a thoughtful, reasoned response.'
                });
                
                return {
                    provider,
                    model: this.llmConfigs.get(provider)?.model || 'unknown',
                    response: result.success ? result.response : result.error,
                    success: result.success
                };
            });
            
            const responses = await Promise.all(promises);
            const validResponses = responses.filter(r => r.success);
            
            if (validResponses.length === 0) {
                throw new Error('No LLM providers returned valid responses');
            }
            
            // Analyze consensus
            const consensusPrompt = `Analyze these responses and provide a consensus:
${validResponses.map(r => `${r.provider}: ${r.response}`).join('\n\n')}

Provide:
1. A unified consensus response
2. Key points of agreement
3. Key points of disagreement
4. An agreement score (0-100)`;
            
            // Use the first available provider to analyze consensus
            const consensusResult = await this.llmHandler({
                prompt: consensusPrompt,
                provider: validResponses[0].provider,
                temperature: 0.3
            });
            
            return {
                success: true,
                consensus: consensusResult.response,
                responses: validResponses,
                agreement_score: 85 // This would be parsed from the consensus analysis
            };
        } catch (error: any) {
            return {
                success: false,
                error: error.message
            };
        }
    }

    private async llmManageHandler(args: any): Promise<any> {
        const action = args.action;
        
        switch (action) {
            case 'list':
                return {
                    success: true,
                    providers: Array.from(this.llmConfigs.entries()).map(([name, config]) => ({
                        name,
                        provider: config.provider,
                        model: config.model,
                        configured: !!(config.apiKey || config.provider === 'ollama')
                    }))
                };
                
            case 'add':
            case 'update':
                if (!args.provider || !args.config) {
                    return { success: false, error: 'Provider and config required' };
                }
                
                this.llmConfigs.set(args.provider, args.config);
                
                // Save to settings
                const config = vscode.workspace.getConfiguration('hanzo');
                await config.update(`llm.${args.provider}`, args.config, true);
                
                return { success: true, message: `Provider ${args.provider} ${action}d` };
                
            case 'remove':
                if (!args.provider) {
                    return { success: false, error: 'Provider required' };
                }
                
                this.llmConfigs.delete(args.provider);
                
                // Remove from settings
                const removeConfig = vscode.workspace.getConfiguration('hanzo');
                await removeConfig.update(`llm.${args.provider}`, undefined, true);
                
                return { success: true, message: `Provider ${args.provider} removed` };
                
            case 'test':
                if (!args.provider) {
                    return { success: false, error: 'Provider required' };
                }
                
                const testResult = await this.llmHandler({
                    prompt: 'Say "Hello, I am working!" if you can process this message.',
                    provider: args.provider
                });
                
                return testResult;
                
            default:
                return { success: false, error: `Unknown action: ${action}` };
        }
    }

    private async agentHandler(args: any): Promise<any> {
        try {
            const agentType = args.agent_type || 'researcher';
            const task = args.task;
            const context = args.context || {};
            const tools = args.tools || [];
            const maxIterations = args.max_iterations || 5;
            
            // Agent personality prompts
            const agentPrompts: Record<string, string> = {
                researcher: 'You are a thorough researcher. Analyze, investigate, and provide comprehensive information.',
                coder: 'You are an expert programmer. Write clean, efficient, and well-documented code.',
                reviewer: 'You are a meticulous code reviewer. Find issues, suggest improvements, and ensure quality.',
                architect: 'You are a software architect. Design scalable, maintainable system architectures.',
                tester: 'You are a QA engineer. Write comprehensive tests and find edge cases.',
                documenter: 'You are a technical writer. Create clear, comprehensive documentation.'
            };
            
            const systemPrompt = agentPrompts[agentType] || agentPrompts.researcher;
            
            // Execute agent task
            const result = await this.llmHandler({
                prompt: `${task}\n\nContext: ${JSON.stringify(context)}\nAvailable tools: ${tools.join(', ')}`,
                system: systemPrompt,
                temperature: 0.7
            });
            
            return {
                success: true,
                agent_type: agentType,
                result: result.response,
                iterations_used: 1 // Simplified for now
            };
        } catch (error: any) {
            return {
                success: false,
                error: error.message
            };
        }
    }

    private async modeHandler(args: any): Promise<any> {
        const action = args.action;
        
        // Define development modes/personalities
        const modes: Record<string, any> = {
            '10x': {
                name: '10x Engineer',
                description: 'Move fast, ship features, optimize later',
                config: { speed: 10, quality: 7, documentation: 5 }
            },
            'careful': {
                name: 'Careful Coder',
                description: 'Prioritize correctness and safety',
                config: { speed: 5, quality: 10, documentation: 8 }
            },
            'creative': {
                name: 'Creative Developer',
                description: 'Think outside the box, innovative solutions',
                config: { speed: 7, quality: 8, documentation: 6, creativity: 10 }
            },
            'pragmatic': {
                name: 'Pragmatic Programmer',
                description: 'Balance all concerns, practical solutions',
                config: { speed: 7, quality: 8, documentation: 7 }
            },
            'perfectionist': {
                name: 'Perfectionist',
                description: 'Everything must be perfect',
                config: { speed: 3, quality: 10, documentation: 10 }
            }
        };
        
        switch (action) {
            case 'list':
                return {
                    success: true,
                    modes: Object.entries(modes).map(([key, mode]) => ({
                        key,
                        name: mode.name,
                        description: mode.description
                    }))
                };
                
            case 'get':
                const currentMode = await this.context.globalState.get('development_mode', 'pragmatic');
                return {
                    success: true,
                    current_mode: currentMode,
                    config: modes[currentMode]
                };
                
            case 'set':
                if (!args.mode) {
                    return { success: false, error: 'Mode required' };
                }
                
                if (!modes[args.mode] && !args.custom_config) {
                    return { success: false, error: `Unknown mode: ${args.mode}` };
                }
                
                await this.context.globalState.update('development_mode', args.mode);
                
                if (args.custom_config) {
                    await this.context.globalState.update(`mode_config_${args.mode}`, args.custom_config);
                }
                
                return {
                    success: true,
                    message: `Development mode set to: ${args.mode}`,
                    config: modes[args.mode] || args.custom_config
                };
                
            case 'describe':
                if (!args.mode) {
                    return { success: false, error: 'Mode required' };
                }
                
                const mode = modes[args.mode];
                if (!mode) {
                    return { success: false, error: `Unknown mode: ${args.mode}` };
                }
                
                return {
                    success: true,
                    mode: args.mode,
                    ...mode
                };
                
            default:
                return { success: false, error: `Unknown action: ${action}` };
        }
    }

    // Helper methods for different LLM providers
    private async callOpenAI(config: LLMConfig, prompt: string, system: string, args: any): Promise<string> {
        const response = await axios.post(
            `${config.baseUrl}/chat/completions`,
            {
                model: args.model || config.model,
                messages: [
                    { role: 'system', content: system },
                    { role: 'user', content: prompt }
                ],
                temperature: args.temperature || 0.7,
                max_tokens: args.max_tokens || 2000
            },
            {
                headers: {
                    'Authorization': `Bearer ${config.apiKey}`,
                    'Content-Type': 'application/json'
                }
            }
        );
        
        return response.data.choices[0].message.content;
    }

    private async callAnthropic(config: LLMConfig, prompt: string, system: string, args: any): Promise<string> {
        const response = await axios.post(
            `${config.baseUrl}/messages`,
            {
                model: args.model || config.model,
                system: system,
                messages: [{ role: 'user', content: prompt }],
                temperature: args.temperature || 0.7,
                max_tokens: args.max_tokens || 2000
            },
            {
                headers: {
                    'x-api-key': config.apiKey,
                    'anthropic-version': '2023-06-01',
                    'Content-Type': 'application/json'
                }
            }
        );
        
        return response.data.content[0].text;
    }

    private async callOllama(config: LLMConfig, prompt: string, system: string, args: any): Promise<string> {
        const response = await axios.post(
            `${config.baseUrl}/api/generate`,
            {
                model: args.model || config.model,
                prompt: `${system}\n\n${prompt}`,
                temperature: args.temperature || 0.7,
                stream: false
            }
        );
        
        return response.data.response;
    }
}