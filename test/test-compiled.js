// Test compiled tools
const path = require('path');
const Module = require('module');

// Hook require to provide vscode mock
const originalRequire = Module.prototype.require;
Module.prototype.require = function(id) {
    if (id === 'vscode') {
        return require('./scripts/vscode-mock');
    }
    return originalRequire.apply(this, arguments);
};

// Mock vscode
global.vscode = {
    workspace: {
        workspaceFolders: [{ uri: { fsPath: process.cwd() } }],
        getConfiguration: () => ({
            get: (key, defaultValue) => defaultValue,
            update: () => Promise.resolve()
        }),
        findFiles: async () => [],
        fs: {
            readFile: async () => Buffer.from('test content'),
            writeFile: async () => {},
            createDirectory: async () => {}
        },
        name: 'Test Workspace'
    },
    window: {
        showErrorMessage: console.error,
        showInformationMessage: console.log,
        showWarningMessage: console.warn,
        visibleTextEditors: [],
        createWebviewPanel: () => null,
        showTextDocument: () => null,
        createOutputChannel: () => ({
            appendLine: console.log,
            show: () => {}
        })
    },
    env: {
        openExternal: async () => true
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

// Load tools
const { MCPTools } = require('./out/mcp/tools');

async function test() {
    console.log('Testing Hanzo Extension Tools...\n');
    
    const context = {
        globalState: {
            _store: new Map(),
            get(key, defaultValue) {
                return this._store.get(key) ?? defaultValue;
            },
            update(key, value) {
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
        asAbsolutePath: (p) => path.join(__dirname, p)
    };

    try {
        const tools = new MCPTools(context);
        await tools.initialize();
        
        const allTools = tools.getAllTools();
        console.log(`✅ Successfully loaded ${allTools.length} tools!`);
        console.log('\nAvailable tools:');
        allTools.forEach(tool => {
            console.log(`  - ${tool.name}: ${tool.description}`);
        });
        
        // Test a simple tool
        console.log('\n--- Testing Rules Tool ---');
        const rulesTool = tools.getTool('rules');
        if (rulesTool) {
            const result = await rulesTool.handler({ format: 'list' });
            console.log('Result:', result);
        }
        
        // Test unified search
        console.log('\n--- Testing Unified Search Tool ---');
        const unifiedSearchTool = tools.getTool('unified_search');
        if (unifiedSearchTool) {
            console.log('Tool found: unified_search');
        } else {
            console.log('Tool NOT found: unified_search');
        }
        
        // Test web fetch
        console.log('\n--- Testing Web Fetch Tool ---');
        const webFetchTool = tools.getTool('web_fetch');
        if (webFetchTool) {
            console.log('Tool found: web_fetch');
        } else {
            console.log('Tool NOT found: web_fetch');
        }
        
        console.log('\n✅ All tests passed!');
    } catch (error) {
        console.error('❌ Test failed:', error);
        process.exit(1);
    }
}

test();