const esbuild = require('esbuild');
const path = require('path');

// VS Code mock for standalone operation
const vscodeMock = `
const mockVscode = {
    workspace: {
        workspaceFolders: process.env.HANZO_WORKSPACE ? [{
            uri: { fsPath: process.env.HANZO_WORKSPACE }
        }] : undefined,
        getConfiguration: (section) => ({
            get: (key, defaultValue) => {
                const envKey = \`HANZO_\${section.toUpperCase()}_\${key.toUpperCase().replace(/\\./g, '_')}\`;
                return process.env[envKey] || defaultValue;
            }
        }),
        findFiles: async () => [],
        fs: {
            readFile: async (uri) => {
                const fs = require('fs').promises;
                const content = await fs.readFile(uri.fsPath || uri);
                return Buffer.from(content);
            },
            writeFile: async (uri, content) => {
                const fs = require('fs').promises;
                await fs.writeFile(uri.fsPath || uri, content);
            },
            createDirectory: async (uri) => {
                const fs = require('fs').promises;
                await fs.mkdir(uri.fsPath || uri, { recursive: true });
            }
        }
    },
    window: {
        showErrorMessage: console.error,
        showInformationMessage: console.log,
        visibleTextEditors: [],
        createWebviewPanel: () => null,
        showTextDocument: () => null
    },
    env: {
        openExternal: async (uri) => {
            console.log(\`Opening: \${uri}\`);
            return true;
        }
    },
    Uri: {
        file: (path) => ({ fsPath: path }),
        parse: (str) => ({ fsPath: str })
    },
    ViewColumn: { One: 1 },
    version: '1.0.0',
    commands: {
        executeCommand: async () => []
    },
    SymbolKind: {
        Function: 11,
        Class: 4,
        Method: 5,
        Variable: 12,
        Constant: 13,
        Interface: 10
    }
};

module.exports = mockVscode;
`;

// Build the standalone server
async function build() {
    try {
        // Build the original standalone server
        await esbuild.build({
            entryPoints: ['src/mcp-server-standalone.ts'],
            bundle: true,
            platform: 'node',
            target: 'node18',
            outfile: 'out/mcp-server-standalone.js',
            external: [],
            loader: { '.ts': 'ts' },
            plugins: [{
                name: 'vscode-mock',
                setup(build) {
                    build.onResolve({ filter: /^vscode$/ }, () => ({
                        path: 'vscode-mock',
                        namespace: 'vscode-mock'
                    }));
                    
                    build.onLoad({ filter: /.*/, namespace: 'vscode-mock' }, () => ({
                        contents: vscodeMock,
                        loader: 'js'
                    }));
                }
            }],
            define: {
                'process.env.NODE_ENV': '"production"'
            }
        });
        
        // Build the authenticated version
        await esbuild.build({
            entryPoints: ['src/mcp-server-standalone-auth.ts'],
            bundle: true,
            platform: 'node',
            target: 'node18',
            outfile: 'out/mcp-server-standalone-auth.js',
            external: [],
            loader: { '.ts': 'ts' },
            plugins: [{
                name: 'vscode-mock',
                setup(build) {
                    build.onResolve({ filter: /^vscode$/ }, () => ({
                        path: 'vscode-mock',
                        namespace: 'vscode-mock'
                    }));
                    
                    build.onLoad({ filter: /.*/, namespace: 'vscode-mock' }, () => ({
                        contents: vscodeMock,
                        loader: 'js'
                    }));
                }
            }],
            define: {
                'process.env.NODE_ENV': '"production"'
            }
        });
        
        // Also build to dist folder for npm package
        await esbuild.build({
            entryPoints: ['src/mcp-server-standalone-auth.ts'],
            bundle: true,
            platform: 'node',
            target: 'node18',
            outfile: 'dist/mcp-server.js',
            external: [],
            loader: { '.ts': 'ts' },
            plugins: [{
                name: 'vscode-mock',
                setup(build) {
                    build.onResolve({ filter: /^vscode$/ }, () => ({
                        path: 'vscode-mock',
                        namespace: 'vscode-mock'
                    }));
                    
                    build.onLoad({ filter: /.*/, namespace: 'vscode-mock' }, () => ({
                        contents: vscodeMock,
                        loader: 'js'
                    }));
                }
            }],
            define: {
                'process.env.NODE_ENV': '"production"'
            },
            minify: true
        });
        
        console.log('MCP servers built successfully!');
    } catch (error) {
        console.error('Build failed:', error);
        process.exit(1);
    }
}

build();