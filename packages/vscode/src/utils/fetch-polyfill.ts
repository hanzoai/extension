/**
 * Node.js fetch polyfill for environments where fetch is not available
 */

export const fetchPolyfill = (globalThis as any).fetch || (async (url: string, options?: any) => {
    const https = require('https');
    const http = require('http');
    const urlObj = new URL(url);
    const isHttps = urlObj.protocol === 'https:';
    
    return new Promise((resolve, reject) => {
        const request = (isHttps ? https : http).request(url, options, (res: any) => {
            let data = '';
            res.on('data', (chunk: any) => data += chunk);
            res.on('end', () => {
                resolve({
                    ok: res.statusCode >= 200 && res.statusCode < 300,
                    status: res.statusCode,
                    statusText: res.statusMessage,
                    json: async () => JSON.parse(data),
                    text: async () => data
                });
            });
        });
        
        request.on('error', reject);
        if (options?.body) request.write(options.body);
        request.end();
    });
});