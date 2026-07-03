import { describe, it, expect } from 'vitest';
import { chatCompletionsURL, modelsURL, API_BASE_URL, pickBearer } from '../src/config';

describe('model gateway endpoints', () => {
  it('chat + models go through api.hanzo.ai/v1 (llm.hanzo.ai is dead)', () => {
    expect(chatCompletionsURL()).toBe('https://api.hanzo.ai/v1/chat/completions');
    expect(modelsURL()).toBe('https://api.hanzo.ai/v1/models');
    expect(API_BASE_URL).toBe('https://api.hanzo.ai');
    expect(chatCompletionsURL()).not.toContain('llm.hanzo.ai');
  });
  // IAM endpoints, the hanzo-office client, PKCE, and scopes now live in
  // @hanzo/auth and are pinned by its config/oauth tests — not duplicated here.
});

describe('pickBearer', () => {
  it('API key wins over the OAuth token', () => {
    expect(pickBearer('hk-abc', 'jwt-xyz')).toBe('hk-abc');
  });
  it('falls back to the OAuth token when no key', () => {
    expect(pickBearer('', 'jwt-xyz')).toBe('jwt-xyz');
    expect(pickBearer('   ', 'jwt-xyz')).toBe('jwt-xyz');
  });
  it('empty when neither is present (anonymous)', () => {
    expect(pickBearer('', '')).toBe('');
  });
});
