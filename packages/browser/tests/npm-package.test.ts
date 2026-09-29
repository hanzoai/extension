import { describe, expect, it } from 'vitest';
import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

/**
 * What `pnpm publish` sends to npm as @hanzo/browser-extension.
 *
 * publish.yml asks npm which version it serves to decide whether to ship, so
 * the npm package has to carry the release the stores get. It is the build:
 * publishConfig.directory points pnpm at the output root, and that root's
 * package.json names the engine directories. `npm pack` lists what would be
 * packed there, and every manifest in the list carries the tree's version.
 */

const BROWSER = path.resolve(__dirname, '..');
const DIST = path.resolve(BROWSER, '..', '..', 'dist');
const read = (file: string) => JSON.parse(fs.readFileSync(file, 'utf8'));
const pkg = read(path.join(BROWSER, 'package.json'));
const published = path.resolve(BROWSER, pkg.publishConfig?.directory ?? '.');

describe('the npm package', () => {
  it('is the build', () => {
    expect(published).toBe(DIST);
  });

  it('ships Chrome and Firefox, each manifest at the version the tree declares', () => {
    const [packed] = JSON.parse(
      execFileSync('npm', ['pack', '--dry-run', '--json', published], { encoding: 'utf8' }),
    );
    expect(packed.version).toBe(pkg.version);
    const manifests = packed.files
      .map((f: { path: string }) => f.path)
      .filter((p: string) => p.endsWith('manifest.json'))
      .sort();
    expect(manifests).toEqual(['chrome/manifest.json', 'firefox/manifest.json']);
    for (const m of manifests) expect(read(path.join(published, m)).version, m).toBe(pkg.version);
  }, 30_000); // spawns npm, whose startup alone outlasts vitest's 5s default on a CI runner

  it('names no entry point, because an extension has none', () => {
    const manifest = read(path.join(published, 'package.json'));
    expect(manifest.main).toBeUndefined();
    expect(manifest.bin).toBeUndefined();
  });
});
