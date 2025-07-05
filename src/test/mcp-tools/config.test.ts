import * as assert from 'assert';
import * as sinon from 'sinon';
import * as vscode from 'vscode';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import { createConfigTool } from '../../mcp/tools/config/config';

suite('Config Tool Test Suite', () => {
    let context: vscode.ExtensionContext;
    let configTool: any;
    let sandbox: sinon.SinonSandbox;
    let fsStub: {
        readFile: sinon.SinonStub;
        writeFile: sinon.SinonStub;
        mkdir: sinon.SinonStub;
    };

    setup(() => {
        sandbox = sinon.createSandbox();
        
        // Mock file system
        fsStub = {
            readFile: sandbox.stub(fs, 'readFile'),
            writeFile: sandbox.stub(fs, 'writeFile').resolves(),
            mkdir: sandbox.stub(fs, 'mkdir').resolves()
        };
        
        // Mock VS Code workspace
        sandbox.stub(vscode.workspace, 'workspaceFolders').value([{
            uri: vscode.Uri.file('/test/workspace'),
            name: 'Test Workspace',
            index: 0
        }]);
        
        sandbox.stub(vscode.workspace, 'getConfiguration').returns({
            get: sandbox.stub().returns([]),
            update: sandbox.stub().resolves()
        } as any);
        
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
        
        configTool = createConfigTool(context);
    });

    teardown(() => {
        sandbox.restore();
    });

    test('Config tool should set and get values', async () => {
        fsStub.readFile.rejects(new Error('File not found'));
        
        // Set a value
        const setResult = await configTool.handler({
            action: 'set',
            key: 'test.setting',
            value: 'test value',
            scope: 'local'
        });
        
        assert.ok(setResult.includes('Set test.setting'));
        assert.ok(setResult.includes('test value'));
        assert.ok(setResult.includes('local'));
        
        // Verify file write
        assert.ok(fsStub.writeFile.called);
        const writeCall = fsStub.writeFile.firstCall;
        const writtenContent = JSON.parse(writeCall.args[1]);
        assert.strictEqual(writtenContent['test.setting'], 'test value');
        
        // Setup read mock
        fsStub.readFile.withArgs(
            path.join('/test/workspace', '.hanzo/config.json')
        ).resolves(JSON.stringify({ 'test.setting': 'test value' }));
        
        // Get the value
        const getResult = await configTool.handler({
            action: 'get',
            key: 'test.setting'
        });
        
        assert.ok(getResult.includes('test.setting = "test value"'));
        assert.ok(getResult.includes('local'));
    });

    test('Config tool should handle global scope', async () => {
        fsStub.readFile.rejects(new Error('File not found'));
        
        // Set global value
        const result = await configTool.handler({
            action: 'set',
            key: 'global.setting',
            value: 42,
            scope: 'global'
        });
        
        assert.ok(result.includes('global'));
        
        // Verify written to global path
        const globalPath = path.join(os.homedir(), '.hanzo', 'config.json');
        assert.ok(fsStub.writeFile.calledWith(globalPath, sinon.match.string));
    });

    test('Config tool should list all settings', async () => {
        // Mock both local and global configs
        fsStub.readFile
            .withArgs(path.join(os.homedir(), '.hanzo', 'config.json'))
            .resolves(JSON.stringify({ 'global.setting': 'global value' }))
            .withArgs(path.join('/test/workspace', '.hanzo/config.json'))
            .resolves(JSON.stringify({ 'local.setting': 'local value' }));
        
        const result = await configTool.handler({
            action: 'list'
        });
        
        assert.ok(result.includes('Configuration settings'));
        assert.ok(result.includes('Global:'));
        assert.ok(result.includes('global.setting = "global value"'));
        assert.ok(result.includes('Local:'));
        assert.ok(result.includes('local.setting = "local value"'));
    });

    test('Config tool should unset values', async () => {
        fsStub.readFile.withArgs(
            path.join('/test/workspace', '.hanzo/config.json')
        ).resolves(JSON.stringify({ 
            'keep.this': 'value',
            'remove.this': 'value'
        }));
        
        const result = await configTool.handler({
            action: 'unset',
            key: 'remove.this',
            scope: 'local'
        });
        
        assert.ok(result.includes('Unset remove.this'));
        
        // Verify the key was removed
        const writeCall = fsStub.writeFile.firstCall;
        const writtenContent = JSON.parse(writeCall.args[1]);
        assert.ok('keep.this' in writtenContent);
        assert.ok(!('remove.this' in writtenContent));
    });

    test('Config tool should enable tools', async () => {
        const result = await configTool.handler({
            action: 'tool_enable',
            key: 'grep'
        });
        
        assert.ok(result.includes("Tool 'grep' has been enabled"));
    });

    test('Config tool should disable tools', async () => {
        const result = await configTool.handler({
            action: 'tool_disable',
            key: 'write'
        });
        
        assert.ok(result.includes("Tool 'write' has been disabled"));
    });

    test('Config tool should list tools', async () => {
        const result = await configTool.handler({
            action: 'tool_list'
        });
        
        assert.ok(result.includes('Total tools:'));
        assert.ok(result.includes('=== Filesystem ==='));
        assert.ok(result.includes('=== Search ==='));
        assert.ok(result.includes('=== Shell ==='));
    });

    test('Config tool should filter tools by category', async () => {
        const result = await configTool.handler({
            action: 'tool_list',
            category: 'filesystem'
        });
        
        assert.ok(result.includes('=== Filesystem ==='));
        assert.ok(!result.includes('=== Search ==='));
        assert.ok(!result.includes('=== Shell ==='));
    });

    test('Config tool should handle missing keys for get', async () => {
        fsStub.readFile.rejects(new Error('File not found'));
        
        const result = await configTool.handler({
            action: 'get',
            key: 'nonexistent.key'
        });
        
        assert.ok(result.includes("Configuration key 'nonexistent.key' not found"));
    });

    test('Config tool should validate required parameters', async () => {
        // Missing key for get
        let result = await configTool.handler({
            action: 'get'
        });
        assert.ok(result.includes('Error: Key required'));
        
        // Missing key for set
        result = await configTool.handler({
            action: 'set',
            value: 'test'
        });
        assert.ok(result.includes('Error: Key required'));
        
        // Missing value for set
        result = await configTool.handler({
            action: 'set',
            key: 'test'
        });
        assert.ok(result.includes('Error: Value required'));
        
        // Missing tool name for tool_enable
        result = await configTool.handler({
            action: 'tool_enable'
        });
        assert.ok(result.includes('Error: Tool name required'));
    });

    test('Config tool should handle unknown actions', async () => {
        const result = await configTool.handler({
            action: 'unknown_action'
        });
        
        assert.ok(result.includes("Error: Unknown action 'unknown_action'"));
    });

    test('Config tool should handle complex values', async () => {
        fsStub.readFile.rejects(new Error('File not found'));
        
        const complexValue = {
            nested: {
                array: [1, 2, 3],
                object: { key: 'value' }
            },
            boolean: true,
            number: 42
        };
        
        // Set complex value
        await configTool.handler({
            action: 'set',
            key: 'complex.value',
            value: complexValue,
            scope: 'local'
        });
        
        // Verify it was serialized correctly
        const writeCall = fsStub.writeFile.firstCall;
        const writtenContent = JSON.parse(writeCall.args[1]);
        assert.deepStrictEqual(writtenContent['complex.value'], complexValue);
    });

    test('Config tool should show disabled tools when requested', async () => {
        const result = await configTool.handler({
            action: 'tool_list',
            show_disabled: true
        });
        
        // Should show both enabled and disabled tools
        assert.ok(result.includes('✅'));
        // Note: disabled tools would show as ❌ but our test setup doesn't have any disabled
    });
});