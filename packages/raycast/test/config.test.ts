import { describe, it, expect } from 'vitest';
import {
  chatCompletionsURL,
  modelsURL,
  isHanzoKey,
  HANZO_API_BASE_URL,
  DEFAULT_MODEL,
} from '../src/config';

describe('gateway endpoints', () => {
  it('point at api.hanzo.ai with /v1 and never an /api/ prefix', () => {
    expect(HANZO_API_BASE_URL).toBe('https://api.hanzo.ai');
    expect(chatCompletionsURL()).toBe('https://api.hanzo.ai/v1/chat/completions');
    expect(modelsURL()).toBe('https://api.hanzo.ai/v1/models');
    expect(chatCompletionsURL()).not.toContain('/api/');
    expect(modelsURL()).not.toContain('/api/');
  });

  it('defaults to a Zen model', () => {
    expect(DEFAULT_MODEL).toBe('zen5');
  });
});

describe('isHanzoKey (boundary guard)', () => {
  it('accepts a well-formed sk- key, trimming whitespace', () => {
    expect(isHanzoKey('sk-abcdef0123456789xyz')).toBe(true);
    expect(isHanzoKey('  sk-abcdef0123456789xyz  ')).toBe(true);
  });

  it('rejects the wrong prefix, too-short, empty, and null', () => {
    expect(isHanzoKey('hk-abcdef0123456789xyz')).toBe(false); // the retired prefix
    expect(isHanzoKey('sk-short')).toBe(false);
    expect(isHanzoKey('eyJhbGciOi.jwt.token')).toBe(false); // an IAM JWT
    expect(isHanzoKey('')).toBe(false);
    expect(isHanzoKey(undefined)).toBe(false);
    expect(isHanzoKey(null)).toBe(false);
  });
});
