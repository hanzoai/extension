#!/usr/bin/env node
/**
 * Delegates `sandbox-browser.mjs` to `@hanzo/browser` (`packages/hanzo-browser/dist/cli.js`).
 */

import { runCli } from '../../hanzo-browser/dist/cli.js';

runCli(process.argv.slice(2)).catch((err) => {
  console.error(err?.message || err);
  process.exit(1);
});
