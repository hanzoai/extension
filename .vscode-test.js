const { defineConfig } = require('@vscode/test-cli');

module.exports = defineConfig([
  {
    label: 'unitTests',
    files: 'out/test/**/*.test.js',
    version: 'stable',
    mocha: {
      ui: 'tdd',
      timeout: 20000
    }
  },
  {
    label: 'browserExtension',
    files: 'out/test/browser-extension/**/*.test.js',
    version: 'stable',
    mocha: {
      ui: 'bdd',
      timeout: 10000
    }
  },
  {
    label: 'mcpTools',
    files: 'out/test/mcp-tools/**/*.test.js',
    version: 'stable',
    workspaceFolder: './test-workspace',
    mocha: {
      ui: 'bdd',
      timeout: 20000
    }
  }
]);