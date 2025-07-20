// Mock for vscode module
export const window = {
  createOutputChannel: (name: string) => ({
    appendLine: (line: string) => console.log(`[${name}] ${line}`),
    append: (text: string) => console.log(`[${name}] ${text}`),
    clear: () => {},
    dispose: () => {},
    show: () => {},
    hide: () => {}
  }),
  showInformationMessage: (message: string) => Promise.resolve(),
  showErrorMessage: (message: string) => Promise.resolve(),
  showWarningMessage: (message: string) => Promise.resolve(),
  showQuickPick: (items: any[], options?: any) => Promise.resolve(),
  showInputBox: (options?: any) => Promise.resolve(),
  createStatusBarItem: () => ({
    text: '',
    tooltip: '',
    command: '',
    show: () => {},
    hide: () => {},
    dispose: () => {}
  })
};

export const workspace = {
  getConfiguration: (section?: string) => ({
    get: (key: string, defaultValue?: any) => defaultValue,
    update: (key: string, value: any) => Promise.resolve(),
    has: (key: string) => false,
    inspect: (key: string) => undefined
  }),
  workspaceFolders: [],
  onDidChangeConfiguration: () => ({ dispose: () => {} })
};

export const Uri = {
  file: (path: string) => ({ fsPath: path, path, scheme: 'file' }),
  parse: (value: string) => ({ fsPath: value, path: value, scheme: 'file' })
};

export const commands = {
  registerCommand: (command: string, callback: (...args: any[]) => any) => ({ dispose: () => {} }),
  executeCommand: (command: string, ...args: any[]) => Promise.resolve()
};

export const ExtensionContext = class {
  subscriptions: any[] = [];
  extensionPath = '';
  storagePath = '';
  globalStoragePath = '';
  logPath = '';
  extensionUri = Uri.file('');
  extensionMode = 1;
  globalState = new Map();
  workspaceState = new Map();
  secrets = {
    get: (key: string) => Promise.resolve(),
    store: (key: string, value: string) => Promise.resolve(),
    delete: (key: string) => Promise.resolve()
  };
  asAbsolutePath(relativePath: string) { return relativePath; }
};

export enum ViewColumn {
  One = 1,
  Two = 2,
  Three = 3,
  Active = -1,
  Beside = -2
}

export const StatusBarAlignment = {
  Left: 1,
  Right: 2
};