import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

// JupyterLab reads this package.json as well as pnpm does. The build copies it
// into hanzo_jupyter/labextension, and each time JupyterLab lists or loads the
// extension it compares every package it shares as a singleton (react,
// @jupyterlab/*, @lumino/*) with its own; before 4.6 it also compared
// @jupyterlab/builder when it built. `catalog:` is no range to it: with the
// extension installed, `jupyter labextension list` stopped on "Invalid SemVer
// Range: catalog:". So those packages name their ranges here.

const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const checked = Object.entries({
  ...pkg.dependencies,
  '@jupyterlab/builder': pkg.devDependencies['@jupyterlab/builder'],
}).filter(([name]) => /^(react$|@jupyterlab\/|@lumino\/)/.test(name));

describe('the manifest JupyterLab reads', () => {
  it('names a version range for every package JupyterLab checks', () => {
    expect(checked.length).toBeGreaterThan(0);
    for (const [name, spec] of checked) expect(spec, name).toMatch(/^[\^~<>=\d]/);
  });

  it('admits React 18, which JupyterLab 4 shares with its extensions', () => {
    const ranges = String(pkg.dependencies.react).split('||').map((r) => r.trim());
    expect(ranges).toContain('^18.2.0');
  });
});
