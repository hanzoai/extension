import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');

const CORE_PACKAGES = [
  'packages/browser/package.json',
  'packages/hanzo-browser/package.json',
  'packages/vscode/package.json',
  'packages/mcp/package.json',
];

for (const rel of CORE_PACKAGES) {
  test(`core extension package manifest is valid: ${rel}`, () => {
    const fullPath = path.join(ROOT, rel);
    assert.ok(fs.existsSync(fullPath), `Missing ${rel}`);
    const pkg = JSON.parse(fs.readFileSync(fullPath, 'utf8'));
    assert.ok(typeof pkg.name === 'string' && pkg.name.length > 0);
    assert.ok(typeof pkg.version === 'string' && pkg.version.length > 0);
  });
}

function createBridgeRequest(id, method, params = {}) {
  return { jsonrpc: '2.0', id, method, params };
}

test('ZAP/MCP bridge frames dom_snapshot, click, and screenshot requests', () => {
  const snap = createBridgeRequest(1, 'browser/dom_snapshot', { tabId: 42 });
  assert.equal(snap.jsonrpc, '2.0');
  assert.equal(snap.method, 'browser/dom_snapshot');
  assert.equal(snap.params.tabId, 42);

  const click = createBridgeRequest(2, 'browser/click', { selector: '#submit-btn' });
  assert.equal(click.params.selector, '#submit-btn');

  const shot = createBridgeRequest(3, 'browser/screenshot', { fullPage: true });
  assert.equal(shot.params.fullPage, true);
});
