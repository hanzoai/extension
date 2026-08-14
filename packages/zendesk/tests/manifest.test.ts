import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { APIKEY_SETTING, MODEL_SETTING } from '../src/config';

const pkgRoot = join(dirname(fileURLToPath(import.meta.url)), '..');

function readJson(rel: string): any {
  return JSON.parse(readFileSync(join(pkgRoot, rel), 'utf8'));
}

describe('manifest.json (ZAF v2 validity)', () => {
  const manifest = readJson('manifest.json');

  it('is valid JSON with the required ZAF fields present', () => {
    expect(manifest).toBeTypeOf('object');
    // Required by the ZAF v2 manifest spec.
    expect(manifest.frameworkVersion).toBe('2.0');
    expect(manifest.author).toBeTypeOf('object');
    expect(manifest.author.name).toBeTruthy();
    expect(manifest.author.email).toMatch(/@/);
    expect(manifest.defaultLocale).toBe('en');
    expect(manifest.location).toBeTypeOf('object');
  });

  it('is a private support app in the ticket_sidebar location', () => {
    expect(manifest.private).toBe(true);
    const loc = manifest.location.support.ticket_sidebar;
    expect(loc).toBeTypeOf('object');
    expect(loc.url).toBe('assets/iframe.html');
    expect(loc.flexible).toBe(true);
  });

  it('uses singleInstall (not the invalid singleInstallation key)', () => {
    expect(manifest.singleInstall).toBe(true);
    expect('singleInstallation' in manifest).toBe(false);
  });

  it('declares the Hanzo key as a required SECURE password parameter', () => {
    const key = manifest.parameters.find((p: any) => p.name === APIKEY_SETTING);
    expect(key).toBeTruthy();
    expect(key.type).toBe('password');
    expect(key.secure).toBe(true);
    expect(key.required).toBe(true);
  });

  it('declares a non-secure default_model parameter defaulting to a Zen model', () => {
    const m = manifest.parameters.find((p: any) => p.name === MODEL_SETTING);
    expect(m).toBeTruthy();
    expect(m.secure).toBe(false);
    expect(m.default).toBe('zen5');
  });

  it('whitelists only the Hanzo gateway domain (no /api/ host, no wildcard)', () => {
    expect(manifest.domainWhitelist).toEqual(['api.hanzo.ai']);
  });

  it('never embeds a secret value in the manifest', () => {
    const raw = readFileSync(join(pkgRoot, 'manifest.json'), 'utf8');
    expect(raw).not.toMatch(/(?:sk|hk)-[A-Za-z0-9]/); // no literal key, retired shape included
    const key = manifest.parameters.find((p: any) => p.name === APIKEY_SETTING);
    expect(key.default ?? '').toBe(''); // no default secret
  });
});

describe('translations/en.json (localization validity)', () => {
  const tr = readJson('translations/en.json');
  const manifest = readJson('manifest.json');

  it('is valid JSON with the required app metadata keys', () => {
    expect(tr.app).toBeTypeOf('object');
    expect(tr.app.name).toBeTruthy();
    expect(tr.app.short_description).toBeTruthy();
    expect(tr.app.short_description.length).toBeLessThanOrEqual(80);
    expect(tr.app.long_description).toBeTruthy();
    expect(tr.app.installation_instructions).toBeTruthy();
  });

  it('provides a label for every manifest parameter (keys must match)', () => {
    for (const p of manifest.parameters) {
      const entry = tr.app.parameters?.[p.name];
      expect(entry, `missing translation for parameter ${p.name}`).toBeTruthy();
      expect(entry.label).toBeTruthy();
    }
  });
});
