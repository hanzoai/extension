#!/usr/bin/env node
/**
 * Build the Teams app package (`hanzo-teams.zip`).
 *
 * Reads `manifest.json`, substitutes `${{VAR}}` placeholders from the
 * environment (so the bot app id is never committed), validates the result is
 * well-formed JSON with the required top-level keys, then zips the manifest and
 * the two icons into `dist/hanzo-teams.zip` — the sideloadable app package.
 *
 * Env:
 *   MICROSOFT_APP_ID  Azure Bot app id (bot registration).
 *   TEAMS_APP_ID      App id GUID for the manifest `id` (defaults to APP_ID).
 *
 * No dependencies: emits a minimal ZIP (stored, no compression) itself.
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { deflateRawSync, crc32 } from 'node:zlib';

const here = dirname(fileURLToPath(import.meta.url));
const distDir = join(here, '..', 'dist');

/** Substitute `${{VAR}}` with `env[VAR]`, erroring on any that are unset. */
function substitute(text, env) {
  const missing = new Set();
  const out = text.replace(/\$\{\{\s*([A-Z0-9_]+)\s*\}\}/g, (_m, key) => {
    // TEAMS_APP_ID defaults to MICROSOFT_APP_ID when unset OR empty.
    const v = env[key] || (key === 'TEAMS_APP_ID' ? env.MICROSOFT_APP_ID : undefined);
    if (!v) {
      missing.add(key);
      return '';
    }
    return v;
  });
  if (missing.size > 0) {
    throw new Error(
      `manifest: unset placeholders: ${[...missing].join(', ')}. ` +
        `Set them in the environment before packaging.`,
    );
  }
  return out;
}

/** Assert the manifest has the shape Teams requires. */
function validate(manifest) {
  const required = [
    'manifestVersion',
    'id',
    'name',
    'description',
    'bots',
    'composeExtensions',
    'validDomains',
  ];
  for (const key of required) {
    if (!(key in manifest)) throw new Error(`manifest missing required key: ${key}`);
  }
  if (!Array.isArray(manifest.bots) || manifest.bots.length === 0) {
    throw new Error('manifest.bots must be a non-empty array');
  }
  if (!Array.isArray(manifest.validDomains) || !manifest.validDomains.includes('api.hanzo.ai')) {
    throw new Error('manifest.validDomains must include api.hanzo.ai');
  }
}

/** Minimal ZIP writer (stored+deflate), enough for a Teams package. */
function zip(entries) {
  const chunks = [];
  const central = [];
  let offset = 0;

  for (const { name, data } of entries) {
    const nameBuf = Buffer.from(name, 'utf8');
    const crc = crc32(data) >>> 0;
    const compressed = deflateRawSync(data);
    const useStore = compressed.length >= data.length;
    const method = useStore ? 0 : 8;
    const body = useStore ? data : compressed;

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0, 6);
    local.writeUInt16LE(method, 8);
    local.writeUInt16LE(0, 10);
    local.writeUInt16LE(0, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(body.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    local.writeUInt16LE(0, 28);
    chunks.push(local, nameBuf, body);

    const cen = Buffer.alloc(46);
    cen.writeUInt32LE(0x02014b50, 0);
    cen.writeUInt16LE(20, 4);
    cen.writeUInt16LE(20, 6);
    cen.writeUInt16LE(0, 8);
    cen.writeUInt16LE(method, 10);
    cen.writeUInt16LE(0, 12);
    cen.writeUInt16LE(0, 14);
    cen.writeUInt32LE(crc, 16);
    cen.writeUInt32LE(body.length, 20);
    cen.writeUInt32LE(data.length, 24);
    cen.writeUInt16LE(nameBuf.length, 28);
    cen.writeUInt32LE(offset, 42);
    central.push(cen, nameBuf);

    offset += local.length + nameBuf.length + body.length;
  }

  const centralBuf = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralBuf.length, 12);
  end.writeUInt32LE(offset, 16);

  return Buffer.concat([...chunks, centralBuf, end]);
}

function main() {
  const raw = readFileSync(join(here, 'manifest.json'), 'utf8');
  const filled = substitute(raw, process.env);
  const manifest = JSON.parse(filled);
  validate(manifest);

  const color = readFileSync(join(here, 'color.png'));
  const outline = readFileSync(join(here, 'outline.png'));

  const pkg = zip([
    { name: 'manifest.json', data: Buffer.from(JSON.stringify(manifest, null, 2), 'utf8') },
    { name: 'color.png', data: color },
    { name: 'outline.png', data: outline },
  ]);

  mkdirSync(distDir, { recursive: true });
  const out = join(distDir, 'hanzo-teams.zip');
  writeFileSync(out, pkg);
  console.log(`[hanzo-teams] wrote ${out} (${pkg.length} bytes)`);
}

main();
