#!/usr/bin/env node

const esbuild = require('esbuild');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

// ONE output root: the extension repo root's `dist/` (NOT packages/browser/dist),
// so every build lands at a short, stable path — `<extension-root>/dist/chrome`
// is the Load-unpacked / native-messaging target, regardless of where `node
// src/build.js` (or `pnpm build`) is invoked from. Derived from __dirname
// (packages/browser/src → ../../../) so it's cwd-independent. Per-browser bundles
// sit directly under OUT; the shared staging bundles + npm files sit at OUT root.
const OUT = path.resolve(__dirname, '..', '..', '..', 'dist');
const out = (...p) => path.join(OUT, ...p);

async function build() {
  console.log('Building browser extension...');
  console.log('Output root:', OUT);

  // The extension renders on plain DOM elements styled by the sibling CSS —
  // it consumes neither `@hanzo/ui` nor `@hanzo/gui`. That is a bundle-budget
  // decision, measured: under this same esbuild config a single `@hanzo/ui`
  // Button costs +154,347 raw / +54,470 gzip (193,568/60,222 bare-React →
  // 347,915/114,692), and only builds at all once the consumer adds
  // react-native-web plus `.web.*` resolveExtensions, because @hanzo/gui
  // reaches react-native through @hanzogui/lucide-icons-2 → react-native-svg.
  // newtab.js ships on every new tab at 180,363 raw / 57,145 gzip today, so
  // that one primitive would very nearly double it. scripts/check-bundle-budgets.mjs
  // is the gate: adopt the package when the delta fits the budget, not before.

  // The Usage panel runs the headless @hanzo/usage engine in the background
  // context. It's a published npm dependency (^0.1.6) — esbuild resolves it
  // from node_modules like any package, so the build works identically locally
  // and on CI (no sibling-repo path assumption).

  // The answer engine (new-tab landing) consumes the @hanzo/ai SDK's `search`
  // primitive — the ONE place the search/deep-research capability is defined.
  // It's a published npm dependency (^0.2.3), so esbuild resolves it from
  // node_modules like any other package — works identically locally and on CI
  // (no sibling-repo path assumption).

  // Ensure dist directories exist
  for (const d of ['', 'chrome', 'firefox', 'safari']) {
    fs.mkdirSync(out(d), { recursive: true });
  }

  // Build content script
  await esbuild.build({
    entryPoints: ['src/content-script.ts'],
    bundle: true,
    outfile: out('content-script.js'),
    platform: 'browser',
    target: ['chrome90', 'firefox91', 'safari14'],
    sourcemap: 'inline'
  });

  // Build background script for Chrome (with WebGPU support)
  await esbuild.build({
    entryPoints: ['src/background.ts'],
    bundle: true,
    outfile: out('background.js'),
    platform: 'browser',
    target: ['chrome90', 'safari14'],
    format: 'esm',
    external: ['chrome', 'browser'],
  });

  // Build Firefox-specific background script (no ESM export, uses browser.* APIs)
  await esbuild.build({
    entryPoints: ['src/background-firefox.ts'],
    bundle: true,
    outfile: out('background-firefox.js'),
    platform: 'browser',
    target: ['firefox91'],
    format: 'iife',  // Immediately-invoked function expression (no exports)
    external: ['browser'],
  });

  // Build WebGPU AI module
  await esbuild.build({
    entryPoints: ['src/webgpu-ai.ts'],
    bundle: true,
    outfile: out('webgpu-ai.js'),
    platform: 'browser',
    target: 'es2020',
    format: 'esm'
  });

  // Build sidebar + popup UI scripts (TypeScript-first, with JS fallback).
  await esbuild.build({
    entryPoints: [fs.existsSync('src/sidebar.ts') ? 'src/sidebar.ts' : 'src/sidebar.js'],
    bundle: true,
    outfile: out('sidebar.js'),
    platform: 'browser',
    target: ['chrome90', 'firefox91', 'safari14'],
    sourcemap: 'inline',
  });

  await esbuild.build({
    entryPoints: [fs.existsSync('src/popup.ts') ? 'src/popup.ts' : 'src/popup.js'],
    bundle: true,
    outfile: out('popup.js'),
    platform: 'browser',
    target: ['chrome90', 'firefox91', 'safari14'],
    sourcemap: 'inline',
  });

  // Answer engine (new-tab landing + omnibox/address-bar search target).
  // React 18 surface consuming the @hanzo/ai `search` primitive; monochrome.
  await esbuild.build({
    entryPoints: ['src/newtab.ts'],
    bundle: true,
    outfile: out('newtab.js'),
    platform: 'browser',
    target: ['chrome90', 'firefox91', 'safari14'],
    // New-tab page loads on every tab — ship it lean (minified, no inline map).
    minify: true,
    sourcemap: false,
  });

  // Onboarding (new-install consent ask: insights + opt-in training).
  await esbuild.build({
    entryPoints: ['src/onboarding.ts'],
    bundle: true,
    outfile: out('onboarding.js'),
    platform: 'browser',
    target: ['chrome90', 'firefox91', 'safari14'],
    minify: true,
    sourcemap: false,
  });

  // Build browser control module
  await esbuild.build({
    entryPoints: ['src/browser-control.ts'],
    bundle: true,
    outfile: out('browser-control.js'),
    platform: 'browser',
    target: 'es2020',
    format: 'esm'
  });

  // Build CLI and server (for npm package)
  await esbuild.build({
    entryPoints: ['src/cli.ts'],
    bundle: true,
    outfile: out('cli.js'),
    platform: 'node',
    target: 'node16',
    packages: 'external'
  });

  // Make CLI executable
  if (process.platform !== 'win32') {
    fs.chmodSync(out('cli.js'), 0o755);
  }

  // Copy manifests for different browsers. package.json is the SINGLE source of
  // truth for the version — stamp it into every manifest so the three can never
  // drift apart (the "must agree" rule, enforced by the build instead of by hand).
  const pkgVersion = JSON.parse(fs.readFileSync('package.json', 'utf8')).version;
  const writeManifest = (srcPath, destPath) => {
    const m = JSON.parse(fs.readFileSync(srcPath, 'utf8'));
    m.version = pkgVersion;
    fs.writeFileSync(destPath, JSON.stringify(m, null, 2));
  };
  writeManifest('src/manifest.json', out('manifest.json'));
  writeManifest('src/manifest.json', out('chrome', 'manifest.json'));
  writeManifest('src/manifest-firefox.json', out('firefox', 'manifest.json'));

  // Safari needs special handling — write Info.plist for Xcode project
  fs.writeFileSync(out('safari', 'Info.plist'), `<?xml version="1.0" encoding="UTF-8"?>
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
    const dir = out(browserName);

    fs.copyFileSync(out('content-script.js'), path.join(dir, 'content-script.js'));
    // Firefox uses IIFE background (no ESM service workers); Chrome/Safari use ESM
    if (browserName === 'firefox') {
      fs.copyFileSync(out('background-firefox.js'), path.join(dir, 'background.js'));
    } else {
      fs.copyFileSync(out('background.js'), path.join(dir, 'background.js'));
    }

    // Copy popup + sidebar + answer-engine HTML/CSS
    for (const f of ['popup.html', 'popup.css', 'sidebar.html', 'sidebar.css', 'newtab.html', 'newtab.css', 'onboarding.html', 'onboarding.css', 'callback.html', 'ai-worker.js']) {
      const src = path.join('src', f);
      if (fs.existsSync(src)) {
        fs.copyFileSync(src, path.join(dir, f));
      }
    }

    // Copy compiled popup/sidebar/newtab scripts
    fs.copyFileSync(out('popup.js'), path.join(dir, 'popup.js'));
    fs.copyFileSync(out('sidebar.js'), path.join(dir, 'sidebar.js'));
    fs.copyFileSync(out('newtab.js'), path.join(dir, 'newtab.js'));
    fs.copyFileSync(out('onboarding.js'), path.join(dir, 'onboarding.js'));

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
  fs.writeFileSync(out('package.json'), JSON.stringify(pkg, null, 2));

  // Create README for npm package
  fs.writeFileSync(out('README.md'), `# Hanzo Browser DevTools

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
      fs.copyFileSync(iconPath, out(icon));
    }
  });

  // Generate Safari Xcode project (macOS + iOS) if safari-web-extension-converter exists.
  // Project goes to dist/safari-xcode/ so it never collides with the dist/safari/ web-ext dir.
  try {
    execSync('xcrun --find safari-web-extension-converter', { stdio: 'ignore' });
    console.log('Generating Safari Xcode project (macOS + iOS)...');
    execSync(
      `xcrun safari-web-extension-converter ${out('chrome')}/ ` +
      `--project-location ${out('safari-xcode')} ` +
      `--app-name "Hanzo AI" ` +
      `--bundle-identifier ai.hanzo.browser-extension ` +
      `--no-prompt --no-open --force`,
      { stdio: 'inherit' }
    );
    console.log(`📦 Safari: ${out('safari-xcode')} (macOS + iOS Xcode project)`);
  } catch {
    console.log('⚠️  Safari: skipped (Xcode not available)');
  }

  console.log('✅ Browser extension built successfully!');
  console.log(`📦 Chrome:  ${out('chrome')}/`);
  console.log(`📦 Firefox: ${out('firefox')}/`);
  console.log(`📦 NPM package ready in: ${OUT}/`);
  console.log(`\nTo publish to npm: cd ${OUT} && npm publish`);
}

build().catch((error) => {
  console.error(error);
  process.exit(1);
});
