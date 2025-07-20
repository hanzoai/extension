import * as assert from 'assert';
import * as sinon from 'sinon';
import * as vscode from 'vscode';
import * as cp from 'child_process';
import * as os from 'os';
import { createProcessTool } from '../../mcp/tools/process';

suite('Process Tool Test Suite', () => {
    let context: vscode.ExtensionContext;
    let processTool: any;
    let sandbox: sinon.SinonSandbox;
    let execStub: sinon.SinonStub;
    let platformStub: sinon.SinonStub;

    setup(() => {
        sandbox = sinon.createSandbox();
        
        // Mock child_process.exec
        execStub = sandbox.stub(cp, 'exec');
        
        // Mock platform
        platformStub = sandbox.stub(os, 'platform');
        platformStub.returns('darwin'); // Default to macOS
        
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
        
        processTool = createProcessTool(context);
    });

    teardown(() => {
        sandbox.restore();
    });

    test('Process tool should list processes on macOS', async () => {
        platformStub.returns('darwin');
        processTool = createProcessTool(context); // Recreate with macOS platform
        
        const psOutput = `  PID TTY           TIME CMD
  123 ??         0:00.50 /usr/bin/node
  456 ??         0:10.25 /Applications/Visual Studio Code.app/Contents/MacOS/Electron
  789 ??         0:05.00 /usr/bin/python3 script.py
`;
        
        execStub.callsFake((cmd, callback) => {
            if (cmd.includes('ps aux')) {
                callback(null, psOutput, '');
            }
        });
        
        const result = await processTool.handler({});
        
        assert.ok(result.includes('3 processes found'));
        assert.ok(result.includes('PID: 123'));
        assert.ok(result.includes('node'));
        assert.ok(result.includes('PID: 456'));
        assert.ok(result.includes('Visual Studio Code'));
        assert.ok(result.includes('PID: 789'));
        assert.ok(result.includes('python3'));
    });

    test('Process tool should filter by query', async () => {
        platformStub.returns('darwin');
        processTool = createProcessTool(context);
        
        const psOutput = `  PID TTY           TIME CMD
  123 ??         0:00.50 /usr/bin/node server.js
  456 ??         0:10.25 /usr/bin/python3 app.py
  789 ??         0:05.00 /usr/bin/node worker.js
`;
        
        execStub.callsFake((cmd, callback) => {
            callback(null, psOutput, '');
        });
        
        const result = await processTool.handler({ query: 'node' });
        
        assert.ok(result.includes('2 processes found'));
        assert.ok(result.includes('PID: 123'));
        assert.ok(result.includes('server.js'));
        assert.ok(result.includes('PID: 789'));
        assert.ok(result.includes('worker.js'));
        assert.ok(!result.includes('python3'));
    });

    test('Process tool should list processes on Windows', async () => {
        platformStub.returns('win32');
        processTool = createProcessTool(context); // Recreate with Windows platform
        
        const tasklistOutput = `
Image Name                     PID Session Name        Session#    Mem Usage
========================= ======== ================ =========== ============
System Idle Process              0 Services                   0          8 K
System                           4 Services                   0        148 K
node.exe                      1234 Console                    1     45,232 K
Code.exe                      5678 Console                    1    125,456 K
python.exe                    9012 Console                    1     32,768 K
`;
        
        execStub.callsFake((cmd, callback) => {
            if (cmd.includes('tasklist')) {
                callback(null, tasklistOutput, '');
            }
        });
        
        const result = await processTool.handler({});
        
        assert.ok(result.includes('5 processes found'));
        assert.ok(result.includes('PID: 1234'));
        assert.ok(result.includes('node.exe'));
        assert.ok(result.includes('45,232 K'));
        assert.ok(result.includes('PID: 5678'));
        assert.ok(result.includes('Code.exe'));
    });

    test('Process tool should list processes on Linux', async () => {
        platformStub.returns('linux');
        processTool = createProcessTool(context);
        
        const psOutput = `USER         PID %CPU %MEM    VSZ   RSS TTY      STAT START   TIME COMMAND
root           1  0.0  0.1 169432 11520 ?        Ss   09:00   0:01 /sbin/init
user        1234  1.5  2.0 2548364 167890 ?      Sl   10:30   0:15 node /app/server.js
user        5678  5.2  8.5 4821456 692456 ?      Sl   10:00   2:30 code
user        9012  0.8  1.2 521234 98765 pts/0    S+   11:00   0:05 python3 script.py
`;
        
        execStub.callsFake((cmd, callback) => {
            callback(null, psOutput, '');
        });
        
        const result = await processTool.handler({});
        
        assert.ok(result.includes('4 processes found'));
        assert.ok(result.includes('PID: 1'));
        assert.ok(result.includes('/sbin/init'));
        assert.ok(result.includes('PID: 1234'));
        assert.ok(result.includes('server.js'));
    });

    test('Process tool should kill process by PID', async () => {
        platformStub.returns('darwin');
        processTool = createProcessTool(context);
        
        execStub.callsFake((cmd, callback) => {
            if (cmd.includes('kill -9 1234')) {
                callback(null, '', '');
            }
        });
        
        const result = await processTool.handler({
            action: 'kill',
            pid: 1234
        });
        
        assert.ok(result.includes('Successfully killed process 1234'));
        assert.ok(execStub.calledWith('kill -9 1234'));
    });

    test('Process tool should kill process on Windows', async () => {
        platformStub.returns('win32');
        processTool = createProcessTool(context);
        
        execStub.callsFake((cmd, callback) => {
            if (cmd.includes('taskkill /F /PID 1234')) {
                callback(null, 'SUCCESS: The process with PID 1234 has been terminated.', '');
            }
        });
        
        const result = await processTool.handler({
            action: 'kill',
            pid: 1234
        });
        
        assert.ok(result.includes('Successfully killed process 1234'));
        assert.ok(execStub.calledWith('taskkill /F /PID 1234'));
    });

    test('Process tool should handle kill errors', async () => {
        processTool = createProcessTool(context);
        
        execStub.callsFake((cmd, callback) => {
            if (cmd.includes('kill')) {
                callback(new Error('Operation not permitted'), '', 'kill: (1234) - Operation not permitted');
            }
        });
        
        await assert.rejects(
            processTool.handler({ action: 'kill', pid: 1234 }),
            /Operation not permitted/
        );
    });

    test('Process tool should require PID for kill action', async () => {
        const result = await processTool.handler({ action: 'kill' });
        
        assert.ok(result.includes('Error: PID is required'));
    });

    test('Process tool should handle case-insensitive queries', async () => {
        platformStub.returns('darwin');
        processTool = createProcessTool(context);
        
        const psOutput = `  PID TTY           TIME CMD
  123 ??         0:00.50 /usr/bin/Node
  456 ??         0:10.25 /Applications/Visual Studio Code.app
  789 ??         0:05.00 /usr/bin/NODE
`;
        
        execStub.callsFake((cmd, callback) => {
            callback(null, psOutput, '');
        });
        
        const result = await processTool.handler({ query: 'node' });
        
        assert.ok(result.includes('2 processes found'));
        assert.ok(result.includes('PID: 123'));
        assert.ok(result.includes('PID: 789'));
    });

    test('Process tool should handle exec errors', async () => {
        execStub.callsFake((cmd, callback) => {
            callback(new Error('Command not found'), '', '');
        });
        
        await assert.rejects(
            processTool.handler({}),
            /Command not found/
        );
    });

    test('Process tool should show memory usage on macOS', async () => {
        platformStub.returns('darwin');
        processTool = createProcessTool(context);
        
        const psOutput = `  PID %CPU %MEM      TIME CMD
  123  0.5  2.5   0:00.50 /usr/bin/node
  456 10.2  5.8   0:10.25 /Applications/Code.app
`;
        
        execStub.callsFake((cmd, callback) => {
            callback(null, psOutput, '');
        });
        
        const result = await processTool.handler({});
        
        assert.ok(result.includes('CPU: 0.5%'));
        assert.ok(result.includes('Memory: 2.5%'));
        assert.ok(result.includes('CPU: 10.2%'));
        assert.ok(result.includes('Memory: 5.8%'));
    });

    test('Process tool should handle empty process list', async () => {
        execStub.callsFake((cmd, callback) => {
            callback(null, '', '');
        });
        
        const result = await processTool.handler({ query: 'nonexistent' });
        
        assert.ok(result.includes('0 processes found'));
    });

    test('Process tool should handle malformed output', async () => {
        execStub.callsFake((cmd, callback) => {
            callback(null, 'Invalid output format', '');
        });
        
        const result = await processTool.handler({});
        
        // Should handle gracefully and show some result
        assert.ok(typeof result === 'string');
        assert.ok(result.includes('processes found') || result.includes('Invalid'));
    });

    test('Process tool should handle unknown platform', async () => {
        platformStub.returns('freebsd'); // Unsupported platform
        processTool = createProcessTool(context);
        
        // Should fall back to Unix-like command
        const psOutput = `PID  COMMAND
123  node
456  python3
`;
        
        execStub.callsFake((cmd, callback) => {
            if (cmd.includes('ps')) {
                callback(null, psOutput, '');
            }
        });
        
        const result = await processTool.handler({});
        
        assert.ok(result.includes('processes found'));
    });
});