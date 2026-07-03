import assert from 'assert';
import * as vscode from 'vscode';
import * as os from 'os';
import * as fs from 'fs';
import * as path from 'path';
import { createFileSystemTools } from '../../mcp/tools/filesystem';

// Rewritten to run the real filesystem tools against real temp files instead
// of stubbing fs.readFile (non-configurable in the test host). Current
// contract: read({ path, offset?, limit? }) numbers lines "N: <line>";
// edit/multi_edit use pattern/replacement; errors surface as "Failed to ...".
suite('FileSystem Tools Test Suite', () => {
    let dir: string;
    let tools: any[];

    setup(() => {
        dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hanzo-fs-'));
        tools = createFileSystemTools({ subscriptions: [] } as any as vscode.ExtensionContext);
    });

    teardown(() => { fs.rmSync(dir, { recursive: true, force: true }); });

    const tool = (name: string) => tools.find(t => t.name === name)!;

    test('read returns line-numbered content', async () => {
        const file = path.join(dir, 'read.txt');
        fs.writeFileSync(file, 'Line 1\nLine 2\nLine 3');
        const result = await tool('read').handler({ path: file });
        assert.ok(result.includes('1: Line 1'));
        assert.ok(result.includes('2: Line 2'));
        assert.ok(result.includes('3: Line 3'));
    });

    test('read honors offset and limit', async () => {
        const file = path.join(dir, 'range.txt');
        fs.writeFileSync(file, 'a\nb\nc\nd');
        const result = await tool('read').handler({ path: file, offset: 2, limit: 1 });
        assert.strictEqual(result, '2: b');
    });

    test('read throws on a missing file', async () => {
        await assert.rejects(
            tool('read').handler({ path: path.join(dir, 'missing.txt') }),
            /Failed to read file/
        );
    });

    test('write creates the file and any parent directories', async () => {
        const file = path.join(dir, 'nested', 'deep', 'out.txt');
        const result = await tool('write').handler({ path: file, content: 'payload' });
        assert.ok(result.includes('File written successfully'));
        assert.strictEqual(fs.readFileSync(file, 'utf-8'), 'payload');
    });

    test('edit replaces the first occurrence of a pattern', async () => {
        const file = path.join(dir, 'edit.txt');
        fs.writeFileSync(file, 'Original content here, Original again');
        const result = await tool('edit').handler({ path: file, pattern: 'Original', replacement: 'Modified' });
        assert.ok(result.includes('File edited successfully'));
        assert.strictEqual(fs.readFileSync(file, 'utf-8'), 'Modified content here, Original again');
    });

    test('edit with replaceAll replaces every occurrence', async () => {
        const file = path.join(dir, 'all.txt');
        fs.writeFileSync(file, 'x x x');
        await tool('edit').handler({ path: file, pattern: 'x', replacement: 'y', replaceAll: true });
        assert.strictEqual(fs.readFileSync(file, 'utf-8'), 'y y y');
    });

    test('edit throws when the pattern is absent', async () => {
        const file = path.join(dir, 'nopat.txt');
        fs.writeFileSync(file, 'hello');
        await assert.rejects(
            tool('edit').handler({ path: file, pattern: 'absent', replacement: 'x' }),
            /Pattern not found in file/
        );
    });

    test('multi_edit applies several edits and counts them', async () => {
        const file = path.join(dir, 'multi.txt');
        fs.writeFileSync(file, 'one two three');
        const result = await tool('multi_edit').handler({
            path: file,
            edits: [
                { pattern: 'one', replacement: '1' },
                { pattern: 'three', replacement: '3' }
            ]
        });
        assert.ok(result.includes('File edited successfully with 2 changes'));
        assert.strictEqual(fs.readFileSync(file, 'utf-8'), '1 two 3');
    });

    test('directory_tree lists directory contents', async () => {
        fs.writeFileSync(path.join(dir, 'file1.txt'), '');
        fs.writeFileSync(path.join(dir, 'file2.txt'), '');
        fs.mkdirSync(path.join(dir, 'subdir'));
        const result = await tool('directory_tree').handler({ path: dir, maxDepth: 1 });
        assert.ok(result.includes('file1.txt'));
        assert.ok(result.includes('file2.txt'));
        assert.ok(result.includes('subdir'));
    });
});
