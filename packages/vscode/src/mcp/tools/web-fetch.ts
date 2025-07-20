import * as vscode from 'vscode';
import { MCPTool } from '../server';
import * as https from 'https';
import * as http from 'http';
import { URL } from 'url';

interface FetchOptions {
    method?: string;
    headers?: Record<string, string>;
    body?: string;
    timeout?: number;
}

export function createWebFetchTool(context: vscode.ExtensionContext): MCPTool {
    async function fetchUrl(url: string, options: FetchOptions = {}): Promise<string> {
        return new Promise((resolve, reject) => {
            const parsedUrl = new URL(url);
            const isHttps = parsedUrl.protocol === 'https:';
            const httpModule = isHttps ? https : http;
            
            const requestOptions = {
                hostname: parsedUrl.hostname,
                port: parsedUrl.port || (isHttps ? 443 : 80),
                path: parsedUrl.pathname + parsedUrl.search,
                method: options.method || 'GET',
                headers: {
                    'User-Agent': 'Hanzo-MCP/1.0',
                    'Accept': 'text/html,application/json,text/plain,*/*',
                    ...options.headers
                },
                timeout: options.timeout || 30000
            };
            
            const req = httpModule.request(requestOptions, (res) => {
                let data = '';
                
                // Handle redirects
                if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
                    const redirectUrl = new URL(res.headers.location, url);
                    fetchUrl(redirectUrl.toString(), options).then(resolve).catch(reject);
                    return;
                }
                
                res.on('data', (chunk) => {
                    data += chunk;
                });
                
                res.on('end', () => {
                    if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
                        resolve(data);
                    } else {
                        reject(new Error(`HTTP ${res.statusCode}: ${res.statusMessage}`));
                    }
                });
            });
            
            req.on('error', reject);
            req.on('timeout', () => {
                req.destroy();
                reject(new Error('Request timeout'));
            });
            
            if (options.body && (options.method === 'POST' || options.method === 'PUT')) {
                req.write(options.body);
            }
            
            req.end();
        });
    }
    
    function extractText(html: string): string {
        // Simple HTML to text conversion
        let text = html;
        
        // Remove script and style elements
        text = text.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '');
        text = text.replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, '');
        
        // Convert breaks and paragraphs to newlines
        text = text.replace(/<br\s*\/?>/gi, '\n');
        text = text.replace(/<\/p>/gi, '\n\n');
        text = text.replace(/<\/div>/gi, '\n');
        text = text.replace(/<\/h[1-6]>/gi, '\n\n');
        
        // Remove all HTML tags
        text = text.replace(/<[^>]+>/g, '');
        
        // Decode HTML entities
        text = text.replace(/&nbsp;/g, ' ');
        text = text.replace(/&amp;/g, '&');
        text = text.replace(/&lt;/g, '<');
        text = text.replace(/&gt;/g, '>');
        text = text.replace(/&quot;/g, '"');
        text = text.replace(/&#39;/g, "'");
        
        // Clean up whitespace
        text = text.replace(/\n\s*\n\s*\n/g, '\n\n');
        text = text.trim();
        
        return text;
    }
    
    function extractMetadata(html: string, url: string): Record<string, string> {
        const metadata: Record<string, string> = { url };
        
        // Extract title
        const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
        if (titleMatch) {
            metadata.title = titleMatch[1].trim();
        }
        
        // Extract meta tags
        const metaRegex = /<meta\s+([^>]+)>/gi;
        let match;
        while ((match = metaRegex.exec(html)) !== null) {
            const attrs = match[1];
            const nameMatch = attrs.match(/name=["']([^"']+)["']/i);
            const propertyMatch = attrs.match(/property=["']([^"']+)["']/i);
            const contentMatch = attrs.match(/content=["']([^"']+)["']/i);
            
            if (contentMatch) {
                const name = nameMatch?.[1] || propertyMatch?.[1];
                if (name) {
                    metadata[name] = contentMatch[1];
                }
            }
        }
        
        return metadata;
    }
    
    return {
        name: 'web_fetch',
        description: 'Fetch and extract content from web URLs',
        inputSchema: {
            type: 'object',
            properties: {
                url: {
                    type: 'string',
                    description: 'URL to fetch'
                },
                method: {
                    type: 'string',
                    enum: ['GET', 'POST', 'PUT', 'DELETE', 'HEAD'],
                    description: 'HTTP method (default: GET)'
                },
                headers: {
                    type: 'object',
                    description: 'Additional HTTP headers'
                },
                body: {
                    type: 'string',
                    description: 'Request body for POST/PUT requests'
                },
                format: {
                    type: 'string',
                    enum: ['text', 'json', 'raw', 'metadata'],
                    description: 'Output format (default: text)'
                },
                max_length: {
                    type: 'number',
                    description: 'Maximum content length (default: 50000)'
                }
            },
            required: ['url']
        },
        handler: async (args: {
            url: string;
            method?: string;
            headers?: Record<string, string>;
            body?: string;
            format?: string;
            max_length?: number;
        }) => {
            try {
                // Validate URL
                const url = new URL(args.url);
                if (!['http:', 'https:'].includes(url.protocol)) {
                    return 'Error: Only HTTP and HTTPS URLs are supported';
                }
                
                // Fetch content
                const content = await fetchUrl(args.url, {
                    method: args.method,
                    headers: args.headers,
                    body: args.body
                });
                
                const format = args.format || 'text';
                const maxLength = args.max_length || 50000;
                
                switch (format) {
                    case 'json': {
                        try {
                            const json = JSON.parse(content);
                            const formatted = JSON.stringify(json, null, 2);
                            if (formatted.length > maxLength) {
                                return formatted.substring(0, maxLength) + '\n\n[Content truncated]';
                            }
                            return formatted;
                        } catch (error) {
                            return `Error parsing JSON: ${error}`;
                        }
                    }
                    
                    case 'raw': {
                        if (content.length > maxLength) {
                            return content.substring(0, maxLength) + '\n\n[Content truncated]';
                        }
                        return content;
                    }
                    
                    case 'metadata': {
                        const metadata = extractMetadata(content, args.url);
                        return JSON.stringify(metadata, null, 2);
                    }
                    
                    case 'text':
                    default: {
                        const text = extractText(content);
                        const metadata = extractMetadata(content, args.url);
                        
                        let output = `# ${metadata.title || 'Web Content'}\n\n`;
                        output += `URL: ${args.url}\n`;
                        
                        if (metadata.description) {
                            output += `Description: ${metadata.description}\n`;
                        }
                        
                        output += '\n---\n\n';
                        
                        if (text.length > maxLength) {
                            output += text.substring(0, maxLength) + '\n\n[Content truncated]';
                        } else {
                            output += text;
                        }
                        
                        return output;
                    }
                }
            } catch (error: any) {
                return `Error fetching URL: ${error.message}`;
            }
        }
    };
}