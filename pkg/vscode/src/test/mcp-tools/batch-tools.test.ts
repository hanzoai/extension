import * as assert from 'assert';
import * as sinon from 'sinon';
import * as vscode from 'vscode';
import { BatchTools } from '../../mcp/tools/batch';

suite('Batch Tools Test Suite', () => {
    let context: vscode.ExtensionContext;
    let batchTools: BatchTools;
    let sandbox: sinon.SinonSandbox;

    setup(() => {
        sandbox = sinon.createSandbox();
        
        // Mock VS Code context
        context = {
            subscriptions: [],
            workspaceState: {
                get: sandbox.stub(),
                update: sandbox.stub().resolves()
            },
            globalState: {
                get: sandbox.stub(),
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
        
        batchTools = new BatchTools(context);
    });

    teardown(() => {
        sandbox.restore();
    });

    test('Batch tool should execute operations sequentially', async () => {
        const mockHandler1 = sandbox.stub().resolves('Result 1');
        const mockHandler2 = sandbox.stub().resolves('Result 2');
        
        batchTools.registerToolHandler('tool1', mockHandler1);
        batchTools.registerToolHandler('tool2', mockHandler2);
        
        const batchTool = batchTools.getTools().find(t => t.name === 'batch')!;
        
        const result = await batchTool.handler({
            operations: [
                { tool: 'tool1', args: { test: 1 } },
                { tool: 'tool2', args: { test: 2 } }
            ]
        });
        
        assert.ok(result.success);
        assert.strictEqual(result.results.length, 2);
        assert.strictEqual(result.succeeded_count, 2);
        assert.strictEqual(result.failed_count, 0);
        
        // Verify handlers were called in order
        assert.ok(mockHandler1.calledBefore(mockHandler2));
        assert.deepStrictEqual(mockHandler1.firstCall.args[0], { test: 1 });
        assert.deepStrictEqual(mockHandler2.firstCall.args[0], { test: 2 });
    });

    test('Batch tool should stop on error when stop_on_error is true', async () => {
        const mockHandler1 = sandbox.stub().rejects(new Error('Test error'));
        const mockHandler2 = sandbox.stub().resolves('Result 2');
        
        batchTools.registerToolHandler('tool1', mockHandler1);
        batchTools.registerToolHandler('tool2', mockHandler2);
        
        const batchTool = batchTools.getTools().find(t => t.name === 'batch')!;
        
        const result = await batchTool.handler({
            operations: [
                { tool: 'tool1', args: {} },
                { tool: 'tool2', args: {} }
            ],
            stop_on_error: true
        });
        
        assert.ok(!result.success);
        assert.strictEqual(result.results.length, 1);
        assert.strictEqual(result.failed_count, 1);
        assert.strictEqual(mockHandler2.callCount, 0); // Second handler should not be called
    });

    test('Batch tool should continue on error when continue_on_error is true', async () => {
        const mockHandler1 = sandbox.stub().rejects(new Error('Test error'));
        const mockHandler2 = sandbox.stub().resolves('Result 2');
        
        batchTools.registerToolHandler('tool1', mockHandler1);
        batchTools.registerToolHandler('tool2', mockHandler2);
        
        const batchTool = batchTools.getTools().find(t => t.name === 'batch')!;
        
        const result = await batchTool.handler({
            operations: [
                { tool: 'tool1', args: {}, continue_on_error: true },
                { tool: 'tool2', args: {} }
            ]
        });
        
        assert.ok(!result.success); // Overall failure due to one error
        assert.strictEqual(result.results.length, 2);
        assert.strictEqual(result.succeeded_count, 1);
        assert.strictEqual(result.failed_count, 1);
        assert.ok(mockHandler2.called);
    });

    test('Batch tool should execute operations in parallel when specified', async () => {
        const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
        
        const mockHandler1 = sandbox.stub().callsFake(async () => {
            await delay(100);
            return 'Result 1';
        });
        const mockHandler2 = sandbox.stub().callsFake(async () => {
            await delay(50);
            return 'Result 2';
        });
        
        batchTools.registerToolHandler('tool1', mockHandler1);
        batchTools.registerToolHandler('tool2', mockHandler2);
        
        const batchTool = batchTools.getTools().find(t => t.name === 'batch')!;
        
        const startTime = Date.now();
        const result = await batchTool.handler({
            operations: [
                { tool: 'tool1', args: {} },
                { tool: 'tool2', args: {} }
            ],
            parallel: true
        });
        const duration = Date.now() - startTime;
        
        assert.ok(result.success);
        assert.strictEqual(result.results.length, 2);
        
        // In parallel mode, should take ~100ms (not 150ms)
        assert.ok(duration < 120, `Expected parallel execution to take < 120ms, took ${duration}ms`);
    });

    test('Batch search should combine results from multiple search types', async () => {
        const mockGrepHandler = sandbox.stub().resolves({
            results: [
                { file: 'file1.ts', line: 10, match: 'test pattern' }
            ]
        });
        const mockSymbolsHandler = sandbox.stub().resolves({
            results: [
                { file: 'file2.ts', symbol: 'TestClass', line: 20 }
            ]
        });
        
        batchTools.registerToolHandler('grep', mockGrepHandler);
        batchTools.registerToolHandler('symbols', mockSymbolsHandler);
        
        const batchSearchTool = batchTools.getTools().find(t => t.name === 'batch_search')!;
        
        const result = await batchSearchTool.handler({
            searches: [
                { type: 'grep', pattern: 'test' },
                { type: 'symbols', pattern: 'Test' }
            ],
            combine_results: true
        });
        
        assert.ok(result.success);
        assert.strictEqual(result.total_results, 2);
        assert.strictEqual(result.search_count, 2);
    });

    test('Batch search should deduplicate results when requested', async () => {
        const mockHandler = sandbox.stub().resolves({
            results: [
                { file: 'file1.ts', line: 10 },
                { file: 'file1.ts', line: 10 }, // Duplicate
                { file: 'file2.ts', line: 20 }
            ]
        });
        
        batchTools.registerToolHandler('grep', mockHandler);
        
        const batchSearchTool = batchTools.getTools().find(t => t.name === 'batch_search')!;
        
        const result = await batchSearchTool.handler({
            searches: [
                { type: 'grep', pattern: 'test' }
            ],
            combine_results: true,
            deduplicate: true
        });
        
        assert.ok(result.success);
        assert.strictEqual(result.total_results, 2); // Should have removed duplicate
    });

    test('Batch tool should handle timeout correctly', async () => {
        const mockHandler = sandbox.stub().callsFake(async () => {
            await new Promise(resolve => setTimeout(resolve, 200));
            return 'Result';
        });
        
        batchTools.registerToolHandler('slow_tool', mockHandler);
        
        const batchTool = batchTools.getTools().find(t => t.name === 'batch')!;
        
        const result = await batchTool.handler({
            operations: [
                { tool: 'slow_tool', args: {} }
            ],
            timeout_ms: 100
        });
        
        assert.ok(!result.success);
        assert.strictEqual(result.results[0].success, false);
        assert.ok(result.results[0].error?.includes('timeout'));
    });

    test('Batch tool should handle unknown tools gracefully', async () => {
        const batchTool = batchTools.getTools().find(t => t.name === 'batch')!;
        
        const result = await batchTool.handler({
            operations: [
                { tool: 'unknown_tool', args: {} }
            ]
        });
        
        assert.ok(!result.success);
        assert.strictEqual(result.results[0].success, false);
        assert.ok(result.results[0].error?.includes('Unknown tool'));
    });
});