import assert from 'assert';
import * as vscode from 'vscode';
import * as os from 'os';
import * as fs from 'fs';
import * as path from 'path';
import { BashTools } from '../../mcp/tools/bash';

// Rewritten to run the real BashTools against the host rather than stubbing
// child_process.exec/spawn (non-configurable in the test host). The context's
// globalState faithfully honors the default argument so session persistence
// works, and we record what gets written back.
suite('Bash Tools Test Suite', () => {
    let bashTools: BashTools;
    let updates: Array<[string, any]>;
    let tmpDir: string;
    const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

    setup(() => {
        updates = [];
        tmpDir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'hanzo-bash-')));
        const context = {
            subscriptions: [],
            extensionPath: '/test/extension',
            globalState: {
                get: (_k: string, d?: any) => d,
                update: async (key: string, value: any) => { updates.push([key, value]); },
                setKeysForSync: () => undefined
            },
            workspaceState: { get: (_k: string, d?: any) => d, update: async () => undefined }
        } as any;
        bashTools = new BashTools(context);
    });

    teardown(() => { fs.rmSync(tmpDir, { recursive: true, force: true }); });

    const tool = (name: string) => bashTools.getTools().find(t => t.name === name)!;

    test('bash executes a command and returns its stdout', async () => {
        const result = await tool('bash').handler({ command: 'echo Hello, World!' });
        assert.strictEqual(result.trim(), 'Hello, World!');
    });

    test('bash handles cd specially for existing directories', async () => {
        const result = await tool('bash').handler({ command: `cd ${tmpDir}` });
        assert.strictEqual(result, `Changed directory to: ${tmpDir}`);
    });

    test('bash rejects cd to a missing directory', async () => {
        await assert.rejects(
            tool('bash').handler({ command: `cd ${path.join(tmpDir, 'nope')}` }),
            /Directory not found/
        );
    });

    test('bash persists session state under hanzo.bashSessions', async () => {
        await tool('bash').handler({ command: 'echo one', session_id: 'sess-1' });
        await tool('bash').handler({ command: 'echo two', session_id: 'sess-1' });
        const saved = updates.filter(([k]) => k === 'hanzo.bashSessions').pop();
        assert.ok(saved, 'sessions should be saved');
        const arr = saved![1];
        assert.ok(Array.isArray(arr));
        assert.ok(arr.some((s: any) => s.id === 'sess-1'));
    });

    test('bash surfaces command failures', async () => {
        await assert.rejects(
            tool('bash').handler({ command: 'this-command-does-not-exist-xyz' })
        );
    });

    test('bash reports timeouts', async () => {
        await assert.rejects(
            tool('bash').handler({ command: 'sleep 5', timeout: 300 }),
            /Command timed out after 300ms/
        );
    });

    test('run_background spawns, lists, logs and pkill can stop it', async () => {
        const started = await tool('run_background').handler({ command: 'echo bg-line; sleep 2', name: 'bg' });
        assert.ok(started.includes("Started background process 'bg'"));

        const list = await tool('processes').handler({});
        assert.ok(list.includes('Running processes:'));
        assert.ok(list.includes('bg'));

        await sleep(300);
        const logs = await tool('logs').handler({ name: 'bg' });
        assert.ok(logs.includes('[stdout] bg-line'));

        const killed = await tool('pkill').handler({ name: 'bg' });
        assert.ok(killed.includes("Sent SIGTERM to process 'bg'"));
    });

    test('processes reports an empty registry', async () => {
        assert.strictEqual(await tool('processes').handler({}), 'No background processes running');
    });

    test('pkill and logs reject unknown process names', async () => {
        await assert.rejects(tool('pkill').handler({ name: 'ghost' }), /Process 'ghost' not found/);
        await assert.rejects(tool('logs').handler({ name: 'ghost' }), /No logs found for process 'ghost'/);
    });
});
