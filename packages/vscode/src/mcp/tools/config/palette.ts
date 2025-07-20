import * as vscode from 'vscode';
import { MCPTool } from '../../server';

interface Palette {
    name: string;
    description: string;
    tools: string[];
    environment?: Record<string, string>;
}

const PALETTES: Record<string, Palette> = {
    minimal: {
        name: 'Minimal',
        description: 'Essential tools only',
        tools: ['read', 'write', 'edit', 'directory_tree', 'grep', 'run_command', 'think'],
        environment: {}
    },
    python: {
        name: 'Python Developer',
        description: 'Tools optimized for Python development',
        tools: [
            'read', 'write', 'edit', 'multi_edit', 'directory_tree', 'find_files',
            'grep', 'search', 'symbols', 'git_search',
            'run_command', 'process', 'open',
            'notebook_read', 'notebook_edit',
            'todo', 'think', 'batch'
        ],
        environment: {
            PYTHON_ENV: 'development'
        }
    },
    javascript: {
        name: 'JavaScript Developer',
        description: 'Tools for Node.js and web development',
        tools: [
            'read', 'write', 'edit', 'multi_edit', 'directory_tree', 'find_files',
            'grep', 'search', 'symbols', 'git_search',
            'run_command', 'process', 'npx', 'open',
            'todo', 'think', 'batch'
        ],
        environment: {
            NODE_ENV: 'development'
        }
    },
    devops: {
        name: 'DevOps Engineer',
        description: 'Infrastructure and operations tools',
        tools: [
            'read', 'write', 'edit', 'directory_tree', 'find_files',
            'grep', 'search', 'git_search',
            'run_command', 'process', 'open',
            'config', 'stats', 'think', 'batch'
        ],
        environment: {
            ENVIRONMENT: 'production'
        }
    },
    'data-science': {
        name: 'Data Scientist',
        description: 'Tools for data analysis and ML',
        tools: [
            'read', 'write', 'edit', 'directory_tree', 'find_files',
            'grep', 'search',
            'run_command', 'process',
            'notebook_read', 'notebook_edit',
            'vector_index', 'vector_search',
            'think', 'batch'
        ],
        environment: {
            JUPYTER_ENV: 'lab'
        }
    }
};

export function createPaletteTools(context: vscode.ExtensionContext): MCPTool[] {
    return [
        {
            name: 'palette',
            description: 'Switch tool palette/personality',
            inputSchema: {
                type: 'object',
                properties: {
                    action: {
                        type: 'string',
                        enum: ['list', 'activate', 'current', 'reset'],
                        description: 'Action to perform'
                    },
                    name: {
                        type: 'string',
                        description: 'Palette name (for activate action)'
                    }
                },
                required: ['action']
            },
            handler: async (args: { action: string; name?: string }) => {
                const PALETTE_KEY = 'hanzo.mcp.activePalette';
                
                switch (args.action) {
                    case 'list': {
                        const current = context.globalState.get<string>(PALETTE_KEY);
                        let output = 'Available palettes:\n\n';
                        
                        for (const [key, palette] of Object.entries(PALETTES)) {
                            const marker = key === current ? ' (active)' : '';
                            output += `${key}${marker}: ${palette.description}\n`;
                            output += `  Tools: ${palette.tools.length}\n`;
                            if (palette.environment && Object.keys(palette.environment).length > 0) {
                                output += `  Environment: ${Object.keys(palette.environment).join(', ')}\n`;
                            }
                            output += '\n';
                        }
                        
                        return output.trim();
                    }
                    
                    case 'activate': {
                        if (!args.name) {
                            return 'Error: Palette name required for activate action';
                        }
                        
                        const palette = PALETTES[args.name];
                        if (!palette) {
                            return `Error: Unknown palette '${args.name}'. Available: ${Object.keys(PALETTES).join(', ')}`;
                        }
                        
                        // Save active palette
                        await context.globalState.update(PALETTE_KEY, args.name);
                        
                        // Update enabled tools configuration
                        const config = vscode.workspace.getConfiguration('hanzo.mcp');
                        await config.update('enabledTools', palette.tools, true);
                        
                        // Apply environment variables
                        for (const [key, value] of Object.entries(palette.environment || {})) {
                            process.env[key] = value;
                        }
                        
                        return `Activated palette '${args.name}' with ${palette.tools.length} tools`;
                    }
                    
                    case 'current': {
                        const current = context.globalState.get<string>(PALETTE_KEY);
                        if (!current) {
                            return 'No palette currently active';
                        }
                        
                        const palette = PALETTES[current];
                        return `Current palette: ${current}\n` +
                               `Description: ${palette.description}\n` +
                               `Active tools: ${palette.tools.join(', ')}`;
                    }
                    
                    case 'reset': {
                        await context.globalState.update(PALETTE_KEY, undefined);
                        const config = vscode.workspace.getConfiguration('hanzo.mcp');
                        await config.update('enabledTools', undefined, true);
                        
                        return 'Palette reset to default configuration';
                    }
                    
                    default:
                        return `Error: Unknown action '${args.action}'`;
                }
            }
        }
    ];
}