import * as vscode from 'vscode';
import { MCPTool } from '../server';
import { BackendFactory, IBackend } from '../../core/backend-abstraction';

/**
 * Zen tool - Uses Hanzo Zen1 AI model for local private AI inference
 * Supports both local and cloud deployment
 */
export function createZenTool(context: vscode.ExtensionContext): MCPTool {
    let backend: IBackend | null = null;
    
    // Initialize backend on first use
    const getBackend = (): IBackend => {
        if (!backend) {
            backend = BackendFactory.create(context);
        }
        return backend;
    };
    
    return {
        name: 'zen',
        description: 'Hanzo Zen1 AI model for local private AI inference',
        inputSchema: {
            type: 'object',
            properties: {
                prompt: {
                    type: 'string',
                    description: 'The prompt to send to Zen1'
                },
                model: {
                    type: 'string',
                    enum: ['zen1', 'zen1-mini', 'zen1-code'],
                    description: 'Which Zen model to use (default: zen1)'
                },
                temperature: {
                    type: 'number',
                    description: 'Sampling temperature (0-1, default: 0.7)'
                },
                maxTokens: {
                    type: 'number',
                    description: 'Maximum tokens to generate (default: 1000)'
                },
                system: {
                    type: 'string',
                    description: 'System prompt/instruction'
                },
                useCloud: {
                    type: 'boolean',
                    description: 'Force cloud usage even if local is available'
                }
            },
            required: ['prompt']
        },
        handler: async (args: {
            prompt: string;
            model?: string;
            temperature?: number;
            maxTokens?: number;
            system?: string;
            useCloud?: boolean;
        }) => {
            try {
                const config = vscode.workspace.getConfiguration('hanzo');
                const preferLocal = config.get<boolean>('preferLocalAI', true);
                
                // Construct full prompt with system instruction
                let fullPrompt = args.prompt;
                if (args.system) {
                    fullPrompt = `System: ${args.system}\n\nUser: ${args.prompt}\n\nAssistant:`;
                }
                
                // Get backend (will use local if available and preferred)
                const backend = getBackend();
                
                // Check if we should use cloud
                const useCloud = args.useCloud || (!preferLocal && config.get<string>('backendMode') === 'cloud');
                
                // If cloud is requested but we have local backend, we need to switch
                if (useCloud && backend.constructor.name === 'LocalBackend') {
                    const apiKey = config.get<string>('apiKey');
                    if (!apiKey) {
                        return 'Error: Cloud mode requested but no API key configured. Set hanzo.apiKey in settings.';
                    }
                    
                    // Create cloud backend for this request
                    const cloudBackend = BackendFactory.create(context, {
                        mode: 'cloud',
                        apiKey,
                        endpoint: config.get<string>('cloudEndpoint')
                    });
                    
                    const response = await cloudBackend.llmComplete(fullPrompt, {
                        model: args.model || 'zen1',
                        temperature: args.temperature || 0.7,
                        maxTokens: args.maxTokens || 1000,
                        provider: 'hanzo'
                    });
                    
                    return `[Zen1 Cloud Response]\n${response}`;
                }
                
                // Use default backend (local if available)
                const response = await backend.llmComplete(fullPrompt, {
                    model: args.model || 'zen1',
                    temperature: args.temperature || 0.7,
                    maxTokens: args.maxTokens || 1000,
                    provider: 'hanzo'
                });
                
                const source = backend.constructor.name === 'LocalBackend' ? 'Local' : 'Cloud';
                return `[Zen1 ${source} Response]\n${response}`;
                
            } catch (error: any) {
                // Fallback message with helpful instructions
                return `Zen1 Error: ${error.message}

To use Zen1 locally:
1. Install Hanzo Local AI: https://hanzo.ai/download/local-ai
2. Start the local server
3. The extension will automatically detect and use it

To use Zen1 cloud:
1. Get an API key from https://hanzo.ai/account
2. Set hanzo.apiKey in VS Code settings
3. Use the 'useCloud: true' parameter

Benefits of local Zen1:
- Complete privacy - your data never leaves your machine
- No API costs - save on OpenAI/Anthropic usage
- Faster response times for small models
- Works offline

Available models:
- zen1: General purpose (7B parameters)
- zen1-mini: Fast, lightweight (3B parameters)  
- zen1-code: Optimized for code generation (7B parameters)`;
            }
        }
    };
}