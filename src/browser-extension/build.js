#!/usr/bin/env node

const esbuild = require('esbuild');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

async function build() {
  console.log('Building browser extension...');
  
  // Ensure dist directories exist
  fs.mkdirSync('dist/browser-extension', { recursive: true });
  fs.mkdirSync('dist/browser-extension/chrome', { recursive: true });
  fs.mkdirSync('dist/browser-extension/firefox', { recursive: true });
  fs.mkdirSync('dist/browser-extension/safari', { recursive: true });
  
  // Build content script
  await esbuild.build({
    entryPoints: ['src/browser-extension/content-script.ts'],
    bundle: true,
    outfile: 'dist/browser-extension/content-script.js',
    platform: 'browser',
    target: ['chrome90', 'firefox91', 'safari14'],
    sourcemap: 'inline'
  });
  
  // Build background script with WebGPU support
  await esbuild.build({
    entryPoints: ['src/browser-extension/background.ts'],
    bundle: true,
    outfile: 'dist/browser-extension/background.js',
    platform: 'browser',
    target: ['chrome90', 'firefox91', 'safari14'],
    format: 'esm',
    external: ['chrome', 'browser']
  });
  
  // Build WebGPU AI module
  await esbuild.build({
    entryPoints: ['src/browser-extension/webgpu-ai.ts'],
    bundle: true,
    outfile: 'dist/browser-extension/webgpu-ai.js',
    platform: 'browser',
    target: 'es2020',
    format: 'esm'
  });
  
  // Build browser control module
  await esbuild.build({
    entryPoints: ['src/browser-extension/browser-control.ts'],
    bundle: true,
    outfile: 'dist/browser-extension/browser-control.js',
    platform: 'browser',
    target: 'es2020',
    format: 'esm'
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
  
  // Copy manifests for different browsers
  fs.copyFileSync(
    'src/browser-extension/manifest.json',
    'dist/browser-extension/manifest.json'
  );
  
  // Chrome version
  fs.copyFileSync(
    'src/browser-extension/manifest.json',
    'dist/browser-extension/chrome/manifest.json'
  );
  
  // Firefox version
  fs.copyFileSync(
    'src/browser-extension/manifest-firefox.json',
    'dist/browser-extension/firefox/manifest.json'
  );
  
  // Safari needs special handling - create stub
  fs.writeFileSync('dist/browser-extension/safari/Info.plist', `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>CFBundleDisplayName</key>
    <string>Hanzo AI Dev Assistant</string>
    <key>CFBundleIdentifier</key>
    <string>ai.hanzo.browser-extension</string>
    <key>CFBundleVersion</key>
    <string>1.0.0</string>
    <key>CFBundleShortVersionString</key>
    <string>1.0.0</string>
    <key>NSExtension</key>
    <dict>
        <key>NSExtensionPointIdentifier</key>
        <string>com.apple.Safari.web-extension</string>
        <key>NSExtensionPrincipalClass</key>
        <string>SafariWebExtensionHandler</string>
    </dict>
</dict>
</plist>`);
  
  // Copy common files to each browser directory
  ['chrome', 'firefox', 'safari'].forEach(browser => {
    fs.copyFileSync(
      'dist/browser-extension/content-script.js',
      `dist/browser-extension/${browser}/content-script.js`
    );
    fs.copyFileSync(
      'dist/browser-extension/background.js',
      `dist/browser-extension/${browser}/background.js`
    );
  });
  
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