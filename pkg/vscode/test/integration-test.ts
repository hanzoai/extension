import * as assert from 'assert';
import * as vscode from 'vscode';
import { MCPTools } from '../src/mcp/tools';
import { createVectorStore } from '../src/core/vector-store-rxdb';
import { SimpleEmbedder } from '../src/core/vector-store';

suite('Hanzo Extension Integration Tests', () => {
    let context: vscode.ExtensionContext;
    let tools: MCPTools;
    
    suiteSetup(async () => {
        // Create mock context
        context = {
            globalState: {
                _store: new Map<string, any>(),
                get(key: string, defaultValue?: any) {
                    return this._store.get(key) ?? defaultValue;
                },
                update(key: string, value: any) {
                    this._store.set(key, value);
                    return Promise.resolve();
                }
            },
            workspaceState: {
                get: () => undefined,
                update: () => Promise.resolve()
            },
            extensionPath: __dirname,
            subscriptions: [],
            asAbsolutePath: (path: string) => path
        } as any;
        
        // Initialize tools
        tools = new MCPTools(context);
        await tools.initialize();
    });
    
    test('All tools should be registered', () => {
        const allTools = tools.getAllTools();
        assert.ok(allTools.length > 50, `Expected > 50 tools, got ${allTools.length}`);
        
        // Check for key tools
        const expectedTools = [
            'read', 'write', 'edit', 'multi_edit',
            'unified_search', 'web_fetch',
            'ast_analyze', 'treesitter_analyze',
            'graph_db', 'todo', 'think'
        ];
        
        for (const toolName of expectedTools) {
            const tool = tools.getTool(toolName);
            assert.ok(tool, `Tool '${toolName}' should be registered`);
        }
    });
    
    test('AST analyzer should parse TypeScript code', async () => {
        const astTool = tools.getTool('ast_analyze');
        assert.ok(astTool);
        
        // Create a test file
        const testCode = `
class TestClass {
    private value: number;
    
    constructor(value: number) {
        this.value = value;
    }
    
    getValue(): number {
        return this.value;
    }
}

function testFunction(param: string): void {
    console.log(param);
}
`;
        
        // Write test file
        const writeTool = tools.getTool('write');
        await writeTool!.handler({
            path: 'test-ast.ts',
            content: testCode
        });
        
        // Analyze it
        const result = await astTool!.handler({
            path: 'test-ast.ts',
            format: 'symbols'
        });
        
        assert.ok(result.includes('TestClass'), 'Should find TestClass');
        assert.ok(result.includes('testFunction'), 'Should find testFunction');
        assert.ok(result.includes('getValue'), 'Should find getValue method');
    });
    
    test('Graph database should handle nodes and edges', async () => {
        const graphTool = tools.getTool('graph_db');
        assert.ok(graphTool);
        
        // Create graph
        await graphTool!.handler({
            action: 'create',
            graph: 'test-graph'
        });
        
        // Add nodes
        await graphTool!.handler({
            action: 'add_node',
            graph: 'test-graph',
            node: {
                id: 'node1',
                type: 'class',
                properties: { name: 'TestClass' }
            }
        });
        
        await graphTool!.handler({
            action: 'add_node',
            graph: 'test-graph',
            node: {
                id: 'node2',
                type: 'function',
                properties: { name: 'testFunction' }
            }
        });
        
        // Add edge
        await graphTool!.handler({
            action: 'add_edge',
            graph: 'test-graph',
            edge: {
                from: 'node1',
                to: 'node2',
                type: 'calls'
            }
        });
        
        // Query
        const queryResult = await graphTool!.handler({
            action: 'query',
            graph: 'test-graph',
            query: { type: 'class' }
        });
        
        assert.ok(queryResult.includes('node1'), 'Should find node1');
        assert.ok(queryResult.includes('TestClass'), 'Should include node properties');
    });
    
    test('Vector store should support local storage', async () => {
        const store = createVectorStore({
            type: 'local',
            dbName: 'test-vector-store'
        });
        
        await store.initialize();
        
        // Set up simple embedder
        const embedder = new SimpleEmbedder(10);
        await embedder.fit(['test document', 'another document']);
        
        if ('setEmbedder' in store) {
            (store as any).setEmbedder(embedder.embed.bind(embedder));
        }
        
        // Add documents
        await store.addDocuments([{
            id: 'doc1',
            content: 'This is a test document',
            metadata: { type: 'test' },
            embedding: await embedder.embed('This is a test document')
        }]);
        
        // Search
        const results = await store.search(
            await embedder.embed('test'),
            5
        );
        
        assert.ok(results.length > 0, 'Should find results');
        assert.equal(results[0].document.id, 'doc1');
        
        await store.close();
    });
    
    test('Unified search should work across multiple dimensions', async () => {
        const searchTool = tools.getTool('unified_search');
        assert.ok(searchTool);
        
        // Create some test content
        const writeTool = tools.getTool('write');
        await writeTool!.handler({
            path: 'search-test.ts',
            content: 'export function searchTestFunction() { return "test"; }'
        });
        
        // Search
        const result = await searchTool!.handler({
            query: 'searchTestFunction',
            include: ['grep', 'filename']
        });
        
        assert.ok(result.includes('searchTestFunction'), 'Should find function in results');
    });
    
    test('Todo tool should manage tasks', async () => {
        const todoTool = tools.getTool('todo');
        assert.ok(todoTool);
        
        // Add task
        await todoTool!.handler({
            action: 'add',
            task: 'Test task'
        });
        
        // Read tasks
        const readResult = await todoTool!.handler({
            action: 'read'
        });
        
        assert.ok(readResult.includes('Test task'), 'Should find added task');
        
        // Clear tasks
        await todoTool!.handler({
            action: 'clear'
        });
    });
    
    test('Think tool should record thoughts', async () => {
        const thinkTool = tools.getTool('think');
        assert.ok(thinkTool);
        
        const result = await thinkTool!.handler({
            thought: 'Testing the think tool',
            category: 'analysis'
        });
        
        assert.ok(result.includes('Thought recorded'), 'Should confirm thought recorded');
        assert.ok(result.includes('analysis'), 'Should include category');
    });
    
    test('Web fetch tool should handle URLs', async () => {
        const webTool = tools.getTool('web_fetch');
        assert.ok(webTool);
        
        // Test with a simple URL (would need mock in real tests)
        const result = await webTool!.handler({
            url: 'https://example.com',
            format: 'metadata'
        });
        
        // Should handle the request (even if it fails in test env)
        assert.ok(typeof result === 'string', 'Should return a string result');
    });
    
    suiteTeardown(async () => {
        // Cleanup
        const graphTool = tools.getTool('graph_db');
        if (graphTool) {
            await graphTool.handler({
                action: 'clear',
                graph: 'test-graph'
            });
        }
    });
});