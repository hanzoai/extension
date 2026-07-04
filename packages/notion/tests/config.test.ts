import { describe, it, expect } from 'vitest';
import {
  HANZO_API_BASE_URL,
  DEFAULT_MODEL,
  NOTION_API_BASE_URL,
  NOTION_VERSION,
  notionApiRoot,
  notionAuthorizeURL,
  notionTokenURL,
} from '../src/config';

describe('config', () => {
  it('points Hanzo at api.hanzo.ai with no /api/ prefix', () => {
    expect(HANZO_API_BASE_URL).toBe('https://api.hanzo.ai');
    expect(HANZO_API_BASE_URL).not.toContain('/api/');
  });

  it('defaults to a Zen model', () => {
    expect(DEFAULT_MODEL).toBe('zen5');
  });

  it('pins a Notion API version', () => {
    expect(NOTION_VERSION).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('derives the Notion v1 root, authorize, and token URLs from the base', () => {
    expect(notionApiRoot()).toBe('https://api.notion.com/v1');
    expect(notionAuthorizeURL()).toBe('https://api.notion.com/v1/oauth/authorize');
    expect(notionTokenURL()).toBe('https://api.notion.com/v1/oauth/token');
    expect(NOTION_API_BASE_URL).toBe('https://api.notion.com');
  });

  it('strips a trailing slash on a base override', () => {
    expect(notionApiRoot('https://example.test/')).toBe('https://example.test/v1');
    expect(notionTokenURL('https://example.test//')).toBe('https://example.test/v1/oauth/token');
  });
});
