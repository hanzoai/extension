import * as vscode from 'vscode';
import { MCPTool } from '../server';

interface UnixToolAlias {
    name: string;
    command: string;
    description?: string;
    args?: string[];
}

/** Creates, lists and removes Unix command aliases that modes can name as tools. */
export function createUnixAliasTools(context: vscode.ExtensionContext): MCPTool[] {
    return [
        {
            name: 'unix_alias',
            description: 'Create Unix tool aliases for use in modes - makes shell commands available as MCP tools',
            inputSchema: {
                type: 'object',
                properties: {
                    action: {
                        type: 'string',
                        enum: ['create', 'list', 'remove', 'execute'],
                        description: 'Alias action'
                    },
                    name: {
                        type: 'string',
                        description: 'Alias name'
                    },
                    command: {
                        type: 'string',
                        description: 'Unix command to alias'
                    },
                    description: {
                        type: 'string',
                        description: 'Description of what the command does'
                    },
                    args: {
                        type: 'array',
                        items: { type: 'string' },
                        description: 'Arguments for execute action'
                    }
                },
                required: ['action']
            },
            handler: async (args: any) => {
                const aliases = context.globalState.get<UnixToolAlias[]>('unix-aliases', []);

                switch (args.action) {
                    case 'create': {
                        if (!args.name || !args.command) {
                            return '❌ Name and command required for alias creation';
                        }

                        const newAlias: UnixToolAlias = {
                            name: args.name,
                            command: args.command,
                            description: args.description
                        };

                        const updated = [...aliases.filter(a => a.name !== args.name), newAlias];
                        await context.globalState.update('unix-aliases', updated);

                        return `✅ Created alias '${args.name}' → '${args.command}'
                        
This alias is now available as an MCP tool in modes!
Use in mode configuration: tools: ['${args.name}']`;
            }

                    case 'list':
                        if (aliases.length === 0) {
                            return 'No Unix aliases defined yet.';
                        }

                        return '# Unix Tool Aliases\n\n' + 
                            aliases.map(a => 
                                `- **${a.name}**: \`${a.command}\`${a.description ? `\n  ${a.description}` : ''}`
                            ).join('\n');

                    case 'remove': {
                        if (!args.name) {
                            return '❌ Name required for removal';
                        }

                        const filtered = aliases.filter(a => a.name !== args.name);
                        await context.globalState.update('unix-aliases', filtered);
                        return `✅ Removed alias '${args.name}'`;
            }

                    case 'execute': {
                        if (!args.name) {
                            return '❌ Name required for execution';
                        }

                        const alias = aliases.find(a => a.name === args.name);
                        if (!alias) {
                            return `❌ Alias '${args.name}' not found`;
                        }

                        // Execute using bash tool
                        const bashCommand = args.args?.length 
                            ? `${alias.command} ${args.args.join(' ')}`
                            : alias.command;

                        // Delegate to bash tool
                        return `Executing: ${bashCommand}
                        
Use @hanzo bash to run: ${bashCommand}`;
            }

                    default:
                        return '❌ Unknown action';
                }
            }
        }
    ];
}

/**
 * Register Unix aliases as dynamic MCP tools
 * This allows modes to use any Unix command as a composable tool
 */
export function registerUnixAliasTools(context: vscode.ExtensionContext): MCPTool[] {
    const aliases = context.globalState.get<UnixToolAlias[]>('unix-aliases', []);
    const tools: MCPTool[] = [];

    for (const alias of aliases) {
        tools.push({
            name: alias.name,
            description: alias.description || `Unix command: ${alias.command}`,
            inputSchema: {
                type: 'object',
                properties: {
                    args: {
                        type: 'array',
                        items: { type: 'string' },
                        description: 'Command arguments'
                    }
                }
            },
            handler: async (args: any) => {
                const { exec } = require('child_process');
                const { promisify } = require('util');
                const execAsync = promisify(exec);

                const fullCommand = args.args?.length 
                    ? `${alias.command} ${args.args.join(' ')}`
                    : alias.command;

                try {
                    const { stdout, stderr } = await execAsync(fullCommand);
                    return stderr ? `${stdout}\n⚠️ Warnings:\n${stderr}` : stdout;
                } catch (error: any) {
                    return `❌ Command failed: ${error.message}`;
                }
            }
        });
    }

    return tools;
}
