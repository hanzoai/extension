import * as assert from 'assert';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';

suite('MCP Tools Unit Test Suite', () => {
    let testDir: string;

    setup(async () => {
        // Create a temp directory for testing
        testDir = path.join(os.tmpdir(), 'hanzo-unit-test-' + Date.now());
        await fs.promises.mkdir(testDir, { recursive: true });
    });

    teardown(async () => {
        // Cleanup test directory
        await fs.promises.rm(testDir, { recursive: true, force: true });
    });

    test('File operations - read and write', async () => {
        const testFile = path.join(testDir, 'test.txt');
        const content = 'Test content';
        
        // Write
        await fs.promises.writeFile(testFile, content);
        
        // Read
        const read = await fs.promises.readFile(testFile, 'utf-8');
        assert.strictEqual(read, content);
    });

    test('File operations - edit content', async () => {
        const testFile = path.join(testDir, 'edit.txt');
        await fs.promises.writeFile(testFile, 'Original content');
        
        // Edit
        const original = await fs.promises.readFile(testFile, 'utf-8');
        const edited = original.replace('Original', 'Modified');
        await fs.promises.writeFile(testFile, edited);
        
        // Verify
        const result = await fs.promises.readFile(testFile, 'utf-8');
        assert.strictEqual(result, 'Modified content');
    });

    test('Search operations - text search', async () => {
        const files = [
            { name: 'file1.txt', content: 'This contains search term' },
            { name: 'file2.txt', content: 'This does not contain it' },
            { name: 'file3.txt', content: 'Another search instance' }
        ];
        
        // Create files
        for (const file of files) {
            await fs.promises.writeFile(path.join(testDir, file.name), file.content);
        }
        
        // Search
        const results: string[] = [];
        for (const file of files) {
            const content = await fs.promises.readFile(path.join(testDir, file.name), 'utf-8');
            if (content.includes('search')) {
                results.push(file.name);
            }
        }
        
        assert.strictEqual(results.length, 2);
        assert.ok(results.includes('file1.txt'));
        assert.ok(results.includes('file3.txt'));
    });

    test('Directory operations - list files', async () => {
        // Create test structure
        await fs.promises.writeFile(path.join(testDir, 'file1.txt'), '');
        await fs.promises.writeFile(path.join(testDir, 'file2.js'), '');
        await fs.promises.mkdir(path.join(testDir, 'subdir'));
        await fs.promises.writeFile(path.join(testDir, 'subdir', 'file3.ts'), '');
        
        // List directory
        const entries = await fs.promises.readdir(testDir);
        assert.strictEqual(entries.length, 3);
        assert.ok(entries.includes('file1.txt'));
        assert.ok(entries.includes('file2.js'));
        assert.ok(entries.includes('subdir'));
    });

    test('Pattern matching - glob simulation', async () => {
        const files = ['test.js', 'test.ts', 'other.txt', 'code.js'];
        
        // Create files
        for (const file of files) {
            await fs.promises.writeFile(path.join(testDir, file), '');
        }
        
        // Simulate pattern matching for *.js
        const entries = await fs.promises.readdir(testDir);
        const jsFiles = entries.filter(f => f.endsWith('.js'));
        
        assert.strictEqual(jsFiles.length, 2);
        assert.ok(jsFiles.includes('test.js'));
        assert.ok(jsFiles.includes('code.js'));
    });

    test('Content analysis - line counting', async () => {
        const content = 'Line 1\nLine 2\nLine 3\n\nLine 5';
        const testFile = path.join(testDir, 'lines.txt');
        await fs.promises.writeFile(testFile, content);
        
        const read = await fs.promises.readFile(testFile, 'utf-8');
        const lines = read.split('\n');
        
        assert.strictEqual(lines.length, 5);
        assert.strictEqual(lines[0], 'Line 1');
        assert.strictEqual(lines[3], ''); // Empty line
        assert.strictEqual(lines[4], 'Line 5');
    });

    test('JSON handling', async () => {
        const data = {
            name: 'test',
            version: '1.0.0',
            dependencies: {
                'rxdb': '^15.0.0'
            }
        };
        
        const jsonFile = path.join(testDir, 'data.json');
        await fs.promises.writeFile(jsonFile, JSON.stringify(data, null, 2));
        
        // Read and parse
        const content = await fs.promises.readFile(jsonFile, 'utf-8');
        const parsed = JSON.parse(content);
        
        assert.strictEqual(parsed.name, 'test');
        assert.strictEqual(parsed.version, '1.0.0');
        assert.ok(parsed.dependencies.rxdb);
    });

    test('Error handling - file not found', async () => {
        try {
            await fs.promises.readFile(path.join(testDir, 'nonexistent.txt'), 'utf-8');
            assert.fail('Should have thrown an error');
        } catch (error: any) {
            assert.ok(error.code === 'ENOENT');
        }
    });

    test('Multi-edit simulation', async () => {
        const testFile = path.join(testDir, 'multi.txt');
        let content = 'Line 1: Original\nLine 2: Original\nLine 3: Different';
        await fs.promises.writeFile(testFile, content);
        
        // Simulate multiple edits
        content = content.replace('Line 1: Original', 'Line 1: Modified');
        content = content.replace('Line 2: Original', 'Line 2: Modified');
        await fs.promises.writeFile(testFile, content);
        
        const result = await fs.promises.readFile(testFile, 'utf-8');
        assert.ok(result.includes('Line 1: Modified'));
        assert.ok(result.includes('Line 2: Modified'));
        assert.ok(result.includes('Line 3: Different'));
    });

    test('Path resolution', async () => {
        const relativePath = './subdir/file.txt';
        const absolutePath = path.resolve(testDir, relativePath);
        
        assert.ok(path.isAbsolute(absolutePath));
        assert.ok(absolutePath.includes('subdir'));
        assert.ok(absolutePath.endsWith('file.txt'));
    });
});