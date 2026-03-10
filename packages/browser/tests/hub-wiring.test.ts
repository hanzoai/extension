import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

// Verify that background.ts has all hub.* message handlers wired in
describe('hub message handler wiring', () => {
  const backgroundSrc = fs.readFileSync(
    path.join(__dirname, '../src/background.ts'),
    'utf-8'
  );

  const requiredHandlers = [
    'hub.search',
    'hub.searchGGUF',
    'hub.model',
    'hub.recommended',
    'hub.searchOllama',
    'hub.downloadOllama',
    'hub.downloadHF',
    'hub.searchMLX',
    'hub.modelCard',
    'hub.modelStats',
    'hub.allModels',
  ];

  for (const handler of requiredHandlers) {
    it(`has case '${handler}' handler`, () => {
      expect(backgroundSrc).toContain(`case '${handler}'`);
    });
  }

  it('imports model-hub module', () => {
    expect(backgroundSrc).toContain("from './model-hub'");
  });
});

// Verify cdp-bridge-server.ts has all hub_* bridge actions
describe('CDP bridge hub actions', () => {
  const bridgeSrc = fs.readFileSync(
    path.join(__dirname, '../src/cdp-bridge-server.ts'),
    'utf-8'
  );

  const requiredActions = [
    'hub_search',
    'hub_search_gguf',
    'hub_search_mlx',
    'hub_model',
    'hub_model_card',
    'hub_model_stats',
    'hub_recommended',
    'hub_search_ollama',
    'hub_download_ollama',
    'hub_download_hf',
    'hub_all_models',
  ];

  for (const action of requiredActions) {
    it(`has case '${action}' action`, () => {
      expect(bridgeSrc).toContain(`case '${action}'`);
    });
  }

  it('lists hub actions in status response', () => {
    for (const action of requiredActions) {
      expect(bridgeSrc).toContain(`'${action}'`);
    }
  });
});
