import { describe, it, expect, afterEach } from 'vitest';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  resolveBearer,
  installKey,
  installKeyFromInstallation,
  HanzoFileInstallationStore,
} from '../src/install.js';
import type { Installation } from '@slack/bolt';

describe('resolveBearer', () => {
  it('prefers the workspace token over the app default', () => {
    expect(resolveBearer({ token: 'hk-ws' }, 'hk-default')).toBe('hk-ws');
  });

  it('falls back to the app default when no workspace token', () => {
    expect(resolveBearer(undefined, 'hk-default')).toBe('hk-default');
    expect(resolveBearer({ token: '   ' }, 'hk-default')).toBe('hk-default');
  });

  it('returns empty (anonymous) when neither is set', () => {
    expect(resolveBearer(undefined, '')).toBe('');
  });
});

describe('installKey', () => {
  it('keys enterprise installs by enterprise id', () => {
    expect(installKey({ isEnterpriseInstall: true, enterpriseId: 'E1', teamId: 'T1' })).toBe('E:E1');
  });

  it('keys team installs by team id', () => {
    expect(installKey({ isEnterpriseInstall: false, teamId: 'T9' })).toBe('T:T9');
  });

  it('throws without any id', () => {
    expect(() => installKey({ isEnterpriseInstall: false })).toThrow(/missing/);
  });

  it('keys a completed installation record', () => {
    const inst = { team: { id: 'T5' }, enterprise: undefined } as unknown as Installation;
    expect(installKeyFromInstallation(inst)).toBe('T:T5');
  });
});

describe('HanzoFileInstallationStore', () => {
  const files: string[] = [];
  afterEach(async () => {
    for (const f of files.splice(0)) await fs.rm(f, { force: true });
  });

  function newStore(): HanzoFileInstallationStore {
    const path = join(tmpdir(), `hanzo-slack-inst-${Math.random().toString(36).slice(2)}.json`);
    files.push(path);
    return new HanzoFileInstallationStore(path);
  }

  it('round-trips an installation', async () => {
    const store = newStore();
    const inst = { team: { id: 'T1' } } as unknown as Installation;
    await store.storeInstallation(inst);
    const got = await store.fetchInstallation({ isEnterpriseInstall: false, teamId: 'T1' } as never);
    expect((got as { team?: { id?: string } }).team?.id).toBe('T1');
  });

  it('throws when an installation is missing', async () => {
    const store = newStore();
    await expect(
      store.fetchInstallation({ isEnterpriseInstall: false, teamId: 'nope' } as never),
    ).rejects.toThrow(/not found/);
  });

  it('binds and reads a per-workspace Hanzo token', async () => {
    const store = newStore();
    await store.setHanzoToken('T1', { token: 'hk-ws', owner: 'acme' });
    expect(await store.getHanzoToken('T1')).toEqual({ token: 'hk-ws', owner: 'acme' });
    expect(await store.getHanzoToken('T2')).toBeUndefined();
  });

  it('deletes an installation and its Hanzo token', async () => {
    const store = newStore();
    await store.storeInstallation({ team: { id: 'T1' } } as unknown as Installation);
    await store.setHanzoToken('T1', { token: 'hk-ws' });
    await store.deleteInstallation({ isEnterpriseInstall: false, teamId: 'T1' } as never);
    expect(await store.getHanzoToken('T1')).toBeUndefined();
  });
});
