// validate-manifest — a standalone preflight for `clasp push`:
//   1. appsscript.json is valid JSON with the required scopes + whitelist, and
//      declares the OAuth2 library that runs the Hanzo IAM sign-in.
//   2. every function named in the manifest (runFunction / onTriggerFunction)
//      or by a callback in the code (setFunctionName, setCallbackFunction,
//      setCustomUiCallback, actionFor_) is defined in a src/*.gs file.
//   3. every src/*.gs parses as JavaScript.
// Exits non-zero on any failure so it can gate a push. `npm run validate`.

import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import vm from 'node:vm';

const here = dirname(fileURLToPath(import.meta.url));
const srcDir = resolve(here, '..', 'src');
const fail = (msg) => {
  console.error('✗ ' + msg);
  process.exitCode = 1;
};

// 1. manifest
const manifest = JSON.parse(readFileSync(resolve(srcDir, 'appsscript.json'), 'utf8'));

const requiredScopes = [
  'https://www.googleapis.com/auth/documents.currentonly',
  'https://www.googleapis.com/auth/spreadsheets.currentonly',
  'https://www.googleapis.com/auth/presentations.currentonly',
  'https://www.googleapis.com/auth/gmail.addons.current.message.readonly',
  'https://www.googleapis.com/auth/gmail.addons.current.action.compose',
  'https://www.googleapis.com/auth/script.external_request',
];
for (const s of requiredScopes) {
  if (!manifest.oauthScopes.includes(s)) fail('missing oauthScope: ' + s);
}
if (JSON.stringify(manifest.urlFetchWhitelist) !== JSON.stringify(['https://api.hanzo.ai/'])) {
  fail('urlFetchWhitelist must be exactly ["https://api.hanzo.ai/"]');
}
// Sign-in is the OAuth2 for Apps Script library, by its published script ID.
const oauth2 = (manifest.dependencies?.libraries || []).find((l) => l.userSymbol === 'OAuth2');
if (oauth2?.libraryId !== '1B7FSrk5Zi6L1rSxxTDgDEUsPzlukDsi4KGuTMorsTQHhGBzBkMun4iDF') {
  fail('dependencies.libraries must declare OAuth2 (1B7FSrk5Zi6L1rSxxTDgDEUsPzlukDsi4KGuTMorsTQHhGBzBkMun4iDF)');
}

// 2. collect every function the manifest references
const referenced = new Set();
const walk = (node) => {
  if (!node || typeof node !== 'object') return;
  for (const [k, v] of Object.entries(node)) {
    if ((k === 'runFunction' || k === 'onTriggerFunction') && typeof v === 'string') {
      referenced.add(v);
    } else {
      walk(v);
    }
  }
};
walk(manifest.addOns);

// 3. load every .gs, collect defined function names, and parse-check
const defined = new Set();
for (const file of readdirSync(srcDir).filter((f) => f.endsWith('.gs'))) {
  const src = readFileSync(resolve(srcDir, file), 'utf8');
  try {
    new vm.Script(src, { filename: file });
  } catch (e) {
    fail(file + ' does not parse: ' + e.message);
    continue;
  }
  for (const m of src.matchAll(/^function\s+([A-Za-z0-9_]+)\s*\(/gm)) defined.add(m[1]);
  // A callback the code names by string is a trigger too: the host calls it.
  const named = /(?:\.set(?:FunctionName|CallbackFunction|CustomUiCallback)|actionFor_)\('([A-Za-z0-9_]+)'/g;
  for (const m of src.matchAll(named)) {
    referenced.add(m[1]);
  }
}

for (const fn of referenced) {
  if (!defined.has(fn)) fail('undefined function named by the manifest or a callback: ' + fn + '()');
}

if (process.exitCode) {
  console.error('\nvalidate-manifest FAILED');
} else {
  console.log(
    '✓ manifest scopes + whitelist OK; ' +
      referenced.size +
      ' referenced functions all defined across ' +
      readdirSync(srcDir).filter((f) => f.endsWith('.gs')).length +
      ' .gs files (all parse).'
  );
}
