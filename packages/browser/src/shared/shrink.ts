/**
 * Shrink a capture where the pixels are.
 *
 * A 4480x1440 screen is ~740 KB of base64. That payload crosses native
 * messaging, then zapd, then lands in an agent's context window — where it is
 * charged by the character and costs more than the agent has to think with.
 * Downscaling in the browser means it is never built in the first place.
 *
 * One function, used by every dispatch path. Base64 in, base64 out, no data:
 * URL prefix on either side.
 */

const CHUNK = 0x8000;

function toBlob(base64: string, type: string): Blob {
  const bin = atob(base64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type });
}

async function toBase64(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let bin = '';
  for (let i = 0; i < bytes.length; i += CHUNK) {
    bin += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(bin);
}

/**
 * Fit a capture inside a `max`-pixel box and re-encode JPEG at `quality` (1-100).
 *
 * A capture already inside the box and already JPEG is returned untouched. Any
 * failure returns the original — a screenshot that is too big beats no
 * screenshot, and the consumer shrinks as a backstop.
 */
export async function shrink(
  base64: string,
  max: number,
  quality: number,
  type = 'image/png',
): Promise<string> {
  if (!base64 || !(max > 0)) return base64;
  try {
    const bitmap = await createImageBitmap(toBlob(base64, type));
    const scale = Math.min(1, max / Math.max(bitmap.width, bitmap.height));
    if (scale >= 1 && type === 'image/jpeg') {
      bitmap.close();
      return base64;
    }
    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = new OffscreenCanvas(width, height);
    const ctx = canvas.getContext('2d');
    if (!ctx) return base64;
    ctx.drawImage(bitmap, 0, 0, width, height);
    bitmap.close();
    return await toBase64(
      await canvas.convertToBlob({ type: 'image/jpeg', quality: Math.min(100, Math.max(1, quality)) / 100 }),
    );
  } catch {
    return base64;
  }
}

/** Read the capture-detail params off a wire command. They arrive as strings. */
export function detail(params: Record<string, any> = {}): {
  format: 'png' | 'jpeg';
  quality: number;
  max: number;
} {
  const format = params.format === 'png' ? 'png' : 'jpeg';
  const quality = Number(params.quality) || (format === 'jpeg' ? 70 : 0);
  const max = Number(params.maxWidth) || 0;
  return { format, quality, max };
}
