import assert from 'assert';
import * as sinon from 'sinon';
import * as vscode from 'vscode';
import { createModeTool } from '../../mcp/tools/mode';

// Rewritten against the current mode.ts contract: actions are
// list / activate / show / current over the DEVELOPMENT_MODES registry
// (programmer personalities), persisted under globalState key
// 'hanzo.developmentMode' (default 'fullstack'). The old get/set/'normal'
// emoji contract no longer exists.
suite('Mode Tool Test Suite', () => {
    let context: vscode.ExtensionContext;
    let modeTool: any;
    let store: Map<string, any>;
    let sandbox: sinon.SinonSandbox;

    setup(() => {
        sandbox = sinon.createSandbox();
        // activate() persists the mode's tool list to the shared hanzo.mcp
        // settings; stub getConfiguration so the test does not mutate real
        // (cross-suite) host configuration.
        const real = vscode.workspace.getConfiguration.bind(vscode.workspace);
        sandbox.stub(vscode.workspace, 'getConfiguration').callsFake(
            ((section?: string, scope?: any) =>
                (section === 'hanzo.mcp'
                    ? { get: (_k: string, d?: any) => d, has: () => true, inspect: () => undefined, update: async () => undefined }
                    : real(section as any, scope))) as any
        );
        store = new Map();
        context = {
            subscriptions: [],
            workspaceState: {
                get: (_k: string, d?: any) => d,
                update: async () => undefined
            },
            globalState: {
                get: (key: string, d?: any) => (store.has(key) ? store.get(key) : d),
                update: async (key: string, value: any) => { store.set(key, value); },
                setKeysForSync: () => undefined
            },
            extensionPath: '/test/extension'
        } as any;

        modeTool = createModeTool(context);
    });

    teardown(() => { sandbox.restore(); });

    test('list is the default action and groups the registry with the active mode', async () => {
        const result = await modeTool.handler({});

        assert.ok(result.includes('Available development modes:'));
        assert.ok(result.includes('**Language Creators**:'));
        assert.ok(result.includes('**Special Configurations**:'));
        // Known registry members render as "- **name**: Programmer - description"
        assert.ok(result.includes('- **ritchie**: Dennis Ritchie - C creator - UNIX philosophy'));
        assert.ok(result.includes('- **hickey**'));
        // Default current mode is fullstack, marked active.
        assert.ok(result.includes('Current mode: **fullstack**'));
        assert.ok(result.includes('- **fullstack** *(active)*'));
        assert.ok(result.includes("Use 'mode --action activate --name <mode>'"));
    });

    test('activate persists the mode and reports programmer/philosophy/tools', async () => {
        const result = await modeTool.handler({ action: 'activate', name: 'hickey' });

        assert.ok(result.includes('Activated mode: **hickey**'));
        assert.ok(result.includes('Programmer: Rich Hickey'));
        assert.ok(result.includes('Description: Clojure creator - simplicity matters'));
        assert.ok(result.includes('Philosophy: *"Simple Made Easy"*'));
        // hickey.tools has 7 entries.
        assert.ok(result.includes('Enabled tools (7):'));
        assert.ok(result.includes('- critic'));
        // Persisted to globalState under the canonical key.
        assert.strictEqual(store.get('hanzo.developmentMode'), 'hickey');
    });

    test('activate throws when the mode name is missing', async () => {
        await assert.rejects(
            modeTool.handler({ action: 'activate' }),
            /Mode name required for activate action/
        );
    });

    test('activate throws on an unknown mode', async () => {
        await assert.rejects(
            modeTool.handler({ action: 'activate', name: 'not-a-real-mode' }),
            /Unknown mode: not-a-real-mode/
        );
        assert.ok(!store.has('hanzo.developmentMode'));
    });

    test('show renders full detail including config for a known mode', async () => {
        const result = await modeTool.handler({ action: 'show', name: 'guido' });

        assert.ok(result.includes('## Mode: guido'));
        assert.ok(result.includes('**Programmer**: Guido van Rossum'));
        assert.ok(result.includes('**Philosophy**:'));
        assert.ok(result.includes('### Tools ('));
        assert.ok(result.includes('### Configuration'));
        assert.ok(result.includes('readability: 10/10'));
    });

    test('show throws when name is missing or unknown', async () => {
        await assert.rejects(
            modeTool.handler({ action: 'show' }),
            /Mode name required for show action/
        );
        await assert.rejects(
            modeTool.handler({ action: 'show', name: 'nope' }),
            /Unknown mode: nope/
        );
    });

    test('current returns the default fullstack mode when nothing is stored', async () => {
        const result = await modeTool.handler({ action: 'current' });

        assert.ok(result.includes('Current mode: **fullstack**'));
        assert.ok(result.includes('Programmer: Full Stack Developer'));
        // fullstack.tools has 12 entries.
        assert.ok(result.includes('Enabled tools: 12'));
    });

    test('current reflects a stored known mode', async () => {
        store.set('hanzo.developmentMode', 'linus');

        const result = await modeTool.handler({ action: 'current' });

        assert.ok(result.includes('Current mode: **linus**'));
        assert.ok(result.includes('Programmer: Linus Torvalds'));
    });

    test('current reports a stored unknown mode as custom', async () => {
        store.set('hanzo.developmentMode', 'my-custom-mode');

        const result = await modeTool.handler({ action: 'current' });

        assert.strictEqual(result, 'Current mode: my-custom-mode (custom mode)');
    });

    test('an unknown action throws with the valid-actions hint', async () => {
        await assert.rejects(
            modeTool.handler({ action: 'set' }),
            /Unknown action: set\. Use 'list', 'activate', 'show', or 'current'/
        );
    });
});
