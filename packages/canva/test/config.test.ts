import { describe, it, expect } from 'vitest';
import {
  HANZO_API_BASE_URL,
  DEFAULT_MODEL,
  chatCompletionsURL,
  modelsURL,
  isHanzoKey,
} from '../src/config';

describe('gateway config', () => {
  it('points at api.hanzo.ai with /v1 endpoints (never /api/)', () => {
    expect(HANZO_API_BASE_URL).toBe('https://api.hanzo.ai');
    expect(chatCompletionsURL()).toBe('https://api.hanzo.ai/v1/chat/completions');
    expect(modelsURL()).toBe('https://api.hanzo.ai/v1/models');
    expect(chatCompletionsURL()).not.toContain('/api/');
  });

  it('defaults to a Zen model', () => {
    expect(DEFAULT_MODEL).toBe('zen5');
  });
});

describe('isHanzoKey', () => {
  it('accepts a well-formed hk- key (trimming whitespace)', () => {
    expect(isHanzoKey('hk-abcdef0123456789ABCDEF')).toBe(true);
    expect(isHanzoKey('  hk-abcdef0123456789ABCDEF  ')).toBe(true);
  });

  it('rejects the wrong prefix, too-short, or non-string', () => {
    expect(isHanzoKey('sk-abcdef0123456789ABCDEF')).toBe(false);
    expect(isHanzoKey('hk-short')).toBe(false);
    expect(isHanzoKey('')).toBe(false);
    expect(isHanzoKey(undefined)).toBe(false);
    expect(isHanzoKey(null)).toBe(false);
  });
});
