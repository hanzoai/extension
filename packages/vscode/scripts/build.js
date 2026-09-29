// Bundles the two files the .vsix runs: dist/extension.js (package.json
// `main`, loaded by the extension host) and dist/mcp-server.js (the stdio MCP
// server src/mcp/server.ts spawns). vsce packages with --no-dependencies, so
// each bundle carries every module it needs; the .vsix has no node_modules.
const esbuild = require('esbuild');

// Left as runtime require()s, never bundled:
// - vscode: the extension host supplies it; mcp-server.js gets VSCODE_MOCK.
// - onnxruntime-node, @xenova/transformers: native ONNX binaries per platform.
//   Neither is a dependency of this package; unified-rxdb-backend requires
//   each inside try/catch and falls back to hash embeddings when absent,
//   which in an installed .vsix is always.
// - bufferutil, utf-8-validate: ws's optional native accelerators, required
//   inside try/catch; without them ws uses its JavaScript implementation.
const optional = ['onnxruntime-node', '@xenova/transformers', 'bufferutil', 'utf-8-validate'];

const common = {
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node18',
  minify: true,
  logLevel: 'warning',
  define: { 'process.env.NODE_ENV': '"production"' },
};

// The vscode API the tools touch, for a server that runs outside VS Code.
const VSCODE_MOCK = `
const fs = require('fs').promises;
module.exports = {
  workspace: {
    workspaceFolders: process.env.HANZO_WORKSPACE ? [{ uri: { fsPath: process.env.HANZO_WORKSPACE } }] : undefined,
    getConfiguration: (section) => ({
      get: (key, defaultValue) =>
        process.env['HANZO_' + section.toUpperCase() + '_' + key.toUpperCase().replace(/\\./g, '_')] || defaultValue
    }),
    findFiles: async () => [],
    fs: {
      readFile: async (uri) => Buffer.from(await fs.readFile(uri.fsPath || uri)),
      writeFile: async (uri, content) => fs.writeFile(uri.fsPath || uri, content),
      createDirectory: async (uri) => fs.mkdir(uri.fsPath || uri, { recursive: true })
    }
  },
  window: {
    showErrorMessage: console.error,
    showInformationMessage: console.error,
    visibleTextEditors: [],
    createWebviewPanel: () => null,
    showTextDocument: () => null,
    createOutputChannel: (name) => ({
      appendLine: (text) => console.error('[' + name + '] ' + text),
      append: (text) => process.stderr.write(text),
      clear: () => {},
      dispose: () => {},
      hide: () => {},
      show: () => {}
    })
  },
  env: { openExternal: async () => true },
  Uri: { file: (p) => ({ fsPath: p }), parse: (s) => ({ fsPath: s }) },
  ViewColumn: { One: 1 },
  version: '1.0.0',
  commands: { executeCommand: async () => [] },
  SymbolKind: { Function: 11, Class: 4, Method: 5, Variable: 12, Constant: 13, Interface: 10 }
};
`;

const vscodeMock = {
  name: 'vscode-mock',
  setup(build) {
    build.onResolve({ filter: /^vscode$/ }, () => ({ path: 'vscode', namespace: 'vscode-mock' }));
    build.onLoad({ filter: /.*/, namespace: 'vscode-mock' }, () => ({ contents: VSCODE_MOCK, loader: 'js' }));
  },
};

Promise.all([
  esbuild.build({
    ...common,
    entryPoints: ['src/extension.ts'],
    outfile: 'dist/extension.js',
    external: ['vscode', ...optional],
  }),
  esbuild.build({
    ...common,
    entryPoints: ['src/mcp-server-fixed.ts'],
    outfile: 'dist/mcp-server.js',
    external: optional,
    plugins: [vscodeMock],
  }),
]).catch(() => process.exit(1));
