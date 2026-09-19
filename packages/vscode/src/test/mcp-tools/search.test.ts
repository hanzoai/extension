import assert from 'assert';
import * as vscode from 'vscode';
import * as os from 'os';
import * as fs from 'fs';
import * as path from 'path';
import { createSearchTools } from '../../mcp/tools/search';

// Rewritten to pin the real search.ts behavior. The old suite double-stubbed
// vscode.commands.executeCommand (which leaked between tests) and assumed
// ripgrep. Whether rg is on the host's PATH is up to the machine, so the
// empty-result cases search for a word the fixture does not contain, which rg
// and the VS Code fallback both answer with nothing, and the fallback has a
// test of its own with rg taken off PATH. No workspace is indexed, so the
// symbol provider returns nothing. Positive git coverage lives in
// git-search.test.ts.
suite('Search Tools Test Suite', () => {
    let dir: string;
    let tools: any[];

    setup(() => {
        dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hanzo-search-'));
        fs.writeFileSync(path.join(dir, 'a.txt'), 'the needle is here\n');
        tools = createSearchTools({
            subscriptions: [],
            globalState: { get: (_k: string, d?: any) => d, update: async () => undefined }
        } as any as vscode.ExtensionContext);
    });

    teardown(() => { fs.rmSync(dir, { recursive: true, force: true }); });

    const tool = (name: string) => tools.find(t => t.name === name)!;

    test('exposes the search tool set with correct schemas', () => {
        for (const name of ['grep', 'search', 'symbols', 'git_search', 'grep_ast', 'batch_search']) {
            assert.ok(tool(name), `${name} should exist`);
        }
        assert.deepStrictEqual(tool('grep').inputSchema.required, ['pattern']);
        assert.deepStrictEqual(tool('search').inputSchema.required, ['query']);
        assert.deepStrictEqual(tool('symbols').inputSchema.required, ['query']);
    });

    test('grep returns "No matches found" when nothing matches', async () => {
        const result = await tool('grep').handler({ pattern: 'haystack', path: dir });
        assert.strictEqual(result, 'No matches found');
    });

    test('symbols returns "No symbols found" with no indexed workspace', async () => {
        const result = await tool('symbols').handler({ query: 'SomeUnlikelySymbolName' });
        assert.strictEqual(result, 'No symbols found');
    });

    test('grep_ast maps a known AST pattern and delegates to grep', async () => {
        const result = await tool('grep_ast').handler({ pattern: 'class $NAME', path: dir });
        assert.strictEqual(result, 'No matches found');
    });

    test('a text search with no hits reports "No results found"', async () => {
        const result = await tool('search').handler({ query: 'haystack', type: 'text', path: dir });
        assert.strictEqual(result, 'No results found');
    });

    test('without ripgrep, grep searches the given path', async () => {
        // An empty PATH is the one way to be sure rg is missing: VS Code gives
        // the extension host the login shell's PATH, whatever launched it.
        const pathEnv = process.env.PATH;
        process.env.PATH = '';
        try {
            const result = await tool('grep').handler({ pattern: 'needle', path: dir });
            assert.ok(result.includes('a.txt:1: the needle is here'), result);
        } finally {
            process.env.PATH = pathEnv;
        }
    });

    test('batch_search runs each search and labels the sections', async () => {
        const result = await tool('batch_search').handler({
            searches: [{ query: 'needle', type: 'text', path: dir }]
        });
        assert.ok(result.includes('Search 1: "needle"'));
    });
});
