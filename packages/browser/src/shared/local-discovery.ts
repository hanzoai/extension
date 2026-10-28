/**
 * Local compute discovery for Hanzo Extension.
 *
 * Discovers and monitors running local inference nodes:
 * - Hanzo Desktop (port 11435)
 * - Hanzo Node (port 3690)
 * - Hanzo Spark (GB10 CUDA at 10.0.0.19:1235)
 * - Hanzo Evo (Strix Halo ROCm at 10.0.0.21:1234 / 10.0.0.57:8731)
 * - Ollama (port 11434)
 * - LM Studio (port 1234)
 */

export interface DiscoveredNode {
  id: string;
  name: string;
  url: string;
  available: boolean;
  type: 'gpu-pool' | 'desktop' | 'node' | 'ollama' | 'lmstudio';
  models?: string[];
  latencyMs?: number;
}

const CANDIDATES: Array<{ id: string; name: string; url: string; probePath: string; type: DiscoveredNode['type'] }> = [
  { id: 'hanzo-desktop', name: 'Hanzo Desktop', url: 'http://localhost:11435', probePath: '/v1/models', type: 'desktop' },
  { id: 'hanzo-node', name: 'Hanzo Node', url: 'http://localhost:3690', probePath: '/v1/models', type: 'node' },
  { id: 'hanzo-spark', name: 'Hanzo Spark (GB10 GPU)', url: 'http://10.0.0.19:1235', probePath: '/v1/models', type: 'gpu-pool' },
  { id: 'hanzo-evo', name: 'Hanzo Evo (Halo GPU)', url: 'http://10.0.0.21:1234', probePath: '/v1/models', type: 'gpu-pool' },
  { id: 'ollama', name: 'Ollama', url: 'http://localhost:11434', probePath: '/api/tags', type: 'ollama' },
  { id: 'lmstudio', name: 'LM Studio', url: 'http://localhost:1234', probePath: '/v1/models', type: 'lmstudio' },
];

export async function discoverLocalNodes(): Promise<DiscoveredNode[]> {
  const results = await Promise.all(
    CANDIDATES.map(async (cand) => {
      const start = Date.now();
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 1200);

      try {
        const res = await fetch(`${cand.url}${cand.probePath}`, {
          method: 'GET',
          signal: controller.signal,
        });
        clearTimeout(timeout);
        if (!res.ok) {
          return { id: cand.id, name: cand.name, url: cand.url, available: false, type: cand.type };
        }
        const data = await res.json().catch(() => ({}));
        let models: string[] = [];
        if (Array.isArray(data?.data)) {
          models = data.data.map((m: any) => String(m.id || m.name || '')).filter(Boolean);
        } else if (Array.isArray(data?.models)) {
          models = data.models.map((m: any) => String(m.name || m.model || '')).filter(Boolean);
        }

        return {
          id: cand.id,
          name: cand.name,
          url: cand.url,
          available: true,
          type: cand.type,
          models: models.slice(0, 10),
          latencyMs: Date.now() - start,
        };
      } catch {
        clearTimeout(timeout);
        return { id: cand.id, name: cand.name, url: cand.url, available: false, type: cand.type };
      }
    })
  );

  return results;
}
