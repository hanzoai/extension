import assert from 'assert';
import * as vscode from 'vscode';

// The extension's activate() starts the MCP server / chat participant and
// awaits auth, which never resolves in the headless `--disable-extensions`
// test host, so we cannot assert on runtime command registration here.
// Instead we pin the shipped contract: the extension identity, its declared
// commands, and its registered configuration. Publisher/name are
// hanzo-ai/hanzo-ide (id hanzo-ai.hanzo-ide).
suite('Extension Test Suite', () => {
    const EXT_ID = 'hanzo-ai.hanzo-ide';

    test('Extension is present under its published id', () => {
        assert.ok(vscode.extensions.getExtension(EXT_ID));
    });

    test('Manifest declares the current command set', () => {
        const ext = vscode.extensions.getExtension(EXT_ID)!;
        const commands: string[] = (ext.packageJSON.contributes.commands || []).map((c: any) => c.command);

        for (const expected of [
            'hanzo.openManager',
            'hanzo.openWelcomeGuide',
            'hanzo.reanalyzeProject',
            'hanzo.triggerReminder',
            'hanzo.checkMetrics',
            'hanzo.resetMetrics',
            'hanzo.login',
            'hanzo.logout',
            'hanzo.debug.authState',
            'hanzo.debug.clearAuth'
        ]) {
            assert.ok(commands.includes(expected), `manifest should declare ${expected}`);
        }
    });

    test('Registered configuration exposes the hanzo.mcp / hanzo.ide keys', () => {
        const config = vscode.workspace.getConfiguration('hanzo');
        assert.ok(config.has('mcp.enabled'));
        assert.ok(config.has('mcp.transport'));
        assert.ok(config.has('mcp.port'));
        assert.ok(config.has('ide'));
        // A config key the old contract used but which no longer exists.
        assert.ok(!config.has('apiKey'));
    });

    test('mcp.enabled resolves to a boolean and mcp.transport to a string', () => {
        const config = vscode.workspace.getConfiguration('hanzo');
        assert.strictEqual(typeof config.get('mcp.enabled'), 'boolean');
        assert.strictEqual(typeof config.get('mcp.transport'), 'string');
    });

    test('A registered config value can be written and read back', async () => {
        const config = vscode.workspace.getConfiguration('hanzo');
        try {
            await config.update('mcp.port', 9999, vscode.ConfigurationTarget.Global);
            assert.strictEqual(
                vscode.workspace.getConfiguration('hanzo').get<number>('mcp.port'),
                9999
            );
        } finally {
            await config.update('mcp.port', undefined, vscode.ConfigurationTarget.Global);
        }
    });
});
