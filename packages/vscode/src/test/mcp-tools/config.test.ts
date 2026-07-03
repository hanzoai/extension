import assert from 'assert';
import * as sinon from 'sinon';
import * as vscode from 'vscode';
import * as os from 'os';
import * as fs from 'fs';
import * as path from 'path';
import { createConfigTool } from '../../mcp/tools/config/config';

// Rewritten to drive the real config tool against a real workspace-local JSON
// store (.hanzo/config.json) instead of stubbing fs.readFile. We point the
// workspace at a temp dir and round-trip get/set/unset/list at local scope.
suite('Config Tool Test Suite', () => {
    let sandbox: sinon.SinonSandbox;
    let workspace: string;
    let configTool: any;
    const KEY = 'test.roundtrip.key';

    setup(() => {
        sandbox = sinon.createSandbox();
        workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'hanzo-cfg-'));
        sandbox.stub(vscode.workspace, 'workspaceFolders').value([{
            uri: vscode.Uri.file(workspace),
            name: 'ws',
            index: 0
        }]);
        configTool = createConfigTool({ subscriptions: [] } as any as vscode.ExtensionContext);
    });

    teardown(() => {
        sandbox.restore();
        fs.rmSync(workspace, { recursive: true, force: true });
    });

    test('set then get round-trips a value at local scope', async () => {
        const setResult = await configTool.handler({ action: 'set', key: KEY, value: 'hello' });
        assert.strictEqual(setResult, 'Set test.roundtrip.key = "hello" (local)');

        const getResult = await configTool.handler({ action: 'get', key: KEY });
        assert.strictEqual(getResult, 'test.roundtrip.key = "hello" (local)');
        // And it is actually persisted to the workspace .hanzo/config.json.
        const stored = JSON.parse(fs.readFileSync(path.join(workspace, '.hanzo', 'config.json'), 'utf-8'));
        assert.strictEqual(stored[KEY], 'hello');
    });

    test('get reports a missing key', async () => {
        const result = await configTool.handler({ action: 'get', key: 'no.such.key.here' });
        assert.strictEqual(result, "Configuration key 'no.such.key.here' not found");
    });

    test('get and set validate their required arguments', async () => {
        assert.strictEqual(await configTool.handler({ action: 'get' }), 'Error: Key required for get action');
        assert.strictEqual(await configTool.handler({ action: 'set' }), 'Error: Key required for set action');
        assert.strictEqual(
            await configTool.handler({ action: 'set', key: KEY }),
            'Error: Value required for set action'
        );
    });

    test('list includes a previously set key', async () => {
        await configTool.handler({ action: 'set', key: KEY, value: 42 });
        const result = await configTool.handler({ action: 'list' });
        assert.ok(result.includes('Configuration settings:'));
        assert.ok(result.includes(KEY));
        assert.ok(result.includes('42'));
    });

    test('unset removes a key', async () => {
        await configTool.handler({ action: 'set', key: KEY, value: 'x' });
        const unsetResult = await configTool.handler({ action: 'unset', key: KEY });
        assert.strictEqual(unsetResult, 'Unset test.roundtrip.key (local)');
        assert.strictEqual(
            await configTool.handler({ action: 'get', key: KEY }),
            "Configuration key 'test.roundtrip.key' not found"
        );
    });

    test('an unknown action is reported', async () => {
        assert.strictEqual(await configTool.handler({ action: 'bogus' }), "Error: Unknown action 'bogus'");
    });
});
