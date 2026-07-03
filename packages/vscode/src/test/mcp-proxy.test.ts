import assert from 'assert';
import * as os from 'os';
import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import { createMCPUniversalProxyTools } from '../mcp/tools/mcp-universal-proxy';

// Rewritten to drop the sinon stubs of child_process.exec / fs.promises
// (non-configurable in the test host) and the fabricated MCP-SDK stdio
// framing (which never matched the real @modelcontextprotocol/sdk client).
// We cover the deterministic, non-network handler behavior directly; a real
// package install requires the network and is gated behind HANZO_E2E_LIVE.
suite('MCP Universal Proxy Tests', () => {
    let storageDir: string;

    const buildTool = (seed?: Record<string, any>) => {
        const store = new Map<string, any>(Object.entries(seed || {}));
        const context = {
            globalState: {
                get: (key: string, def?: any) => (store.has(key) ? store.get(key) : def),
                update: async (key: string, value: any) => { store.set(key, value); },
                keys: () => Array.from(store.keys())
            },
            globalStorageUri: { fsPath: storageDir },
            subscriptions: []
        } as any as vscode.ExtensionContext;
        return createMCPUniversalProxyTools(context).find(t => t.name === 'mcp')!;
    };

    setup(() => { storageDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hanzo-proxy-')); });
    teardown(() => { fs.rmSync(storageDir, { recursive: true, force: true }); });

    test('install requires a package name', async () => {
        assert.strictEqual(
            await buildTool().handler({ action: 'install' }),
            '❌ Package name required for install'
        );
    });

    test('call requires a tool name', async () => {
        assert.strictEqual(
            await buildTool().handler({ action: 'call' }),
            '❌ Tool name required for call'
        );
    });

    test('calling an unknown tool reports no server was found', async () => {
        const result = await buildTool().handler({ action: 'call', tool: 'nope' });
        assert.ok(result.includes('Tool call failed'));
        assert.ok(result.includes('No server found for tool: nope'));
    });

    test('unknown actions are reported', async () => {
        assert.strictEqual(
            await buildTool().handler({ action: 'frobnicate' }),
            '❌ Unknown action. Use: install, call, list, or uninstall'
        );
    });

    test('uninstall is not implemented yet', async () => {
        assert.strictEqual(
            await buildTool().handler({ action: 'uninstall' }),
            '❌ Uninstall not yet implemented'
        );
    });

    test('list renders the proxy status even with nothing installed', async () => {
        const result = await buildTool().handler({ action: 'list' });
        assert.ok(result.includes('# MCP Proxy Status'));
        assert.ok(result.includes('## Installed Servers'));
    });

    test('installing an already-installed package short-circuits without a network call', async () => {
        const tool = buildTool({
            'mcp-installed-servers': [{
                name: 'github',
                package: '@modelcontextprotocol/server-github',
                installed: true,
                version: '1.0.0'
            }]
        });
        const result = await tool.handler({
            action: 'install',
            package: '@modelcontextprotocol/server-github'
        });
        assert.strictEqual(result, "✅ MCP server 'github' is already installed");
    });

    // Real installs hit npm/uvx and the network; opt in with HANZO_E2E_LIVE.
    (process.env.HANZO_E2E_LIVE ? test : test.skip)('a failed install surfaces "Failed to install" (live)', async function () {
        this.timeout(120000);
        await assert.rejects(
            buildTool().handler({ action: 'install', package: '@invalid/package-that-does-not-exist-12345' }),
            /Failed to install/
        );
    });
});
