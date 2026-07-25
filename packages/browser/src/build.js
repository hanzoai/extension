#!/usr/bin/env node

const esbuild = require('esbuild');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

async function build() {
  console.log('Building browser extension...');

  // The extension does NOT depend on `@hanzo/ui`. Primitives are served by
  // a small local shim aliased as `@hanzo/gui` so call-sites read like the
  // canonical hanzo design system. The full tamagui-based @hanzo/gui will
  // land in a feature branch — when that ships, just point the alias below
  // at the published `@hanzo/gui` package and remove gui-primitives.tsx.
  const hanzoGuiShim = path.join(__dirname, 'gui-primitives.tsx');
  console.log('Using @hanzo/gui local primitives shim:', hanzoGuiShim);

  // The Usage panel runs the headless @hanzo/usage engine in the background
  // context. The package lives in the sibling repo (hanzoai/usage); alias its
  // built ESM entry so esbuild bundles it into the background scripts. Same
  // pattern as the @hanzo/gui shim above — one specifier, one source of truth.
  const hanzoUsage = path.join(__dirname, '..', '..', '..', '..', 'usage', 'packages', 'core', 'dist', 'index.js');
  const backgroundAliases = { '@hanzo/usage': hanzoUsage };
  console.log('Using @hanzo/usage engine:', hanzoUsage);

  // The answer engine (new-tab landing) consumes the @hanzo/ai SDK's `search`
  // primitive — the ONE place the search/deep-research capability is defined.
  // It's a published npm dependency (^0.2.3), so esbuild resolves it from
  // node_modules like any other package — works identically locally and on CI
  // (no sibling-repo path assumption).

  // Ensure dist directories exist
  fs.mkdirSync('dist/browser-extension', { recursive: true });
  fs.mkdirSync('dist/browser-extension/chrome', { recursive: true });
  fs.mkdirSync('dist/browser-extension/firefox', { recursive: true });
  fs.mkdirSync('dist/browser-extension/safari', { recursive: true });

  // Build content script
  await esbuild.build({
    entryPoints: ['src/content-script.ts'],
    bundle: true,
    outfile: 'dist/browser-extension/content-script.js',
    platform: 'browser',
    target: ['chrome90', 'firefox91', 'safari14'],
    sourcemap: 'inline'
  });

  // Build background script for Chrome (with WebGPU support)
  await esbuild.build({
    entryPoints: ['src/background.ts'],
    bundle: true,
    outfile: 'dist/browser-extension/background.js',
    platform: 'browser',
    target: ['chrome90', 'safari14'],
    format: 'esm',
    external: ['chrome', 'browser'],
    alias: backgroundAliases
  });

  // Build Firefox-specific background script (no ESM export, uses browser.* APIs)
  await esbuild.build({
    entryPoints: ['src/background-firefox.ts'],
    bundle: true,
    outfile: 'dist/browser-extension/background-firefox.js',
    platform: 'browser',
    target: ['firefox91'],
    format: 'iife',  // Immediately-invoked function expression (no exports)
    external: ['browser'],
    alias: backgroundAliases
  });

  // Build WebGPU AI module
  await esbuild.build({
    entryPoints: ['src/webgpu-ai.ts'],
    bundle: true,
    outfile: 'dist/browser-extension/webgpu-ai.js',
    platform: 'browser',
    target: 'es2020',
    format: 'esm'
  });

  // Build sidebar + popup UI scripts (TypeScript-first, with JS fallback).
  // Primitives are aliased to the local @hanzo/gui shim (see gui-primitives.tsx).
  const sidebarAliases = {
    '@hanzo/gui': hanzoGuiShim,
  };

  await esbuild.build({
    entryPoints: [fs.existsSync('src/sidebar.ts') ? 'src/sidebar.ts' : 'src/sidebar.js'],
    bundle: true,
    outfile: 'dist/browser-extension/sidebar.js',
    platform: 'browser',
    target: ['chrome90', 'firefox91', 'safari14'],
    sourcemap: 'inline',
    alias: sidebarAliases,
  });

  await esbuild.build({
    entryPoints: [fs.existsSync('src/popup.ts') ? 'src/popup.ts' : 'src/popup.js'],
    bundle: true,
    outfile: 'dist/browser-extension/popup.js',
    platform: 'browser',
    target: ['chrome90', 'firefox91', 'safari14'],
    sourcemap: 'inline',
  });

  // Answer engine (new-tab landing + omnibox/address-bar search target).
  // React 18 surface consuming the @hanzo/ai `search` primitive; monochrome.
  await esbuild.build({
    entryPoints: ['src/newtab.ts'],
    bundle: true,
    outfile: 'dist/browser-extension/newtab.js',
    platform: 'browser',
    target: ['chrome90', 'firefox91', 'safari14'],
    // New-tab page loads on every tab — ship it lean (minified, no inline map).
    minify: true,
    sourcemap: false,
  });

  // Build browser control module
  await esbuild.build({
    entryPoints: ['src/browser-control.ts'],
    bundle: true,
    outfile: 'dist/browser-extension/browser-control.js',
    platform: 'browser',
    target: 'es2020',
    format: 'esm'
  });

  // Build CLI and server (for npm package)
  await esbuild.build({
    entryPoints: ['src/cli.ts'],
    bundle: true,
    outfile: 'dist/browser-extension/cli.js',
    platform: 'node',
    target: 'node16',
    packages: 'external'
  });

  // Make CLI executable
  if (process.platform !== 'win32') {
    execSync('chmod +x dist/browser-extension/cli.js');
  }

  // Build TypeScript declarations
  console.log('Building TypeScript declarations...');
  // Check if we should run tsc in root or src, based on where tsconfig is.
  // Assuming root tsconfig covers src, or src has one.
  // There is a tsconfig in src.
  // execSync('cd src && npx tsc --noEmit', { stdio: 'inherit' });

  // Copy manifests for different browsers. package.json is the SINGLE source of
  // truth for the version — stamp it into every manifest so the three can never
  // drift apart (the "must agree" rule, enforced by the build instead of by hand).
  const pkgVersion = JSON.parse(fs.readFileSync('package.json', 'utf8')).version;
  const writeManifest = (srcPath, destPath) => {
    const m = JSON.parse(fs.readFileSync(srcPath, 'utf8'));
    m.version = pkgVersion;
    fs.writeFileSync(destPath, JSON.stringify(m, null, 2));
  };
  writeManifest('src/manifest.json', 'dist/browser-extension/manifest.json');
  writeManifest('src/manifest.json', 'dist/browser-extension/chrome/manifest.json');
  writeManifest('src/manifest-firefox.json', 'dist/browser-extension/firefox/manifest.json');

  // Safari needs special handling — write Info.plist for Xcode project
  fs.writeFileSync('dist/browser-extension/safari/Info.plist', `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>CFBundleDisplayName</key>
    <string>Hanzo AI Dev Assistant</string>
    <key>CFBundleIdentifier</key>
    <string>ai.hanzo.browser-extension</string>
    <key>CFBundleVersion</key>
    <string>${pkgVersion}</string>
    <key>CFBundleShortVersionString</key>
    <string>${pkgVersion}</string>
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
  ['chrome', 'firefox', 'safari'].forEach(browserName => {
    const dir = `dist/browser-extension/${browserName}`;

    fs.copyFileSync(
      'dist/browser-extension/content-script.js',
      `${dir}/content-script.js`
    );
    // Firefox uses IIFE background (no ESM service workers); Chrome/Safari use ESM
    if (browserName === 'firefox') {
      fs.copyFileSync(
        'dist/browser-extension/background-firefox.js',
        `${dir}/background.js`
      );
    } else {
      fs.copyFileSync(
        'dist/browser-extension/background.js',
        `${dir}/background.js`
      );
    }

    // Copy popup + sidebar + answer-engine HTML/CSS
    for (const f of ['popup.html', 'popup.css', 'sidebar.html', 'sidebar.css', 'newtab.html', 'newtab.css', 'callback.html', 'ai-worker.js']) {
      const src = path.join('src', f);
      if (fs.existsSync(src)) {
        fs.copyFileSync(src, path.join(dir, f));
      }
    }

    // Copy compiled popup/sidebar/newtab scripts
    fs.copyFileSync('dist/browser-extension/popup.js', path.join(dir, 'popup.js'));
    fs.copyFileSync('dist/browser-extension/sidebar.js', path.join(dir, 'sidebar.js'));
    fs.copyFileSync('dist/browser-extension/newtab.js', path.join(dir, 'newtab.js'));

    // Copy icons into each browser directory
    for (const icon of ['icon16.png', 'icon48.png', 'icon128.png']) {
      const iconPath = path.join('images', icon);
      if (fs.existsSync(iconPath)) {
        fs.copyFileSync(iconPath, path.join(dir, icon));
      }
    }
  });

  // Copy package.json for npm
  const pkg = JSON.parse(fs.readFileSync('src/package.json', 'utf8'));
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

3. Ctrl+Click any element in your browser to navigate to its source code!

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

  // Generate Safari Xcode project (macOS + iOS) if safari-web-extension-converter exists
  try {
    execSync('xcrun --find safari-web-extension-converter', { stdio: 'ignore' });
    console.log('Generating Safari Xcode project (macOS + iOS)...');
    execSync(
      `xcrun safari-web-extension-converter dist/browser-extension/chrome/ ` +
      `--project-location dist/safari ` +
      `--app-name "Hanzo AI" ` +
      `--bundle-identifier ai.hanzo.browser-extension ` +
      `--no-prompt --no-open --force`,
      { stdio: 'inherit' }
    );
    console.log('📦 Safari: dist/safari/ (macOS + iOS Xcode project)');
  } catch {
    console.log('⚠️  Safari: skipped (Xcode not available)');
  }

  console.log('✅ Browser extension built successfully!');
  console.log('📦 Chrome: dist/browser-extension/chrome/');
  console.log('📦 Firefox: dist/browser-extension/firefox/');
  console.log('📦 NPM package ready in: dist/browser-extension/');
  console.log('\nTo publish to npm: cd dist/browser-extension && npm publish');
}

build().catch((error) => {
  console.error(error);
  process.exit(1);
});
