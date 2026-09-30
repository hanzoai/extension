// loadGs — evaluate a `.gs` file in a Node sandbox and return its
// module.exports. Apps Script `.gs` is plain JS in one global scope; each file
// ends with a guarded `module.exports` (inert in Apps Script, live under Node),
// so the shipped functions are testable with zero duplication. `globals` stands
// in for the Apps Script services a test drives (OAuth2, Utilities, …); anything
// not given is undefined, so a test only reaches the services it names.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import vm from 'node:vm';

const here = dirname(fileURLToPath(import.meta.url));

export function loadGs(relPath, globals = {}) {
  const src = readFileSync(resolve(here, '..', relPath), 'utf8');
  const module = { exports: {} };
  const sandbox = { module, exports: module.exports, console, ...globals };
  vm.createContext(sandbox);
  vm.runInContext(src, sandbox, { filename: relPath });
  return module.exports;
}
