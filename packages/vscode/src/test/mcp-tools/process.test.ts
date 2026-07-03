import assert from 'assert';
import * as vscode from 'vscode';
import { createProcessTool } from '../../mcp/tools/process';

// Rewritten against the current process.ts, which is a single unified tool
// (action: list | run | kill | logs | clean) backed by an in-process registry
// and a log file per spawned process. The old macOS `ps` parsing (stubbed via
// child_process.exec) no longer exists.
suite('Process Tool Test Suite', () => {
    let processTool: any;
    const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

    setup(() => {
        processTool = createProcessTool({ subscriptions: [] } as any as vscode.ExtensionContext);
    });

    test('list reports an empty registry', async () => {
        assert.strictEqual(await processTool.handler({ action: 'list' }), 'No processes running');
    });

    test('an unknown action is reported', async () => {
        assert.strictEqual(await processTool.handler({ action: 'bogus' }), "Error: Unknown action 'bogus'");
    });

    test('run requires a command', async () => {
        assert.strictEqual(await processTool.handler({ action: 'run' }), 'Error: Command required for run action');
    });

    test('kill requires an id and reports unknown ids', async () => {
        assert.strictEqual(await processTool.handler({ action: 'kill' }), 'Error: Process ID required for kill action');
        assert.strictEqual(
            await processTool.handler({ action: 'kill', id: 'nope' }),
            'Error: Process nope not found'
        );
    });

    test('logs requires an id', async () => {
        assert.strictEqual(await processTool.handler({ action: 'logs' }), 'Error: Process ID required for logs action');
    });

    test('run spawns a process, captures its logs, and clean removes it', async () => {
        const started = await processTool.handler({ action: 'run', command: 'echo hello-proc', name: 'echoer' });
        assert.ok(started.includes('Started process'));
        const id = started.match(/Started process (\S+) \(PID/)![1];

        // The process appears in the listing.
        assert.ok((await processTool.handler({ action: 'list' })).includes(id));

        // Give the child time to write and exit, then read its captured logs.
        await sleep(500);
        const logs = await processTool.handler({ action: 'logs', id });
        assert.ok(logs.includes('hello-proc'));

        // Clean removes finished processes.
        const cleaned = await processTool.handler({ action: 'clean' });
        assert.ok(cleaned.includes('Cleaned'));
        assert.strictEqual(await processTool.handler({ action: 'logs', id }), `Error: Process ${id} not found`);
    });
});
