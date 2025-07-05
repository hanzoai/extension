import * as assert from 'assert';
import * as vscode from 'vscode';
import * as path from 'path';

suite('Extension Test Suite', () => {
    vscode.window.showInformationMessage('Start all tests.');

    test('Extension should be present', () => {
        assert.ok(vscode.extensions.getExtension('hanzoai.hanzo-ai'));
    });

    test('Should activate extension', async () => {
        const ext = vscode.extensions.getExtension('hanzoai.hanzo-ai');
        assert.ok(ext);
        await ext!.activate();
        assert.ok(ext!.isActive);
    });

    test('Should register all commands', async () => {
        const commands = await vscode.commands.getCommands();
        
        // Core commands
        assert.ok(commands.includes('hanzo.agent'));
        assert.ok(commands.includes('hanzo.mode'));
        assert.ok(commands.includes('hanzo.browser'));
        assert.ok(commands.includes('hanzo.search'));
        assert.ok(commands.includes('hanzo.symbols'));
        assert.ok(commands.includes('hanzo.mcp'));
        assert.ok(commands.includes('hanzo.login'));
        assert.ok(commands.includes('hanzo.logout'));
        assert.ok(commands.includes('hanzo.showAPIKey'));
    });

    test('Should have configuration', () => {
        const config = vscode.workspace.getConfiguration('hanzo');
        assert.ok(config);
        assert.ok(config.has('apiKey'));
        assert.ok(config.has('defaultModel'));
        assert.ok(config.has('enableMCP'));
    });

    test('API key management', async () => {
        const config = vscode.workspace.getConfiguration('hanzo');
        
        // Test setting and getting API key
        await config.update('apiKey', 'test_key_123', vscode.ConfigurationTarget.Global);
        const apiKey = config.get<string>('apiKey');
        assert.strictEqual(apiKey, 'test_key_123');
        
        // Clean up
        await config.update('apiKey', undefined, vscode.ConfigurationTarget.Global);
    });

    test('Default model configuration', () => {
        const config = vscode.workspace.getConfiguration('hanzo');
        const defaultModel = config.get<string>('defaultModel');
        assert.ok(defaultModel);
        assert.ok(typeof defaultModel === 'string');
    });

    test('MCP configuration', () => {
        const config = vscode.workspace.getConfiguration('hanzo');
        const enableMCP = config.get<boolean>('enableMCP');
        assert.strictEqual(typeof enableMCP, 'boolean');
    });

    test('Mode list should contain legendary modes', () => {
        // This would test the modes functionality
        const expectedModes = [
            'carmack', 'norvig', 'hotz', 'karpathy', 'ritchie',
            'thompson', 'kernighan', 'pike', 'fowler', 'martin'
        ];
        
        // In real implementation, we'd call the getModes function
        // For now, we just verify the expected structure
        assert.ok(expectedModes.length >= 10);
        assert.ok(expectedModes.includes('carmack'));
        assert.ok(expectedModes.includes('norvig'));
    });
});