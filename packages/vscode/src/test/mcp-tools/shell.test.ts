import assert from 'assert';
import * as sinon from 'sinon';
import * as vscode from 'vscode';
import * as os from 'os';
import * as fs from 'fs';
import * as path from 'path';
import { createShellTools } from '../../mcp/tools/shell';

// Rewritten to exercise the real shell.ts against the host. The current
// contract is run_command/bash/zsh({ command, cwd?, timeout? }) using a
// promisified exec (output trimmed, stderr appended under "[stderr]", errors
// thrown as "Command failed"/"Command timed out"), and open({ path }) which
// delegates to vscode.env.openExternal. The old working_directory/environment
// params, "STDERR:" prefix, and revealInExplorer behavior no longer exist.
suite('Shell Tools Test Suite', () => {
    let context: vscode.ExtensionContext;
    let shellTools: any[];
    let sandbox: sinon.SinonSandbox;

    setup(() => {
        sandbox = sinon.createSandbox();
        context = { subscriptions: [], extensionPath: '/test/extension' } as any;
        shellTools = createShellTools(context);
    });

    teardown(() => { sandbox.restore(); });

    const tool = (name: string) => shellTools.find(t => t.name === name)!;

    test('run_command returns trimmed stdout', async () => {
        const result = await tool('run_command').handler({ command: 'echo Hello, World!' });
        assert.strictEqual(result, 'Hello, World!');
    });

    test('run_command runs in the requested cwd', async () => {
        const dir = fs.realpathSync(os.tmpdir());
        const result = await tool('run_command').handler({ command: 'pwd', cwd: dir });
        assert.strictEqual(result, dir);
    });

    test('run_command appends stderr under a [stderr] marker', async () => {
        const result = await tool('run_command').handler({ command: 'echo out; echo err 1>&2' });
        assert.ok(result.includes('out'));
        assert.ok(result.includes('[stderr]'));
        assert.ok(result.includes('err'));
    });

    test('run_command reports success when there is no output', async () => {
        const result = await tool('run_command').handler({ command: 'true' });
        assert.strictEqual(result, 'Command completed successfully');
    });

    test('run_command throws Command failed on a non-zero exit', async () => {
        await assert.rejects(
            tool('run_command').handler({ command: 'this-command-does-not-exist-xyz' }),
            /Command failed/
        );
    });

    test('run_command throws a timeout error when it exceeds the timeout', async () => {
        await assert.rejects(
            tool('run_command').handler({ command: 'sleep 5', timeout: 300 }),
            /timed out/
        );
    });

    test('bash executes through /bin/bash', async () => {
        const result = await tool('bash').handler({ command: 'echo $0' });
        assert.ok(result.includes('bash'));
    });

    test('zsh executes through /bin/zsh', async function () {
        // the tool's whole subject is delegation to /bin/zsh — without zsh
        // on the host (e.g. CI runners) there is nothing to verify
        if (!fs.existsSync('/bin/zsh')) { this.skip(); }
        const result = await tool('zsh').handler({ command: 'echo zshtest' });
        assert.strictEqual(result, 'zshtest');
    });

    test('open opens a URL via openExternal', async () => {
        const openExternal = sandbox.stub(vscode.env, 'openExternal').resolves(true);
        const result = await tool('open').handler({ path: 'https://example.com' });
        assert.ok(openExternal.calledOnce);
        assert.ok(openExternal.calledWith(vscode.Uri.parse('https://example.com')));
        assert.strictEqual(result, 'Opened URL: https://example.com');
    });

    test('open opens an absolute file path via openExternal', async () => {
        const openExternal = sandbox.stub(vscode.env, 'openExternal').resolves(true);
        const file = path.join(os.tmpdir(), 'shell-open.txt');
        const result = await tool('open').handler({ path: file });
        assert.ok(openExternal.calledOnce);
        assert.strictEqual(result, `Opened file: ${file}`);
    });
});
