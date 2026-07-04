import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const manifestPath = join(__dirname, '..', 'manifest', 'manifest.json');
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as Record<string, any>;

describe('Teams app manifest', () => {
  it('is valid JSON with the required top-level keys', () => {
    for (const key of [
      'manifestVersion',
      'id',
      'name',
      'description',
      'icons',
      'bots',
      'composeExtensions',
      'permissions',
      'validDomains',
    ]) {
      expect(manifest[key], `missing ${key}`).toBeDefined();
    }
  });

  it('targets Teams schema v1.16+', () => {
    const [major, minor] = manifest.manifestVersion.split('.').map(Number);
    expect(major).toBe(1);
    expect(minor).toBeGreaterThanOrEqual(16);
  });

  it('declares a bot in personal, team, and groupChat scopes', () => {
    const bot = manifest.bots[0];
    expect(bot.scopes).toEqual(expect.arrayContaining(['personal', 'team', 'groupChat']));
  });

  it('declares the askHanzo action and composeHanzo query commands', () => {
    const commands = manifest.composeExtensions[0].commands;
    const ids = commands.map((c: any) => c.id);
    expect(ids).toContain('askHanzo');
    expect(ids).toContain('composeHanzo');
    const ask = commands.find((c: any) => c.id === 'askHanzo');
    expect(ask.type).toBe('action');
    expect(ask.context).toEqual(expect.arrayContaining(['message', 'compose']));
    const compose = commands.find((c: any) => c.id === 'composeHanzo');
    expect(compose.type).toBe('query');
  });

  it('offers the four quick actions as the askHanzo chip choices', () => {
    const ask = manifest.composeExtensions[0].commands.find((c: any) => c.id === 'askHanzo');
    const chip = ask.parameters.find((p: any) => p.name === 'chip');
    expect(chip.choices.map((c: any) => c.value)).toEqual([
      'summarize',
      'draft',
      'explain',
      'action_items',
    ]);
  });

  it('lists api.hanzo.ai as a valid domain and never uses an /api/ path', () => {
    expect(manifest.validDomains).toContain('api.hanzo.ai');
    expect(JSON.stringify(manifest)).not.toMatch(/hanzo\.ai\/api\//);
  });
});
