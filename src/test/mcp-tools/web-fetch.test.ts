import * as assert from 'assert';
import * as sinon from 'sinon';
import * as vscode from 'vscode';
import { createWebFetchTool } from '../../mcp/tools/web-fetch';

suite('Web Fetch Tool Test Suite', () => {
    let context: vscode.ExtensionContext;
    let webFetchTool: any;
    let sandbox: sinon.SinonSandbox;
    let fetchStub: sinon.SinonStub;
    let globalStateGetStub: sinon.SinonStub;
    let globalStateUpdateStub: sinon.SinonStub;

    setup(() => {
        sandbox = sinon.createSandbox();
        
        // Mock fetch
        fetchStub = sandbox.stub(global, 'fetch' as any);
        
        // Mock VS Code context
        globalStateGetStub = sandbox.stub();
        globalStateUpdateStub = sandbox.stub().resolves();
        
        context = {
            subscriptions: [],
            workspaceState: {
                get: sandbox.stub(),
                update: sandbox.stub().resolves()
            },
            globalState: {
                get: globalStateGetStub,
                update: globalStateUpdateStub,
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
        
        // Default empty cache
        globalStateGetStub.returns({});
        
        webFetchTool = createWebFetchTool(context);
    });

    teardown(() => {
        sandbox.restore();
    });

    test('Web fetch tool should fetch HTML content', async () => {
        const htmlContent = `
            <html>
                <head><title>Test Page</title></head>
                <body>
                    <h1>Hello World</h1>
                    <p>This is a test page.</p>
                </body>
            </html>
        `;
        
        fetchStub.resolves({
            ok: true,
            status: 200,
            headers: new Map([['content-type', 'text/html']]),
            text: () => Promise.resolve(htmlContent)
        });
        
        const result = await webFetchTool.handler({
            url: 'https://example.com'
        });
        
        assert.ok(result.includes('# Test Page'));
        assert.ok(result.includes('## Hello World'));
        assert.ok(result.includes('This is a test page.'));
        assert.ok(fetchStub.calledOnce);
        assert.ok(fetchStub.calledWith('https://example.com'));
    });

    test('Web fetch tool should handle JSON content', async () => {
        const jsonData = {
            name: 'Test API',
            version: '1.0.0',
            features: ['auth', 'search', 'export']
        };
        
        fetchStub.resolves({
            ok: true,
            status: 200,
            headers: new Map([['content-type', 'application/json']]),
            text: () => Promise.resolve(JSON.stringify(jsonData))
        });
        
        const result = await webFetchTool.handler({
            url: 'https://api.example.com/info'
        });
        
        assert.ok(result.includes('```json'));
        assert.ok(result.includes('"name": "Test API"'));
        assert.ok(result.includes('"version": "1.0.0"'));
        assert.ok(result.includes('"features"'));
    });

    test('Web fetch tool should use cache for repeated requests', async () => {
        const url = 'https://example.com/cached';
        const content = '<html><body>Cached content</body></html>';
        
        fetchStub.resolves({
            ok: true,
            status: 200,
            headers: new Map([['content-type', 'text/html']]),
            text: () => Promise.resolve(content)
        });
        
        // First request
        await webFetchTool.handler({ url });
        assert.ok(fetchStub.calledOnce);
        assert.ok(globalStateUpdateStub.called);
        
        // Set up cache for second request
        const cache = {};
        cache[url] = {
            content: '# Cached content',
            timestamp: Date.now()
        };
        globalStateGetStub.returns(cache);
        
        // Second request should use cache
        const result = await webFetchTool.handler({ url });
        assert.strictEqual(fetchStub.callCount, 1); // Still only called once
        assert.ok(result.includes('Cached content'));
    });

    test('Web fetch tool should respect cache expiry', async () => {
        const url = 'https://example.com/expired';
        
        // Set up expired cache (16 minutes old)
        const cache = {};
        cache[url] = {
            content: 'Old cached content',
            timestamp: Date.now() - (16 * 60 * 1000)
        };
        globalStateGetStub.returns(cache);
        
        fetchStub.resolves({
            ok: true,
            status: 200,
            headers: new Map([['content-type', 'text/html']]),
            text: () => Promise.resolve('<html><body>Fresh content</body></html>')
        });
        
        const result = await webFetchTool.handler({ url });
        
        assert.ok(fetchStub.calledOnce);
        assert.ok(result.includes('Fresh content'));
        assert.ok(!result.includes('Old cached content'));
    });

    test('Web fetch tool should handle fetch errors', async () => {
        fetchStub.rejects(new Error('Network error'));
        
        await assert.rejects(
            webFetchTool.handler({ url: 'https://example.com' }),
            /Network error/
        );
    });

    test('Web fetch tool should handle HTTP errors', async () => {
        fetchStub.resolves({
            ok: false,
            status: 404,
            statusText: 'Not Found',
            text: () => Promise.resolve('Page not found')
        });
        
        await assert.rejects(
            webFetchTool.handler({ url: 'https://example.com/notfound' }),
            /HTTP error! status: 404/
        );
    });

    test('Web fetch tool should handle redirects', async () => {
        fetchStub.resolves({
            ok: true,
            status: 200,
            redirected: true,
            url: 'https://example.com/redirected',
            headers: new Map([['content-type', 'text/html']]),
            text: () => Promise.resolve('<html><body>Redirected page</body></html>')
        });
        
        const result = await webFetchTool.handler({
            url: 'https://example.com/original'
        });
        
        assert.ok(result.includes('Redirected page'));
    });

    test('Web fetch tool should handle plain text content', async () => {
        const textContent = 'This is plain text content.\nWith multiple lines.\nAnd some data.';
        
        fetchStub.resolves({
            ok: true,
            status: 200,
            headers: new Map([['content-type', 'text/plain']]),
            text: () => Promise.resolve(textContent)
        });
        
        const result = await webFetchTool.handler({
            url: 'https://example.com/text.txt'
        });
        
        assert.ok(result.includes('This is plain text content'));
        assert.ok(result.includes('With multiple lines'));
        assert.ok(result.includes('And some data'));
    });

    test('Web fetch tool should validate URLs', async () => {
        await assert.rejects(
            webFetchTool.handler({ url: 'not-a-valid-url' }),
            /Invalid URL/
        );
        
        await assert.rejects(
            webFetchTool.handler({ url: 'ftp://example.com' }),
            /Only http/
        );
    });

    test('Web fetch tool should handle large content', async () => {
        const largeContent = '<html><body>' + 'x'.repeat(1000000) + '</body></html>';
        
        fetchStub.resolves({
            ok: true,
            status: 200,
            headers: new Map([['content-type', 'text/html']]),
            text: () => Promise.resolve(largeContent)
        });
        
        const result = await webFetchTool.handler({
            url: 'https://example.com/large'
        });
        
        // Should be truncated
        assert.ok(result.length < largeContent.length);
        assert.ok(result.includes('[Content truncated'));
    });

    test('Web fetch tool should set proper headers', async () => {
        fetchStub.resolves({
            ok: true,
            status: 200,
            headers: new Map([['content-type', 'text/html']]),
            text: () => Promise.resolve('<html></html>')
        });
        
        await webFetchTool.handler({ url: 'https://example.com' });
        
        const fetchCall = fetchStub.firstCall;
        const options = fetchCall.args[1];
        
        assert.ok(options.headers);
        assert.strictEqual(options.headers['User-Agent'], 'HanzoMCP/1.0');
        assert.strictEqual(options.headers['Accept'], 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8');
    });

    test('Web fetch tool should handle XML content', async () => {
        const xmlContent = `<?xml version="1.0"?>
            <root>
                <item>Test 1</item>
                <item>Test 2</item>
            </root>`;
        
        fetchStub.resolves({
            ok: true,
            status: 200,
            headers: new Map([['content-type', 'application/xml']]),
            text: () => Promise.resolve(xmlContent)
        });
        
        const result = await webFetchTool.handler({
            url: 'https://example.com/data.xml'
        });
        
        assert.ok(result.includes('```xml'));
        assert.ok(result.includes('<item>Test 1</item>'));
        assert.ok(result.includes('<item>Test 2</item>'));
    });

    test('Web fetch tool should handle binary content types', async () => {
        fetchStub.resolves({
            ok: true,
            status: 200,
            headers: new Map([['content-type', 'image/png']]),
            text: () => Promise.resolve('binary data')
        });
        
        await assert.rejects(
            webFetchTool.handler({ url: 'https://example.com/image.png' }),
            /Content type image\/png is not supported/
        );
    });

    test('Web fetch tool should clean up old cache entries', async () => {
        const cache = {};
        
        // Add multiple cache entries with different ages
        for (let i = 0; i < 10; i++) {
            cache[`https://example.com/page${i}`] = {
                content: `Content ${i}`,
                timestamp: Date.now() - (i * 5 * 60 * 1000) // 0, 5, 10, 15, 20... minutes old
            };
        }
        
        globalStateGetStub.returns(cache);
        
        fetchStub.resolves({
            ok: true,
            status: 200,
            headers: new Map([['content-type', 'text/html']]),
            text: () => Promise.resolve('<html><body>New content</body></html>')
        });
        
        await webFetchTool.handler({ url: 'https://example.com/new' });
        
        // Check that old entries were cleaned up
        const updateCall = globalStateUpdateStub.lastCall;
        const updatedCache = updateCall.args[1];
        
        // Should have removed entries older than 15 minutes
        const remainingUrls = Object.keys(updatedCache);
        assert.ok(remainingUrls.length < 11); // Less than original 10 + 1 new
    });
});