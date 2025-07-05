import * as assert from 'assert';
import * as sinon from 'sinon';
import * as vscode from 'vscode';
import * as cp from 'child_process';
import * as fs from 'fs/promises';
import { createGitSearchTools } from '../../mcp/tools/git-search';

suite('Git Search Tools Test Suite', () => {
    let context: vscode.ExtensionContext;
    let gitSearchTools: any[];
    let sandbox: sinon.SinonSandbox;
    let workspaceStub: sinon.SinonStub;
    let execStub: sinon.SinonStub;
    let fsReadFileStub: sinon.SinonStub;
    let fsWriteFileStub: sinon.SinonStub;
    let fsStatStub: sinon.SinonStub;

    setup(() => {
        sandbox = sinon.createSandbox();
        
        // Mock VS Code workspace
        workspaceStub = sandbox.stub(vscode.workspace, 'workspaceFolders').value([{
            uri: vscode.Uri.file('/test/workspace'),
            name: 'Test Workspace',
            index: 0
        }]);
        
        // Mock child_process.exec
        execStub = sandbox.stub(cp, 'exec');
        
        // Mock fs methods
        fsReadFileStub = sandbox.stub(fs, 'readFile');
        fsWriteFileStub = sandbox.stub(fs, 'writeFile').resolves();
        fsStatStub = sandbox.stub(fs, 'stat');
        
        // Mock VS Code context
        context = {
            subscriptions: [],
            workspaceState: {
                get: sandbox.stub(),
                update: sandbox.stub().resolves()
            },
            globalState: {
                get: sandbox.stub().returns([]),
                update: sandbox.stub().resolves(),
                setKeysForSync: sandbox.stub()
            },
            extensionPath: '/test/extension',
            extensionUri: vscode.Uri.file('/test/extension'),
            storageUri: vscode.Uri.file('/test/storage'),
            globalStorageUri: vscode.Uri.file('/test/global-storage'),
            logUri: vscode.Uri.file('/test/logs'),
            extensionMode: vscode.ExtensionMode.Test,
            asAbsolutePath: (path: string) => `/test/extension/${path}`,
            storagePath: '/test/storage',
            globalStoragePath: '/test/global-storage',
            logPath: '/test/logs'
        } as any;
        
        gitSearchTools = createGitSearchTools(context);
    });

    teardown(() => {
        sandbox.restore();
    });

    test('Git_search tool should search in git history', async () => {
        const gitSearchTool = gitSearchTools.find(t => t.name === 'git_search');
        assert.ok(gitSearchTool);
        
        const gitLogOutput = `
commit abc123
Author: Test User <test@example.com>
Date:   Mon Jan 1 10:00:00 2024 +0000

    Add search functionality

diff --git a/src/search.ts b/src/search.ts
@@ -10,6 +10,8 @@
 function search(query) {
-  // TODO: implement
+  const results = index.search(query);
+  return results;
 }

commit def456
Author: Test User <test@example.com>
Date:   Sun Dec 31 15:00:00 2023 +0000

    Initial search module

diff --git a/src/search.ts b/src/search.ts
new file mode 100644
@@ -0,0 +1,5 @@
+function search(query) {
+  // TODO: implement
+}
+
+export { search };
`;
        
        execStub.callsFake((cmd, options, callback) => {
            if (cmd.includes('git log -p')) {
                callback(null, gitLogOutput, '');
            }
        });
        
        const result = await gitSearchTool.handler({
            search_term: 'search',
            file_pattern: '*.ts'
        });
        
        assert.ok(result.includes('Found 2 commits'));
        assert.ok(result.includes('Add search functionality'));
        assert.ok(result.includes('Initial search module'));
        assert.ok(result.includes('src/search.ts'));
        assert.ok(result.includes('const results = index.search(query)'));
    });

    test('Git_search tool should handle file pattern filtering', async () => {
        const gitSearchTool = gitSearchTools.find(t => t.name === 'git_search');
        
        execStub.callsFake((cmd, options, callback) => {
            // Check that the command includes file pattern
            assert.ok(cmd.includes('-- "*.py"'));
            callback(null, '', '');
        });
        
        await gitSearchTool.handler({
            search_term: 'test',
            file_pattern: '*.py'
        });
        
        assert.ok(execStub.calledOnce);
    });

    test('Content_replace tool should replace content in files', async () => {
        const contentReplaceTool = gitSearchTools.find(t => t.name === 'content_replace');
        assert.ok(contentReplaceTool);
        
        const originalContent = `function oldFunction() {
    return "old value";
}

oldFunction();`;
        
        fsReadFileStub.resolves(originalContent);
        fsStatStub.resolves({ isFile: () => true });
        
        const result = await contentReplaceTool.handler({
            pattern: 'oldFunction',
            replacement: 'newFunction',
            files: ['/test/workspace/test.js']
        });
        
        assert.ok(result.includes('Replaced 2 occurrences in 1 file'));
        
        const writeCall = fsWriteFileStub.firstCall;
        const newContent = writeCall.args[1];
        
        assert.ok(newContent.includes('function newFunction()'));
        assert.ok(newContent.includes('newFunction();'));
        assert.ok(!newContent.includes('oldFunction'));
    });

    test('Content_replace tool should use regex when specified', async () => {
        const contentReplaceTool = gitSearchTools.find(t => t.name === 'content_replace');
        
        const content = 'test123 test456 test789';
        fsReadFileStub.resolves(content);
        fsStatStub.resolves({ isFile: () => true });
        
        const result = await contentReplaceTool.handler({
            pattern: 'test\\d+',
            replacement: 'replaced',
            files: ['/test/workspace/test.txt'],
            regex: true
        });
        
        assert.ok(result.includes('Replaced 3 occurrences'));
        
        const newContent = fsWriteFileStub.firstCall.args[1];
        assert.strictEqual(newContent, 'replaced replaced replaced');
    });

    test('Diff tool should show differences between files', async () => {
        const diffTool = gitSearchTools.find(t => t.name === 'diff');
        assert.ok(diffTool);
        
        const gitDiffOutput = `diff --git a/src/test.ts b/src/test.ts
index abc123..def456 100644
--- a/src/test.ts
+++ b/src/test.ts
@@ -1,5 +1,6 @@
 function test() {
-  console.log("old");
+  console.log("new");
+  console.log("added line");
 }
 
 export { test };`;
        
        execStub.callsFake((cmd, callback) => {
            if (cmd.includes('git diff')) {
                callback(null, gitDiffOutput, '');
            }
        });
        
        const result = await diffTool.handler({
            path: 'src/test.ts'
        });
        
        assert.ok(result.includes('src/test.ts'));
        assert.ok(result.includes('-  console.log("old")'));
        assert.ok(result.includes('+  console.log("new")'));
        assert.ok(result.includes('+  console.log("added line")'));
    });

    test('Diff tool should compare two files', async () => {
        const diffTool = gitSearchTools.find(t => t.name === 'diff');
        
        execStub.callsFake((cmd, callback) => {
            if (cmd.includes('diff -u')) {
                callback(null, `--- file1.txt
+++ file2.txt
@@ -1,3 +1,3 @@
 Line 1
-Line 2 old
+Line 2 new
 Line 3`, '');
            }
        });
        
        const result = await diffTool.handler({
            path: 'file1.txt',
            compare_to: 'file2.txt'
        });
        
        assert.ok(result.includes('file1.txt'));
        assert.ok(result.includes('file2.txt'));
        assert.ok(result.includes('-Line 2 old'));
        assert.ok(result.includes('+Line 2 new'));
    });

    test('Watch tool should set up file watchers', async () => {
        const watchTool = gitSearchTools.find(t => t.name === 'watch');
        assert.ok(watchTool);
        
        let watcherCallback: vscode.Disposable | undefined;
        const createFileSystemWatcherStub = sandbox.stub(vscode.workspace, 'createFileSystemWatcher')
            .returns({
                onDidChange: (callback: any) => {
                    watcherCallback = { dispose: () => {} };
                    return watcherCallback;
                },
                onDidCreate: () => ({ dispose: () => {} }),
                onDidDelete: () => ({ dispose: () => {} }),
                dispose: () => {}
            } as any);
        
        const result = await watchTool.handler({
            patterns: ['**/*.ts', '**/*.js'],
            action: 'start'
        });
        
        assert.ok(result.includes('Started watching 2 patterns'));
        assert.ok(createFileSystemWatcherStub.calledTwice);
    });

    test('Watch tool should stop watchers', async () => {
        const watchTool = gitSearchTools.find(t => t.name === 'watch');
        
        // Start watching first
        const disposeMock = sandbox.stub();
        sandbox.stub(vscode.workspace, 'createFileSystemWatcher').returns({
            onDidChange: () => ({ dispose: disposeMock }),
            onDidCreate: () => ({ dispose: disposeMock }),
            onDidDelete: () => ({ dispose: disposeMock }),
            dispose: disposeMock
        } as any);
        
        await watchTool.handler({
            patterns: ['**/*.ts'],
            action: 'start'
        });
        
        // Now stop
        const result = await watchTool.handler({
            action: 'stop'
        });
        
        assert.ok(result.includes('Stopped all file watchers'));
        assert.ok(disposeMock.called);
    });

    test('Git_search tool should handle no results', async () => {
        const gitSearchTool = gitSearchTools.find(t => t.name === 'git_search');
        
        execStub.callsFake((cmd, options, callback) => {
            callback(null, '', '');
        });
        
        const result = await gitSearchTool.handler({
            search_term: 'nonexistent'
        });
        
        assert.ok(result.includes('No commits found'));
    });

    test('Content_replace tool should handle glob patterns', async () => {
        const contentReplaceTool = gitSearchTools.find(t => t.name === 'content_replace');
        
        const findFilesStub = sandbox.stub(vscode.workspace, 'findFiles').resolves([
            vscode.Uri.file('/test/workspace/file1.js'),
            vscode.Uri.file('/test/workspace/file2.js')
        ]);
        
        fsReadFileStub.resolves('oldValue');
        fsStatStub.resolves({ isFile: () => true });
        
        const result = await contentReplaceTool.handler({
            pattern: 'oldValue',
            replacement: 'newValue',
            files: ['**/*.js']
        });
        
        assert.ok(findFilesStub.calledOnce);
        assert.ok(result.includes('2 files'));
        assert.strictEqual(fsWriteFileStub.callCount, 2);
    });

    test('Content_replace tool should skip files with no matches', async () => {
        const contentReplaceTool = gitSearchTools.find(t => t.name === 'content_replace');
        
        fsReadFileStub.onFirstCall().resolves('no match here');
        fsReadFileStub.onSecondCall().resolves('oldValue to replace');
        fsStatStub.resolves({ isFile: () => true });
        
        const result = await contentReplaceTool.handler({
            pattern: 'oldValue',
            replacement: 'newValue',
            files: ['/test/file1.txt', '/test/file2.txt']
        });
        
        assert.ok(result.includes('1 file'));
        assert.strictEqual(fsWriteFileStub.callCount, 1);
    });

    test('Diff tool should handle uncommitted changes', async () => {
        const diffTool = gitSearchTools.find(t => t.name === 'diff');
        
        execStub.callsFake((cmd, callback) => {
            if (cmd === 'git diff') {
                callback(null, 'diff output', '');
            }
        });
        
        const result = await diffTool.handler({});
        
        assert.ok(execStub.calledWith('git diff'));
        assert.ok(result.includes('diff output'));
    });

    test('Git_search tool should handle git command errors', async () => {
        const gitSearchTool = gitSearchTools.find(t => t.name === 'git_search');
        
        execStub.callsFake((cmd, options, callback) => {
            callback(new Error('Not a git repository'), '', '');
        });
        
        await assert.rejects(
            gitSearchTool.handler({ search_term: 'test' }),
            /Not a git repository/
        );
    });

    test('Watch tool should list active watchers', async () => {
        const watchTool = gitSearchTools.find(t => t.name === 'watch');
        
        // Set up watchers first
        sandbox.stub(vscode.workspace, 'createFileSystemWatcher').returns({
            onDidChange: () => ({ dispose: () => {} }),
            onDidCreate: () => ({ dispose: () => {} }),
            onDidDelete: () => ({ dispose: () => {} }),
            dispose: () => {}
        } as any);
        
        await watchTool.handler({
            patterns: ['**/*.ts', '**/*.js'],
            action: 'start'
        });
        
        // List watchers
        const result = await watchTool.handler({
            action: 'list'
        });
        
        assert.ok(result.includes('Active watchers:'));
        assert.ok(result.includes('**/*.ts'));
        assert.ok(result.includes('**/*.js'));
    });
});