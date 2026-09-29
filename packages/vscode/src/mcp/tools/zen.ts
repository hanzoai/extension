import * as vscode from 'vscode';
import { MCPTool } from '../server';
import { AuthManager } from '../../auth/manager';
import { complete, Message, MODEL } from '../../api/chat';

// The Zen 5 family as catalog.hanzo.ai prices it, zen5 first; api.hanzo.ai/v1/models lists each.
const MODELS = [MODEL, 'zen5-flash', 'zen5-mini', 'zen5-coder', 'zen5-pro'];

/** Zen tool - asks a Zen model on api.hanzo.ai. */
export function createZenTool(context: vscode.ExtensionContext): MCPTool {
    return {
        name: 'zen',
        description: 'Ask a Zen model on api.hanzo.ai',
        inputSchema: {
            type: 'object',
            properties: {
                prompt: {
                    type: 'string',
                    description: 'The prompt to send to Zen'
                },
                model: {
                    type: 'string',
                    enum: MODELS,
                    description: `Which Zen model to use (default: ${MODEL})`
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
        }) => {
            const messages: Message[] = [];
            if (args.system) {
                messages.push({ role: 'system', content: args.system });
            }
            messages.push({ role: 'user', content: args.prompt });
            try {
                return await complete(await AuthManager.getInstance(context).bearer(), messages, {
                    model: args.model || MODEL,
                    temperature: args.temperature || 0.7,
                    maxTokens: args.maxTokens || 1000
                });
            } catch (error: any) {
                return `Zen error: ${error.message}`;
            }
        }
    };
}
