import assert from 'assert';
import * as sinon from 'sinon';
import * as vscode from 'vscode';
import { MCPTools } from '../../mcp/tools';

// Rewritten against the current MCPTools contract. There is no `filterTools`
// method; enabling/disabling is driven entirely by the `hanzo.mcp` settings
// (enabledTools / disabledTools / disableWriteTools / disableSearchTools),
// applied in the constructor and in getAllTools(). Tools must be initialize()d
// before getAllTools() returns anything.
suite('MCP Tools Test Suite', () => {
    let sandbox: sinon.SinonSandbox;

    // Faithful Memento: honor the default argument the way real VS Code does.
    const makeContext = (): vscode.ExtensionContext => ({
        globalState: { get: (_k: string, d?: any) => d, update: async () => undefined, keys: () => [] },
        workspaceState: { get: (_k: string, d?: any) => d, update: async () => undefined, keys: () => [] },
        extensionPath: '/mock/extension',
        subscriptions: []
    } as any);

    // Fake only the `hanzo.mcp` section; delegate every other section to the
    // real configuration so tool construction keeps working.
    const stubMcpConfig = (overrides: Record<string, any>) => {
        const real = vscode.workspace.getConfiguration.bind(vscode.workspace);
        const fake = {
            get: (key: string, def?: any) => (key in overrides ? overrides[key] : def),
            has: () => true,
            inspect: () => undefined,
            update: async () => undefined
        };
        sandbox.stub(vscode.workspace, 'getConfiguration').callsFake(
            ((section?: string, scope?: any) =>
                (section === 'hanzo.mcp' ? fake : real(section as any, scope))) as any
        );
    };

    // Always stub the hanzo.mcp section (even with no overrides) so the suite
    // is hermetic: other suites persist real hanzo.mcp settings (e.g. the mode
    // tool writes enabledTools), which would otherwise leak in here.
    const build = async (overrides: Record<string, any> = {}): Promise<MCPTools> => {
        stubMcpConfig(overrides);
        const tools = new MCPTools(makeContext());
        await tools.initialize();
        return tools;
    };

    setup(() => { sandbox = sinon.createSandbox(); });
    teardown(() => { sandbox.restore(); });

    test('initialize registers the core tool set', async () => {
        const all = (await build()).getAllTools();
        assert.ok(all.length > 0);
        for (const name of ['read', 'write', 'edit', 'multi_edit', 'grep', 'search', 'run_command', 'bash']) {
            assert.ok(all.some(t => t.name === name), `tool ${name} should be enabled`);
        }
    });

    test('the read tool carries the MCPTool shape', async () => {
        const read = (await build()).getAllTools().find(t => t.name === 'read');
        assert.ok(read);
        assert.strictEqual(read!.name, 'read');
        assert.ok(read!.description);
        assert.strictEqual(read!.inputSchema.type, 'object');
        assert.ok(read!.inputSchema.properties);
        assert.strictEqual(typeof read!.handler, 'function');
    });

    test('disableWriteTools removes the write-family tools', async () => {
        const all = (await build({ disableWriteTools: true })).getAllTools();
        for (const name of ['write', 'edit', 'multi_edit']) {
            assert.ok(!all.some(t => t.name === name), `${name} should be filtered out`);
        }
        assert.ok(all.some(t => t.name === 'read'));
    });

    test('disableSearchTools removes the search-family tools', async () => {
        const all = (await build({ disableSearchTools: true })).getAllTools();
        for (const name of ['search', 'grep', 'symbols', 'git_search']) {
            assert.ok(!all.some(t => t.name === name), `${name} should be filtered out`);
        }
        assert.ok(all.some(t => t.name === 'read'));
    });

    test('an explicit enabledTools allow-list wins', async () => {
        const all = (await build({ enabledTools: ['read', 'write'] })).getAllTools();
        assert.strictEqual(all.length, 2);
        assert.ok(all.some(t => t.name === 'read'));
        assert.ok(all.some(t => t.name === 'write'));
    });

    test('disabledTools subtracts from the default set', async () => {
        const all = (await build({ disabledTools: ['write', 'edit'] })).getAllTools();
        assert.ok(!all.some(t => t.name === 'write'));
        assert.ok(!all.some(t => t.name === 'edit'));
        assert.ok(all.some(t => t.name === 'read'));
    });
});
