import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

describe('dist extension manifests', () => {
  const root = resolve(__dirname, '..', '..', '..');

  it('produces valid Chrome and Firefox manifests in dist/', () => {
    for (const target of ['chrome', 'firefox']) {
      const manifestPath = resolve(root, 'dist', target, 'manifest.json');
      expect(existsSync(manifestPath), `missing ${manifestPath}`).toBe(true);
      const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
      expect(manifest.name).toBeTruthy();
      expect(manifest.version).toBeTruthy();
    }
  });
});
