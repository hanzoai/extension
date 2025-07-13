#!/usr/bin/env node

const esbuild = require('esbuild');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

async function build() {
  console.log('Building browser extension...');
  
  // Ensure dist directory exists
  fs.mkdirSync('dist/browser-extension', { recursive: true });
  
  // Build content script
  await esbuild.build({
    entryPoints: ['src/browser-extension/content-script.ts'],
    bundle: true,
    outfile: 'dist/browser-extension/content-script.js',
    platform: 'browser',
    target: 'chrome90',
    sourcemap: 'inline'
  });
  
  // Build CLI and server (for npm package)
  await esbuild.build({
    entryPoints: ['src/browser-extension/cli.ts'],
    bundle: true,
    outfile: 'dist/browser-extension/cli.js',
    platform: 'node',
    target: 'node16',
    external: ['ws', 'commander', 'chalk'],
    banner: {
      js: '#!/usr/bin/env node'
    }
  });
  
  // Make CLI executable
  if (process.platform !== 'win32') {
    execSync('chmod +x dist/browser-extension/cli.js');
  }
  
  // Build TypeScript declarations
  console.log('Building TypeScript declarations...');
  execSync('cd src/browser-extension && npx tsc', { stdio: 'inherit' });
  
  // Copy manifest
  fs.copyFileSync(
    'src/browser-extension/manifest.json',
    'dist/browser-extension/manifest.json'
  );
  
  // Copy package.json for npm
  const pkg = JSON.parse(fs.readFileSync('src/browser-extension/package.json', 'utf8'));
  pkg.main = 'cli.js';
  fs.writeFileSync(
    'dist/browser-extension/package.json',
    JSON.stringify(pkg, null, 2)
  );
  
  // Create README for npm package
  fs.writeFileSync('dist/browser-extension/README.md', `# Hanzo Browser DevTools

Click-to-code navigation for web developers with MCP integration.

## Installation

\`\`\`bash
npm install -g @hanzoai/browser-devtools
\`\`\`

## Usage

1. Start the server:
\`\`\`bash
hanzo-browser-server start
\`\`\`

2. Install the browser extension:
\`\`\`bash
hanzo-browser-server install-extension
\`\`\`

3. Alt+Click any element in your browser to navigate to its source code!

## Features

- 🎯 **Source-map support** for React, Vue, Svelte
- 🔍 **Fallback tagging** for legacy code
- 🚀 **MCP integration** for Claude Code
- ⚡ **Lightning fast** WebSocket communication

## Integration with Claude Code

The server exposes element selection events that can be consumed by MCP tools:

\`\`\`javascript
server.on('elementSelected', (data) => {
  // data.file - Source file path
  // data.line - Line number
  // data.column - Column number (if available)
  // data.framework - Detected framework
});
\`\`\`
`);
  
  // Copy icons if they exist
  ['icon16.png', 'icon48.png', 'icon128.png'].forEach(icon => {
    const iconPath = path.join('images', icon);
    if (fs.existsSync(iconPath)) {
      fs.copyFileSync(iconPath, path.join('dist/browser-extension', icon));
    }
  });

  console.log('✅ Browser extension built successfully!');
  console.log('📦 Extension: dist/browser-extension/');
  console.log('📦 NPM package ready in: dist/browser-extension/');
  console.log('\nTo publish to npm: cd dist/browser-extension && npm publish');
}

build().catch(console.error);