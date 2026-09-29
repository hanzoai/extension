import assert from 'assert';
import * as vscode from 'vscode';

// The shipped contract: the extension identity (publisher/name
// hanzo-ai/hanzo-ide), its commands, and its configuration.
suite('Extension Test Suite', () => {
    const EXT_ID = 'hanzo-ai.hanzo-ide';
    const COMMANDS = ['hanzo.login', 'hanzo.logout', 'hanzo.debug.authState', 'hanzo.debug.clearAuth'];

    test('Extension is present under its published id', () => {
        assert.ok(vscode.extensions.getExtension(EXT_ID));
    });

    test('Manifest declares exactly the command set', () => {
        const ext = vscode.extensions.getExtension(EXT_ID)!;
        const commands: string[] = (ext.packageJSON.contributes.commands || []).map((c: any) => c.command);
        assert.deepStrictEqual(commands.sort(), [...COMMANDS].sort());
    });

    test('Activation registers every declared command', async () => {
        await vscode.extensions.getExtension(EXT_ID)!.activate();
        const registered = await vscode.commands.getCommands(true);
        for (const command of COMMANDS) {
            assert.ok(registered.includes(command), `activation should register ${command}`);
        }
    });

    test('Registered configuration exposes the hanzo.mcp keys and none of the removed ones', () => {
        const config = vscode.workspace.getConfiguration('hanzo');
        assert.ok(config.has('mcp.enabled'));
        assert.ok(config.has('mcp.enabledTools'));
        for (const removed of ['apiKey', 'api.endpoint', 'ide', 'debug', 'mcp.transport', 'mcp.port', 'mcp.backend', 'mcp.pythonCommand']) {
            assert.ok(!config.has(removed), `hanzo.${removed} should not be registered`);
        }
    });

    test('mcp.enabled resolves to a boolean', () => {
        assert.strictEqual(typeof vscode.workspace.getConfiguration('hanzo').get('mcp.enabled'), 'boolean');
    });

    test('A registered config value can be written and read back', async () => {
        const config = vscode.workspace.getConfiguration('hanzo');
        try {
            await config.update('mcp.disabledTools', ['zsh'], vscode.ConfigurationTarget.Global);
            assert.deepStrictEqual(
                vscode.workspace.getConfiguration('hanzo').get<string[]>('mcp.disabledTools'),
                ['zsh']
            );
        } finally {
            await config.update('mcp.disabledTools', undefined, vscode.ConfigurationTarget.Global);
        }
    });
});
