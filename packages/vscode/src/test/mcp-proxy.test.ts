import * as assert from 'assert';
import * as sinon from 'sinon';
import * as vscode from 'vscode';
import * as cp from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { createMCPUniversalProxyTools } from '../mcp/tools/mcp-universal-proxy';
import { promisify } from 'util';

const exec = promisify(cp.exec);

describe('MCP Universal Proxy Tests', () => {
    let context: vscode.ExtensionContext;
    let sandbox: sinon.SinonSandbox;
    let globalState: Map<string, any>;
    let mcpTool: any;
    let execStub: sinon.SinonStub;
    let fsStub: any;

    beforeEach(() => {
        sandbox = sinon.createSandbox();
        globalState = new Map();

        // Mock VS Code context
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
                fsPath: '/test/storage'
            },
            subscriptions: []
        } as any;

        // Mock exec
        execStub = sandbox.stub(cp, 'exec');
        
        // Mock fs
        fsStub = {
            mkdir: sandbox.stub().resolves(),
            writeFile: sandbox.stub().resolves(),
            readFile: sandbox.stub(),
            rm: sandbox.stub().resolves()
        };
        sandbox.stub(fs.promises, 'mkdir').callsFake(fsStub.mkdir);
        sandbox.stub(fs.promises, 'writeFile').callsFake(fsStub.writeFile);
        sandbox.stub(fs.promises, 'readFile').callsFake(fsStub.readFile);

        // Get the MCP tool
        const tools = createMCPUniversalProxyTools(context);
        mcpTool = tools.find(t => t.name === 'mcp');
    });

    afterEach(() => {
        sandbox.restore();
    });

    describe('Installation', () => {
        it('should install npm packages correctly', async () => {
            const packageName = '@modelcontextprotocol/server-github';
            
            // Mock successful npm install
            execStub.withArgs('npm install').callsArgWith(2, null, 'installed', '');
            
            // Mock package.json read
            fsStub.readFile.resolves(JSON.stringify({
                name: packageName,
                version: '1.0.0',
                main: 'dist/index.js'
            }));

            const result = await mcpTool.handler({
                action: 'install',
                package: packageName
            });

            assert(result.includes('Successfully installed'));
            assert(result.includes('1.0.0'));
            assert(fsStub.mkdir.called);
            assert(fsStub.writeFile.called);
        });

        it('should install Python packages correctly', async () => {
            const packageName = 'mcp-server-git';
            
            // Mock successful uvx install
            execStub.withArgs(sinon.match(/uvx install/)).callsArgWith(2, null, 'installed', '');
            execStub.withArgs(sinon.match(/uvx.*--version/)).callsArgWith(2, null, '1.2.3', '');

            const result = await mcpTool.handler({
                action: 'install',
                package: packageName,
                type: 'python'
            });

            assert(result.includes('Successfully installed'));
            assert(result.includes('1.2.3'));
        });

        it('should detect package type automatically', async () => {
            // NPM package
            execStub.callsArgWith(2, null, 'installed', '');
            fsStub.readFile.resolves(JSON.stringify({
                name: 'test',
                version: '1.0.0'
            }));

            await mcpTool.handler({
                action: 'install',
                package: '@scope/package'
            });

            assert(execStub.calledWith('npm install'));

            // Python package
            execStub.reset();
            execStub.callsArgWith(2, null, 'installed', '');
            
            await mcpTool.handler({
                action: 'install',
                package: 'mcp-server-test'
            });

            assert(execStub.calledWith(sinon.match(/uvx install/)));
        });

        it('should not reinstall if already installed without force', async () => {
            // Pre-populate installed servers
            globalState.set('mcp-installed-servers', [{
                name: 'github',
                package: '@modelcontextprotocol/server-github',
                installed: true,
                version: '1.0.0'
            }]);

            const result = await mcpTool.handler({
                action: 'install',
                package: '@modelcontextprotocol/server-github'
            });

            assert(result.includes('already installed'));
            assert(!execStub.called);
        });

        it('should reinstall with force flag', async () => {
            globalState.set('mcp-installed-servers', [{
                name: 'github',
                package: '@modelcontextprotocol/server-github',
                installed: true
            }]);

            execStub.callsArgWith(2, null, 'installed', '');
            fsStub.readFile.resolves(JSON.stringify({
                version: '2.0.0'
            }));

            const result = await mcpTool.handler({
                action: 'install',
                package: '@modelcontextprotocol/server-github',
                force: true
            });

            assert(result.includes('Successfully installed'));
            assert(execStub.called);
        });
    });

    describe('Tool Proxy', () => {
        let spawnStub: sinon.SinonStub;
        let mockProcess: any;

        beforeEach(() => {
            mockProcess = {
                stdin: { write: sandbox.stub() },
                stdout: { 
                    on: sandbox.stub(),
                    off: sandbox.stub()
                },
                stderr: { on: sandbox.stub() },
                pid: 12345
            };

            spawnStub = sandbox.stub(cp, 'spawn').returns(mockProcess as any);
        });

        it('should proxy tool calls to the correct server', async () => {
            // Setup installed server
            globalState.set('mcp-installed-servers', [{
                name: 'github',
                package: '@modelcontextprotocol/server-github',
                installed: true,
                installPath: '/test/storage/mcp-servers/github',
                capabilities: {
                    tools: ['github_search', 'github_create_issue']
                }
            }]);

            // Simulate server response
            mockProcess.stdout.on.callsArgWith(1, JSON.stringify({
                jsonrpc: '2.0',
                id: 1,
                result: {
                    content: [{ type: 'text', text: 'Search results' }]
                }
            }));

            const result = await mcpTool.handler({
                action: 'call',
                tool: 'github_search',
                args: { query: 'test' }
            });

            assert(result.includes('Tool called via github'));
            assert(result.includes('Search results'));
        });

        it('should handle tool not found error', async () => {
            const result = await mcpTool.handler({
                action: 'call',
                tool: 'unknown_tool'
            });

            assert(result.includes('No server found for tool'));
        });

        it('should auto-connect to server if not connected', async () => {
            globalState.set('mcp-installed-servers', [{
                name: 'sqlite',
                package: '@modelcontextprotocol/server-sqlite',
                installed: true,
                installPath: '/test/storage/mcp-servers/sqlite'
            }]);

            // Mock initial connection response
            let callCount = 0;
            mockProcess.stdout.on.callsFake((event: string, handler: Function) => {
                if (event === 'data') {
                    // First call: capabilities
                    if (callCount === 0) {
                        handler(JSON.stringify({
                            jsonrpc: '2.0',
                            result: {
                                tools: [{ name: 'sqlite_query' }]
                            }
                        }));
                    }
                    // Second call: actual tool response
                    else if (callCount === 1) {
                        handler(JSON.stringify({
                            jsonrpc: '2.0',
                            result: {
                                content: [{ type: 'text', text: 'Query result' }]
                            }
                        }));
                    }
                    callCount++;
                }
            });

            const result = await mcpTool.handler({
                action: 'call',
                tool: 'sqlite_query',
                args: { query: 'SELECT * FROM users' }
            });

            assert(spawnStub.called);
            assert(result.includes('Query result'));
        });
    });

    describe('Listing Capabilities', () => {
        it('should list all installed servers and their capabilities', async () => {
            globalState.set('mcp-installed-servers', [
                {
                    name: 'github',
                    package: '@modelcontextprotocol/server-github',
                    installed: true,
                    version: '1.0.0',
                    type: 'npm',
                    capabilities: {
                        tools: ['github_search', 'github_create_issue'],
                        resources: ['github://repo'],
                        prompts: ['review_pr']
                    }
                },
                {
                    name: 'sqlite',
                    package: '@modelcontextprotocol/server-sqlite',
                    installed: true,
                    version: '2.0.0',
                    type: 'npm',
                    capabilities: {
                        tools: ['sqlite_query', 'sqlite_execute']
                    }
                }
            ]);

            const result = await mcpTool.handler({ action: 'list' });

            assert(result.includes('github'));
            assert(result.includes('sqlite'));
            assert(result.includes('github_search'));
            assert(result.includes('sqlite_query'));
            assert(result.includes('Tools: 2'));
            assert(result.includes('Resources: 1'));
            assert(result.includes('Prompts: 1'));
        });

        it('should show empty state when no servers installed', async () => {
            const result = await mcpTool.handler({ action: 'list' });
            assert(result.includes('MCP Proxy Status'));
            assert(result.includes('Installed Servers'));
        });
    });

    describe('Error Handling', () => {
        it('should handle npm install failures', async () => {
            execStub.callsArgWith(2, new Error('npm install failed'));

            try {
                await mcpTool.handler({
                    action: 'install',
                    package: '@modelcontextprotocol/server-test'
                });
                assert.fail('Should have thrown');
            } catch (error: any) {
                assert(error.message.includes('Failed to install'));
            }
        });

        it('should handle missing required parameters', async () => {
            let result = await mcpTool.handler({ action: 'install' });
            assert(result.includes('Package name required'));

            result = await mcpTool.handler({ action: 'call' });
            assert(result.includes('Tool name required'));
        });

        it('should handle unknown actions gracefully', async () => {
            const result = await mcpTool.handler({ action: 'unknown' });
            assert(result.includes('Unknown action'));
        });

        it('should handle server connection failures', async () => {
            const spawnStub = sandbox.stub(cp, 'spawn');
            spawnStub.throws(new Error('Failed to start server'));

            globalState.set('mcp-installed-servers', [{
                name: 'test',
                installed: true,
                capabilities: { tools: ['test_tool'] }
            }]);

            try {
                await mcpTool.handler({
                    action: 'call',
                    tool: 'test_tool'
                });
                assert.fail('Should have thrown');
            } catch (error: any) {
                assert(error.message.includes('Failed to start server'));
            }
        });
    });

    describe('Package Name Extraction', () => {
        const testCases = [
            ['@modelcontextprotocol/server-github', 'github'],
            ['@scope/server-test', 'test'],
            ['mcp-server-git', 'git'],
            ['simple-package', 'simple-package'],
            ['server-sqlite', 'sqlite']
        ];

        testCases.forEach(([input, expected]) => {
            it(`should extract "${expected}" from "${input}"`, async () => {
                execStub.callsArgWith(2, null, '', '');
                fsStub.readFile.resolves(JSON.stringify({ version: '1.0.0' }));

                const result = await mcpTool.handler({
                    action: 'install',
                    package: input
                });

                const installedServers = globalState.get('mcp-installed-servers') || [];
                assert(installedServers.some((s: any) => s.name === expected));
            });
        });
    });
});