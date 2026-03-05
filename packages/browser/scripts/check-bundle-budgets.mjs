#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');

const budgets = {
  'dist/browser-extension/background.js': 180 * 1024,
  'dist/browser-extension/sidebar.js': 5200 * 1024,
  'dist/browser-extension/content-script.js': 220 * 1024,
};

let failed = false;

function resolveBundlePath(relPath) {
  const direct = path.join(root, relPath);
  if (fs.existsSync(direct)) return direct;

  const baseName = path.basename(relPath);
  const chromeFallback = path.join(root, 'dist/browser-extension/chrome', baseName);
  if (fs.existsSync(chromeFallback)) return chromeFallback;

  const firefoxFallback = path.join(root, 'dist/browser-extension/firefox', baseName);
  if (fs.existsSync(firefoxFallback)) return firefoxFallback;

  return null;
}

function ensureBuildArtifacts() {
  const hasAnyArtifacts = Object.keys(budgets).some((relPath) => !!resolveBundlePath(relPath));
  if (hasAnyArtifacts) return;

  console.log('No bundle artifacts found; running build once before budget check...');
  execSync('node src/build.js', { cwd: root, stdio: 'inherit' });
}

ensureBuildArtifacts();

for (const [relPath, maxBytes] of Object.entries(budgets)) {
  const filePath = resolveBundlePath(relPath);
  if (!filePath) {
    console.error(`Missing bundle for budget check: ${relPath}`);
    failed = true;
    continue;
  }

  const size = fs.statSync(filePath).size;
  const kb = (size / 1024).toFixed(1);
  const limitKb = (maxBytes / 1024).toFixed(1);
  const status = size <= maxBytes ? 'OK' : 'OVER';
  const displayPath = path.relative(root, filePath);
  console.log(`${status} ${relPath} [${displayPath}] ${kb}KB / ${limitKb}KB`);
  if (size > maxBytes) {
    failed = true;
  }
}

if (failed) {
  process.exit(1);
}
