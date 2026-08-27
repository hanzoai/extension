import { describe, expect, it } from 'vitest';

import { detail, shrink } from '../src/shared/shrink';

/**
 * `detail` decides what goes on the wire, so it is worth pinning exactly. The
 * downscale itself needs a real canvas and a real JPEG encoder — that is
 * `e2e/shrink.spec.ts`, in Chromium, on real pixels. What is asserted here is
 * only what is true without a browser.
 */

describe('detail', () => {
  it('reads the params the router hands over as strings', () => {
    expect(detail({ format: 'jpeg', quality: '70', maxWidth: '1280' })).toEqual({
      format: 'jpeg',
      quality: 70,
      max: 1280,
    });
  });

  it('defaults to a jpeg preview at q70 and no downscale unless asked', () => {
    expect(detail({})).toEqual({ format: 'jpeg', quality: 70, max: 0 });
  });

  it('png means the caller wants the pixels — never a lossy re-encode', () => {
    expect(detail({ format: 'png', maxWidth: '1280' })).toEqual({
      format: 'png',
      quality: 0,
      max: 1280,
    });
  });
});

describe('shrink', () => {
  it('returns the capture untouched when no box is given', async () => {
    const b64 = 'aGVsbG8=';
    expect(await shrink(b64, 0, 70)).toBe(b64);
  });

  it('returns the capture untouched rather than losing it on bad input', async () => {
    expect(await shrink('not base64 at all !!', 1280, 70)).toBe('not base64 at all !!');
    expect(await shrink('', 1280, 70)).toBe('');
  });
});
