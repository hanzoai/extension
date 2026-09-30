import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const manifest = JSON.parse(
  readFileSync(resolve(here, '..', 'src', 'appsscript.json'), 'utf8')
);

describe('appsscript.json', () => {
  it('is V8 with Stackdriver logging', () => {
    expect(manifest.runtimeVersion).toBe('V8');
    expect(manifest.exceptionLogging).toBe('STACKDRIVER');
  });

  it('declares the per-host currentonly scopes + external_request', () => {
    const scopes = manifest.oauthScopes;
    expect(scopes).toContain('https://www.googleapis.com/auth/documents.currentonly');
    expect(scopes).toContain('https://www.googleapis.com/auth/spreadsheets.currentonly');
    expect(scopes).toContain('https://www.googleapis.com/auth/presentations.currentonly');
    expect(scopes).toContain('https://www.googleapis.com/auth/script.external_request');
  });

  it('declares the Gmail add-on scopes (read message + compose action)', () => {
    const scopes = manifest.oauthScopes;
    expect(scopes).toContain(
      'https://www.googleapis.com/auth/gmail.addons.current.message.readonly'
    );
    expect(scopes).toContain(
      'https://www.googleapis.com/auth/gmail.addons.current.action.compose'
    );
  });

  it('whitelists ONLY api.hanzo.ai for UrlFetch', () => {
    expect(manifest.urlFetchWhitelist).toEqual(['https://api.hanzo.ai/']);
  });

  it('registers a homepage trigger for every host', () => {
    const addOns = manifest.addOns;
    expect(addOns.common.homepageTrigger.runFunction).toBe('onHomepage');
    expect(addOns.docs.homepageTrigger.runFunction).toBe('onDocsHomepage');
    expect(addOns.sheets.homepageTrigger.runFunction).toBe('onSheetsHomepage');
    expect(addOns.slides.homepageTrigger.runFunction).toBe('onSlidesHomepage');
    expect(addOns.gmail.homepageTrigger.runFunction).toBe('onGmailHomepage');
  });

  it('wires the Gmail contextual + compose triggers', () => {
    const gmail = manifest.addOns.gmail;
    expect(gmail.contextualTriggers[0].onTriggerFunction).toBe('onGmailMessage');
    expect(gmail.composeTrigger.selectActions[0].runFunction).toBe('onGmailCompose');
  });

  it('exposes the Hanzo account universal action', () => {
    expect(manifest.addOns.common.universalActions).toEqual([
      { label: 'Hanzo account', runFunction: 'onSettings' },
    ]);
  });

  it('signs in through the OAuth2 for Apps Script library', () => {
    expect(manifest.dependencies.libraries).toEqual([
      {
        userSymbol: 'OAuth2',
        libraryId: '1B7FSrk5Zi6L1rSxxTDgDEUsPzlukDsi4KGuTMorsTQHhGBzBkMun4iDF',
        version: '43',
      },
    ]);
  });
});
