#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');

const budgets = {
  'dist/browser-extension/background.js': 180 * 1024,
  'dist/browser-extension/sidebar.js': 5200 * 1024,
  'dist/browser-extension/content-script.js': 220 * 1024,
};

let failed = false;

for (const [relPath, maxBytes] of Object.entries(budgets)) {
  const filePath = path.join(root, relPath);
  if (!fs.existsSync(filePath)) {
    console.error(`Missing bundle for budget check: ${relPath}`);
    failed = true;
    continue;
  }

  const size = fs.statSync(filePath).size;
  const kb = (size / 1024).toFixed(1);
  const limitKb = (maxBytes / 1024).toFixed(1);
  const status = size <= maxBytes ? 'OK' : 'OVER';
  console.log(`${status} ${relPath} ${kb}KB / ${limitKb}KB`);
  if (size > maxBytes) {
    failed = true;
  }
}

if (failed) {
  process.exit(1);
}
