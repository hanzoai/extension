// Builds the Claude Desktop extension into dist/: server.js, mcp's CLI with
// every dependency inlined (the extension ships no node_modules); the
// manifest, stamped with this package's version; the icon; and hanzo-ai.dxt,
// the zip of those three that Claude Desktop installs.
const esbuild = require('esbuild');
const fs = require('fs');
const path = require('path');
const yazl = require('yazl');

const pkg = require('../package.json');
const root = path.join(__dirname, '..');
const out = (...p) => path.join(root, 'dist', ...p);

// Left as runtime import()s, never bundled: native packages that only tools
// off the default surface load, each of which answers an error naming the
// package when it is absent. @lancedb/lancedb and @xenova/transformers back
// the legacy vector tools; jsautogui backs --enable-autogui.
const optional = ['@lancedb/lancedb', '@xenova/transformers', 'jsautogui'];

async function build() {
  fs.rmSync(out(), { recursive: true, force: true });

  // CommonJS, because a .dxt has no package.json to declare a module type.
  await esbuild.build({
    entryPoints: [path.join(root, '..', 'mcp', 'src', 'cli.ts')],
    outfile: out('server.js'),
    bundle: true,
    platform: 'node',
    format: 'cjs',
    target: 'node18',
    minify: true,
    external: optional,
    logLevel: 'warning',
  });

  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8'));
  manifest.version = pkg.version;
  fs.writeFileSync(out('manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
  fs.copyFileSync(path.join(root, 'icon.png'), out('icon.png'));

  const zip = new yazl.ZipFile();
  for (const name of ['manifest.json', 'server.js', 'icon.png']) zip.addFile(out(name), name);
  zip.end();
  await new Promise((resolve, reject) => {
    zip.outputStream
      .pipe(fs.createWriteStream(out(`${manifest.name}.dxt`)))
      .on('close', resolve)
      .on('error', reject);
  });
}

build().catch((err) => {
  console.error(err);
  process.exit(1);
});
