import * as assert from 'assert';
import * as sinon from 'sinon';
import * as vscode from 'vscode';
import * as path from 'path';
import { createFileSystemTools } from '../../mcp/tools/filesystem';

suite('FileSystem Tools Test Suite', () => {
    let context: vscode.ExtensionContext;
    let fsTools: any[];
    let sandbox: sinon.SinonSandbox;
    let workspaceStub: sinon.SinonStub;
    let fsStub: {
        readFile: sinon.SinonStub;
        writeFile: sinon.SinonStub;
        stat: sinon.SinonStub;
        readDirectory: sinon.SinonStub;
    };

    setup(() => {
        sandbox = sinon.createSandbox();
        
        // Mock VS Code workspace
        workspaceStub = sandbox.stub(vscode.workspace, 'workspaceFolders').value([{
            uri: vscode.Uri.file('/test/workspace'),
            name: 'Test Workspace',
            index: 0
        }]);
        
        // Mock VS Code file system
        fsStub = {
            readFile: sandbox.stub(),
            writeFile: sandbox.stub().resolves(),
            stat: sandbox.stub(),
            readDirectory: sandbox.stub()
        };
        
        sandbox.stub(vscode.workspace.fs, 'readFile').callsFake(fsStub.readFile);
        sandbox.stub(vscode.workspace.fs, 'writeFile').callsFake(fsStub.writeFile);
        sandbox.stub(vscode.workspace.fs, 'stat').callsFake(fsStub.stat);
        sandbox.stub(vscode.workspace.fs, 'readDirectory').callsFake(fsStub.readDirectory);
        
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
        
        // Mock permission manager
        const permissionManager = {
            checkPermission: sandbox.stub().returns(true),
            allowed_paths: ['/test/workspace']
        };
        
        fsTools = createFileSystemTools(context, permissionManager as any);
    });

    teardown(() => {
        sandbox.restore();
    });

    test('Read tool should read file contents', async () => {
        const readTool = fsTools.find(t => t.name === 'read');
        assert.ok(readTool);
        
        const fileContent = 'Hello, World!\nThis is a test file.';
        fsStub.readFile.resolves(Buffer.from(fileContent));
        
        const result = await readTool.handler({
            file_path: '/test/workspace/test.txt'
        });
        
        assert.strictEqual(result, fileContent);
        assert.ok(fsStub.readFile.calledOnce);
    });

    test('Write tool should write file contents', async () => {
        const writeTool = fsTools.find(t => t.name === 'write');
        assert.ok(writeTool);
        
        const result = await writeTool.handler({
            file_path: '/test/workspace/new-file.txt',
            content: 'New file content'
        });
        
        assert.ok(result.includes('Successfully wrote'));
        assert.ok(result.includes('16 bytes'));
        assert.ok(fsStub.writeFile.calledOnce);
        
        const writeCall = fsStub.writeFile.firstCall;
        const writtenContent = Buffer.from(writeCall.args[1]).toString();
        assert.strictEqual(writtenContent, 'New file content');
    });

    test('Edit tool should replace content in file', async () => {
        const editTool = fsTools.find(t => t.name === 'edit');
        assert.ok(editTool);
        
        const originalContent = 'Line 1\nOld content\nLine 3';
        fsStub.readFile.resolves(Buffer.from(originalContent));
        
        const result = await editTool.handler({
            file_path: '/test/workspace/edit.txt',
            old_string: 'Old content',
            new_string: 'New content'
        });
        
        assert.ok(result.includes('Successfully edited'));
        
        const writeCall = fsStub.writeFile.firstCall;
        const writtenContent = Buffer.from(writeCall.args[1]).toString();
        assert.strictEqual(writtenContent, 'Line 1\nNew content\nLine 3');
    });

    test('Edit tool should handle non-unique old_string', async () => {
        const editTool = fsTools.find(t => t.name === 'edit');
        
        const content = 'test\ntest\ntest';
        fsStub.readFile.resolves(Buffer.from(content));
        
        await assert.rejects(
            editTool.handler({
                file_path: '/test/workspace/test.txt',
                old_string: 'test',
                new_string: 'replaced'
            }),
            /occurs 3 times/
        );
    });

    test('Multi_edit tool should apply multiple edits', async () => {
        const multiEditTool = fsTools.find(t => t.name === 'multi_edit');
        assert.ok(multiEditTool);
        
        const originalContent = 'foo\nbar\nbaz';
        fsStub.readFile.resolves(Buffer.from(originalContent));
        
        const result = await multiEditTool.handler({
            file_path: '/test/workspace/multi.txt',
            edits: [
                { old_string: 'foo', new_string: 'FOO' },
                { old_string: 'bar', new_string: 'BAR' },
                { old_string: 'baz', new_string: 'BAZ' }
            ]
        });
        
        assert.ok(result.includes('Successfully applied 3 edits'));
        
        const writeCall = fsStub.writeFile.firstCall;
        const writtenContent = Buffer.from(writeCall.args[1]).toString();
        assert.strictEqual(writtenContent, 'FOO\nBAR\nBAZ');
    });

    test('Directory_tree tool should list directory structure', async () => {
        const treeTool = fsTools.find(t => t.name === 'directory_tree');
        assert.ok(treeTool);
        
        // Mock directory structure
        fsStub.readDirectory
            .withArgs(vscode.Uri.file('/test/workspace'))
            .resolves([
                ['src', vscode.FileType.Directory],
                ['package.json', vscode.FileType.File],
                ['README.md', vscode.FileType.File]
            ]);
        
        fsStub.readDirectory
            .withArgs(vscode.Uri.file('/test/workspace/src'))
            .resolves([
                ['index.ts', vscode.FileType.File],
                ['utils.ts', vscode.FileType.File]
            ]);
        
        const result = await treeTool.handler({
            path: '/test/workspace',
            max_depth: 2
        });
        
        assert.ok(result.includes('src/'));
        assert.ok(result.includes('package.json'));
        assert.ok(result.includes('README.md'));
        assert.ok(result.includes('index.ts'));
        assert.ok(result.includes('utils.ts'));
    });

    test('Find_files tool should search for files', async () => {
        const findTool = fsTools.find(t => t.name === 'find_files');
        assert.ok(findTool);
        
        // Mock vscode.workspace.findFiles
        const findFilesStub = sandbox.stub(vscode.workspace, 'findFiles').resolves([
            vscode.Uri.file('/test/workspace/src/index.ts'),
            vscode.Uri.file('/test/workspace/src/utils.ts'),
            vscode.Uri.file('/test/workspace/test/index.test.ts')
        ]);
        
        const result = await findTool.handler({
            pattern: '**/*.ts'
        });
        
        assert.ok(result.includes('3 files found'));
        assert.ok(result.includes('src/index.ts'));
        assert.ok(result.includes('src/utils.ts'));
        assert.ok(result.includes('test/index.test.ts'));
        
        assert.ok(findFilesStub.calledOnce);
        const pattern = findFilesStub.firstCall.args[0];
        assert.ok(pattern.pattern.includes('**/*.ts'));
    });

    test('Grep tool should search file contents', async () => {
        const grepTool = fsTools.find(t => t.name === 'grep');
        assert.ok(grepTool);
        
        // Mock file search
        sandbox.stub(vscode.workspace, 'findFiles').resolves([
            vscode.Uri.file('/test/workspace/file1.ts'),
            vscode.Uri.file('/test/workspace/file2.ts')
        ]);
        
        // Mock file contents
        fsStub.readFile
            .withArgs(vscode.Uri.file('/test/workspace/file1.ts'))
            .resolves(Buffer.from('export function test() {\n  console.log("test");\n}'))
            .withArgs(vscode.Uri.file('/test/workspace/file2.ts'))
            .resolves(Buffer.from('import { test } from "./file1";\ntest();'));
        
        const result = await grepTool.handler({
            pattern: 'test',
            include: '**/*.ts'
        });
        
        assert.ok(result.includes('2 files with matches'));
        assert.ok(result.includes('file1.ts'));
        assert.ok(result.includes('file2.ts'));
        assert.ok(result.includes('3 total matches'));
    });

    test('Read tool should handle file not found', async () => {
        const readTool = fsTools.find(t => t.name === 'read');
        
        fsStub.readFile.rejects(new Error('File not found'));
        
        await assert.rejects(
            readTool.handler({ file_path: '/test/workspace/nonexistent.txt' }),
            /File not found/
        );
    });

    test('Write tool should handle permission denied', async () => {
        const writeTool = fsTools.find(t => t.name === 'write');
        
        // Create new permission manager that denies access
        const restrictedPermissionManager = {
            checkPermission: sandbox.stub().returns(false),
            allowed_paths: []
        };
        
        const restrictedTools = createFileSystemTools(context, restrictedPermissionManager as any);
        const restrictedWriteTool = restrictedTools.find(t => t.name === 'write');
        
        await assert.rejects(
            restrictedWriteTool.handler({
                file_path: '/restricted/file.txt',
                content: 'test'
            }),
            /Access denied/
        );
    });

    test('Edit tool should handle replace_all option', async () => {
        const editTool = fsTools.find(t => t.name === 'edit');
        
        const content = 'test test test';
        fsStub.readFile.resolves(Buffer.from(content));
        
        const result = await editTool.handler({
            file_path: '/test/workspace/test.txt',
            old_string: 'test',
            new_string: 'replaced',
            replace_all: true
        });
        
        assert.ok(result.includes('Successfully edited'));
        
        const writeCall = fsStub.writeFile.firstCall;
        const writtenContent = Buffer.from(writeCall.args[1]).toString();
        assert.strictEqual(writtenContent, 'replaced replaced replaced');
    });
});