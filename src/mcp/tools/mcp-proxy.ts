import * as vscode from 'vscode';
import { MCPTool } from '../server';
import * as cp from 'child_process';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import { promisify } from 'util';

const exec = promisify(cp.exec);

interface MCPServer {
    name: string;
    package: string;
    type: 'npm' | 'python';
    installed: boolean;
    version?: string;
    path?: string;
    process?: cp.ChildProcess;
}

interface MCPInstallArgs {
    package: string;
    type?: 'npm' | 'python';
    force?: boolean;
}

interface MCPProxyArgs {
    server: string;
    method: string;
    params?: any;
}

export function createMCPProxyTools(context: vscode.ExtensionContext): MCPTool[] {
    const mcpServers = new Map<string, MCPServer>();
    
    // Load known MCP servers
    loadKnownServers(mcpServers);
    
    return [
        {
            name: 'mcp_install',
            description: 'Install any MCP server via npm/npx or Python/uvx',
            inputSchema: {
                type: 'object',
                properties: {
                    package: {
                        type: 'string',
                        description: 'Package name (e.g., "@modelcontextprotocol/server-puppeteer", "mcp-server-git")'
                    },
                    type: {
                        type: 'string',
                        enum: ['npm', 'python'],
                        description: 'Package type (auto-detected if not specified)'
                    },
                    force: {
                        type: 'boolean',
                        description: 'Force reinstall even if already installed'
                    }
                },
                required: ['package']
            },
            handler: async (args: MCPInstallArgs) => {
                const packageType = args.type || detectPackageType(args.package);
                const serverName = extractServerName(args.package);
                
                // Check if already installed
                const existing = mcpServers.get(serverName);
                if (existing && existing.installed && !args.force) {
                    return `✅ MCP server '${serverName}' is already installed at: ${existing.path}`;
                }
                
                try {
                    const result = await installMCPServer(
                        args.package, 
                        packageType, 
                        context
                    );
                    
                    // Update server registry
                    mcpServers.set(serverName, {
                        name: serverName,
                        package: args.package,
                        type: packageType,
                        installed: true,
                        version: result.version,
                        path: result.path
                    });
                    
                    // Save to persistent storage
                    await saveMCPServers(context, mcpServers);
                    
                    return `✅ Successfully installed ${args.package}
📦 Version: ${result.version}
📂 Location: ${result.path}
🚀 Use: @hanzo mcp_proxy --server ${serverName} --method <method>`;
                    
                } catch (error: any) {
                    return `❌ Failed to install ${args.package}: ${error.message}`;
                }
            }
        },
        {
            name: 'mcp_proxy',
            description: 'Proxy commands to any installed MCP server',
            inputSchema: {
                type: 'object',
                properties: {
                    server: {
                        type: 'string',
                        description: 'MCP server name (e.g., "puppeteer", "git", "sqlite")'
                    },
                    method: {
                        type: 'string',
                        description: 'Method to call on the MCP server'
                    },
                    params: {
                        type: 'object',
                        description: 'Parameters to pass to the method'
                    }
                },
                required: ['server', 'method']
            },
            handler: async (args: MCPProxyArgs) => {
                const server = mcpServers.get(args.server);
                
                if (!server || !server.installed) {
                    // Try to find and suggest installation
                    const suggestions = findSimilarServers(args.server);
                    return `❌ MCP server '${args.server}' not installed.

${suggestions.length > 0 ? `Did you mean one of these?
${suggestions.map(s => `- ${s}`).join('\n')}

Install with: @hanzo mcp_install --package <package-name>` : 
`Try installing with: @hanzo mcp_install --package @modelcontextprotocol/server-${args.server}`}`;
                }
                
                try {
                    // Ensure server is running
                    if (!server.process || !isProcessRunning(server.process.pid!)) {
                        server.process = await startMCPServer(server, context);
                    }
                    
                    // Proxy the method call
                    const result = await proxyMethodCall(
                        server,
                        args.method,
                        args.params
                    );
                    
                    return formatProxyResult(result);
                    
                } catch (error: any) {
                    return `❌ MCP proxy error: ${error.message}`;
                }
            }
        },
        {
            name: 'mcp_list',
            description: 'List all available and installed MCP servers',
            inputSchema: {
                type: 'object',
                properties: {
                    installed: {
                        type: 'boolean',
                        description: 'Show only installed servers'
                    }
                }
            },
            handler: async (args: { installed?: boolean }) => {
                const servers = Array.from(mcpServers.values());
                const filtered = args.installed 
                    ? servers.filter(s => s.installed)
                    : servers;
                
                if (filtered.length === 0) {
                    return args.installed 
                        ? 'No MCP servers installed yet. Use mcp_install to add servers.'
                        : 'No MCP servers registered.';
                }
                
                let output = args.installed 
                    ? '## Installed MCP Servers\n\n'
                    : '## Available MCP Servers\n\n';
                
                for (const server of filtered) {
                    output += `### ${server.name}\n`;
                    output += `- Package: \`${server.package}\`\n`;
                    output += `- Type: ${server.type}\n`;
                    output += `- Installed: ${server.installed ? '✅' : '❌'}\n`;
                    if (server.version) output += `- Version: ${server.version}\n`;
                    if (server.path) output += `- Path: ${server.path}\n`;
                    output += '\n';
                }
                
                if (!args.installed) {
                    output += '\n## Popular MCP Servers\n\n';
                    output += '- `@modelcontextprotocol/server-puppeteer` - Browser automation\n';
                    output += '- `@modelcontextprotocol/server-sqlite` - SQLite database\n';
                    output += '- `@modelcontextprotocol/server-postgresql` - PostgreSQL\n';
                    output += '- `mcp-server-git` - Git operations (Python)\n';
                    output += '- `mcp-server-github` - GitHub API (Python)\n';
                    output += '- `mcp-server-slack` - Slack integration (Python)\n';
                    output += '- `mcp-server-filesystem` - Advanced file operations\n';
                }
                
                return output;
            }
        },
        {
            name: 'mcp_uninstall',
            description: 'Uninstall an MCP server',
            inputSchema: {
                type: 'object',
                properties: {
                    server: {
                        type: 'string',
                        description: 'MCP server name to uninstall'
                    }
                },
                required: ['server']
            },
            handler: async (args: { server: string }) => {
                const server = mcpServers.get(args.server);
                
                if (!server) {
                    return `❌ MCP server '${args.server}' not found.`;
                }
                
                if (!server.installed) {
                    return `❌ MCP server '${args.server}' is not installed.`;
                }
                
                try {
                    // Stop the server if running
                    if (server.process && isProcessRunning(server.process.pid!)) {
                        server.process.kill();
                    }
                    
                    // Remove installation
                    if (server.path && fs.existsSync(server.path)) {
                        await fs.promises.rm(server.path, { recursive: true, force: true });
                    }
                    
                    // Update registry
                    server.installed = false;
                    server.path = undefined;
                    server.version = undefined;
                    server.process = undefined;
                    
                    await saveMCPServers(context, mcpServers);
                    
                    return `✅ Successfully uninstalled MCP server '${args.server}'`;
                    
                } catch (error: any) {
                    return `❌ Failed to uninstall: ${error.message}`;
                }
            }
        }
    ];
}

function loadKnownServers(servers: Map<string, MCPServer>) {
    // Load from a known list of MCP servers
    const knownServers = [
        // NPM packages
        { name: 'puppeteer', package: '@modelcontextprotocol/server-puppeteer', type: 'npm' as const },
        { name: 'playwright', package: '@modelcontextprotocol/server-playwright', type: 'npm' as const },
        { name: 'sqlite', package: '@modelcontextprotocol/server-sqlite', type: 'npm' as const },
        { name: 'postgresql', package: '@modelcontextprotocol/server-postgresql', type: 'npm' as const },
        { name: 'filesystem', package: '@modelcontextprotocol/server-filesystem', type: 'npm' as const },
        { name: 'memory', package: '@modelcontextprotocol/server-memory', type: 'npm' as const },
        { name: 'fetch', package: '@modelcontextprotocol/server-fetch', type: 'npm' as const },
        
        // Python packages
        { name: 'git', package: 'mcp-server-git', type: 'python' as const },
        { name: 'github', package: 'mcp-server-github', type: 'python' as const },
        { name: 'slack', package: 'mcp-server-slack', type: 'python' as const },
        { name: 'time', package: 'mcp-server-time', type: 'python' as const },
        { name: 'weather', package: 'mcp-server-weather', type: 'python' as const },
    ];
    
    for (const server of knownServers) {
        servers.set(server.name, {
            ...server,
            installed: false
        });
    }
}

function detectPackageType(packageName: string): 'npm' | 'python' {
    // NPM packages usually start with @ or contain /
    if (packageName.startsWith('@') || packageName.includes('/')) {
        return 'npm';
    }
    
    // Python packages usually have mcp-server prefix
    if (packageName.startsWith('mcp-server-') || packageName.includes('_')) {
        return 'python';
    }
    
    // Default to npm
    return 'npm';
}

function extractServerName(packageName: string): string {
    // Extract meaningful name from package
    if (packageName.includes('/')) {
        // @modelcontextprotocol/server-puppeteer -> puppeteer
        const parts = packageName.split('/');
        const lastPart = parts[parts.length - 1];
        return lastPart.replace('server-', '').replace('mcp-', '');
    }
    
    // mcp-server-git -> git
    return packageName.replace('mcp-server-', '').replace('mcp-', '');
}

async function installMCPServer(
    packageName: string, 
    type: 'npm' | 'python',
    context: vscode.ExtensionContext
): Promise<{ version: string; path: string }> {
    const installDir = path.join(context.globalStorageUri.fsPath, 'mcp-servers');
    const serverName = extractServerName(packageName);
    const serverDir = path.join(installDir, serverName);
    
    // Ensure directory exists
    await fs.promises.mkdir(serverDir, { recursive: true });
    
    if (type === 'npm') {
        // Install via npm
        const { stdout } = await exec(
            `npm install ${packageName} --prefix "${serverDir}"`,
            { cwd: serverDir }
        );
        
        // Get version
        const packageJsonPath = path.join(serverDir, 'node_modules', packageName, 'package.json');
        const packageJson = JSON.parse(await fs.promises.readFile(packageJsonPath, 'utf8'));
        
        return {
            version: packageJson.version,
            path: serverDir
        };
    } else {
        // Install via uvx/pip
        const { stdout } = await exec(
            `uvx --from ${packageName} --install-dir "${serverDir}" ${packageName}`,
            { cwd: serverDir }
        );
        
        // Try to get version
        let version = 'unknown';
        try {
            const { stdout: versionOut } = await exec(
                `uvx ${packageName} --version`,
                { cwd: serverDir }
            );
            version = versionOut.trim();
        } catch {}
        
        return {
            version,
            path: serverDir
        };
    }
}

async function startMCPServer(
    server: MCPServer,
    context: vscode.ExtensionContext
): Promise<cp.ChildProcess> {
    const serverPath = server.path!;
    
    if (server.type === 'npm') {
        // Find the main entry point
        const packagePath = path.join(serverPath, 'node_modules', server.package);
        const packageJson = JSON.parse(
            await fs.promises.readFile(path.join(packagePath, 'package.json'), 'utf8')
        );
        
        const mainFile = packageJson.main || 'index.js';
        const entryPoint = path.join(packagePath, mainFile);
        
        return cp.spawn('node', [entryPoint], {
            stdio: ['pipe', 'pipe', 'pipe'],
            env: {
                ...process.env,
                NODE_PATH: path.join(serverPath, 'node_modules')
            }
        });
    } else {
        // Python server
        return cp.spawn('uvx', [server.package], {
            stdio: ['pipe', 'pipe', 'pipe'],
            cwd: serverPath
        });
    }
}

async function proxyMethodCall(
    server: MCPServer,
    method: string,
    params: any
): Promise<any> {
    // This is a simplified proxy - in reality, we'd use the MCP protocol
    // For now, we'll simulate the call
    return new Promise((resolve, reject) => {
        if (!server.process) {
            reject(new Error('Server not running'));
            return;
        }
        
        // Send JSON-RPC request
        const request = {
            jsonrpc: '2.0',
            id: Date.now(),
            method: method,
            params: params || {}
        };
        
        server.process.stdin?.write(JSON.stringify(request) + '\n');
        
        // Listen for response
        const handler = (data: Buffer) => {
            try {
                const response = JSON.parse(data.toString());
                if (response.id === request.id) {
                    server.process?.stdout?.off('data', handler);
                    if (response.error) {
                        reject(new Error(response.error.message));
                    } else {
                        resolve(response.result);
                    }
                }
            } catch (e) {
                // Not JSON, ignore
            }
        };
        
        server.process.stdout?.on('data', handler);
        
        // Timeout after 30 seconds
        setTimeout(() => {
            server.process?.stdout?.off('data', handler);
            reject(new Error('Request timeout'));
        }, 30000);
    });
}

function isProcessRunning(pid: number): boolean {
    try {
        process.kill(pid, 0);
        return true;
    } catch {
        return false;
    }
}

function findSimilarServers(name: string): string[] {
    const knownNames = [
        'puppeteer', 'playwright', 'sqlite', 'postgresql',
        'git', 'github', 'slack', 'filesystem', 'memory'
    ];
    
    return knownNames.filter(n => 
        n.includes(name) || name.includes(n)
    );
}

function formatProxyResult(result: any): string {
    if (typeof result === 'string') {
        return result;
    }
    
    if (result === null || result === undefined) {
        return '✅ Method executed successfully';
    }
    
    try {
        return JSON.stringify(result, null, 2);
    } catch {
        return String(result);
    }
}

async function saveMCPServers(
    context: vscode.ExtensionContext,
    servers: Map<string, MCPServer>
): Promise<void> {
    const data = Array.from(servers.entries()).map(([name, server]) => ({
        ...server,
        process: undefined // Don't serialize process
    }));
    
    await context.globalState.update('mcp-servers', data);
}

export async function loadMCPServers(
    context: vscode.ExtensionContext
): Promise<Map<string, MCPServer>> {
    const servers = new Map<string, MCPServer>();
    const data = context.globalState.get<any[]>('mcp-servers', []);
    
    for (const item of data) {
        servers.set(item.name, item);
    }
    
    // Load known servers if empty
    if (servers.size === 0) {
        loadKnownServers(servers);
    }
    
    return servers;
}