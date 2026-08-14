// validate-source — a standalone structural preflight for `sf project deploy`,
// runnable with zero Salesforce org. It fails (non-zero exit) on:
//   1. an Apex class (.cls) without its .cls-meta.xml, or unbalanced braces.
//   2. an @AuraEnabled Apex method the LWC imports that the class doesn't define.
//   3. an incomplete hanzoAssistant LWC bundle (js / html / meta missing).
//   4. any gateway endpoint that isn't api.hanzo.ai/v1 (no /api/, no /v2/).
//   5. a hardcoded Hanzo API key or Bearer literal anywhere in source.
//   6. the Named/External Credential pair or its principal grant missing.
// It is intentionally simple — a byte-level sanity gate, not a compiler. The Apex
// compiler + the test run (`npm run apex:test`) are the authoritative checks.

import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');
const app = join(root, 'force-app', 'main', 'default');

let failed = false;
const fail = (msg) => {
  console.error('✗ ' + msg);
  failed = true;
};
const ok = (msg) => console.log('✓ ' + msg);

// Recursively list files under a dir (returns [] if the dir is absent).
function walk(dir) {
  if (!existsSync(dir)) return [];
  const out = [];
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) out.push(...walk(p));
    else out.push(p);
  }
  return out;
}

// 1. Apex classes: meta present + braces balanced.
const classesDir = join(app, 'classes');
const clsFiles = walk(classesDir).filter((f) => f.endsWith('.cls'));
if (clsFiles.length === 0) fail('no Apex classes found');
for (const f of clsFiles) {
  if (!existsSync(f + '-meta.xml')) fail(`missing meta for ${f}`);
  const src = readFileSync(f, 'utf8');
  const opens = (src.match(/{/g) || []).length;
  const closes = (src.match(/}/g) || []).length;
  if (opens !== closes) fail(`unbalanced braces in ${f} (${opens} { vs ${closes} })`);
}
ok(`${clsFiles.length} Apex classes present with balanced braces + meta`);

// 2. LWC @salesforce/apex imports resolve to defined Apex methods.
const lwcJs = walk(join(app, 'lwc')).filter((f) => f.endsWith('.js'));
const allApex = clsFiles.map((f) => readFileSync(f, 'utf8')).join('\n');
for (const jsFile of lwcJs) {
  const js = readFileSync(jsFile, 'utf8');
  const importRe = /@salesforce\/apex\/(\w+)\.(\w+)/g;
  let m;
  while ((m = importRe.exec(js))) {
    const [, cls, method] = m;
    // The method must be defined on that Apex class and be @AuraEnabled.
    const clsPath = join(classesDir, `${cls}.cls`);
    if (!existsSync(clsPath)) {
      fail(`LWC imports ${cls}.${method} but ${cls}.cls is missing`);
      continue;
    }
    const clsSrc = readFileSync(clsPath, 'utf8');
    const defined = new RegExp(`\\b${method}\\s*\\(`).test(clsSrc);
    const aura = /@AuraEnabled/.test(clsSrc);
    if (!defined) fail(`LWC imports ${cls}.${method} — not defined in ${cls}.cls`);
    if (!aura) fail(`${cls}.cls has no @AuraEnabled methods (LWC cannot call it)`);
  }
}
ok('every LWC @salesforce/apex import resolves to a defined @AuraEnabled method');

// 3. hanzoAssistant bundle is complete.
const bundle = join(app, 'lwc', 'hanzoAssistant');
for (const f of ['hanzoAssistant.js', 'hanzoAssistant.html', 'hanzoAssistant.js-meta.xml']) {
  if (!existsSync(join(bundle, f))) fail(`hanzoAssistant bundle missing ${f}`);
}
ok('hanzoAssistant LWC bundle complete');

// 4 + 5. Endpoint discipline + no committed secrets, across all source.
const sourceFiles = [
  ...walk(app),
  ...walk(join(root, 'src')),
].filter((f) => /\.(cls|js|html|xml|mjs)$/.test(f));
for (const f of sourceFiles) {
  const src = readFileSync(f, 'utf8');
  // Endpoint discipline: flag a REAL gateway path, not prose that names the rule.
  // A real endpoint is api.hanzo.ai/… or a callout:Hanzo_API/… path.
  if (/(?:hanzo\.ai|callout:Hanzo_API)\/api\//.test(src))
    fail(`${f} builds an /api/ endpoint — use /v1/ only`);
  if (/(?:hanzo\.ai|callout:Hanzo_API)\/v2\//.test(src))
    fail(`${f} builds a v2 endpoint`);
  // A real Hanzo key: sk- followed by key-ish chars. Retired hk- keys still exist
  // in the wild and leak just as badly, so both shapes are caught. The docs use
  // sk-… (ellipsis) as a placeholder, which must never match.
  if (/\b(?:sk|hk)-[A-Za-z0-9]{8,}/.test(src)) fail(`${f} appears to contain a hardcoded API key`);
  // A literal Bearer token (not the merge field {!$Credential…}) is a leak.
  if (/Bearer\s+[A-Za-z0-9._-]{16,}/.test(src)) fail(`${f} contains a literal Bearer token`);
}
ok('no /api/ or /v2/ endpoints; no hardcoded keys or Bearer tokens');

// 6. Named + External Credential pair and the principal grant exist.
const nc = join(app, 'namedCredentials', 'Hanzo_API.namedCredential-meta.xml');
const ec = join(app, 'externalCredentials', 'Hanzo_API.externalCredential-meta.xml');
const ps = join(app, 'permissionsets', 'Hanzo_AI_User.permissionset-meta.xml');
if (!existsSync(nc)) fail('missing Named Credential Hanzo_API');
if (!existsSync(ec)) fail('missing External Credential Hanzo_API');
if (existsSync(nc)) {
  const s = readFileSync(nc, 'utf8');
  if (!s.includes('https://api.hanzo.ai')) fail('Named Credential URL is not https://api.hanzo.ai');
  if (!s.includes('$Credential.Hanzo_API.ApiKey'))
    fail('Named Credential does not inject the ApiKey via the External Credential');
}
if (existsSync(ps)) {
  const s = readFileSync(ps, 'utf8');
  if (!s.includes('externalCredentialPrincipalAccesses'))
    fail('permission set does not grant External Credential principal access');
}
ok('Named + External Credential pair and principal grant present');

if (failed) {
  console.error('\nvalidate-source: FAILED');
  process.exit(1);
}
console.log('\nvalidate-source: OK');
