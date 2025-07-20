// Mock VS Code API for testing
module.exports = {
    workspace: {
        workspaceFolders: process.env.HANZO_WORKSPACE ? [{
            uri: { fsPath: process.env.HANZO_WORKSPACE }
        }] : [{
            uri: { fsPath: process.cwd() }
        }],
        getConfiguration: (section) => ({
            get: (key, defaultValue) => {
                const envKey = `HANZO_${section ? section.toUpperCase() + '_' : ''}${key.toUpperCase().replace(/\./g, '_')}`;
                const value = process.env[envKey];
                if (value !== undefined) {
                    if (value === 'true') return true;
                    if (value === 'false') return false;
                    if (/^\d+$/.test(value)) return parseInt(value);
                    if (value.startsWith('[') && value.endsWith(']')) {
                        try {
                            return JSON.parse(value);
                        } catch {
                            return value;
                        }
                    }
                    return value;
                }
                return defaultValue;
            },
            update: async () => true
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
        },
        name: process.env.HANZO_WORKSPACE ? require('path').basename(process.env.HANZO_WORKSPACE) : 'Unknown'
    },
    window: {
        showErrorMessage: console.error,
        showInformationMessage: console.log,
        showWarningMessage: console.warn,
        visibleTextEditors: [],
        createWebviewPanel: () => null,
        showTextDocument: () => null,
        createOutputChannel: (name) => ({
            appendLine: (line) => console.error(`[${name}] ${line}`),
            show: () => {}
        })
    },
    env: {
        openExternal: async (uri) => {
            console.error(`Opening: ${uri}`);
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
    },
    ExtensionContext: class {
        constructor() {
            this.globalState = {
                _store: new Map(),
                get(key, defaultValue) {
                    return this._store.get(key) ?? defaultValue;
                },
                update(key, value) {
                    this._store.set(key, value);
                    return Promise.resolve();
                }
            };
            this.workspaceState = this.globalState;
            this.extensionPath = __dirname;
            this.subscriptions = [];
        }
        asAbsolutePath(relativePath) {
            return require('path').join(this.extensionPath, relativePath);
        }
    }
};