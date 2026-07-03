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

// The node bridge (cdp-bridge-server.ts) and its snake_case hub_* action
// namespace were removed with it — hub access now rides the ZAP surface
// into the background.ts `hub.*` handlers asserted above.
