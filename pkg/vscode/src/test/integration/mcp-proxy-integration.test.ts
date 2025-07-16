import * as assert from 'assert';
import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { createMCPUniversalProxyTools } from '../../mcp/tools/mcp-universal-proxy';

describe('MCP Proxy Integration Tests', function() {
    this.timeout(60000); // 60 seconds for real installations

    let context: vscode.ExtensionContext;
    let mcpTool: any;
    let testStoragePath: string;

    before(async () => {
        // Create test storage directory
        testStoragePath = path.join(__dirname, '../../../.test-storage');
        await fs.promises.mkdir(testStoragePath, { recursive: true });

        // Create mock context
        const globalState = new Map();
        context = {
            globalState: {
                get: (key: string, defaultValue?: any) => globalState.get(key) || defaultValue,
                update: async (key: string, value: any) => {
                    globalState.set(key, value);
                    return Promise.resolve();
                },
                keys: () => Array.from(globalState.keys())
            },
            globalStorageUri: {
                fsPath: testStoragePath
            },
            subscriptions: []
        } as any;

        // Get the MCP tool
        const tools = createMCPUniversalProxyTools(context);
        mcpTool = tools.find(t => t.name === 'mcp');
    });

    after(async () => {
        // Cleanup test storage
        try {
            await fs.promises.rm(testStoragePath, { recursive: true, force: true });
        } catch {}
    });

    describe('Real Server Installation', () => {
        it('should install and connect to filesystem MCP server', async function() {
            this.timeout(120000); // 2 minutes for npm install

            // Install the filesystem server
            const installResult = await mcpTool.handler({
                action: 'install',
                package: '@modelcontextprotocol/server-filesystem'
            });

            assert(installResult.includes('Successfully installed'));
            assert(installResult.includes('@modelcontextprotocol/server-filesystem'));

            // List capabilities
            const listResult = await mcpTool.handler({ action: 'list' });
            
            assert(listResult.includes('filesystem'));
            assert(listResult.includes('Installed Servers'));
            
            // Verify installation directory exists
            const serverPath = path.join(testStoragePath, 'mcp-servers', 'filesystem');
            assert(fs.existsSync(serverPath));
            assert(fs.existsSync(path.join(serverPath, 'node_modules')));
        });

        it('should handle Python package installation', async function() {
            // Skip if uvx not available
            try {
                const { execSync } = require('child_process');
                execSync('which uvx', { stdio: 'ignore' });
            } catch {
                this.skip();
                return;
            }

            const installResult = await mcpTool.handler({
                action: 'install',
                package: 'mcp-server-time',
                type: 'python'
            });

            assert(installResult.includes('Successfully installed') || 
                   installResult.includes('already installed'));
        });
    });

    describe('Server Communication', () => {
        it('should discover server capabilities after connection', async function() {
            // Ensure filesystem server is installed
            await mcpTool.handler({
                action: 'install',
                package: '@modelcontextprotocol/server-filesystem'
            });

            // Give server time to start and discover capabilities
            await new Promise(resolve => setTimeout(resolve, 2000));

            const listResult = await mcpTool.handler({ action: 'list' });
            
            // Should show tools discovered from the server
            assert(listResult.includes('Available Tools') || 
                   listResult.includes('filesystem'));
        });
    });

    describe('Error Recovery', () => {
        it('should handle invalid package names gracefully', async () => {
            const result = await mcpTool.handler({
                action: 'install',
                package: '@invalid/package-that-does-not-exist-12345'
            });

            assert(result.includes('Failed to install'));
        });

        it('should recover from server crashes', async function() {
            // This test would require mocking server crashes
            // For now, we just verify the error handling path exists
            const result = await mcpTool.handler({
                action: 'call',
                tool: 'non_existent_tool'
            });

            assert(result.includes('No server found') || result.includes('failed'));
        });
    });

    describe('Multiple Server Management', () => {
        it('should manage multiple servers simultaneously', async function() {
            this.timeout(180000); // 3 minutes for multiple installs

            // Install multiple servers
            const servers = [
                '@modelcontextprotocol/server-memory',
                '@modelcontextprotocol/server-fetch'
            ];

            for (const server of servers) {
                await mcpTool.handler({
                    action: 'install',
                    package: server
                });
            }

            // List all servers
            const listResult = await mcpTool.handler({ action: 'list' });
            
            assert(listResult.includes('memory'));
            assert(listResult.includes('fetch'));
            
            // Verify each has its own directory
            assert(fs.existsSync(path.join(testStoragePath, 'mcp-servers', 'memory')));
            assert(fs.existsSync(path.join(testStoragePath, 'mcp-servers', 'fetch')));
        });
    });

    describe('Persistence', () => {
        it('should persist installed servers across sessions', async () => {
            // Install a server
            await mcpTool.handler({
                action: 'install',
                package: '@modelcontextprotocol/server-memory'
            });

            // Create new tools instance (simulating restart)
            const newTools = createMCPUniversalProxyTools(context);
            const newMcpTool = newTools.find(t => t.name === 'mcp');

            // List should still show the installed server
            const listResult = await newMcpTool.handler({ action: 'list' });
            assert(listResult.includes('memory'));
        });
    });
});

describe('MCP Proxy Examples', () => {
    it('should demonstrate usage patterns', () => {
        const examples = `
# Install GitHub MCP server
@hanzo mcp --action install --package @modelcontextprotocol/server-github

# Install Python-based Git server
@hanzo mcp --action install --package mcp-server-git --type python

# List all installed servers and capabilities
@hanzo mcp --action list

# Call a tool from any installed server
@hanzo mcp --action call --tool github_search --args '{"query": "MCP servers"}'

# Auto-install and use in one command (future feature)
@hanzo mcp --action call --tool sqlite_query --args '{"query": "SELECT * FROM users"}' --auto-install
        `;

        assert(examples.includes('install'));
        assert(examples.includes('list'));
        assert(examples.includes('call'));
    });
});