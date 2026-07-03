import assert from 'assert';
import * as vscode from 'vscode';
import { MCPRunnerTools } from '../../mcp/tools/mcp-runner';

// Rewritten against the current MCPRunnerTools: the single tool is named
// 'mcp_manage' (not 'mcp') with actions add/remove/start/stop/list/logs/call.
// Registry operations are exercised directly and one real spawn covers
// start/stop, replacing the old child_process.spawn stub.
suite('MCP Runner Tools Test Suite', () => {
    let runner: MCPRunnerTools;

    const makeContext = (): vscode.ExtensionContext => ({
        subscriptions: [],
        extensionPath: '/test/extension',
        globalState: {
            get: (_k: string, d?: any) => d,
            update: async () => undefined,
            setKeysForSync: () => undefined
        },
        workspaceState: { get: (_k: string, d?: any) => d, update: async () => undefined }
    } as any);

    setup(() => { runner = new MCPRunnerTools(makeContext()); });

    const mcp = () => runner.getTools().find(t => t.name === 'mcp_manage')!;

    test('list reports an empty registry', async () => {
        assert.strictEqual(await mcp().handler({ action: 'list' }), 'No MCP servers configured');
    });

    test('add registers a server and list shows it as stopped', async () => {
        const added = await mcp().handler({
            action: 'add',
            name: 'demo',
            command: 'node',
            args: ['server.js'],
            transport: 'stdio'
        });
        assert.ok(added.includes("Added MCP server 'demo'"));
        assert.ok(added.includes('Command: node server.js'));

        const list = await mcp().handler({ action: 'list' });
        assert.ok(list.includes('**demo** (stopped)'));
        assert.ok(list.includes('node server.js'));
    });

    test('adding a duplicate name throws', async () => {
        await mcp().handler({ action: 'add', name: 'dup', command: 'node' });
        await assert.rejects(
            mcp().handler({ action: 'add', name: 'dup', command: 'node' }),
            /already exists/
        );
    });

    test('remove deletes a server and unknown names throw', async () => {
        await mcp().handler({ action: 'add', name: 'gone', command: 'node' });
        assert.strictEqual(await mcp().handler({ action: 'remove', name: 'gone' }), "Removed MCP server 'gone'");
        await assert.rejects(mcp().handler({ action: 'remove', name: 'ghost' }), /not found/);
    });

    test('logs and stop reject unknown servers', async () => {
        await assert.rejects(mcp().handler({ action: 'logs', name: 'ghost' }), /not found/);
        await assert.rejects(mcp().handler({ action: 'stop', name: 'ghost' }), /not found/);
    });

    test('an unknown action throws', async () => {
        await assert.rejects(mcp().handler({ action: 'bogus' }), /Unknown action: bogus/);
    });

    test('start spawns a real process and stop terminates it', async function () {
        this.timeout(10000);
        await mcp().handler({ action: 'add', name: 'sleeper', command: 'sleep', args: ['5'], transport: 'stdio' });

        const started = await mcp().handler({ action: 'start', name: 'sleeper' });
        assert.ok(started.includes("Started MCP server 'sleeper'"));
        assert.ok(started.includes('PID'));

        const stopped = await mcp().handler({ action: 'stop', name: 'sleeper' });
        assert.strictEqual(stopped, "Stopped MCP server 'sleeper'");
    });
});
