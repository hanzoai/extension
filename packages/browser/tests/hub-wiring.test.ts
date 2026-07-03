import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

// Verify that background.ts has all hub.* message handlers wired in.
//
// Post-ZAP the model-hub is reached exclusively through the background
// service-worker message router (`hub.*` actions). The legacy WebSocket
// CDP bridge (cdp-bridge-server.ts, `hub_*` actions) was deleted in the
// native-ZAP migration, so its parity block was removed — the dot-notation
// handlers below are the single source of hub wiring.
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
