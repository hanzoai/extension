import { expect, test } from '@playwright/test';
import * as esbuild from 'esbuild';
import path from 'path';

/**
 * The downscale, on real pixels, in a real browser.
 *
 * `shrink` is nothing but `createImageBitmap` + `OffscreenCanvas` + the JPEG
 * encoder, so a jsdom test of it would only test the mocks. This compiles the
 * module the way the extension ships it and runs it in Chromium against a
 * synthetic 4480x1440 capture — the screen size that made a full-res PNG cost
 * more context than an agent has to think with.
 */

const SCREEN = { width: 4480, height: 1440 };

async function bundle(): Promise<string> {
  const out = await esbuild.build({
    entryPoints: [path.resolve(__dirname, '../src/shared/shrink.ts')],
    bundle: true,
    format: 'iife',
    globalName: 'S',
    write: false,
    platform: 'browser',
  });
  return out.outputFiles[0].text;
}

test('a 4480x1440 capture comes back inside a 1280px box and a bounded payload', async ({ page }) => {
  await page.setContent('<html><body></body></html>');
  await page.addScriptTag({ content: await bundle() });

  const result = await page.evaluate(async ({ width, height }) => {
    // A noisy gradient — a flat fill would compress to nothing and prove nothing.
    const source = new OffscreenCanvas(width, height);
    const ctx = source.getContext('2d')!;
    for (let x = 0; x < width; x += 8) {
      ctx.fillStyle = `hsl(${(x / width) * 360}deg 70% ${40 + ((x / 8) % 20)}%)`;
      ctx.fillRect(x, 0, 8, height);
    }
    const png = await source.convertToBlob({ type: 'image/png' });
    const bytes = new Uint8Array(await png.arrayBuffer());
    let bin = '';
    for (let i = 0; i < bytes.length; i += 0x8000) {
      bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    }
    const native = btoa(bin);

    const { format, quality, max } = S.detail({ format: 'jpeg', quality: '70', maxWidth: '1280' });
    const small = await S.shrink(native, max, quality, 'image/png');
    const untouched = await S.shrink(native, 0, quality, 'image/png');
    const bitmap = await createImageBitmap(
      await (await fetch(`data:image/jpeg;base64,${small}`)).blob(),
    );
    return {
      format,
      native: native.length,
      small: small.length,
      untouched: untouched.length,
      width: bitmap.width,
      height: bitmap.height,
    };
  }, SCREEN);

  expect(result.format).toBe('jpeg');
  expect(result.width).toBe(1280);
  expect(result.height).toBe(Math.round((1280 / SCREEN.width) * SCREEN.height));
  // The whole point: what crosses the wire is bounded no matter how big the
  // screen is. 200K base64 chars is the ceiling a 1280px q70 JPEG cannot reach.
  expect(result.small).toBeLessThan(200_000);
  // max=0 is the door to the native capture, and it must not touch it.
  expect(result.untouched).toBe(result.native);
});

declare const S: {
  detail(params: Record<string, unknown>): { format: 'png' | 'jpeg'; quality: number; max: number };
  shrink(base64: string, max: number, quality: number, type?: string): Promise<string>;
};
