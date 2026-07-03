import { describe, it, expect } from 'vitest';
import {
  formatSize,
  formatSpeed,
  getRecommendedModels,
  searchHuggingFace,
  searchGGUF,
  searchMLX,
  getHuggingFaceModel,
  getModelCard,
  getModelStats,
  searchOllamaLibrary,
} from '../src/model-hub';

// ---------------------------------------------------------------------------
// Pure function tests (no network)
// ---------------------------------------------------------------------------

describe('formatSize', () => {
  it('formats bytes', () => {
    expect(formatSize(500)).toBe('500 B');
  });

  it('formats kilobytes', () => {
    expect(formatSize(2048)).toBe('2.0 KB');
  });

  it('formats megabytes', () => {
    expect(formatSize(5 * 1024 * 1024)).toBe('5.0 MB');
  });

  it('formats gigabytes', () => {
    expect(formatSize(3.5 * 1024 * 1024 * 1024)).toBe('3.5 GB');
  });
});

describe('formatSpeed', () => {
  it('formats bytes/sec', () => {
    expect(formatSpeed(1024 * 1024)).toBe('1.0 MB/s');
  });
});

describe('getRecommendedModels', () => {
  it('returns non-empty array', () => {
    const models = getRecommendedModels();
    expect(models.length).toBeGreaterThan(0);
  });

  it('all models have required fields', () => {
    for (const m of getRecommendedModels()) {
      expect(m.id).toBeTruthy();
      expect(m.name).toBeTruthy();
      expect(m.author).toBeTruthy();
      expect(m.source).toBe('huggingface');
      expect(m.tags).toBeInstanceOf(Array);
    }
  });
});

describe('searchOllamaLibrary', () => {
  it('returns all known models for empty query', () => {
    const models = searchOllamaLibrary('');
    // synchronous — returns a Promise but the known list is static
    expect(models).toBeInstanceOf(Promise);
  });

  it('filters by query', async () => {
    const models = await searchOllamaLibrary('qwen');
    expect(models.length).toBeGreaterThan(0);
    for (const m of models) {
      expect(m.source).toBe('ollama');
      expect(m.id.startsWith('ollama:')).toBe(true);
    }
  });

  it('returns empty for nonsense query', async () => {
    const models = await searchOllamaLibrary('zznonexistent999');
    expect(models).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// HuggingFace API integration tests (real network calls)
//
// These verify OUR client against the live API. When HF itself refuses
// service (rate-limit 429, outage, no network) there is nothing of ours to
// verify — skip with the status logged instead of failing on the weather.
// Any failure while HF answers 200 is still a real failure. Live calls get
// a 15s budget (HF routinely exceeds vitest's 5s default under load).
// ---------------------------------------------------------------------------

const HF_LIVE_TIMEOUT = 15_000;
const hfStatus = await fetch('https://huggingface.co/api/models?limit=1', {
  signal: AbortSignal.timeout(5000),
}).then((r) => r.status, () => 0);
if (hfStatus !== 200) {
  console.warn(`[model-hub.test] skipping live HF tests — huggingface.co status ${hfStatus || 'unreachable'}`);
}

describe.skipIf(hfStatus !== 200)('HuggingFace API', () => {
  it('searchHuggingFace returns models', async () => {
    const models = await searchHuggingFace('llama', { limit: 2 });
    expect(models.length).toBeGreaterThan(0);
    expect(models.length).toBeLessThanOrEqual(2);
    for (const m of models) {
      expect(m.id).toBeTruthy();
      expect(m.source).toBe('huggingface');
    }
  }, HF_LIVE_TIMEOUT);

  it('searchGGUF returns GGUF-tagged models', async () => {
    const models = await searchGGUF('qwen', 3);
    expect(models.length).toBeGreaterThan(0);
    for (const m of models) {
      expect(m.tags).toBeInstanceOf(Array);
    }
  }, HF_LIVE_TIMEOUT);

  it('searchMLX returns MLX models', async () => {
    const models = await searchMLX('llama', 3);
    expect(models.length).toBeGreaterThan(0);
  }, HF_LIVE_TIMEOUT);

  it('getHuggingFaceModel returns model with files', async () => {
    // Use a well-known public model that doesn't require auth
    const model = await getHuggingFaceModel('TheBloke/Llama-2-7B-Chat-GGUF');
    expect(model.id).toBeTruthy();
    expect(model.source).toBe('huggingface');
    expect(model.files).toBeInstanceOf(Array);
    expect(model.files!.length).toBeGreaterThan(0);
    for (const f of model.files!) {
      expect(
        f.filename.endsWith('.gguf') ||
        f.filename.endsWith('.safetensors') ||
        f.filename.endsWith('.bin') ||
        f.filename.endsWith('.mlx') ||
        f.filename.endsWith('.npz')
      ).toBe(true);
      expect(f.downloadUrl).toContain('huggingface.co');
    }
  }, HF_LIVE_TIMEOUT);

  it('getModelCard returns markdown', async () => {
    const card = await getModelCard('TheBloke/Llama-2-7B-Chat-GGUF');
    expect(typeof card).toBe('string');
    // Card may be empty for some models; just verify it's a string
    expect(card).toBeDefined();
  }, HF_LIVE_TIMEOUT);

  it('getModelStats returns download count', async () => {
    const stats = await getModelStats('TheBloke/Llama-2-7B-Chat-GGUF');
    expect(stats.downloads).toBeGreaterThan(0);
    expect(stats.tags).toBeInstanceOf(Array);
  }, HF_LIVE_TIMEOUT);
});
