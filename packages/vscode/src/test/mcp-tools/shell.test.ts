import * as assert from 'assert';
import * as sinon from 'sinon';
import * as vscode from 'vscode';
import * as cp from 'child_process';
import * as os from 'os';
import { createShellTools } from '../../mcp/tools/shell';

suite('Shell Tools Test Suite', () => {
    let context: vscode.ExtensionContext;
    let shellTools: any[];
    let sandbox: sinon.SinonSandbox;
    let workspaceStub: sinon.SinonStub;
    let execStub: sinon.SinonStub;
    let spawnStub: sinon.SinonStub;
    let platformStub: sinon.SinonStub;
    let envStub: any;

    setup(() => {
        sandbox = sinon.createSandbox();
        
        // Mock VS Code workspace
        workspaceStub = sandbox.stub(vscode.workspace, 'workspaceFolders').value([{
            uri: vscode.Uri.file('/test/workspace'),
            name: 'Test Workspace',
            index: 0
        }]);
        
        // Mock child_process methods
        execStub = sandbox.stub(cp, 'exec');
        spawnStub = sandbox.stub(cp, 'spawn');
        
        // Mock platform
        platformStub = sandbox.stub(os, 'platform');
        platformStub.returns('darwin'); // Default to macOS
        
        // Mock VS Code env
        envStub = {
            openExternal: sandbox.stub().resolves(true)
        };
        sandbox.stub(vscode, 'env').value(envStub);
        
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
        
        shellTools = createShellTools(context);
    });

    teardown(() => {
        sandbox.restore();
    });

    test('Run_command tool should execute simple commands', async () => {
        const runCommandTool = shellTools.find(t => t.name === 'run_command');
        assert.ok(runCommandTool);
        
        execStub.callsFake((cmd, options, callback) => {
            callback(null, 'Hello, World!', '');
        });
        
        const result = await runCommandTool.handler({
            command: 'echo "Hello, World!"'
        });
        
        assert.strictEqual(result, 'Hello, World!');
        assert.ok(execStub.calledOnce);
        assert.ok(execStub.calledWith('echo "Hello, World!"'));
    });

    test('Run_command tool should execute in working directory', async () => {
        const runCommandTool = shellTools.find(t => t.name === 'run_command');
        
        execStub.callsFake((cmd, options, callback) => {
            callback(null, '/custom/dir', '');
        });
        
        await runCommandTool.handler({
            command: 'pwd',
            working_directory: '/custom/dir'
        });
        
        const execCall = execStub.firstCall;
        assert.strictEqual(execCall.args[1].cwd, '/custom/dir');
    });

    test('Run_command tool should handle stderr', async () => {
        const runCommandTool = shellTools.find(t => t.name === 'run_command');
        
        execStub.callsFake((cmd, options, callback) => {
            callback(null, 'Output', 'Warning: Something happened');
        });
        
        const result = await runCommandTool.handler({
            command: 'some-command'
        });
        
        assert.ok(result.includes('Output'));
        assert.ok(result.includes('STDERR:'));
        assert.ok(result.includes('Warning: Something happened'));
    });

    test('Run_command tool should handle errors', async () => {
        const runCommandTool = shellTools.find(t => t.name === 'run_command');
        
        execStub.callsFake((cmd, options, callback) => {
            const error = new Error('Command failed');
            (error as any).code = 1;
            callback(error, '', 'Command not found');
        });
        
        await assert.rejects(
            runCommandTool.handler({ command: 'invalid-command' }),
            /Command failed/
        );
    });

    test('Open tool should open URLs', async () => {
        const openTool = shellTools.find(t => t.name === 'open');
        assert.ok(openTool);
        
        const result = await openTool.handler({
            path_or_url: 'https://example.com'
        });
        
        assert.ok(envStub.openExternal.calledOnce);
        assert.ok(envStub.openExternal.calledWith(
            vscode.Uri.parse('https://example.com')
        ));
        assert.ok(result.includes('Opened: https://example.com'));
    });

    test('Open tool should open files', async () => {
        const openTool = shellTools.find(t => t.name === 'open');
        
        // Mock VS Code commands
        const executeCommandStub = sandbox.stub(vscode.commands, 'executeCommand').resolves();
        
        const result = await openTool.handler({
            path_or_url: '/test/workspace/file.txt'
        });
        
        assert.ok(executeCommandStub.calledOnce);
        assert.ok(executeCommandStub.calledWith(
            'vscode.open',
            vscode.Uri.file('/test/workspace/file.txt')
        ));
        assert.ok(result.includes('Opened file: /test/workspace/file.txt'));
    });

    test('Open tool should handle platform-specific paths', async () => {
        const openTool = shellTools.find(t => t.name === 'open');
        
        // Test on Windows
        platformStub.returns('win32');
        
        const result = await openTool.handler({
            path_or_url: 'C:\\Users\\test\\file.txt'
        });
        
        assert.ok(result.includes('Opened'));
    });

    test('Run_command tool should respect timeout', async () => {
        const runCommandTool = shellTools.find(t => t.name === 'run_command');
        
        let timeoutId: NodeJS.Timeout;
        execStub.callsFake((cmd, options, callback) => {
            // Simulate long-running command
            timeoutId = setTimeout(() => {
                callback(null, 'Done', '');
            }, 2000);
            
            return {
                kill: () => {
                    clearTimeout(timeoutId);
                    const error = new Error('Command timed out');
                    (error as any).killed = true;
                    callback(error, '', '');
                }
            };
        });
        
        await assert.rejects(
            runCommandTool.handler({
                command: 'sleep 10',
                timeout: 100 // 100ms timeout
            }),
            /timed out/
        );
    });

    test('Run_command tool should pass environment variables', async () => {
        const runCommandTool = shellTools.find(t => t.name === 'run_command');
        
        execStub.callsFake((cmd, options, callback) => {
            callback(null, 'TEST_VALUE', '');
        });
        
        await runCommandTool.handler({
            command: 'echo $TEST_VAR',
            environment: {
                TEST_VAR: 'TEST_VALUE'
            }
        });
        
        const execCall = execStub.firstCall;
        assert.ok(execCall.args[1].env.TEST_VAR === 'TEST_VALUE');
    });

    test('Run_command tool should handle shell escaping', async () => {
        const runCommandTool = shellTools.find(t => t.name === 'run_command');
        
        execStub.callsFake((cmd, options, callback) => {
            callback(null, 'File with spaces.txt', '');
        });
        
        const result = await runCommandTool.handler({
            command: 'ls "File with spaces.txt"'
        });
        
        assert.ok(result.includes('File with spaces.txt'));
    });

    test('Open tool should handle invalid URLs', async () => {
        const openTool = shellTools.find(t => t.name === 'open');
        
        envStub.openExternal.rejects(new Error('Invalid URL'));
        
        await assert.rejects(
            openTool.handler({ path_or_url: 'not-a-valid-url' }),
            /Invalid URL/
        );
    });

    test('Run_command tool should handle large output', async () => {
        const runCommandTool = shellTools.find(t => t.name === 'run_command');
        
        const largeOutput = 'x'.repeat(1024 * 1024); // 1MB of output
        execStub.callsFake((cmd, options, callback) => {
            callback(null, largeOutput, '');
        });
        
        const result = await runCommandTool.handler({
            command: 'generate-large-output'
        });
        
        assert.ok(result.length <= 100000); // Should be truncated
        assert.ok(result.includes('[Output truncated'));
    });

    test('Run_command tool should handle binary output', async () => {
        const runCommandTool = shellTools.find(t => t.name === 'run_command');
        
        execStub.callsFake((cmd, options, callback) => {
            // Simulate binary output
            callback(null, Buffer.from([0xFF, 0xFE, 0x00, 0x01]).toString(), '');
        });
        
        const result = await runCommandTool.handler({
            command: 'cat binary-file'
        });
        
        // Should handle binary data without crashing
        assert.ok(typeof result === 'string');
    });

    test('Open tool should handle directories', async () => {
        const openTool = shellTools.find(t => t.name === 'open');
        
        // Mock file system check
        const fs = require('fs');
        const statSyncStub = sandbox.stub(fs, 'statSync').returns({
            isDirectory: () => true,
            isFile: () => false
        });
        
        const executeCommandStub = sandbox.stub(vscode.commands, 'executeCommand').resolves();
        
        await openTool.handler({
            path_or_url: '/test/workspace'
        });
        
        assert.ok(executeCommandStub.calledWith('revealInExplorer'));
    });

    test('Run_command tool should use shell on Windows', async () => {
        platformStub.returns('win32');
        
        // Recreate tools with Windows platform
        shellTools = createShellTools(context);
        const runCommandTool = shellTools.find(t => t.name === 'run_command');
        
        execStub.callsFake((cmd, options, callback) => {
            callback(null, 'Windows output', '');
        });
        
        await runCommandTool.handler({
            command: 'dir'
        });
        
        const execCall = execStub.firstCall;
        assert.ok(execCall.args[1].shell === true || execCall.args[1].shell === 'cmd.exe');
    });
});