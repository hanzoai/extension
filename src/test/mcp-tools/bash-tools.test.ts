import * as assert from 'assert';
import * as sinon from 'sinon';
import * as vscode from 'vscode';
import * as cp from 'child_process';
import { BashTools } from '../../mcp/tools/bash';

suite('Bash Tools Test Suite', () => {
    let context: vscode.ExtensionContext;
    let bashTools: BashTools;
    let sandbox: sinon.SinonSandbox;
    let execStub: sinon.SinonStub;
    let spawnStub: sinon.SinonStub;

    setup(() => {
        sandbox = sinon.createSandbox();
        
        // Mock child_process
        execStub = sandbox.stub(cp, 'exec');
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
        
        bashTools = new BashTools(context);
    });

    teardown(() => {
        sandbox.restore();
    });

    test('Bash tool should execute simple commands', async () => {
        execStub.callsFake((cmd, options, callback) => {
            callback(null, 'Hello, World!', '');
        });
        
        const bashTool = bashTools.getTools().find(t => t.name === 'bash')!;
        
        const result = await bashTool.handler({
            command: 'echo "Hello, World!"'
        });
        
        assert.strictEqual(result, 'Hello, World!');
        assert.ok(execStub.calledOnce);
        assert.strictEqual(execStub.firstCall.args[0], 'echo "Hello, World!"');
    });

    test('Bash tool should handle cd commands specially', async () => {
        sandbox.stub(vscode.workspace.fs, 'stat').resolves();
        
        const bashTool = bashTools.getTools().find(t => t.name === 'bash')!;
        
        const result = await bashTool.handler({
            command: 'cd /test/dir'
        });
        
        assert.ok(result.includes('Changed directory to: /test/dir'));
        assert.ok(execStub.notCalled); // Should not execute cd through exec
    });

    test('Bash tool should maintain session state', async () => {
        execStub.onFirstCall().callsFake((cmd, options, callback) => {
            callback(null, 'First command', '');
        });
        execStub.onSecondCall().callsFake((cmd, options, callback) => {
            callback(null, 'Second command', '');
        });
        
        const bashTool = bashTools.getTools().find(t => t.name === 'bash')!;
        
        // First command with new session
        await bashTool.handler({
            command: 'echo "First"',
            session_id: 'test-session'
        });
        
        // Second command with same session
        await bashTool.handler({
            command: 'echo "Second"',
            session_id: 'test-session'
        });
        
        // Verify session was saved
        assert.ok(context.globalState.update.called);
        const savedSessions = context.globalState.update.firstCall.args[1];
        assert.ok(Array.isArray(savedSessions));
        assert.ok(savedSessions.some((s: any) => s.id === 'test-session'));
    });

    test('Run background tool should spawn processes', async () => {
        const mockProcess = {
            pid: 12345,
            stdout: new (require('events').EventEmitter)(),
            stderr: new (require('events').EventEmitter)(),
            on: sandbox.stub(),
            kill: sandbox.stub()
        };
        
        spawnStub.returns(mockProcess as any);
        
        const runBackgroundTool = bashTools.getTools().find(t => t.name === 'run_background')!;
        
        const result = await runBackgroundTool.handler({
            command: 'npm run dev',
            name: 'dev-server'
        });
        
        assert.ok(result.includes('Started background process'));
        assert.ok(result.includes('dev-server'));
        assert.ok(result.includes('12345'));
        
        assert.ok(spawnStub.calledOnce);
        assert.strictEqual(spawnStub.firstCall.args[0], 'npm run dev');
    });

    test('Processes tool should list running processes', async () => {
        // Start a mock background process first
        const mockProcess = {
            pid: 12345,
            killed: false,
            stdout: new (require('events').EventEmitter)(),
            stderr: new (require('events').EventEmitter)(),
            on: sandbox.stub()
        };
        
        spawnStub.returns(mockProcess as any);
        
        const runBackgroundTool = bashTools.getTools().find(t => t.name === 'run_background')!;
        await runBackgroundTool.handler({
            command: 'test-command',
            name: 'test-process'
        });
        
        const processesTool = bashTools.getTools().find(t => t.name === 'processes')!;
        const result = await processesTool.handler({});
        
        assert.ok(result.includes('Running processes:'));
        assert.ok(result.includes('test-process'));
        assert.ok(result.includes('12345'));
        assert.ok(result.includes('running'));
    });

    test('Pkill tool should kill processes by name', async () => {
        const mockProcess = {
            pid: 12345,
            killed: false,
            stdout: new (require('events').EventEmitter)(),
            stderr: new (require('events').EventEmitter)(),
            on: sandbox.stub(),
            kill: sandbox.stub()
        };
        
        spawnStub.returns(mockProcess as any);
        
        // Start a process
        const runBackgroundTool = bashTools.getTools().find(t => t.name === 'run_background')!;
        await runBackgroundTool.handler({
            command: 'test-command',
            name: 'test-process'
        });
        
        // Kill it
        const pkillTool = bashTools.getTools().find(t => t.name === 'pkill')!;
        const result = await pkillTool.handler({
            name: 'test-process'
        });
        
        assert.ok(result.includes('Sent SIGTERM'));
        assert.ok(result.includes('test-process'));
        assert.ok(mockProcess.kill.calledWith('SIGTERM'));
    });

    test('Logs tool should return process logs', async () => {
        const mockProcess = {
            pid: 12345,
            stdout: new (require('events').EventEmitter)(),
            stderr: new (require('events').EventEmitter)(),
            on: sandbox.stub()
        };
        
        spawnStub.returns(mockProcess as any);
        
        // Start a process
        const runBackgroundTool = bashTools.getTools().find(t => t.name === 'run_background')!;
        await runBackgroundTool.handler({
            command: 'test-command',
            name: 'test-process'
        });
        
        // Emit some logs
        mockProcess.stdout.emit('data', Buffer.from('Test stdout log\n'));
        mockProcess.stderr.emit('data', Buffer.from('Test stderr log\n'));
        
        // Get logs
        const logsTool = bashTools.getTools().find(t => t.name === 'logs')!;
        const result = await logsTool.handler({
            name: 'test-process',
            lines: 10
        });
        
        assert.ok(result.includes('Logs for \'test-process\''));
        assert.ok(result.includes('[stdout] Test stdout log'));
        assert.ok(result.includes('[stderr] Test stderr log'));
    });

    test('NPX tool should execute npx commands', async () => {
        execStub.callsFake((cmd, options, callback) => {
            callback(null, 'NPX command output', '');
        });
        
        const npxTool = bashTools.getTools().find(t => t.name === 'npx')!;
        
        const result = await npxTool.handler({
            command: 'create-react-app my-app'
        });
        
        assert.strictEqual(result, 'NPX command output');
        assert.ok(execStub.calledOnce);
        assert.strictEqual(execStub.firstCall.args[0], 'npx create-react-app my-app');
        assert.strictEqual(execStub.firstCall.args[1].timeout, 60000); // 1 minute timeout
    });

    test('UVX tool should execute uvx commands', async () => {
        execStub.callsFake((cmd, options, callback) => {
            callback(null, 'UVX command output', '');
        });
        
        const uvxTool = bashTools.getTools().find(t => t.name === 'uvx')!;
        
        const result = await uvxTool.handler({
            command: 'ruff check .'
        });
        
        assert.strictEqual(result, 'UVX command output');
        assert.ok(execStub.calledOnce);
        assert.strictEqual(execStub.firstCall.args[0], 'uvx ruff check .');
    });

    test('Bash tool should handle command errors', async () => {
        execStub.callsFake((cmd, options, callback) => {
            const error = new Error('Command failed');
            (error as any).code = 1;
            callback(error, '', 'Error: command not found');
        });
        
        const bashTool = bashTools.getTools().find(t => t.name === 'bash')!;
        
        await assert.rejects(
            bashTool.handler({ command: 'invalid-command' }),
            /Command failed.*Error: command not found/
        );
    });

    test('Bash tool should handle command timeouts', async () => {
        execStub.callsFake((cmd, options, callback) => {
            const error = new Error('Command timeout');
            (error as any).killed = true;
            callback(error, '', '');
        });
        
        const bashTool = bashTools.getTools().find(t => t.name === 'bash')!;
        
        await assert.rejects(
            bashTool.handler({ command: 'sleep 100', timeout: 100 }),
            /Command timed out after 100ms/
        );
    });

    test('Background processes should handle exit events', async () => {
        const mockProcess = {
            pid: 12345,
            stdout: new (require('events').EventEmitter)(),
            stderr: new (require('events').EventEmitter)(),
            on: sandbox.stub().callsFake((event, handler) => {
                if (event === 'exit') {
                    // Simulate process exit after a delay
                    setTimeout(() => handler(0), 10);
                }
            })
        };
        
        spawnStub.returns(mockProcess as any);
        
        const runBackgroundTool = bashTools.getTools().find(t => t.name === 'run_background')!;
        await runBackgroundTool.handler({
            command: 'test-command',
            name: 'test-process'
        });
        
        // Wait for exit event
        await new Promise(resolve => setTimeout(resolve, 20));
        
        // Check logs for exit message
        const logsTool = bashTools.getTools().find(t => t.name === 'logs')!;
        const result = await logsTool.handler({
            name: 'test-process'
        });
        
        assert.ok(result.includes('[exit] Process exited with code 0'));
    });
});