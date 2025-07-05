import * as assert from 'assert';
import * as sinon from 'sinon';
import * as vscode from 'vscode';
import { createSearchTools } from '../../mcp/tools/search';

suite('Search Tools Test Suite', () => {
    let context: vscode.ExtensionContext;
    let searchTools: any[];
    let sandbox: sinon.SinonSandbox;
    let workspaceStub: sinon.SinonStub;
    let searchProviderStub: {
        textSearch: sinon.SinonStub;
        createFileTextSearchQuery: sinon.SinonStub;
        createTextSearchQuery: sinon.SinonStub;
    };
    let findFilesStub: sinon.SinonStub;
    let executeDefinitionProviderStub: sinon.SinonStub;
    let executeReferenceProviderStub: sinon.SinonStub;
    let executeDocumentSymbolProviderStub: sinon.SinonStub;
    let openTextDocumentStub: sinon.SinonStub;

    setup(() => {
        sandbox = sinon.createSandbox();
        
        // Mock VS Code workspace
        workspaceStub = sandbox.stub(vscode.workspace, 'workspaceFolders').value([{
            uri: vscode.Uri.file('/test/workspace'),
            name: 'Test Workspace',
            index: 0
        }]);
        
        // Mock text search provider
        searchProviderStub = {
            textSearch: sandbox.stub().resolves({ results: [] }),
            createFileTextSearchQuery: (pattern: string) => ({ pattern }),
            createTextSearchQuery: (pattern: string) => ({ pattern })
        };
        
        sandbox.stub(vscode.workspace, 'registerTextSearchProvider').returns({ dispose: () => {} });
        
        // Mock workspace search methods
        findFilesStub = sandbox.stub(vscode.workspace, 'findFiles');
        
        // Mock commands
        executeDefinitionProviderStub = sandbox.stub(vscode.commands, 'executeCommand')
            .withArgs('vscode.executeDefinitionProvider');
        executeReferenceProviderStub = sandbox.stub(vscode.commands, 'executeCommand')
            .withArgs('vscode.executeReferenceProvider');
        executeDocumentSymbolProviderStub = sandbox.stub(vscode.commands, 'executeCommand')
            .withArgs('vscode.executeDocumentSymbolProvider');
        
        // Mock openTextDocument
        openTextDocumentStub = sandbox.stub(vscode.workspace, 'openTextDocument');
        
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
        
        searchTools = createSearchTools(context);
    });

    teardown(() => {
        sandbox.restore();
    });

    test('Search tool should perform text search', async () => {
        const searchTool = searchTools.find(t => t.name === 'search');
        assert.ok(searchTool);
        
        // Mock search results
        findFilesStub.resolves([
            vscode.Uri.file('/test/workspace/file1.ts'),
            vscode.Uri.file('/test/workspace/file2.ts')
        ]);
        
        // Mock ripgrep command
        const child_process = require('child_process');
        const execStub = sandbox.stub(child_process, 'exec').yields(null, 
            '/test/workspace/file1.ts:10:5:    function testFunction() {\n' +
            '/test/workspace/file2.ts:25:10:    testFunction();\n',
            ''
        );
        
        const result = await searchTool.handler({
            query: 'testFunction',
            include: '**/*.ts'
        });
        
        assert.ok(result.includes('2 results found'));
        assert.ok(result.includes('file1.ts:10:5'));
        assert.ok(result.includes('file2.ts:25:10'));
    });

    test('Search tool should handle case sensitivity', async () => {
        const searchTool = searchTools.find(t => t.name === 'search');
        
        findFilesStub.resolves([vscode.Uri.file('/test/workspace/test.js')]);
        
        const child_process = require('child_process');
        const execStub = sandbox.stub(child_process, 'exec');
        
        await searchTool.handler({
            query: 'TestCase',
            case_sensitive: true
        });
        
        // Verify ripgrep was called with case-sensitive flag
        assert.ok(execStub.calledOnce);
        const rgCommand = execStub.firstCall.args[0];
        assert.ok(!rgCommand.includes('-i'), 'Should not include case-insensitive flag');
    });

    test('Search tool should limit results', async () => {
        const searchTool = searchTools.find(t => t.name === 'search');
        
        findFilesStub.resolves([]);
        
        const child_process = require('child_process');
        const execStub = sandbox.stub(child_process, 'exec').yields(null, 
            Array(10).fill(0).map((_, i) => 
                `/test/workspace/file${i}.ts:${i}:1:match${i}`
            ).join('\n'),
            ''
        );
        
        const result = await searchTool.handler({
            query: 'match',
            max_results: 5
        });
        
        // Count occurrences of "match" in the result
        const matches = result.match(/match/g);
        assert.strictEqual(matches?.length, 5, 'Should limit to 5 results');
    });

    test('Symbols tool should find symbol definitions', async () => {
        const symbolsTool = searchTools.find(t => t.name === 'symbols');
        assert.ok(symbolsTool);
        
        // Mock document
        const mockDoc = {
            uri: vscode.Uri.file('/test/workspace/test.ts'),
            fileName: '/test/workspace/test.ts',
            languageId: 'typescript'
        };
        
        openTextDocumentStub.resolves(mockDoc);
        
        // Mock symbol provider results
        executeDocumentSymbolProviderStub.resolves([
            {
                name: 'TestClass',
                kind: vscode.SymbolKind.Class,
                range: new vscode.Range(10, 0, 20, 0),
                selectionRange: new vscode.Range(10, 6, 10, 15),
                children: [
                    {
                        name: 'testMethod',
                        kind: vscode.SymbolKind.Method,
                        range: new vscode.Range(12, 2, 15, 2),
                        selectionRange: new vscode.Range(12, 8, 12, 18)
                    }
                ]
            },
            {
                name: 'helperFunction',
                kind: vscode.SymbolKind.Function,
                range: new vscode.Range(22, 0, 25, 0),
                selectionRange: new vscode.Range(22, 9, 22, 23)
            }
        ]);
        
        const result = await symbolsTool.handler({
            symbol_name: 'test',
            file_path: '/test/workspace/test.ts'
        });
        
        assert.ok(result.includes('Found 2 symbols matching "test"'));
        assert.ok(result.includes('TestClass'));
        assert.ok(result.includes('testMethod'));
        assert.ok(result.includes('Class at line 11'));
        assert.ok(result.includes('Method at line 13'));
    });

    test('Symbols tool should find references', async () => {
        const symbolsTool = searchTools.find(t => t.name === 'symbols');
        
        const mockDoc = {
            uri: vscode.Uri.file('/test/workspace/test.ts'),
            getText: () => 'class TestClass {}'
        };
        
        openTextDocumentStub.resolves(mockDoc);
        
        // Mock references
        executeReferenceProviderStub.resolves([
            {
                uri: vscode.Uri.file('/test/workspace/usage1.ts'),
                range: new vscode.Range(5, 10, 5, 19)
            },
            {
                uri: vscode.Uri.file('/test/workspace/usage2.ts'),
                range: new vscode.Range(10, 15, 10, 24)
            }
        ]);
        
        const result = await symbolsTool.handler({
            symbol_name: 'TestClass',
            file_path: '/test/workspace/test.ts',
            references: true
        });
        
        assert.ok(result.includes('Found 2 references'));
        assert.ok(result.includes('usage1.ts:6:11'));
        assert.ok(result.includes('usage2.ts:11:16'));
    });

    test('Search tool should handle regex patterns', async () => {
        const searchTool = searchTools.find(t => t.name === 'search');
        
        findFilesStub.resolves([]);
        
        const child_process = require('child_process');
        const execStub = sandbox.stub(child_process, 'exec').yields(null,
            '/test/workspace/test.ts:5:1:function test123() {\n' +
            '/test/workspace/test.ts:10:1:function test456() {\n',
            ''
        );
        
        const result = await searchTool.handler({
            query: 'test\\d+',
            regex: true
        });
        
        assert.ok(result.includes('2 results found'));
        assert.ok(result.includes('test123'));
        assert.ok(result.includes('test456'));
    });

    test('Search tool should handle errors gracefully', async () => {
        const searchTool = searchTools.find(t => t.name === 'search');
        
        findFilesStub.resolves([]);
        
        const child_process = require('child_process');
        const execStub = sandbox.stub(child_process, 'exec').yields(
            new Error('ripgrep not found'),
            '',
            ''
        );
        
        await assert.rejects(
            searchTool.handler({ query: 'test' }),
            /ripgrep not found/
        );
    });

    test('Symbols tool should handle non-existent files', async () => {
        const symbolsTool = searchTools.find(t => t.name === 'symbols');
        
        openTextDocumentStub.rejects(new Error('File not found'));
        
        await assert.rejects(
            symbolsTool.handler({
                symbol_name: 'test',
                file_path: '/nonexistent/file.ts'
            }),
            /File not found/
        );
    });

    test('Search tool should apply include patterns', async () => {
        const searchTool = searchTools.find(t => t.name === 'search');
        
        findFilesStub.resolves([
            vscode.Uri.file('/test/workspace/src/index.ts'),
            vscode.Uri.file('/test/workspace/test/test.spec.ts')
        ]);
        
        const child_process = require('child_process');
        const execStub = sandbox.stub(child_process, 'exec');
        
        await searchTool.handler({
            query: 'test',
            include: 'src/**/*.ts',
            exclude: 'test/**'
        });
        
        // Verify ripgrep was called with correct glob patterns
        assert.ok(execStub.calledOnce);
        const rgCommand = execStub.firstCall.args[0];
        assert.ok(rgCommand.includes('-g'), 'Should include glob flag');
    });

    test('Symbols tool should filter by symbol kind', async () => {
        const symbolsTool = searchTools.find(t => t.name === 'symbols');
        
        const mockDoc = { uri: vscode.Uri.file('/test/workspace/test.ts') };
        openTextDocumentStub.resolves(mockDoc);
        
        executeDocumentSymbolProviderStub.resolves([
            {
                name: 'TestClass',
                kind: vscode.SymbolKind.Class,
                range: new vscode.Range(0, 0, 10, 0),
                selectionRange: new vscode.Range(0, 0, 0, 10)
            },
            {
                name: 'testFunction',
                kind: vscode.SymbolKind.Function,
                range: new vscode.Range(15, 0, 20, 0),
                selectionRange: new vscode.Range(15, 0, 15, 12)
            },
            {
                name: 'testVariable',
                kind: vscode.SymbolKind.Variable,
                range: new vscode.Range(25, 0, 25, 20),
                selectionRange: new vscode.Range(25, 0, 25, 12)
            }
        ]);
        
        const result = await symbolsTool.handler({
            symbol_name: 'test',
            file_path: '/test/workspace/test.ts',
            kind: 'class'
        });
        
        assert.ok(result.includes('TestClass'));
        assert.ok(!result.includes('testFunction'));
        assert.ok(!result.includes('testVariable'));
    });
});