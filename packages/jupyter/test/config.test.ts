import { describe, it, expect } from 'vitest';
import {
  resolveSettings,
  DEFAULT_SETTINGS,
  DEFAULT_MODEL,
  HANZO_API_BASE_URL,
  CommandIds,
  PLUGIN_ID,
} from '../src/config';

describe('resolveSettings', () => {
  it('fills defaults when everything is missing', () => {
    expect(resolveSettings({})).toEqual(DEFAULT_SETTINGS);
  });

  it('uses provided values', () => {
    const s = resolveSettings({
      apiKey: 'sk-abc',
      model: 'zen5-coder',
      baseUrl: 'https://gw.example.com',
    });
    expect(s).toEqual({
      apiKey: 'sk-abc',
      model: 'zen5-coder',
      baseUrl: 'https://gw.example.com',
    });
  });

  it('falls back to defaults on blank / whitespace strings', () => {
    const s = resolveSettings({ apiKey: '   ', model: '', baseUrl: '  ' });
    expect(s.model).toBe(DEFAULT_MODEL);
    expect(s.baseUrl).toBe(HANZO_API_BASE_URL);
    expect(s.apiKey).toBe('');
  });

  it('trims values and strips trailing slashes from baseUrl', () => {
    const s = resolveSettings({
      apiKey: '  sk-x  ',
      model: '  zen5  ',
      baseUrl: 'https://api.hanzo.ai///',
    });
    expect(s.apiKey).toBe('sk-x');
    expect(s.model).toBe('zen5');
    expect(s.baseUrl).toBe('https://api.hanzo.ai');
  });

  it('ignores non-string values', () => {
    const s = resolveSettings({
      apiKey: 123 as unknown,
      model: null as unknown,
      baseUrl: {} as unknown,
    });
    expect(s).toEqual(DEFAULT_SETTINGS);
  });

  it('default model is a Zen model and default base is api.hanzo.ai', () => {
    expect(DEFAULT_MODEL).toBe('zen5');
    expect(HANZO_API_BASE_URL).toBe('https://api.hanzo.ai');
  });
});

describe('command + plugin identifiers', () => {
  it('every command id is namespaced under hanzo:', () => {
    for (const id of Object.values(CommandIds)) {
      expect(id.startsWith('hanzo:')).toBe(true);
    }
  });

  it('command ids are unique', () => {
    const ids = Object.values(CommandIds);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('plugin id matches the schema basename convention', () => {
    expect(PLUGIN_ID).toBe('@hanzo/jupyter:plugin');
  });
});
