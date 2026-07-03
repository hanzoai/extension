import assert from 'assert';
import * as vscode from 'vscode';
import * as os from 'os';
import * as fs from 'fs';
import * as path from 'path';
import { execSync } from 'child_process';
import { createGitSearchTools } from '../../mcp/tools/git-search';

// Rewritten to drive the real git_search tool (which shells out to git via
// child_process.exec) against a throwaway git repository, rather than stubbing
// child_process.exec (non-configurable in the test host).
suite('Git Search Tools Test Suite', () => {
    let repo: string;
    let nonRepo: string;
    let tools: any[];

    suiteSetup(() => {
        repo = fs.mkdtempSync(path.join(os.tmpdir(), 'hanzo-git-'));
        const git = (cmd: string) => execSync(
            `git -c user.email=t@t -c user.name=t ${cmd}`,
            { cwd: repo, stdio: 'ignore' }
        );
        git('init -q');
        fs.writeFileSync(path.join(repo, 'foo.txt'), 'hello world');
        git('add foo.txt');
        git('commit -q -m "add foo file"');

        nonRepo = fs.mkdtempSync(path.join(os.tmpdir(), 'hanzo-nogit-'));
    });

    suiteTeardown(() => {
        fs.rmSync(repo, { recursive: true, force: true });
        fs.rmSync(nonRepo, { recursive: true, force: true });
    });

    setup(() => {
        tools = createGitSearchTools({ subscriptions: [] } as any as vscode.ExtensionContext);
    });

    const tool = (name: string) => tools.find(t => t.name === name)!;

    test('git_search finds matching commits', async () => {
        const result = await tool('git_search').handler({ pattern: 'foo', type: 'commits', path: repo });
        assert.ok(result.includes('Found 1 results'));
        assert.ok(result.includes('add foo file'));
    });

    test('git_search lists matching tracked files', async () => {
        const result = await tool('git_search').handler({ pattern: 'foo', type: 'files', path: repo });
        assert.ok(result.includes('foo.txt'));
    });

    test('git_search reports when nothing matches', async () => {
        const result = await tool('git_search').handler({ pattern: 'zzznomatch', type: 'commits', path: repo });
        assert.strictEqual(result, "No results found for pattern 'zzznomatch'");
    });

    test('git_search rejects an unknown search type', async () => {
        await assert.rejects(
            tool('git_search').handler({ pattern: 'x', type: 'bogus', path: repo }),
            /Unknown search type: bogus/
        );
    });

    test('git_search rejects a non-git directory', async () => {
        await assert.rejects(
            tool('git_search').handler({ pattern: 'x', type: 'commits', path: nonRepo }),
            /Not a git repository/
        );
    });

    test('git_search requires a workspace or explicit path', async () => {
        await assert.rejects(
            tool('git_search').handler({ pattern: 'x', type: 'commits' }),
            /No workspace folder found/
        );
    });

    test('watch start/list/stop behave as documented', async () => {
        assert.ok((await tool('watch').handler({ pattern: '**/*.ts', path: repo, action: 'start' }))
            .includes('Started watching'));
        assert.ok((await tool('watch').handler({ pattern: '**/*.ts', action: 'list' }))
            .includes('No watchers currently active'));
        await assert.rejects(
            tool('watch').handler({ pattern: '**/*.ts', action: 'stop' }),
            /Watcher ID required for stop action/
        );
    });
});
