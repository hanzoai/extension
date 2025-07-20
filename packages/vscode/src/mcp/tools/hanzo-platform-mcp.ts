import * as vscode from 'vscode';
import { MCPTool } from '../server';
import axios from 'axios';

interface HanzoPlatformConfig {
    apiKey?: string;
    endpoint?: string;
    localFirst?: boolean;
}

interface UnixToolAlias {
    name: string;
    command: string;
    description?: string;
    args?: string[];
}

/**
 * Hanzo Platform MCP Integration
 * 
 * Provides unified access to both local and cloud MCP servers through Hanzo Platform.
 * When logged in to Hanzo, users can access cloud-hosted MCP servers that run on 
 * Hanzo's infrastructure, eliminating the need for local installation.
 */
export function createHanzoPlatformMCPTools(context: vscode.ExtensionContext): MCPTool[] {
    const config = vscode.workspace.getConfiguration('hanzo');
    
    return [
        {
            name: 'hanzo_mcp',
            description: 'Access Hanzo Platform MCP servers - cloud-hosted MCP services',
            inputSchema: {
                type: 'object',
                properties: {
                    server: {
                        type: 'string',
                        description: 'MCP server to access (e.g., "github", "sqlite", "git")'
                    },
                    method: {
                        type: 'string',
                        description: 'Method to call on the server'
                    },
                    params: {
                        type: 'object',
                        description: 'Parameters for the method'
                    },
                    localFirst: {
                        type: 'boolean',
                        description: 'Try local MCP first, fallback to cloud (default: true)'
                    }
                },
                required: ['server', 'method']
            },
            handler: async (args: any) => {
                const apiKey = process.env.HANZO_API_KEY || config.get<string>('llm.hanzo.apiKey');
                const endpoint = process.env.HANZO_MCP_ENDPOINT || config.get<string>('mcp.endpoint', 'https://api.hanzo.ai/mcp/v1');
                
                if (!apiKey) {
                    return '❌ Hanzo API key required. Set HANZO_API_KEY or login via `hanzo login`';
                }

                const localFirst = args.localFirst ?? true;

                // Try local MCP first if enabled
                if (localFirst) {
                    try {
                        // Check if server is installed locally
                        const localResult = await callLocalMCP(args.server, args.method, args.params);
                        if (localResult.success) {
                            return `✅ [Local] ${localResult.result}`;
                        }
                    } catch (error) {
                        // Fall through to cloud
                    }
                }

                // Call Hanzo Platform MCP
                try {
                    const response = await axios.post(
                        `${endpoint}/proxy`,
                        {
                            server: args.server,
                            method: args.method,
                            params: args.params
                        },
                        {
                            headers: {
                                'Authorization': `Bearer ${apiKey}`,
                                'Content-Type': 'application/json'
                            }
                        }
                    );

                    return formatCloudResponse(response.data);
                } catch (error: any) {
                    if (error.response?.status === 404) {
                        return `❌ MCP server '${args.server}' not available on Hanzo Platform. Available servers: github, sqlite, postgresql, git, slack, time, weather`;
                    }
                    return `❌ Hanzo Platform MCP error: ${error.message}`;
                }
            }
        },
        {
            name: 'hanzo_platform',
            description: 'Control Hanzo Platform services and resources',
            inputSchema: {
                type: 'object',
                properties: {
                    action: {
                        type: 'string',
                        enum: ['deploy', 'list', 'logs', 'scale', 'delete', 'status'],
                        description: 'Platform action to perform'
                    },
                    service: {
                        type: 'string',
                        description: 'Service name'
                    },
                    config: {
                        type: 'object',
                        description: 'Configuration for the action'
                    }
                },
                required: ['action']
            },
            handler: async (args: any) => {
                const apiKey = process.env.HANZO_API_KEY || config.get<string>('llm.hanzo.apiKey');
                const endpoint = config.get<string>('platform.endpoint', 'https://api.hanzo.ai/platform/v1');

                if (!apiKey) {
                    return '❌ Hanzo API key required for platform operations';
                }

                try {
                    const response = await axios.post(
                        `${endpoint}/${args.action}`,
                        {
                            service: args.service,
                            ...args.config
                        },
                        {
                            headers: {
                                'Authorization': `Bearer ${apiKey}`,
                                'Content-Type': 'application/json'
                            }
                        }
                    );

                    return formatPlatformResponse(args.action, response.data);
                } catch (error: any) {
                    return `❌ Platform operation failed: ${error.message}`;
                }
            }
        },
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
                    case 'create':
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

                    case 'list':
                        if (aliases.length === 0) {
                            return 'No Unix aliases defined yet.';
                        }

                        return '# Unix Tool Aliases\n\n' + 
                            aliases.map(a => 
                                `- **${a.name}**: \`${a.command}\`${a.description ? `\n  ${a.description}` : ''}`
                            ).join('\n');

                    case 'remove':
                        if (!args.name) {
                            return '❌ Name required for removal';
                        }

                        const filtered = aliases.filter(a => a.name !== args.name);
                        await context.globalState.update('unix-aliases', filtered);
                        return `✅ Removed alias '${args.name}'`;

                    case 'execute':
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

                    default:
                        return '❌ Unknown action';
                }
            }
        }
    ];
}

async function callLocalMCP(server: string, method: string, params: any): Promise<{ success: boolean; result?: string }> {
    // This would check if the server is installed locally and call it
    // For now, return not found to trigger cloud fallback
    return { success: false };
}

function formatCloudResponse(data: any): string {
    if (data.error) {
        return `❌ Cloud MCP Error: ${data.error}`;
    }

    let output = `✅ [Hanzo Cloud] ${data.server} → ${data.method}\n\n`;
    
    if (data.result) {
        if (typeof data.result === 'string') {
            output += data.result;
        } else {
            output += JSON.stringify(data.result, null, 2);
        }
    }

    if (data.metadata) {
        output += `\n\n📊 Metadata:`;
        output += `\n- Execution time: ${data.metadata.executionTime}ms`;
        output += `\n- Credits used: ${data.metadata.creditsUsed}`;
        output += `\n- Server location: ${data.metadata.region}`;
    }

    return output;
}

function formatPlatformResponse(action: string, data: any): string {
    switch (action) {
        case 'deploy':
            return `✅ Deployed ${data.service}
- URL: ${data.url}
- Status: ${data.status}
- Resources: ${data.resources}`;

        case 'list':
            return `# Hanzo Platform Services\n\n` +
                data.services.map((s: any) => 
                    `- **${s.name}** (${s.status})\n  URL: ${s.url}\n  Created: ${s.created}`
                ).join('\n\n');

        case 'logs':
            return `# Logs for ${data.service}\n\n${data.logs}`;

        case 'status':
            return `# ${data.service} Status
- Health: ${data.health}
- Uptime: ${data.uptime}
- Requests: ${data.requests}
- Errors: ${data.errors}`;

        default:
            return JSON.stringify(data, null, 2);
    }
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