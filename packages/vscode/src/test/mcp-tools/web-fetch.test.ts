import assert from 'assert';
import * as http from 'http';
import { AddressInfo } from 'net';
import { createWebFetchTool } from '../../mcp/tools/web-fetch';

// Rewritten to pin the real web-fetch.ts behavior. That tool uses the raw
// node http/https modules (not global.fetch), returns error strings rather
// than rejecting, has no cache, emits no ``` code fences, and sends a
// 'Hanzo-MCP/1.0' User-Agent. We exercise it end-to-end against a real
// loopback server instead of mocking the transport.
suite('Web Fetch Tool Test Suite', () => {
    let server: http.Server;
    let base: string;
    let webFetchTool: any;
    let last: { method?: string; headers?: http.IncomingHttpHeaders; body?: string };

    setup(async () => {
        last = {};
        server = http.createServer((req, res) => {
            let body = '';
            req.on('data', (c) => { body += c; });
            req.on('end', () => {
                last = { method: req.method, headers: req.headers, body };
                const url = req.url || '/';
                if (url === '/html') {
                    res.writeHead(200, { 'Content-Type': 'text/html' });
                    res.end('<html><head><title>Test Page</title>' +
                        '<meta name="description" content="A test description"></head>' +
                        '<body><h1>Hello World</h1><p>This is a test page.</p></body></html>');
                } else if (url === '/json') {
                    res.writeHead(200, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ name: 'Test API', version: '1.0.0', features: ['a', 'b'] }));
                } else if (url === '/text') {
                    res.writeHead(200, { 'Content-Type': 'text/plain' });
                    res.end('This is plain text content.\nWith multiple lines.');
                } else if (url === '/notfound') {
                    res.writeHead(404, 'Not Found');
                    res.end('nope');
                } else if (url === '/redirect') {
                    res.writeHead(302, { Location: `${base}/html` });
                    res.end();
                } else if (url === '/large') {
                    res.writeHead(200, { 'Content-Type': 'text/plain' });
                    res.end('x'.repeat(5000));
                } else if (url === '/echo') {
                    res.writeHead(200, { 'Content-Type': 'text/plain' });
                    res.end('ok');
                } else {
                    res.writeHead(200, { 'Content-Type': 'text/plain' });
                    res.end('root');
                }
            });
        });
        await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
        base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
        webFetchTool = createWebFetchTool({} as any);
    });

    teardown(async () => {
        await new Promise<void>((resolve) => server.close(() => resolve()));
    });

    test('text format extracts title, url header and body text from HTML', async () => {
        const result = await webFetchTool.handler({ url: `${base}/html` });

        assert.ok(result.includes('# Test Page'));
        assert.ok(result.includes(`URL: ${base}/html`));
        assert.ok(result.includes('Description: A test description'));
        assert.ok(result.includes('Hello World'));
        assert.ok(result.includes('This is a test page.'));
    });

    test('json format returns pretty JSON with no code fences', async () => {
        const result = await webFetchTool.handler({ url: `${base}/json`, format: 'json' });

        assert.ok(!result.includes('```'));
        assert.ok(result.includes('"name": "Test API"'));
        assert.ok(result.includes('"version": "1.0.0"'));
        assert.ok(result.includes('"features"'));
    });

    test('raw format returns the untransformed body', async () => {
        const result = await webFetchTool.handler({ url: `${base}/text`, format: 'raw' });
        assert.strictEqual(result, 'This is plain text content.\nWith multiple lines.');
    });

    test('metadata format returns the extracted metadata as JSON', async () => {
        const result = await webFetchTool.handler({ url: `${base}/html`, format: 'metadata' });
        const meta = JSON.parse(result);
        assert.strictEqual(meta.title, 'Test Page');
        assert.strictEqual(meta.description, 'A test description');
        assert.strictEqual(meta.url, `${base}/html`);
    });

    test('follows 3xx redirects to the final content', async () => {
        const result = await webFetchTool.handler({ url: `${base}/redirect` });
        assert.ok(result.includes('# Test Page'));
        assert.ok(result.includes('Hello World'));
    });

    test('plain text content is returned in the text envelope', async () => {
        const result = await webFetchTool.handler({ url: `${base}/text` });
        assert.ok(result.includes('This is plain text content'));
        assert.ok(result.includes('With multiple lines'));
    });

    test('rejects non-http(s) protocols with a clear message', async () => {
        const result = await webFetchTool.handler({ url: 'ftp://example.com/file' });
        assert.strictEqual(result, 'Error: Only HTTP and HTTPS URLs are supported');
    });

    test('malformed URLs are caught and reported, not thrown', async () => {
        const result = await webFetchTool.handler({ url: 'not-a-valid-url' });
        assert.ok(result.startsWith('Error fetching URL:'));
        assert.ok(result.includes('Invalid URL'));
    });

    test('HTTP error statuses are reported, not thrown', async () => {
        const result = await webFetchTool.handler({ url: `${base}/notfound` });
        assert.ok(result.startsWith('Error fetching URL:'));
        assert.ok(result.includes('HTTP 404'));
    });

    test('content over max_length is truncated with a marker', async () => {
        const result = await webFetchTool.handler({ url: `${base}/large`, format: 'raw', max_length: 100 });
        assert.ok(result.length < 5000);
        assert.ok(result.includes('[Content truncated]'));
    });

    test('sends the Hanzo-MCP User-Agent and Accept headers', async () => {
        await webFetchTool.handler({ url: `${base}/html` });
        assert.strictEqual(last.headers!['user-agent'], 'Hanzo-MCP/1.0');
        assert.ok((last.headers!['accept'] as string).includes('application/json'));
    });

    test('passes caller-supplied headers through', async () => {
        await webFetchTool.handler({ url: `${base}/html`, headers: { 'X-Custom': 'abc' } });
        assert.strictEqual(last.headers!['x-custom'], 'abc');
    });

    test('POST sends the request body to the server', async () => {
        await webFetchTool.handler({ url: `${base}/echo`, method: 'POST', body: 'hello world', format: 'raw' });
        assert.strictEqual(last.method, 'POST');
        assert.strictEqual(last.body, 'hello world');
    });
});
