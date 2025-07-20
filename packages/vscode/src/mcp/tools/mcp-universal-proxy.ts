import * as vscode from 'vscode';
import { MCPTool } from '../server';
import * as cp from 'child_process';
import * as path from 'path';
import * as fs from 'fs';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { promisify } from 'util';

const exec = promisify(cp.exec);

interface MCPServerConfig {
    name: string;
    package: string;
    type: 'npm' | 'python';
    command?: string;
    args?: string[];
    env?: Record<string, string>;
}

interface MCPServerInstance extends MCPServerConfig {
    client?: Client;
    transport?: StdioClientTransport;
    installed: boolean;
    version?: string;
    installPath?: string;
    capabilities?: {
        tools?: string[];
        resources?: string[];
        prompts?: string[];
    };
}

class MCPProxyManager {
    private servers: Map<string, MCPServerInstance> = new Map();
    private context: vscode.ExtensionContext;
    private toolToServerMap: Map<string, string> = new Map();
    private resourceToServerMap: Map<string, string> = new Map();
    private promptToServerMap: Map<string, string> = new Map();

    constructor(context: vscode.ExtensionContext) {
        this.context = context;
        this.loadKnownServers();
        this.loadInstalledServers();
    }

    private loadKnownServers() {
        // Load popular MCP servers
        const knownServers: MCPServerConfig[] = [
            // NPM packages
            {
                name: 'puppeteer',
                package: '@modelcontextprotocol/server-puppeteer',
                type: 'npm',
                command: 'node',
                args: ['node_modules/@modelcontextprotocol/server-puppeteer/dist/index.js']
            },
            {
                name: 'playwright', 
                package: '@modelcontextprotocol/server-playwright',
                type: 'npm',
                command: 'node',
                args: ['node_modules/@modelcontextprotocol/server-playwright/dist/index.js']
            },
            {
                name: 'sqlite',
                package: '@modelcontextprotocol/server-sqlite',
                type: 'npm',
                command: 'node', 
                args: ['node_modules/@modelcontextprotocol/server-sqlite/dist/index.js']
            },
            {
                name: 'filesystem',
                package: '@modelcontextprotocol/server-filesystem',
                type: 'npm',
                command: 'node',
                args: ['node_modules/@modelcontextprotocol/server-filesystem/dist/index.js']
            },
            {
                name: 'github',
                package: '@modelcontextprotocol/server-github',
                type: 'npm',
                command: 'node',
                args: ['node_modules/@modelcontextprotocol/server-github/dist/index.js']
            },
            // Python packages
            {
                name: 'git',
                package: 'mcp-server-git',
                type: 'python',
                command: 'uvx',
                args: ['mcp-server-git']
            },
            {
                name: 'slack',
                package: 'mcp-server-slack',
                type: 'python',
                command: 'uvx',
                args: ['mcp-server-slack']
            },
            {
                name: 'time',
                package: 'mcp-server-time',
                type: 'python',
                command: 'uvx', 
                args: ['mcp-server-time']
            },
            {
                name: 'fetch',
                package: 'mcp-server-fetch',
                type: 'python',
                command: 'uvx',
                args: ['mcp-server-fetch']
            }
        ];

        for (const server of knownServers) {
            this.servers.set(server.name, {
                ...server,
                installed: false
            });
        }
    }

    private async loadInstalledServers() {
        const installed = this.context.globalState.get<MCPServerInstance[]>('mcp-installed-servers', []);
        for (const server of installed) {
            this.servers.set(server.name, server);
        }
    }

    private async saveInstalledServers() {
        const installed = Array.from(this.servers.values())
            .filter(s => s.installed)
            .map(s => ({
                ...s,
                client: undefined,
                transport: undefined
            }));
        await this.context.globalState.update('mcp-installed-servers', installed);
    }

    async installServer(packageName: string, type?: 'npm' | 'python', force?: boolean): Promise<string> {
        const serverType = type || this.detectPackageType(packageName);
        const serverName = this.extractServerName(packageName);
        
        // Check if already installed
        const existing = this.servers.get(serverName);
        if (existing?.installed && !force) {
            return `✅ MCP server '${serverName}' is already installed`;
        }

        const installDir = path.join(this.context.globalStorageUri.fsPath, 'mcp-servers', serverName);
        await fs.promises.mkdir(installDir, { recursive: true });

        try {
            let version = 'unknown';
            let command: string;
            let args: string[];

            if (serverType === 'npm') {
                // Create package.json
                const packageJson = {
                    name: `mcp-proxy-${serverName}`,
                    version: '1.0.0',
                    private: true,
                    dependencies: {
                        [packageName]: 'latest'
                    }
                };
                await fs.promises.writeFile(
                    path.join(installDir, 'package.json'),
                    JSON.stringify(packageJson, null, 2)
                );

                // Install
                await exec('npm install', { cwd: installDir });

                // Get version
                const installedPkgPath = path.join(installDir, 'node_modules', packageName, 'package.json');
                const installedPkg = JSON.parse(await fs.promises.readFile(installedPkgPath, 'utf8'));
                version = installedPkg.version;

                // Determine entry point
                const main = installedPkg.main || 'index.js';
                command = 'node';
                args = [path.join('node_modules', packageName, main)];

            } else {
                // Python package - install with uvx
                await exec(`uvx install ${packageName}`, { cwd: installDir });
                
                // Try to get version
                try {
                    const { stdout } = await exec(`uvx ${packageName} --version`, { cwd: installDir });
                    version = stdout.trim();
                } catch {}

                command = 'uvx';
                args = [packageName];
            }

            // Update server info
            const serverInfo: MCPServerInstance = {
                name: serverName,
                package: packageName,
                type: serverType,
                command,
                args,
                installed: true,
                version,
                installPath: installDir
            };

            this.servers.set(serverName, serverInfo);
            await this.saveInstalledServers();

            // Try to connect and discover capabilities
            await this.connectToServer(serverName);

            return `✅ Successfully installed ${packageName}
📦 Version: ${version}
📂 Location: ${installDir}
🚀 Ready to use via proxy`;

        } catch (error: any) {
            throw new Error(`Failed to install ${packageName}: ${error.message}`);
        }
    }

    async connectToServer(serverName: string): Promise<void> {
        const server = this.servers.get(serverName);
        if (!server || !server.installed) {
            throw new Error(`Server ${serverName} not installed`);
        }

        // Disconnect if already connected
        if (server.client) {
            await server.transport?.close();
        }

        const command = server.command!;
        const args = server.args || [];
        const cwd = server.installPath;
        const env: Record<string, string> = Object.entries({ ...process.env, ...server.env })
            .reduce((acc, [key, value]) => {
                if (value !== undefined) {
                    acc[key] = value;
                }
                return acc;
            }, {} as Record<string, string>);

        // Create transport
        const transport = new StdioClientTransport({
            command,
            args,
            cwd,
            env
        });

        // Create client
        const client = new Client({
            name: `hanzo-proxy-${serverName}`,
            version: '1.0.0'
        }, {
            capabilities: {}
        });

        // Connect
        await client.connect(transport);

        // Discover capabilities
        const capabilities: MCPServerInstance['capabilities'] = {};

        try {
            // List tools
            const toolsResponse = await (client as any).request({
                method: 'tools/list',
                params: {}
            });
            capabilities.tools = toolsResponse.tools?.map((t: any) => t.name) || [];

            // List resources
            const resourcesResponse = await (client as any).request({
                method: 'resources/list',
                params: {}
            });
            capabilities.resources = resourcesResponse.resources?.map((r: any) => r.uri) || [];

            // List prompts
            const promptsResponse = await (client as any).request({
                method: 'prompts/list',
                params: {}
            });
            capabilities.prompts = promptsResponse.prompts?.map((p: any) => p.name) || [];

        } catch (error) {
            console.error(`Failed to discover capabilities for ${serverName}:`, error);
        }

        // Update server
        server.client = client;
        server.transport = transport;
        server.capabilities = capabilities;

        // Update routing maps
        if (capabilities.tools) {
            for (const tool of capabilities.tools) {
                this.toolToServerMap.set(tool, serverName);
            }
        }
        if (capabilities.resources) {
            for (const resource of capabilities.resources) {
                this.resourceToServerMap.set(resource, serverName);
            }
        }
        if (capabilities.prompts) {
            for (const prompt of capabilities.prompts) {
                this.promptToServerMap.set(prompt, serverName);
            }
        }
    }

    async proxyToolCall(toolName: string, args: any): Promise<any> {
        const serverName = this.toolToServerMap.get(toolName);
        if (!serverName) {
            throw new Error(`No server found for tool: ${toolName}`);
        }

        const server = this.servers.get(serverName);
        if (!server?.client) {
            // Try to connect
            await this.connectToServer(serverName);
        }

        const response = await (server!.client as any).request({
            method: 'tools/call',
            params: {
                name: toolName,
                arguments: args
            }
        });

        return {
            server: serverName,
            tool: toolName,
            result: response.content || response
        };
    }

    async listAllCapabilities(): Promise<any> {
        const result = {
            servers: [] as any[],
            tools: [] as any[],
            resources: [] as any[],
            prompts: [] as any[]
        };

        for (const [name, server] of this.servers) {
            if (!server.installed) continue;

            // Ensure connected
            if (!server.client) {
                try {
                    await this.connectToServer(name);
                } catch (error) {
                    console.error(`Failed to connect to ${name}:`, error);
                    continue;
                }
            }

            result.servers.push({
                name,
                package: server.package,
                version: server.version,
                type: server.type,
                capabilities: server.capabilities
            });

            // Aggregate capabilities
            if (server.capabilities?.tools) {
                result.tools.push(...server.capabilities.tools.map(t => ({ tool: t, server: name })));
            }
            if (server.capabilities?.resources) {
                result.resources.push(...server.capabilities.resources.map(r => ({ resource: r, server: name })));
            }
            if (server.capabilities?.prompts) {
                result.prompts.push(...server.capabilities.prompts.map(p => ({ prompt: p, server: name })));
            }
        }

        return result;
    }

    private detectPackageType(packageName: string): 'npm' | 'python' {
        if (packageName.startsWith('@') || packageName.includes('/')) {
            return 'npm';
        }
        if (packageName.startsWith('mcp-server-') || packageName.includes('_')) {
            return 'python';
        }
        return 'npm';
    }

    private extractServerName(packageName: string): string {
        if (packageName.includes('/')) {
            const parts = packageName.split('/');
            const lastPart = parts[parts.length - 1];
            return lastPart.replace('server-', '').replace('mcp-', '');
        }
        return packageName.replace('mcp-server-', '').replace('mcp-', '');
    }

    async disconnectAll() {
        for (const server of this.servers.values()) {
            if (server.transport) {
                await server.transport.close();
            }
        }
    }
}

export function createMCPUniversalProxyTools(context: vscode.ExtensionContext): MCPTool[] {
    const proxyManager = new MCPProxyManager(context);

    // Cleanup on deactivate
    context.subscriptions.push({
        dispose: async () => {
            await proxyManager.disconnectAll();
        }
    });

    return [
        {
            name: 'mcp',
            description: 'Universal MCP server proxy - install and use any MCP server',
            inputSchema: {
                type: 'object',
                properties: {
                    action: {
                        type: 'string',
                        enum: ['install', 'call', 'list', 'uninstall'],
                        description: 'Action to perform'
                    },
                    package: {
                        type: 'string',
                        description: 'Package name for install (e.g., "@modelcontextprotocol/server-github")'
                    },
                    server: {
                        type: 'string',
                        description: 'Server name for operations'
                    },
                    tool: {
                        type: 'string',
                        description: 'Tool name to call'
                    },
                    args: {
                        type: 'object',
                        description: 'Arguments for tool call'
                    },
                    type: {
                        type: 'string',
                        enum: ['npm', 'python'],
                        description: 'Package type (auto-detected if not specified)'
                    },
                    force: {
                        type: 'boolean',
                        description: 'Force reinstall'
                    }
                },
                required: ['action']
            },
            handler: async (args: any) => {
                switch (args.action) {
                    case 'install':
                        if (!args.package) {
                            return '❌ Package name required for install';
                        }
                        return await proxyManager.installServer(args.package, args.type, args.force);

                    case 'call':
                        if (!args.tool) {
                            return '❌ Tool name required for call';
                        }
                        try {
                            const result = await proxyManager.proxyToolCall(args.tool, args.args || {});
                            return `✅ Tool called via ${result.server}\n\nResult:\n${JSON.stringify(result.result, null, 2)}`;
                        } catch (error: any) {
                            return `❌ Tool call failed: ${error.message}`;
                        }

                    case 'list':
                        const capabilities = await proxyManager.listAllCapabilities();
                        return formatCapabilities(capabilities);

                    case 'uninstall':
                        // TODO: Implement uninstall
                        return '❌ Uninstall not yet implemented';

                    default:
                        return '❌ Unknown action. Use: install, call, list, or uninstall';
                }
            }
        }
    ];
}

function formatCapabilities(capabilities: any): string {
    let output = '# MCP Proxy Status\n\n';

    output += '## Installed Servers\n';
    for (const server of capabilities.servers) {
        output += `\n### ${server.name}\n`;
        output += `- Package: \`${server.package}\`\n`;
        output += `- Version: ${server.version}\n`;
        output += `- Type: ${server.type}\n`;
        if (server.capabilities) {
            output += `- Tools: ${server.capabilities.tools?.length || 0}\n`;
            output += `- Resources: ${server.capabilities.resources?.length || 0}\n`;
            output += `- Prompts: ${server.capabilities.prompts?.length || 0}\n`;
        }
    }

    if (capabilities.tools.length > 0) {
        output += '\n## Available Tools\n';
        for (const { tool, server } of capabilities.tools) {
            output += `- \`${tool}\` (${server})\n`;
        }
    }

    if (capabilities.resources.length > 0) {
        output += '\n## Available Resources\n';
        for (const { resource, server } of capabilities.resources) {
            output += `- \`${resource}\` (${server})\n`;
        }
    }

    if (capabilities.prompts.length > 0) {
        output += '\n## Available Prompts\n';
        for (const { prompt, server } of capabilities.prompts) {
            output += `- \`${prompt}\` (${server})\n`;
        }
    }

    return output;
}