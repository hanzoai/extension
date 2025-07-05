import * as vscode from 'vscode';
import { MCPTool } from '../server';

interface DevelopmentMode {
    name: string;
    programmer: string;
    description: string;
    philosophy?: string;
    tools: string[];
    environment?: Record<string, string>;
    config?: Record<string, any>;
}

const DEVELOPMENT_MODES: Record<string, DevelopmentMode> = {
    // Language Creators
    'guido': {
        name: 'guido',
        programmer: 'Guido van Rossum',
        description: 'Python creator - readability counts',
        philosophy: 'There should be one-- and preferably only one --obvious way to do it',
        tools: ['read', 'write', 'edit', 'grep', 'symbols', 'uvx', 'think'],
        config: { readability: 10, simplicity: 9, explicitness: 10 }
    },
    'linus': {
        name: 'linus',
        programmer: 'Linus Torvalds',
        description: 'Linux kernel creator - no-nonsense performance',
        philosophy: 'Talk is cheap. Show me the code.',
        tools: ['read', 'write', 'edit', 'grep', 'git_search', 'bash', 'processes', 'critic'],
        config: { performance: 10, directness: 10, patience: 2 }
    },
    'brendan': {
        name: 'brendan',
        programmer: 'Brendan Eich',
        description: 'JavaScript creator - move fast and evolve',
        philosophy: 'Always bet on JavaScript',
        tools: ['read', 'write', 'edit', 'grep', 'symbols', 'npx', 'web_fetch'],
        config: { speed: 10, flexibility: 9, backwards_compatibility: 8 }
    },
    
    // Special Configurations
    'fullstack': {
        name: 'fullstack',
        programmer: 'Full Stack Developer',
        description: 'Frontend to backend, databases to deployment',
        tools: ['read', 'write', 'edit', 'grep', 'symbols', 'bash', 'npx', 'uvx', 
                'sql_query', 'web_fetch', 'todo', 'git_search'],
        config: { versatility: 10, breadth: 9, depth: 7 }
    },
    'minimal': {
        name: 'minimal',
        programmer: 'Minimalist',
        description: 'Less is more - only essential tools',
        tools: ['read', 'write', 'edit', 'grep', 'bash'],
        config: { simplicity: 10, focus: 10, feature_creep: 0 }
    },
    '10x': {
        name: '10x',
        programmer: '10x Engineer',
        description: 'Maximum productivity, all tools enabled',
        tools: ['read', 'write', 'edit', 'multi_edit', 'grep', 'symbols', 'git_search',
                'bash', 'npx', 'uvx', 'batch', 'agent', 'llm', 'consensus', 'think', 'critic'],
        config: { productivity: 10, tool_mastery: 10, work_life_balance: 3 }
    },
    'security': {
        name: 'security',
        programmer: 'Security Engineer',
        description: 'Security first, paranoid by design',
        tools: ['read', 'grep', 'git_search', 'bash', 'processes', 'critic', 'think'],
        config: { paranoia: 10, validation: 10, trust: 0 }
    },
    'data_scientist': {
        name: 'data_scientist',
        programmer: 'Data Scientist',
        description: 'Data analysis and machine learning focused',
        tools: ['read', 'write', 'edit', 'notebook_read', 'notebook_edit', 'uvx', 
                'sql_query', 'vector_search', 'think'],
        config: { analysis: 10, visualization: 8, statistics: 9 }
    },
    'hanzo': {
        name: 'hanzo',
        programmer: 'Hanzo AI',
        description: 'Hanzo AI optimal configuration',
        philosophy: 'Building the future of AI development',
        tools: ['read', 'write', 'edit', 'multi_edit', 'grep', 'symbols', 'git_search',
                'bash', 'npx', 'uvx', 'batch', 'agent', 'llm', 'consensus', 'think', 
                'critic', 'todo', 'sql_query', 'vector_search', 'web_fetch'],
        config: { innovation: 10, collaboration: 9, excellence: 10 }
    }
};

export function createModeTool(context: vscode.ExtensionContext): MCPTool {
    // Load current mode from context
    const getCurrentMode = () => {
        return context.globalState.get<string>('hanzo.developmentMode', 'fullstack');
    };
    
    const setCurrentMode = async (modeName: string) => {
        await context.globalState.update('hanzo.developmentMode', modeName);
        // Also update enabled tools based on mode
        const mode = DEVELOPMENT_MODES[modeName];
        if (mode) {
            const config = vscode.workspace.getConfiguration('hanzo.mcp');
            await config.update('enabledTools', mode.tools, true);
        }
    };
    
    return {
        name: 'mode',
        description: 'Manage development modes (programmer personalities)',
        inputSchema: {
            type: 'object',
            properties: {
                action: {
                    type: 'string',
                    enum: ['list', 'activate', 'show', 'current'],
                    description: 'Action to perform (default: list)'
                },
                name: {
                    type: 'string',
                    description: 'Mode name (for activate/show actions)'
                }
            }
        },
        handler: async (args: { action?: string; name?: string }) => {
            const action = args.action || 'list';
            
            switch (action) {
                case 'list': {
                    const currentMode = getCurrentMode();
                    let output = 'Available development modes:\n\n';
                    
                    // Group modes by category
                    const categories = {
                        'Language Creators': ['guido', 'linus', 'brendan'],
                        'Special Configurations': ['fullstack', 'minimal', '10x', 'security', 
                                                   'data_scientist', 'hanzo']
                    };
                    
                    for (const [category, modeNames] of Object.entries(categories)) {
                        output += `**${category}**:\n`;
                        for (const modeName of modeNames) {
                            const mode = DEVELOPMENT_MODES[modeName];
                            if (mode) {
                                const marker = currentMode === modeName ? ' *(active)*' : '';
                                output += `- **${mode.name}**${marker}: ${mode.programmer} - ${mode.description}\n`;
                            }
                        }
                        output += '\n';
                    }
                    
                    output += `\nCurrent mode: **${currentMode}**\n`;
                    output += "\nUse 'mode --action activate --name <mode>' to activate a mode";
                    
                    return output;
                }
                
                case 'activate': {
                    if (!args.name) {
                        throw new Error('Mode name required for activate action');
                    }
                    
                    const mode = DEVELOPMENT_MODES[args.name];
                    if (!mode) {
                        throw new Error(`Unknown mode: ${args.name}`);
                    }
                    
                    await setCurrentMode(args.name);
                    
                    let output = `Activated mode: **${mode.name}**\n`;
                    output += `Programmer: ${mode.programmer}\n`;
                    output += `Description: ${mode.description}\n`;
                    
                    if (mode.philosophy) {
                        output += `Philosophy: *"${mode.philosophy}"*\n`;
                    }
                    
                    output += `\nEnabled tools (${mode.tools.length}):\n`;
                    output += mode.tools.map(t => `- ${t}`).join('\n');
                    
                    if (mode.environment) {
                        output += '\n\nEnvironment variables:\n';
                        for (const [key, value] of Object.entries(mode.environment)) {
                            output += `- ${key}=${value}\n`;
                        }
                    }
                    
                    output += '\n\n*Note: Tool configuration has been updated. Restart the MCP session for full effect.*';
                    
                    return output;
                }
                
                case 'show': {
                    if (!args.name) {
                        throw new Error('Mode name required for show action');
                    }
                    
                    const mode = DEVELOPMENT_MODES[args.name];
                    if (!mode) {
                        throw new Error(`Unknown mode: ${args.name}`);
                    }
                    
                    let output = `## Mode: ${mode.name}\n\n`;
                    output += `**Programmer**: ${mode.programmer}\n`;
                    output += `**Description**: ${mode.description}\n`;
                    
                    if (mode.philosophy) {
                        output += `**Philosophy**: *"${mode.philosophy}"*\n`;
                    }
                    
                    output += `\n### Tools (${mode.tools.length})\n`;
                    output += mode.tools.map(t => `- ${t}`).join('\n');
                    
                    if (mode.config) {
                        output += '\n\n### Configuration\n';
                        for (const [key, value] of Object.entries(mode.config)) {
                            output += `- ${key}: ${value}/10\n`;
                        }
                    }
                    
                    if (mode.environment) {
                        output += '\n\n### Environment\n';
                        for (const [key, value] of Object.entries(mode.environment)) {
                            output += `- ${key}=${value}\n`;
                        }
                    }
                    
                    return output;
                }
                
                case 'current': {
                    const currentModeName = getCurrentMode();
                    const mode = DEVELOPMENT_MODES[currentModeName];
                    
                    if (!mode) {
                        return `Current mode: ${currentModeName} (custom mode)`;
                    }
                    
                    let output = `Current mode: **${mode.name}**\n`;
                    output += `Programmer: ${mode.programmer}\n`;
                    output += `Description: ${mode.description}\n`;
                    
                    if (mode.philosophy) {
                        output += `Philosophy: *"${mode.philosophy}"*\n`;
                    }
                    
                    output += `Enabled tools: ${mode.tools.length}`;
                    
                    return output;
                }
                
                default:
                    throw new Error(`Unknown action: ${action}. Use 'list', 'activate', 'show', or 'current'`);
            }
        }
    };
}