import * as assert from 'assert';
import * as sinon from 'sinon';
import * as vscode from 'vscode';
import * as cp from 'child_process';
import { MCPRunnerTools } from '../../mcp/tools/mcp-runner';

suite('MCP Runner Tools Test Suite', () => {
    let context: vscode.ExtensionContext;
    let mcpRunner: MCPRunnerTools;
    let sandbox: sinon.SinonSandbox;
    let spawnStub: sinon.SinonStub;

    setup(() => {
        sandbox = sinon.createSandbox();
        
        // Mock child_process.spawn
        spawnStub = sandbox.stub(cp, 'spawn');
        
        // Mock VS Code workspace
        sandbox.stub(vscode.workspace, 'workspaceFolders').value([{
            uri: vscode.Uri.file('/test/workspace'),
            name: 'Test Workspace',
            index: 0
        }]);
        
        // Mock VS Code context
        context = {
            subscriptions: [],
            workspaceState: {
                get: sandbox.stub(),
                update: sandbox.stub().resolves()
            },
            globalState: {
                get: sandbox.stub().returns([]),
                update: sandbox.stub().resolves(),
                setKeysForSync: sandbox.stub()
            },
            extensionPath: '/test/extension',
            extensionUri: vscode.Uri.file('/test/extension'),
            storageUri: vscode.Uri.file('/test/storage'),
            globalStorageUri: vscode.Uri.file('/test/global-storage'),
            logUri: vscode.Uri.file('/test/logs'),
            extensionMode: vscode.ExtensionMode.Test,
            asAbsolutePath: (path: string) => `/test/extension/${path}`,
            storagePath: '/test/storage',
            globalStoragePath: '/test/global-storage',
            logPath: '/test/logs'
        } as any;
        
        mcpRunner = new MCPRunnerTools(context);
    });

    teardown(() => {
        sandbox.restore();
    });

    test('MCP tool should add server configuration', async () => {
        const mcpTool = mcpRunner.getTools().find(t => t.name === 'mcp')!;
        
        const result = await mcpTool.handler({
            action: 'add',
            name: 'test-server',
            command: 'npx @modelcontextprotocol/server-filesystem',
            args: ['/tmp'],
            transport: 'stdio'
        });
        
        assert.ok(result.includes('Added MCP server'));
        assert.ok(result.includes('test-server'));
        assert.ok(result.includes('npx @modelcontextprotocol/server-filesystem'));
        
        // Verify saved to global state
        assert.ok(context.globalState.update.calledWith('hanzo.mcpServers'));
    });

    test('MCP tool should start server with stdio transport', async () => {
        const mockProcess = {
            pid: 12345,
            killed: false,
            stdout: new (require('events').EventEmitter)(),
            stderr: new (require('events').EventEmitter)(),
            on: sandbox.stub()
        };
        
        spawnStub.returns(mockProcess as any);
        
        const mcpTool = mcpRunner.getTools().find(t => t.name === 'mcp')!;
        
        // First add the server
        await mcpTool.handler({
            action: 'add',
            name: 'test-server',
            command: 'node',
            args: ['server.js'],
            transport: 'stdio'
        });
        
        // Then start it
        const result = await mcpTool.handler({
            action: 'start',
            name: 'test-server'
        });
        
        assert.ok(result.includes('Started MCP server'));
        assert.ok(result.includes('test-server'));
        assert.ok(result.includes('12345'));
        assert.ok(result.includes('stdio'));
        
        assert.ok(spawnStub.calledOnce);
        assert.strictEqual(spawnStub.firstCall.args[0], 'node');
        assert.deepStrictEqual(spawnStub.firstCall.args[1], ['server.js']);
    });

    test('MCP tool should start server with TCP transport', async () => {
        const mockProcess = {
            pid: 54321,
            killed: false,
            stdout: new (require('events').EventEmitter)(),
            stderr: new (require('events').EventEmitter)(),
            on: sandbox.stub()
        };
        
        spawnStub.returns(mockProcess as any);
        
        const mcpTool = mcpRunner.getTools().find(t => t.name === 'mcp')!;
        
        // Add TCP server
        await mcpTool.handler({
            action: 'add',
            name: 'tcp-server',
            command: 'python',
            args: ['-m', 'mcp.server'],
            transport: 'tcp',
            host: 'localhost',
            port: 8080
        });
        
        // Start it
        const result = await mcpTool.handler({
            action: 'start',
            name: 'tcp-server'
        });
        
        assert.ok(result.includes('Started MCP server'));
        assert.ok(result.includes('tcp://localhost:8080'));
        
        // Check environment variables
        const env = spawnStub.firstCall.args[2].env;
        assert.strictEqual(env.MCP_HOST, 'localhost');
        assert.strictEqual(env.MCP_PORT, '8080');
    });

    test('MCP tool should list servers', async () => {
        const mcpTool = mcpRunner.getTools().find(t => t.name === 'mcp')!;
        
        // Add multiple servers
        await mcpTool.handler({
            action: 'add',
            name: 'server1',
            command: 'node server1.js',
            transport: 'stdio'
        });
        
        await mcpTool.handler({
            action: 'add',
            name: 'server2',
            command: 'python server2.py',
            transport: 'tcp',
            port: 3000
        });
        
        const result = await mcpTool.handler({
            action: 'list'
        });
        
        assert.ok(result.includes('MCP Servers:'));
        assert.ok(result.includes('server1'));
        assert.ok(result.includes('server2'));
        assert.ok(result.includes('node server1.js'));
        assert.ok(result.includes('python server2.py'));
        assert.ok(result.includes('tcp'));
        assert.ok(result.includes('3000'));
    });

    test('MCP tool should stop running server', async () => {
        const mockProcess = {
            pid: 12345,
            killed: false,
            stdout: new (require('events').EventEmitter)(),
            stderr: new (require('events').EventEmitter)(),
            on: sandbox.stub(),
            kill: sandbox.stub()
        };
        
        spawnStub.returns(mockProcess as any);
        
        const mcpTool = mcpRunner.getTools().find(t => t.name === 'mcp')!;
        
        // Add and start server
        await mcpTool.handler({
            action: 'add',
            name: 'test-server',
            command: 'node server.js'
        });
        
        await mcpTool.handler({
            action: 'start',
            name: 'test-server'
        });
        
        // Stop it
        const result = await mcpTool.handler({
            action: 'stop',
            name: 'test-server'
        });
        
        assert.ok(result.includes('Stopped MCP server'));
        assert.ok(mockProcess.kill.calledOnce);
    });

    test('MCP tool should remove server configuration', async () => {
        const mcpTool = mcpRunner.getTools().find(t => t.name === 'mcp')!;
        
        // Add server
        await mcpTool.handler({
            action: 'add',
            name: 'test-server',
            command: 'node server.js'
        });
        
        // Remove it
        const result = await mcpTool.handler({
            action: 'remove',
            name: 'test-server'
        });
        
        assert.ok(result.includes('Removed MCP server'));
        
        // Verify it's gone
        await assert.rejects(
            mcpTool.handler({ action: 'start', name: 'test-server' }),
            /not found/
        );
    });

    test('MCP tool should capture and store logs', async () => {
        const mockProcess = {
            pid: 12345,
            killed: false,
            stdout: new (require('events').EventEmitter)(),
            stderr: new (require('events').EventEmitter)(),
            on: sandbox.stub()
        };
        
        spawnStub.returns(mockProcess as any);
        
        const mcpTool = mcpRunner.getTools().find(t => t.name === 'mcp')!;
        
        // Add and start server
        await mcpTool.handler({
            action: 'add',
            name: 'test-server',
            command: 'node server.js'
        });
        
        await mcpTool.handler({
            action: 'start',
            name: 'test-server'
        });
        
        // Emit some logs
        mockProcess.stdout.emit('data', Buffer.from('Server started on port 3000\n'));
        mockProcess.stderr.emit('data', Buffer.from('Warning: debug mode enabled\n'));
        
        // Get logs
        const result = await mcpTool.handler({
            action: 'logs',
            name: 'test-server',
            lines: 10
        });
        
        assert.ok(result.includes('Logs for \'test-server\''));
        assert.ok(result.includes('[stdout] Server started on port 3000'));
        assert.ok(result.includes('[stderr] Warning: debug mode enabled'));
    });

    test('MCP tool should handle call action placeholder', async () => {
        const mcpTool = mcpRunner.getTools().find(t => t.name === 'mcp')!;
        
        // First add a server
        await mcpTool.handler({
            action: 'add',
            name: 'test-server',
            command: 'node server.js'
        });
        
        // Try to call a tool (placeholder)
        const result = await mcpTool.handler({
            action: 'call',
            name: 'test-server',
            tool: 'some_tool',
            tool_args: { param: 'value' }
        });
        
        assert.ok(result.includes('not yet implemented'));
        assert.ok(result.includes('some_tool'));
        assert.ok(result.includes('"param": "value"'));
    });

    test('MCP tool should handle server errors', async () => {
        const mockProcess = {
            pid: 12345,
            killed: false,
            stdout: new (require('events').EventEmitter)(),
            stderr: new (require('events').EventEmitter)(),
            on: sandbox.stub().callsFake((event, handler) => {
                if (event === 'error') {
                    setTimeout(() => handler(new Error('ENOENT: command not found')), 10);
                }
            })
        };
        
        spawnStub.returns(mockProcess as any);
        
        const mcpTool = mcpRunner.getTools().find(t => t.name === 'mcp')!;
        
        // Add server with invalid command
        await mcpTool.handler({
            action: 'add',
            name: 'bad-server',
            command: 'invalid-command'
        });
        
        // Try to start it
        await mcpTool.handler({
            action: 'start',
            name: 'bad-server'
        });
        
        // Wait for error event
        await new Promise(resolve => setTimeout(resolve, 20));
        
        // Check logs for error
        const logs = await mcpTool.handler({
            action: 'logs',
            name: 'bad-server'
        });
        
        assert.ok(logs.includes('[error] ENOENT: command not found'));
    });

    test('MCP tool should handle duplicate server names', async () => {
        const mcpTool = mcpRunner.getTools().find(t => t.name === 'mcp')!;
        
        // Add first server
        await mcpTool.handler({
            action: 'add',
            name: 'duplicate',
            command: 'node server.js'
        });
        
        // Try to add duplicate
        await assert.rejects(
            mcpTool.handler({
                action: 'add',
                name: 'duplicate',
                command: 'python server.py'
            }),
            /already exists/
        );
    });
});