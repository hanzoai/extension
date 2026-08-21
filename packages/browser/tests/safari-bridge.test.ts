import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Safari reaches zapd on its own.
 *
 * Chrome and Firefox spawn `zapd` over stdio as a native messaging host. Safari
 * cannot spawn a binary, so the extension's own handler carries the last hop and
 * writes to the router's socket. Without that it is Xcode's stock stub, which
 * logs a message and echoes it back — a browser that looks wired and reaches
 * nothing.
 */
const handler = readFileSync(
  join(__dirname, '..', 'src', 'safari', 'SafariWebExtensionHandler.swift'),
  'utf8',
);
const build = readFileSync(join(__dirname, '..', 'src', 'build.js'), 'utf8');

describe('the Safari handler', () => {
  it('addresses the router socket', () => {
    expect(handler).toMatch(/\.zap\/run\/zapd\.sock/);
    expect(handler).toMatch(/AF_UNIX/);
  });

  it('is not the echo stub', () => {
    // The stub's whole body: log the message, return { "echo": message }.
    expect(handler).not.toMatch(/"echo"\s*:\s*message/);
  });

  it('holds one connection rather than dialing per message', () => {
    // The router pushes ROUTE long after the extension last spoke; a socket
    // opened per message misses every one of them.
    expect(handler).toMatch(/static let shared/);
  });

  it('frames the way the host does — u32 little-endian, then the JSON', () => {
    expect(handler).toMatch(/littleEndian/);
    expect(handler).toMatch(/count:\s*4/);
  });
});

describe('the Safari build step', () => {
  it('installs our handler after the converter writes its own', () => {
    expect(build).toMatch(/SafariWebExtensionHandler\.swift/);
    expect(build).toMatch(/bridged to zapd/);
  });

  it('separates a missing converter from a failed conversion', () => {
    // One `catch {}` around both reported "Xcode not available" for every
    // failure, and the project read as generated when nothing was written.
    expect(build).toMatch(/haveConverter/);
    expect(build).toMatch(/the converter changed its layout/);
  });
});
