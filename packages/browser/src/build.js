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

  // Both React surfaces — the new-tab answer engine and the sidebar's chat —
  // draw with `@hanzo/ui/chat` on `@hanzo/gui`, the one component system shared
  // with web/desktop/mobile. What that costs is measured, per bundle, in
  // scripts/check-bundle-budgets.mjs, which fails the build when a bundle grows
  // past its ceiling: growth is argued for by raising a number in a diff.
  //
  // Everything they consume is a published npm dependency — @hanzo/ai for the
  // wire, @hanzo/usage for the usage panel — so esbuild resolves from
  // node_modules and the build is identical locally and on CI. No sibling-repo
  // path assumption anywhere.

  // Ensure dist directories exist
  for (const d of ['', 'chrome', 'firefox', 'safari']) {
    fs.mkdirSync(out(d), { recursive: true });
  }

  // What a React surface needs to bundle @hanzo/ui on @hanzo/gui — the one
  // substrate the web app / desktop / mobile share. The gui runtime is written
  // cross-platform, so it must be resolved for the web: `.web.*` first
  // (react-native-svg et al ship native fabric files at their plain specifier,
  // and esbuild cannot parse Flow), `react-native` → `react-native-web`, and a
  // defined process.env (the runtime reads NODE_ENV / TAMAGUI_TARGET; an
  // extension page has no `process`).
  //
  // Stated ONCE. The sidebar built without it and died on Flow syntax inside
  // react-native — a failure with no mention of the missing alias, in a package
  // neither surface names.
  const WEB = {
    alias: { 'react-native': 'react-native-web' },
    resolveExtensions: ['.web.tsx', '.web.ts', '.web.jsx', '.web.js', '.tsx', '.ts', '.jsx', '.js', '.json'],
    define: {
      'process.env.NODE_ENV': '"production"',
      'process.env.TAMAGUI_TARGET': '"web"',
    },
    banner: { js: 'var process=globalThis.process??{env:{NODE_ENV:"production"}};' },
  };

  // Publishable event-ingest key (pk-…) for POST api.hanzo.ai/v1/event, inlined
  // into every bundle that can emit telemetry (the surfaces importing
  // shared/consent.ts: popup, newtab, onboarding). Write-only — it attributes a
  // write and mints no reading principal — so it is safe in a shipped bundle.
  //
  // Absent from a plain `node src/build.js`, and that is correct rather than
  // broken: the client then sends unattributed, cloud files the events under the
  // reserved `$public` tenant, and our org cannot read them. CI passes the value
  // from KMS `deploy/EVENT_INGEST_KEY`, the same one name every Hanzo surface uses.
  const TELEMETRY_DEFINE = {
    __EVENT_INGEST_KEY__: JSON.stringify(process.env.EVENT_INGEST_KEY ?? ''),
  };

  // Build content script
  await esbuild.build({
    entryPoints: ['src/content-script.ts'],
    bundle: true,
    outfile: out('content-script.js'),
    platform: 'browser',
    target: ['chrome90', 'firefox91', 'safari14'],
    minify: true
  });

  // Build background script for Chrome (with WebGPU support)
  await esbuild.build({
    entryPoints: ['src/background.ts'],
    bundle: true,
    outfile: out('background.js'),
    platform: 'browser',
    minify: true,
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
    minify: true,
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
    minify: true,
    target: 'es2020',
    format: 'esm'
  });

  // Sidebar — Chat on the shared @hanzo/ui/chat shell, plus the Tools and
  // Settings panels. It is a shipped page bundle carrying the gui runtime, so
  // it ships the way newtab does: minified, no inline map.
  await esbuild.build({
    ...WEB,
    entryPoints: ['src/sidebar.ts'],
    bundle: true,
    outfile: out('sidebar.js'),
    platform: 'browser',
    target: ['chrome90', 'firefox91', 'safari14'],
    minify: true,
    define: { ...WEB.define, ...TELEMETRY_DEFINE },
  });

  await esbuild.build({
    entryPoints: ['src/popup.ts'],
    bundle: true,
    outfile: out('popup.js'),
    platform: 'browser',
    target: ['chrome90', 'firefox91', 'safari14'],
    minify: true,
    define: { ...TELEMETRY_DEFINE },
  });

  // Answer engine (new-tab landing + omnibox/address-bar search target).
  // React surface consuming the @hanzo/ai `search` primitive, drawn with
  // @hanzo/ui/chat.
  await esbuild.build({
    ...WEB,
    entryPoints: ['src/newtab.ts'],
    bundle: true,
    outfile: out('newtab.js'),
    platform: 'browser',
    target: ['chrome90', 'firefox91', 'safari14'],
    // New-tab page loads on every tab — ship it lean (minified, no inline map).
    minify: true,
    sourcemap: false,
    define: { ...WEB.define, ...TELEMETRY_DEFINE },
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
    define: { ...TELEMETRY_DEFINE },
  });

  // Build browser control module
  await esbuild.build({
    entryPoints: ['src/browser-control.ts'],
    bundle: true,
    outfile: out('browser-control.js'),
    platform: 'browser',
    minify: true,
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

  // Copy package.json for npm — STAMPED with the same version as everything else.
  //
  // src/package.json is a TEMPLATE (name, bin, files, deps) and its own `version`
  // field is inert; it sat at 1.0.0 while the real one climbed to 1.9.x. The
  // browser manifests above already take `pkgVersion` from the root package.json,
  // so leaving this one un-stamped meant the npm artifact was the ONE output that
  // did not agree with the source of truth this file names three lines up — and a
  // publish of it would have tried to republish 1.0.0.
  const pkg = JSON.parse(fs.readFileSync('src/package.json', 'utf8'));
  pkg.version = pkgVersion;
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
  // Safari's converter is only present with Xcode, so its absence is a skip and
  // not a failure. Anything else IS a failure: a swallowed error here printed
  // "Xcode not available" while the real cause was something else, and the
  // project read as generated when nothing had been written.
  let haveConverter = true;
  try {
    execSync('xcrun --find safari-web-extension-converter', { stdio: 'ignore' });
  } catch {
    haveConverter = false;
    console.log('Safari: skipped, no safari-web-extension-converter (Xcode not installed)');
  }
  if (haveConverter) {
    console.log('Generating Safari Xcode project (macOS + iOS)...');
    execSync(
      `xcrun safari-web-extension-converter ${out('chrome')}/ ` +
      `--project-location ${out('safari-xcode')} ` +
      `--app-name "Hanzo AI" ` +
      `--bundle-identifier ai.hanzo.browser-extension ` +
      `--no-prompt --no-open --force`,
      { stdio: 'inherit' }
    );

    // The converter writes Xcode's stock handler, which logs a message and
    // echoes it back. Ours carries the last hop to zapd — Chrome and Firefox
    // get there by spawning the host over stdio, and Safari cannot spawn a
    // binary, so it writes to the router's socket itself. Copied AFTER the
    // conversion, because --force rewrites that file every run.
    const handler = 'SafariWebExtensionHandler.swift';
    const shared = path.join(out('safari-xcode'), 'Hanzo AI', 'Shared (Extension)', handler);
    if (fs.existsSync(path.dirname(shared))) {
      fs.copyFileSync(path.join(__dirname, 'safari', handler), shared);
      console.log(`Safari: ${handler} bridged to zapd`);
    } else {
      throw new Error(`Safari: no Shared (Extension) dir at ${shared} — the converter changed its layout`);
    }
    console.log(`📦 Safari: ${out('safari-xcode')} (macOS + iOS Xcode project)`);
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
