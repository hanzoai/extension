import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs/promises';
import * as os from 'os';
import { MCPTool } from '../../server';
import { MCPTools } from '../index';

interface ConfigValue {
    value: any;
    scope: 'local' | 'global';
    timestamp: Date;
}

export function createConfigTool(context: vscode.ExtensionContext): MCPTool {
    const CONFIG_FILE_LOCAL = '.hanzo/config.json';
    const CONFIG_FILE_GLOBAL = path.join(os.homedir(), '.hanzo', 'config.json');
    
    async function loadConfig(scope: 'local' | 'global' | 'all'): Promise<Record<string, ConfigValue>> {
        const configs: Record<string, ConfigValue> = {};
        
        // Load global config
        if (scope === 'global' || scope === 'all') {
            try {
                const globalContent = await fs.readFile(CONFIG_FILE_GLOBAL, 'utf-8');
                const globalConfig = JSON.parse(globalContent);
                for (const [key, value] of Object.entries(globalConfig)) {
                    configs[key] = { value, scope: 'global', timestamp: new Date() };
                }
            } catch {
                // No global config
            }
        }
        
        // Load local config (overwrites global)
        if (scope === 'local' || scope === 'all') {
            const workspace = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
            if (workspace) {
                try {
                    const localPath = path.join(workspace, CONFIG_FILE_LOCAL);
                    const localContent = await fs.readFile(localPath, 'utf-8');
                    const localConfig = JSON.parse(localContent);
                    for (const [key, value] of Object.entries(localConfig)) {
                        configs[key] = { value, scope: 'local', timestamp: new Date() };
                    }
                } catch {
                    // No local config
                }
            }
        }
        
        return configs;
    }
    
    async function saveConfig(key: string, value: any, scope: 'local' | 'global') {
        const configPath = scope === 'global' ? CONFIG_FILE_GLOBAL : 
            path.join(vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || '', CONFIG_FILE_LOCAL);
        
        // Ensure directory exists
        await fs.mkdir(path.dirname(configPath), { recursive: true });
        
        // Load existing config
        let config: Record<string, any> = {};
        try {
            const content = await fs.readFile(configPath, 'utf-8');
            config = JSON.parse(content);
        } catch {
            // No existing config
        }
        
        // Update config
        if (value === null) {
            delete config[key];
        } else {
            config[key] = value;
        }
        
        // Save config
        await fs.writeFile(configPath, JSON.stringify(config, null, 2));
    }
    
    return {
        name: 'config',
        description: 'Manage configuration settings and tools. Actions: get, set, unset, list, tool_enable, tool_disable, tool_list',
        inputSchema: {
            type: 'object',
            properties: {
                action: {
                    type: 'string',
                    enum: ['get', 'set', 'unset', 'list', 'tool_enable', 'tool_disable', 'tool_list'],
                    description: 'Action to perform'
                },
                key: {
                    type: 'string',
                    description: 'Configuration key or tool name'
                },
                value: {
                    description: 'Configuration value (for set action)'
                },
                scope: {
                    type: 'string',
                    enum: ['local', 'global'],
                    description: 'Configuration scope (default: local)'
                },
                category: {
                    type: 'string',
                    enum: ['all', 'filesystem', 'search', 'shell', 'ai', 'development'],
                    description: 'Tool category filter (for tool_list)'
                },
                show_disabled: {
                    type: 'boolean',
                    description: 'Show disabled tools (for tool_list)'
                }
            },
            required: ['action']
        },
        handler: async (args: {
            action: string;
            key?: string;
            value?: any;
            scope?: 'local' | 'global';
            category?: string;
            show_disabled?: boolean;
        }) => {
            const scope = args.scope || 'local';
            
            switch (args.action) {
                case 'get': {
                    if (!args.key) {
                        return 'Error: Key required for get action';
                    }
                    
                    const configs = await loadConfig('all');
                    const config = configs[args.key];
                    
                    if (!config) {
                        return `Configuration key '${args.key}' not found`;
                    }
                    
                    return `${args.key} = ${JSON.stringify(config.value)} (${config.scope})`;
                }
                
                case 'set': {
                    if (!args.key) {
                        return 'Error: Key required for set action';
                    }
                    if (args.value === undefined) {
                        return 'Error: Value required for set action';
                    }
                    
                    await saveConfig(args.key, args.value, scope);
                    return `Set ${args.key} = ${JSON.stringify(args.value)} (${scope})`;
                }
                
                case 'unset': {
                    if (!args.key) {
                        return 'Error: Key required for unset action';
                    }
                    
                    await saveConfig(args.key, null, scope);
                    return `Unset ${args.key} (${scope})`;
                }
                
                case 'list': {
                    const configs = await loadConfig('all');
                    
                    if (Object.keys(configs).length === 0) {
                        return 'No configuration settings found';
                    }
                    
                    let output = 'Configuration settings:\n\n';
                    
                    // Group by scope
                    const byScope: Record<string, Array<[string, any]>> = {
                        global: [],
                        local: []
                    };
                    
                    for (const [key, config] of Object.entries(configs)) {
                        byScope[config.scope].push([key, config.value]);
                    }
                    
                    if (byScope.global.length > 0) {
                        output += 'Global:\n';
                        for (const [key, value] of byScope.global) {
                            output += `  ${key} = ${JSON.stringify(value)}\n`;
                        }
                        output += '\n';
                    }
                    
                    if (byScope.local.length > 0) {
                        output += 'Local:\n';
                        for (const [key, value] of byScope.local) {
                            output += `  ${key} = ${JSON.stringify(value)}\n`;
                        }
                    }
                    
                    return output.trim();
                }
                
                case 'tool_enable': {
                    if (!args.key) {
                        return 'Error: Tool name required for tool_enable action';
                    }
                    
                    const mcpTools = new MCPTools(context);
                    mcpTools.enableTool(args.key);
                    return `Tool '${args.key}' has been enabled`;
                }
                
                case 'tool_disable': {
                    if (!args.key) {
                        return 'Error: Tool name required for tool_disable action';
                    }
                    
                    const mcpTools = new MCPTools(context);
                    mcpTools.disableTool(args.key);
                    return `Tool '${args.key}' has been disabled`;
                }
                
                case 'tool_list': {
                    const mcpTools = new MCPTools(context);
                    await mcpTools.initialize();
                    
                    const allTools = mcpTools.getAllTools();
                    const stats = mcpTools.getToolStats();
                    
                    let output = `Total tools: ${stats.total} (${stats.enabled} enabled, ${stats.disabled} disabled)\n\n`;
                    
                    // Categorize tools
                    const categories: Record<string, string[]> = {
                        filesystem: ['read', 'write', 'edit', 'multi_edit', 'directory_tree', 'find_files', 'content_replace', 'diff', 'watch'],
                        search: ['grep', 'search', 'symbols', 'git_search', 'grep_ast', 'batch_search'],
                        shell: ['run_command', 'bash', 'run_background', 'processes', 'pkill', 'logs', 'open', 'npx', 'uvx'],
                        ai: ['dispatch_agent', 'llm', 'consensus', 'think', 'agent', 'mode'],
                        development: ['todo', 'notebook_read', 'notebook_edit', 'critic'],
                        system: ['batch', 'config', 'stats', 'web_fetch', 'rules', 'mcp'],
                        other: []
                    };
                    
                    // Add tools to categories
                    for (const tool of allTools) {
                        let categorized = false;
                        for (const [cat, names] of Object.entries(categories)) {
                            if (names.includes(tool.name)) {
                                categorized = true;
                                break;
                            }
                        }
                        if (!categorized) {
                            categories.other.push(tool.name);
                        }
                    }
                    
                    // Display by category
                    for (const [cat, toolNames] of Object.entries(categories)) {
                        if (args.category && args.category !== 'all' && args.category !== cat) {
                            continue;
                        }
                        
                        const enabledInCategory = toolNames.filter(name => 
                            allTools.some(t => t.name === name)
                        );
                        
                        if (enabledInCategory.length === 0 && !args.show_disabled) {
                            continue;
                        }
                        
                        output += `=== ${cat.charAt(0).toUpperCase() + cat.slice(1)} ===\n`;
                        
                        for (const toolName of toolNames) {
                            const tool = allTools.find(t => t.name === toolName);
                            if (tool) {
                                output += `✅ ${toolName}: ${tool.description}\n`;
                            } else if (args.show_disabled) {
                                output += `❌ ${toolName}: (disabled)\n`;
                            }
                        }
                        
                        output += '\n';
                    }
                    
                    return output.trim();
                }
                
                default:
                    return `Error: Unknown action '${args.action}'`;
            }
        }
    };
}