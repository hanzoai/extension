import * as assert from 'assert';
import * as sinon from 'sinon';
import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { createFileSystemTools } from '../../mcp/tools/filesystem';

suite('File Tools Test Suite', () => {
    let fileTools: FileTools;
    let sandbox: sinon.SinonSandbox;
    let context: vscode.ExtensionContext;

    setup(() => {
        sandbox = sinon.createSandbox();
        
        context = {
            globalState: {
                get: sandbox.stub(),
                update: sandbox.stub()
            },
            extensionPath: '/mock/extension'
        } as any;

        fileTools = new FileTools(context);
    });

    teardown(() => {
        sandbox.restore();
    });

    suite('Read Tool', () => {
        test('Should read file successfully', async () => {
            const mockContent = 'Hello, world!';
            sandbox.stub(fs.promises, 'readFile').resolves(Buffer.from(mockContent));
            sandbox.stub(fs, 'existsSync').returns(true);

            const result = await fileTools.getTools()[0].handler({ path: '/test/file.txt' });
            
            assert.ok(result.success);
            assert.strictEqual(result.content, mockContent);
        });

        test('Should handle non-existent file', async () => {
            sandbox.stub(fs, 'existsSync').returns(false);

            const result = await fileTools.getTools()[0].handler({ path: '/test/nonexistent.txt' });
            
            assert.ok(!result.success);
            assert.ok(result.error.includes('does not exist'));
        });

        test('Should validate path security', async () => {
            const result = await fileTools.getTools()[0].handler({ path: '../../../etc/passwd' });
            
            assert.ok(!result.success);
            assert.ok(result.error.includes('Invalid path'));
        });
    });

    suite('Write Tool', () => {
        test('Should write file successfully', async () => {
            sandbox.stub(fs.promises, 'writeFile').resolves();
            sandbox.stub(fs.promises, 'mkdir').resolves();
            sandbox.stub(path, 'dirname').returns('/test');

            const result = await fileTools.getTools()[1].handler({ 
                path: '/test/file.txt',
                content: 'New content'
            });
            
            assert.ok(result.success);
            assert.strictEqual(result.message, 'File written successfully');
        });

        test('Should create directory if not exists', async () => {
            const mkdirStub = sandbox.stub(fs.promises, 'mkdir').resolves();
            sandbox.stub(fs.promises, 'writeFile').resolves();
            sandbox.stub(path, 'dirname').returns('/test/new/dir');

            await fileTools.getTools()[1].handler({ 
                path: '/test/new/dir/file.txt',
                content: 'Content'
            });
            
            assert.ok(mkdirStub.calledWith('/test/new/dir', { recursive: true }));
        });

        test('Should handle write errors', async () => {
            sandbox.stub(fs.promises, 'writeFile').rejects(new Error('Permission denied'));
            sandbox.stub(fs.promises, 'mkdir').resolves();

            const result = await fileTools.getTools()[1].handler({ 
                path: '/test/file.txt',
                content: 'Content'
            });
            
            assert.ok(!result.success);
            assert.ok(result.error.includes('Permission denied'));
        });
    });

    suite('Edit Tool', () => {
        test('Should edit file successfully', async () => {
            const originalContent = 'Hello, world!';
            const newContent = 'Hello, universe!';
            
            sandbox.stub(fs, 'existsSync').returns(true);
            sandbox.stub(fs.promises, 'readFile').resolves(Buffer.from(originalContent));
            const writeStub = sandbox.stub(fs.promises, 'writeFile').resolves();

            const result = await fileTools.getTools()[2].handler({ 
                path: '/test/file.txt',
                old_string: 'world',
                new_string: 'universe'
            });
            
            assert.ok(result.success);
            assert.ok(writeStub.calledWith('/test/file.txt', newContent));
        });

        test('Should handle string not found', async () => {
            sandbox.stub(fs, 'existsSync').returns(true);
            sandbox.stub(fs.promises, 'readFile').resolves(Buffer.from('Hello, world!'));

            const result = await fileTools.getTools()[2].handler({ 
                path: '/test/file.txt',
                old_string: 'not found',
                new_string: 'replacement'
            });
            
            assert.ok(!result.success);
            assert.ok(result.error.includes('not found in file'));
        });

        test('Should handle replace_all option', async () => {
            const originalContent = 'foo bar foo baz foo';
            const expectedContent = 'baz bar baz baz baz';
            
            sandbox.stub(fs, 'existsSync').returns(true);
            sandbox.stub(fs.promises, 'readFile').resolves(Buffer.from(originalContent));
            const writeStub = sandbox.stub(fs.promises, 'writeFile').resolves();

            const result = await fileTools.getTools()[2].handler({ 
                path: '/test/file.txt',
                old_string: 'foo',
                new_string: 'baz',
                replace_all: true
            });
            
            assert.ok(result.success);
            assert.ok(writeStub.calledWith('/test/file.txt', expectedContent));
        });
    });

    suite('Multi Edit Tool', () => {
        test('Should perform multiple edits', async () => {
            const originalContent = 'Hello, world! Welcome to the world.';
            const expectedContent = 'Hi, universe! Welcome to the universe.';
            
            sandbox.stub(fs, 'existsSync').returns(true);
            sandbox.stub(fs.promises, 'readFile').resolves(Buffer.from(originalContent));
            const writeStub = sandbox.stub(fs.promises, 'writeFile').resolves();

            const result = await fileTools.getTools()[3].handler({ 
                path: '/test/file.txt',
                edits: [
                    { old_string: 'Hello', new_string: 'Hi' },
                    { old_string: 'world', new_string: 'universe', replace_all: true }
                ]
            });
            
            assert.ok(result.success);
            assert.ok(writeStub.calledWith('/test/file.txt', expectedContent));
        });

        test('Should fail if any edit fails', async () => {
            sandbox.stub(fs, 'existsSync').returns(true);
            sandbox.stub(fs.promises, 'readFile').resolves(Buffer.from('Hello, world!'));

            const result = await fileTools.getTools()[3].handler({ 
                path: '/test/file.txt',
                edits: [
                    { old_string: 'Hello', new_string: 'Hi' },
                    { old_string: 'not found', new_string: 'replacement' }
                ]
            });
            
            assert.ok(!result.success);
            assert.ok(result.error.includes('Edit 2 failed'));
        });
    });

    suite('Directory Tree Tool', () => {
        test('Should generate directory tree', async () => {
            // Mock file system structure
            sandbox.stub(fs, 'existsSync').returns(true);
            sandbox.stub(fs, 'statSync').returns({ isDirectory: () => true } as any);
            sandbox.stub(fs, 'readdirSync').returns(['file1.txt', 'dir1', 'file2.js'] as any);

            const result = await fileTools.getTools()[4].handler({ 
                path: '/test',
                max_depth: 2
            });
            
            assert.ok(result.success);
            assert.ok(result.tree);
            assert.ok(result.tree.includes('/test'));
        });

        test('Should respect max_depth', async () => {
            sandbox.stub(fs, 'existsSync').returns(true);
            sandbox.stub(fs, 'statSync').returns({ isDirectory: () => true } as any);
            sandbox.stub(fs, 'readdirSync').returns(['file.txt'] as any);

            const result = await fileTools.getTools()[4].handler({ 
                path: '/test',
                max_depth: 0
            });
            
            assert.ok(result.success);
            assert.ok(!result.tree.includes('file.txt'));
        });
    });

    suite('Find Files Tool', () => {
        test('Should find files by pattern', async () => {
            const mockFiles = [
                '/test/file1.js',
                '/test/file2.ts',
                '/test/subdir/file3.js'
            ];

            // Mock glob functionality
            sandbox.stub(vscode.workspace, 'findFiles').resolves(
                mockFiles.map(f => vscode.Uri.file(f))
            );

            const result = await fileTools.getTools()[5].handler({ 
                pattern: '**/*.js'
            });
            
            assert.ok(result.success);
            assert.strictEqual(result.files.length, 2);
            assert.ok(result.files.includes('/test/file1.js'));
            assert.ok(result.files.includes('/test/subdir/file3.js'));
        });

        test('Should handle no matches', async () => {
            sandbox.stub(vscode.workspace, 'findFiles').resolves([]);

            const result = await fileTools.getTools()[5].handler({ 
                pattern: '**/*.xyz'
            });
            
            assert.ok(result.success);
            assert.strictEqual(result.files.length, 0);
            assert.strictEqual(result.message, 'No files found matching pattern');
        });

        test('Should handle exclude patterns', async () => {
            const mockFiles = [vscode.Uri.file('/test/file.js')];
            const findFilesStub = sandbox.stub(vscode.workspace, 'findFiles').resolves(mockFiles);

            await fileTools.getTools()[5].handler({ 
                pattern: '**/*.js',
                exclude: '**/node_modules/**'
            });
            
            assert.ok(findFilesStub.calledWith('**/*.js', '**/node_modules/**'));
        });
    });
});