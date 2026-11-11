import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const pkgDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const distDir = path.join(pkgDir, 'dist');
const extPageJs = path.resolve(pkgDir, '../browser/dist/chrome/page.js');
const pageBundleTs = path.join(pkgDir, 'src', 'page-bundle.ts');

if (fs.existsSync(extPageJs)) {
  const src = fs.readFileSync(extPageJs, 'utf8');
  fs.writeFileSync(pageBundleTs, `export const PAGE_BUNDLE = ${JSON.stringify(src)};\n`, 'utf8');
}

fs.rmSync(distDir, { recursive: true, force: true });

const tscBin = path.join(pkgDir, 'node_modules', '.bin', 'tsc');
execFileSync(fs.existsSync(tscBin) ? tscBin : 'tsc', ['-p', path.join(pkgDir, 'tsconfig.json')], {
  cwd: pkgDir,
  stdio: 'inherit',
});

const cliPath = path.join(distDir, 'cli.js');
if (fs.existsSync(cliPath)) {
  const body = fs.readFileSync(cliPath, 'utf8');
  const shebang = '#!/usr/bin/env node\n';
  if (!body.startsWith('#!')) {
    fs.writeFileSync(cliPath, shebang + body, 'utf8');
  }
  fs.chmodSync(cliPath, 0o755);
}
