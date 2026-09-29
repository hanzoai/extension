import assert from 'assert';
import * as vscode from 'vscode';
import type { Api } from '../../extension';

// Activation spawns the shipped dist/mcp-server.js (built by test:electron's
// `npm run build`) on this extension host's own runtime and connects to it
// over the child's stdio. These tests drive that same client.
suite('MCP Server Integration Test Suite', () => {
    let api: Api;

    suiteSetup(async function () {
        this.timeout(30000);
        api = await vscode.extensions.getExtension<Api>('hanzo-ai.hanzo-ide')!.activate();
    });

    test('activation connects to the bundled server', () => {
        assert.ok(api.mcp, 'activate() should return a connected MCP client');
        const ext = vscode.extensions.getExtension('hanzo-ai.hanzo-ide')!;
        assert.deepStrictEqual(api.mcp.getServerVersion(), { name: 'hanzo-ide', version: ext.packageJSON.version });
    });

    test('the server lists the workspace tools with their schemas', async () => {
        const { tools } = await api.mcp!.listTools();
        const names = tools.map(t => t.name);
        for (const expected of ['read', 'write', 'edit', 'bash', 'grep', 'directory_tree']) {
            assert.ok(names.includes(expected), `tools/list should include ${expected}`);
        }
        const bash = tools.find(t => t.name === 'bash')!;
        assert.strictEqual(bash.inputSchema.type, 'object');
        assert.ok(bash.inputSchema.properties?.command, 'bash takes a command');
    });

    test('a tool call runs in the server and returns its output', async () => {
        const result = await api.mcp!.callTool({ name: 'bash', arguments: { command: 'echo hanzo-mcp-ok' } });
        assert.ok(!result.isError, JSON.stringify(result));
        assert.deepStrictEqual(result.content, [{ type: 'text', text: 'hanzo-mcp-ok\n' }]);
    });

    test('an unknown tool is refused', async () => {
        await assert.rejects(api.mcp!.callTool({ name: 'no_such_tool', arguments: {} }), /Unknown tool: no_such_tool/);
    });
});
