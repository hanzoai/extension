import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Safari joins the ZAP router the way Chrome and Firefox do: a WebSocket to the
 * router's loopback door (shared/socket.ts). WebKit opens ws://127.0.0.1 from a
 * secure context, which an extension's pages are, so Safari needs no native
 * handler of its own and ships the converter's stock one untouched.
 */
const root = join(__dirname, '..', 'src');
const build = readFileSync(join(root, 'build.js'), 'utf8');

describe('Safari', () => {
  it('carries no native bridge of its own', () => {
    expect(existsSync(join(root, 'safari'))).toBe(false);
    expect(build).not.toMatch(/SafariWebExtensionHandler\.swift/);
  });

  it('separates a missing converter from a failed conversion', () => {
    // One `catch {}` around both reported "Xcode not available" for every
    // failure, and the project read as generated when nothing was written.
    expect(build).toMatch(/haveConverter/);
  });
});
