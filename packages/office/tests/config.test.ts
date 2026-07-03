import { describe, it, expect } from 'vitest';
import {
  chatCompletionsURL, modelsURL, iamAuthorizeURL, iamTokenURL,
  API_BASE_URL, IAM_LOGIN_URL, CLIENT_ID,
} from '../src/config';

describe('canonical endpoints', () => {
  it('chat + models go through api.hanzo.ai/v1 (llm.hanzo.ai is dead)', () => {
    expect(chatCompletionsURL()).toBe('https://api.hanzo.ai/v1/chat/completions');
    expect(modelsURL()).toBe('https://api.hanzo.ai/v1/models');
    expect(API_BASE_URL).toBe('https://api.hanzo.ai');
    expect(chatCompletionsURL()).not.toContain('llm.hanzo.ai');
  });

  it('IAM is the canonical HIP-0111 /v1/iam/oauth/* surface', () => {
    expect(iamAuthorizeURL()).toBe('https://hanzo.id/v1/iam/oauth/authorize');
    expect(iamTokenURL()).toBe('https://iam.hanzo.ai/v1/iam/oauth/token');
    expect(IAM_LOGIN_URL).toBe('https://hanzo.id');
  });

  it('the add-in IAM client is hanzo-office', () => {
    expect(CLIENT_ID).toBe('hanzo-office');
  });
});
