// loadGs — evaluate a `.gs` file in a Node sandbox and return its
// module.exports. Apps Script `.gs` is plain JS in one global scope; hanzo.gs
// ends with a guarded `module.exports` (inert in Apps Script, live under Node),
// so the pure functions are testable with zero duplication. The Apps Script
// globals (UrlFetchApp, PropertiesService, …) are left undefined — only the
// pure functions are exercised here.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import vm from 'node:vm';

const here = dirname(fileURLToPath(import.meta.url));

export function loadGs(relPath) {
  const src = readFileSync(resolve(here, '..', relPath), 'utf8');
  const module = { exports: {} };
  const sandbox = { module, exports: module.exports, console };
  vm.createContext(sandbox);
  vm.runInContext(src, sandbox, { filename: relPath });
  return module.exports;
}
