import * as assert from 'assert';
import * as sinon from 'sinon';
import * as vscode from 'vscode';
import { createModeTool } from '../../mcp/tools/mode';

suite('Mode Tool Test Suite', () => {
    let context: vscode.ExtensionContext;
    let modeTool: any;
    let sandbox: sinon.SinonSandbox;
    let globalStateGetStub: sinon.SinonStub;
    let globalStateUpdateStub: sinon.SinonStub;
    let showInformationMessageStub: sinon.SinonStub;

    setup(() => {
        sandbox = sinon.createSandbox();
        
        // Mock VS Code window
        showInformationMessageStub = sandbox.stub(vscode.window, 'showInformationMessage');
        
        // Mock VS Code context
        globalStateGetStub = sandbox.stub();
        globalStateUpdateStub = sandbox.stub().resolves();
        
        context = {
            subscriptions: [],
            workspaceState: {
                get: sandbox.stub(),
                update: sandbox.stub().resolves()
            },
            globalState: {
                get: globalStateGetStub,
                update: globalStateUpdateStub,
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
        
        // Default to normal mode
        globalStateGetStub.withArgs('hanzo.development_mode').returns('normal');
        
        modeTool = createModeTool(context);
    });

    teardown(() => {
        sandbox.restore();
    });

    test('Mode tool should get current mode', async () => {
        globalStateGetStub.withArgs('hanzo.development_mode').returns('focused');
        
        const result = await modeTool.handler({
            action: 'get'
        });
        
        assert.ok(result.includes('Current mode: focused'));
        assert.ok(result.includes('Stay laser-focused'));
    });

    test('Mode tool should set development mode', async () => {
        const result = await modeTool.handler({
            action: 'set',
            mode: 'architect'
        });
        
        assert.ok(result.includes('Development mode set to: architect'));
        assert.ok(result.includes('Think big picture'));
        assert.ok(globalStateUpdateStub.calledWith('hanzo.development_mode', 'architect'));
        assert.ok(showInformationMessageStub.calledWith('Development mode: architect 🏗️'));
    });

    test('Mode tool should list all available modes', async () => {
        const result = await modeTool.handler({
            action: 'list'
        });
        
        assert.ok(result.includes('Available development modes:'));
        assert.ok(result.includes('normal - Standard development mode'));
        assert.ok(result.includes('focused - Deep focus mode'));
        assert.ok(result.includes('creative - Creative exploration mode'));
        assert.ok(result.includes('debug - Debugging mode'));
        assert.ok(result.includes('review - Code review mode'));
        assert.ok(result.includes('refactor - Refactoring mode'));
        assert.ok(result.includes('test - Test writing mode'));
        assert.ok(result.includes('docs - Documentation mode'));
        assert.ok(result.includes('architect - System design mode'));
        assert.ok(result.includes('speed - Rapid development mode'));
    });

    test('Mode tool should validate mode names', async () => {
        const result = await modeTool.handler({
            action: 'set',
            mode: 'invalid-mode'
        });
        
        assert.ok(result.includes('Error: Invalid mode'));
        assert.ok(result.includes('Available modes:'));
        assert.ok(!globalStateUpdateStub.called);
    });

    test('Mode tool should handle missing mode for set action', async () => {
        const result = await modeTool.handler({
            action: 'set'
        });
        
        assert.ok(result.includes('Error: Mode name required'));
    });

    test('Mode tool should handle invalid actions', async () => {
        const result = await modeTool.handler({
            action: 'invalid'
        });
        
        assert.ok(result.includes('Error: Invalid action'));
        assert.ok(result.includes('Valid actions: get, set, list'));
    });

    test('Mode tool should show current mode when no mode is set', async () => {
        globalStateGetStub.withArgs('hanzo.development_mode').returns(undefined);
        
        const result = await modeTool.handler({
            action: 'get'
        });
        
        assert.ok(result.includes('Current mode: normal'));
        assert.ok(result.includes('Standard development mode'));
    });

    test('Mode tool should provide detailed mode descriptions', async () => {
        // Test each mode's description
        const modes = [
            { name: 'focused', emoji: '🎯', description: 'Stay laser-focused' },
            { name: 'creative', emoji: '🎨', description: 'Think outside the box' },
            { name: 'debug', emoji: '🐛', description: 'Systematic debugging' },
            { name: 'review', emoji: '👀', description: 'Critical code review' },
            { name: 'refactor', emoji: '♻️', description: 'Clean code refactoring' },
            { name: 'test', emoji: '🧪', description: 'Comprehensive testing' },
            { name: 'docs', emoji: '📚', description: 'Clear documentation' },
            { name: 'architect', emoji: '🏗️', description: 'Think big picture' },
            { name: 'speed', emoji: '⚡', description: 'Move fast' }
        ];
        
        for (const mode of modes) {
            const result = await modeTool.handler({
                action: 'set',
                mode: mode.name
            });
            
            assert.ok(result.includes(mode.description));
            assert.ok(showInformationMessageStub.calledWith(`Development mode: ${mode.name} ${mode.emoji}`));
        }
    });

    test('Mode tool should persist mode across sessions', async () => {
        // Set mode
        await modeTool.handler({
            action: 'set',
            mode: 'test'
        });
        
        // Verify it was saved
        assert.ok(globalStateUpdateStub.calledWith('hanzo.development_mode', 'test'));
        
        // Simulate new session with saved mode
        globalStateGetStub.withArgs('hanzo.development_mode').returns('test');
        
        const result = await modeTool.handler({
            action: 'get'
        });
        
        assert.ok(result.includes('Current mode: test'));
    });

    test('Mode tool should handle normal mode properly', async () => {
        const result = await modeTool.handler({
            action: 'set',
            mode: 'normal'
        });
        
        assert.ok(result.includes('Development mode set to: normal'));
        assert.ok(result.includes('Standard development mode'));
        assert.ok(showInformationMessageStub.calledWith('Development mode: normal 💻'));
    });

    test('Mode tool should show mode characteristics in list', async () => {
        const result = await modeTool.handler({
            action: 'list'
        });
        
        // Check that each mode has its emoji and description
        assert.ok(result.includes('💻 normal'));
        assert.ok(result.includes('🎯 focused'));
        assert.ok(result.includes('🎨 creative'));
        assert.ok(result.includes('🐛 debug'));
        assert.ok(result.includes('👀 review'));
        assert.ok(result.includes('♻️ refactor'));
        assert.ok(result.includes('🧪 test'));
        assert.ok(result.includes('📚 docs'));
        assert.ok(result.includes('🏗️ architect'));
        assert.ok(result.includes('⚡ speed'));
    });

    test('Mode tool should trim whitespace from mode names', async () => {
        const result = await modeTool.handler({
            action: 'set',
            mode: '  focused  '
        });
        
        assert.ok(result.includes('Development mode set to: focused'));
        assert.ok(globalStateUpdateStub.calledWith('hanzo.development_mode', 'focused'));
    });

    test('Mode tool should be case-insensitive for mode names', async () => {
        const result = await modeTool.handler({
            action: 'set',
            mode: 'FOCUSED'
        });
        
        assert.ok(result.includes('Development mode set to: focused'));
        assert.ok(globalStateUpdateStub.calledWith('hanzo.development_mode', 'focused'));
    });
});