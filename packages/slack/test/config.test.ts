import { describe, it, expect } from 'vitest';
import { loadConfig, isOAuthMode } from '../src/config.js';

const BASE = { SLACK_SIGNING_SECRET: 'sign' };

describe('loadConfig', () => {
  it('accepts single-workspace bot-token mode', () => {
    const cfg = loadConfig({ ...BASE, SLACK_BOT_TOKEN: 'xoxb-1' });
    expect(cfg.slack.botToken).toBe('xoxb-1');
    expect(isOAuthMode(cfg.slack)).toBe(false);
    expect(cfg.hanzo.baseURL).toBe('https://api.hanzo.ai');
    expect(cfg.defaultModel).toBe('zen5');
    expect(cfg.port).toBe(3000);
  });

  it('accepts OAuth mode with client id/secret/state', () => {
    const cfg = loadConfig({
      ...BASE,
      SLACK_CLIENT_ID: 'cid',
      SLACK_CLIENT_SECRET: 'csec',
      SLACK_STATE_SECRET: 'st',
    });
    expect(isOAuthMode(cfg.slack)).toBe(true);
  });

  it('requires the signing secret', () => {
    expect(() => loadConfig({ SLACK_BOT_TOKEN: 'xoxb-1' })).toThrow(/SLACK_SIGNING_SECRET/);
  });

  it('requires either bot token or OAuth', () => {
    expect(() => loadConfig({ ...BASE })).toThrow(/SLACK_BOT_TOKEN|OAuth/);
  });

  it('requires state secret in OAuth mode', () => {
    expect(() =>
      loadConfig({ ...BASE, SLACK_CLIENT_ID: 'c', SLACK_CLIENT_SECRET: 's' }),
    ).toThrow(/SLACK_STATE_SECRET/);
  });

  it('reads Hanzo + IAM overrides and PORT', () => {
    const cfg = loadConfig({
      ...BASE,
      SLACK_BOT_TOKEN: 'xoxb-1',
      HANZO_API_KEY: 'hk-123',
      HANZO_API_BASE_URL: 'https://api.hanzo.ai',
      HANZO_DEFAULT_MODEL: 'zen5-pro',
      HANZO_IAM_SERVER_URL: 'https://hanzo.id',
      PORT: '8080',
    });
    expect(cfg.hanzo.apiKey).toBe('hk-123');
    expect(cfg.defaultModel).toBe('zen5-pro');
    expect(cfg.hanzo.iamServerUrl).toBe('https://hanzo.id');
    expect(cfg.port).toBe(8080);
  });

  it('rejects an invalid PORT', () => {
    expect(() => loadConfig({ ...BASE, SLACK_BOT_TOKEN: 'x', PORT: 'abc' })).toThrow(/PORT/);
  });
});
