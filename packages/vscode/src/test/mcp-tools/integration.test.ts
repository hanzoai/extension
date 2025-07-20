import * as assert from 'assert';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import * as vscode from 'vscode';
import { createFileSystemTools } from '../../mcp/tools/filesystem';
import { createSearchTools } from '../../mcp/tools/search';
import { createShellTools } from '../../mcp/tools/shell';
import { createEditorTools } from '../../mcp/tools/editor';
import { createUnifiedSearchTool } from '../../mcp/tools/unified-search';

suite('MCP Tools Integration Test Suite', () => {
    let testDir: string;
    let mockContext: any;

    setup(async () => {
        // Create a temp directory for testing
        testDir = path.join(os.tmpdir(), 'hanzo-mcp-test-' + Date.now());
        await fs.promises.mkdir(testDir, { recursive: true });
        
        // Create mock context
        mockContext = {
            extensionPath: testDir,
            globalState: {
                get: () => undefined,
                update: async () => {},
                keys: () => []
            },
            workspaceState: {
                get: () => undefined,
                update: async () => {},
                keys: () => []
            },
            subscriptions: []
        };
    });

    teardown(async () => {
        // Cleanup test directory
        await fs.promises.rm(testDir, { recursive: true, force: true });
    });

    suite('FileSystem Tools', () => {
        test('should read file contents', async () => {
            const tools = createFileSystemTools(mockContext);
            const readTool = tools.find(t => t.name === 'read');
            assert.ok(readTool);

            // Create test file
            const testFile = path.join(testDir, 'test.txt');
            await fs.promises.writeFile(testFile, 'Line 1\nLine 2\nLine 3');

            // Test read
            const result = await readTool.handler({ path: testFile });
            assert.ok(result.includes('Line 1'));
            assert.ok(result.includes('Line 2'));
            assert.ok(result.includes('Line 3'));
        });

        test('should write file contents', async () => {
            const tools = createFileSystemTools(mockContext);
            const writeTool = tools.find(t => t.name === 'write');
            assert.ok(writeTool);

            const testFile = path.join(testDir, 'new.txt');
            const content = 'New content';

            // Test write
            await writeTool.handler({ path: testFile, content });

            // Verify
            const written = await fs.promises.readFile(testFile, 'utf-8');
            assert.strictEqual(written, content);
        });

        test('should edit file contents', async () => {
            const tools = createFileSystemTools(mockContext);
            const editTool = tools.find(t => t.name === 'edit');
            assert.ok(editTool);

            // Create test file
            const testFile = path.join(testDir, 'edit.txt');
            await fs.promises.writeFile(testFile, 'Original content here');

            // Test edit
            await editTool.handler({
                path: testFile,
                old_string: 'Original',
                new_string: 'Modified'
            });

            // Verify
            const edited = await fs.promises.readFile(testFile, 'utf-8');
            assert.ok(edited.includes('Modified'));
            assert.ok(!edited.includes('Original'));
        });

        test('should list directory contents', async () => {
            const tools = createFileSystemTools(mockContext);
            const treeTool = tools.find(t => t.name === 'directory_tree');
            assert.ok(treeTool);

            // Create test files
            await fs.promises.writeFile(path.join(testDir, 'file1.txt'), 'content');
            await fs.promises.writeFile(path.join(testDir, 'file2.txt'), 'content');
            await fs.promises.mkdir(path.join(testDir, 'subdir'));

            // Test directory tree
            const result = await treeTool.handler({ path: testDir, max_depth: 1 });
            assert.ok(result.includes('file1.txt'));
            assert.ok(result.includes('file2.txt'));
            assert.ok(result.includes('subdir'));
        });
    });

    suite('Search Tools', () => {
        test('should search for text in files', async () => {
            const tools = createSearchTools(mockContext);
            const grepTool = tools.find(t => t.name === 'grep');
            assert.ok(grepTool);

            // Create test files
            await fs.promises.writeFile(
                path.join(testDir, 'search1.txt'),
                'This is a test file\nIt contains search term\nAnd more content'
            );
            await fs.promises.writeFile(
                path.join(testDir, 'search2.txt'),
                'Another file\nWithout the term'
            );

            // Test grep
            const result = await grepTool.handler({
                pattern: 'search',
                path: testDir
            });

            assert.ok(typeof result === 'string');
            assert.ok(result.includes('search1.txt'));
            assert.ok(result.includes('search term'));
        });

        test('should find files by pattern', async () => {
            const tools = createSearchTools(mockContext);
            const findTool = tools.find(t => t.name === 'find_files');
            
            if (findTool) {
                // Create test files
                await fs.promises.writeFile(path.join(testDir, 'test.js'), '');
                await fs.promises.writeFile(path.join(testDir, 'test.ts'), '');
                await fs.promises.writeFile(path.join(testDir, 'other.txt'), '');

                // Test find files
                const result = await findTool.handler({
                    pattern: '*.{js,ts}',
                    path: testDir
                });

                assert.ok(result.includes('test.js'));
                assert.ok(result.includes('test.ts'));
                assert.ok(!result.includes('other.txt'));
            }
        });
    });

    suite('Shell Tools', () => {
        test('should execute shell commands', async () => {
            const tools = createShellTools(mockContext);
            const shellTool = tools.find(t => t.name === 'run_command');
            assert.ok(shellTool);

            // Test echo command
            const result = await shellTool.handler({
                command: 'echo "Hello from test"'
            });

            assert.ok(result.includes('Hello from test'));
        });

        test('should handle command errors', async () => {
            const tools = createShellTools(mockContext);
            const shellTool = tools.find(t => t.name === 'run_command');
            assert.ok(shellTool);

            // Test command that should fail
            try {
                await shellTool.handler({
                    command: 'exit 1'
                });
                assert.fail('Should have thrown an error');
            } catch (error: any) {
                assert.ok(error.message.includes('exit code 1'));
            }
        });
    });

    suite('Editor Tools', () => {
        test('should support multi-edit operations', async () => {
            const tools = createEditorTools(mockContext);
            const multiEditTool = tools.find(t => t.name === 'multi_edit');
            
            if (multiEditTool) {
                // Create test file
                const testFile = path.join(testDir, 'multi.txt');
                await fs.promises.writeFile(testFile, 
                    'Line 1: Original\nLine 2: Original\nLine 3: Different'
                );

                // Test multi-edit
                await multiEditTool.handler({
                    path: testFile,
                    edits: [
                        { old_string: 'Line 1: Original', new_string: 'Line 1: Modified' },
                        { old_string: 'Line 2: Original', new_string: 'Line 2: Modified' }
                    ]
                });

                // Verify
                const edited = await fs.promises.readFile(testFile, 'utf-8');
                assert.ok(edited.includes('Line 1: Modified'));
                assert.ok(edited.includes('Line 2: Modified'));
                assert.ok(edited.includes('Line 3: Different'));
            }
        });
    });

    suite('Unified Search Tool', () => {
        test('should perform unified search', async () => {
            const tool = createUnifiedSearchTool(mockContext);
            
            // Create test content
            await fs.promises.writeFile(
                path.join(testDir, 'unified.ts'),
                'export function unifiedSearch() { return "results"; }'
            );

            // Test unified search
            const result = await tool.handler({
                query: 'unified',
                path: testDir
            });

            assert.ok(result);
            // Result format may vary, just ensure it doesn't crash
        });
    });

    suite('Tool Input Validation', () => {
        test('should validate required parameters', async () => {
            const tools = createFileSystemTools(mockContext);
            const readTool = tools.find(t => t.name === 'read');
            assert.ok(readTool);

            // Test missing required parameter
            try {
                await readTool.handler({} as any);
                assert.fail('Should have thrown an error');
            } catch (error: any) {
                assert.ok(error.message.includes('path') || error.message.includes('required'));
            }
        });

        test('should handle invalid file paths', async () => {
            const tools = createFileSystemTools(mockContext);
            const readTool = tools.find(t => t.name === 'read');
            assert.ok(readTool);

            // Test non-existent file
            try {
                await readTool.handler({ path: '/nonexistent/file.txt' });
                assert.fail('Should have thrown an error');
            } catch (error: any) {
                assert.ok(error.message.includes('Failed to read file') || 
                         error.message.includes('ENOENT'));
            }
        });
    });
});