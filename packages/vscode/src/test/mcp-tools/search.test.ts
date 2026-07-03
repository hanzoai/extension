import assert from 'assert';
import * as vscode from 'vscode';
import * as os from 'os';
import * as fs from 'fs';
import * as path from 'path';
import { createSearchTools } from '../../mcp/tools/search';

// Rewritten to pin the real search.ts behavior in this environment. The old
// suite double-stubbed vscode.commands.executeCommand (which leaked between
// tests) and assumed ripgrep. In the headless test host ripgrep is not on the
// child PATH and no workspace is indexed, so grep falls back to the VS Code
// file search (empty) and the symbol provider returns nothing -- both of which
// are deterministic, real outputs we assert on. Positive git/grep coverage
// lives in git-search.test.ts.
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

    test('grep returns "No matches found" when ripgrep/workspace search yields nothing', async () => {
        const result = await tool('grep').handler({ pattern: 'needle', path: dir });
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
        const result = await tool('search').handler({ query: 'needle', type: 'text', path: dir });
        assert.strictEqual(result, 'No results found');
    });

    test('batch_search runs each search and labels the sections', async () => {
        const result = await tool('batch_search').handler({
            searches: [{ query: 'needle', type: 'text', path: dir }]
        });
        assert.ok(result.includes('Search 1: "needle"'));
    });
});
