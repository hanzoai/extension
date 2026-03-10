// Model Hub — Browse, search, download, and manage local LLM models
// Supports HuggingFace Hub, Ollama Library, and direct URL downloads.

export interface HubModel {
  id: string;              // e.g. "TheBloke/Llama-2-7B-Chat-GGUF"
  name: string;            // e.g. "Llama 2 7B Chat GGUF"
  author: string;
  description: string;
  downloads: number;
  likes: number;
  tags: string[];
  lastModified: string;
  source: 'huggingface' | 'ollama' | 'hanzo';
  size?: number;           // bytes
  files?: HubModelFile[];
  url?: string;
}

export interface HubModelFile {
  filename: string;
  size: number;
  quantization?: string;   // e.g. "Q4_K_M", "Q5_K_S"
  downloadUrl: string;
}

export interface DownloadProgress {
  modelId: string;
  filename: string;
  status: 'queued' | 'downloading' | 'complete' | 'error' | 'cancelled';
  bytesDownloaded: number;
  bytesTotal: number;
  speed?: number;          // bytes/sec
  error?: string;
  startedAt: number;
}

export interface LocalModel {
  id: string;
  name: string;
  path: string;
  size: number;
  format: string;          // gguf, safetensors, bin
  quantization?: string;
  source: string;          // where it was downloaded from
  installedAt: number;
  lastUsed?: number;
}

// ---------------------------------------------------------------------------
// HuggingFace Hub API
// ---------------------------------------------------------------------------

const HF_API = 'https://huggingface.co/api';

export async function searchHuggingFace(
  query: string,
  options?: {
    filter?: string;        // e.g. "gguf", "text-generation"
    sort?: 'downloads' | 'likes' | 'lastModified';
    limit?: number;
    author?: string;
  }
): Promise<HubModel[]> {
  const params = new URLSearchParams();
  params.set('search', query);
  if (options?.filter) params.set('filter', options.filter);
  params.set('sort', options?.sort || 'downloads');
  params.set('direction', '-1');
  params.set('limit', String(options?.limit || 20));
  if (options?.author) params.set('author', options.author);

  const resp = await fetch(`${HF_API}/models?${params}`, {
    signal: AbortSignal.timeout(10000),
  });
  if (!resp.ok) throw new Error(`HuggingFace API: ${resp.status}`);
  const data = await resp.json();

  return data.map((m: any) => ({
    id: m.modelId || m.id,
    name: (m.modelId || m.id).split('/').pop() || m.id,
    author: m.author || (m.modelId || '').split('/')[0] || 'unknown',
    description: m.cardData?.description || m.pipeline_tag || '',
    downloads: m.downloads || 0,
    likes: m.likes || 0,
    tags: m.tags || [],
    lastModified: m.lastModified || '',
    source: 'huggingface' as const,
    url: `https://huggingface.co/${m.modelId || m.id}`,
  }));
}

export async function getHuggingFaceModel(modelId: string): Promise<HubModel> {
  const resp = await fetch(`${HF_API}/models/${modelId}`, {
    signal: AbortSignal.timeout(10000),
  });
  if (!resp.ok) throw new Error(`HuggingFace model ${modelId}: ${resp.status}`);
  const m = await resp.json();

  // Get file listing for GGUF/safetensors downloads
  const files: HubModelFile[] = [];
  if (m.siblings) {
    for (const f of m.siblings) {
      const fn = f.rfilename || f.filename || '';
      if (fn.endsWith('.gguf') || fn.endsWith('.safetensors') || fn.endsWith('.bin') || fn.endsWith('.mlx') || fn.endsWith('.npz')) {
        // Parse quantization from filename (e.g. "model-Q4_K_M.gguf")
        const quantMatch = fn.match(/[.-](Q\d[_.]\w+|f16|f32|fp16|int[48])/i);
        files.push({
          filename: fn,
          size: f.size || 0,
          quantization: quantMatch ? quantMatch[1] : undefined,
          downloadUrl: `https://huggingface.co/${modelId}/resolve/main/${fn}`,
        });
      }
    }
  }

  return {
    id: m.modelId || m.id || modelId,
    name: (m.modelId || modelId).split('/').pop() || modelId,
    author: m.author || modelId.split('/')[0] || 'unknown',
    description: m.cardData?.description || m.pipeline_tag || '',
    downloads: m.downloads || 0,
    likes: m.likes || 0,
    tags: m.tags || [],
    lastModified: m.lastModified || '',
    source: 'huggingface',
    files,
    url: `https://huggingface.co/${modelId}`,
  };
}

// Search specifically for GGUF models (ready to run locally)
export async function searchGGUF(query: string, limit = 20): Promise<HubModel[]> {
  return searchHuggingFace(query, { filter: 'gguf', sort: 'downloads', limit });
}

// Search specifically for MLX models (Apple Silicon optimized)
export async function searchMLX(query: string, limit = 20): Promise<HubModel[]> {
  return searchHuggingFace(query ? `${query} mlx` : 'mlx', { sort: 'downloads', limit });
}

// Get full model card README from HuggingFace
export async function getModelCard(modelId: string): Promise<string> {
  const resp = await fetch(`https://huggingface.co/${modelId}/raw/main/README.md`, {
    signal: AbortSignal.timeout(10000),
  });
  if (!resp.ok) return '';
  return resp.text();
}

// Get model stats (downloads, likes, trending) from HF API
export async function getModelStats(modelId: string): Promise<{
  downloads: number;
  downloadsMonth: number;
  likes: number;
  tags: string[];
  pipeline: string;
  library: string;
}> {
  const resp = await fetch(`${HF_API}/models/${modelId}`, {
    signal: AbortSignal.timeout(10000),
  });
  if (!resp.ok) throw new Error(`Model stats ${modelId}: ${resp.status}`);
  const m = await resp.json();
  return {
    downloads: m.downloads || 0,
    downloadsMonth: m.downloadsAllTime || m.downloads || 0,
    likes: m.likes || 0,
    tags: m.tags || [],
    pipeline: m.pipeline_tag || '',
    library: m.library_name || '',
  };
}

// Popular/recommended models for local use
export function getRecommendedModels(): HubModel[] {
  return [
    {
      id: 'bartowski/Qwen3-8B-GGUF', name: 'Qwen3 8B', author: 'bartowski',
      description: 'Qwen3 8B quantized GGUF — excellent general-purpose model',
      downloads: 0, likes: 0, tags: ['gguf', 'text-generation', 'qwen3'],
      lastModified: '', source: 'huggingface',
      url: 'https://huggingface.co/bartowski/Qwen3-8B-GGUF',
    },
    {
      id: 'bartowski/Qwen3-4B-GGUF', name: 'Qwen3 4B', author: 'bartowski',
      description: 'Qwen3 4B quantized GGUF — fast and efficient',
      downloads: 0, likes: 0, tags: ['gguf', 'text-generation', 'qwen3'],
      lastModified: '', source: 'huggingface',
      url: 'https://huggingface.co/bartowski/Qwen3-4B-GGUF',
    },
    {
      id: 'bartowski/Qwen3-14B-GGUF', name: 'Qwen3 14B', author: 'bartowski',
      description: 'Qwen3 14B quantized GGUF — strong reasoning',
      downloads: 0, likes: 0, tags: ['gguf', 'text-generation', 'qwen3'],
      lastModified: '', source: 'huggingface',
      url: 'https://huggingface.co/bartowski/Qwen3-14B-GGUF',
    },
    {
      id: 'bartowski/Qwen3-32B-GGUF', name: 'Qwen3 32B', author: 'bartowski',
      description: 'Qwen3 32B quantized GGUF — top-tier quality',
      downloads: 0, likes: 0, tags: ['gguf', 'text-generation', 'qwen3'],
      lastModified: '', source: 'huggingface',
      url: 'https://huggingface.co/bartowski/Qwen3-32B-GGUF',
    },
    {
      id: 'lmstudio-community/Meta-Llama-3.1-8B-Instruct-GGUF', name: 'Llama 3.1 8B',
      author: 'lmstudio-community',
      description: 'Meta Llama 3.1 8B Instruct GGUF — great for LM Studio',
      downloads: 0, likes: 0, tags: ['gguf', 'text-generation', 'llama'],
      lastModified: '', source: 'huggingface',
      url: 'https://huggingface.co/lmstudio-community/Meta-Llama-3.1-8B-Instruct-GGUF',
    },
    {
      id: 'bartowski/gemma-3-12b-it-GGUF', name: 'Gemma 3 12B',
      author: 'bartowski',
      description: 'Google Gemma 3 12B Instruct GGUF',
      downloads: 0, likes: 0, tags: ['gguf', 'text-generation', 'gemma'],
      lastModified: '', source: 'huggingface',
      url: 'https://huggingface.co/bartowski/gemma-3-12b-it-GGUF',
    },
  ];
}

// ---------------------------------------------------------------------------
// Ollama Library
// ---------------------------------------------------------------------------

export async function searchOllamaLibrary(query: string): Promise<HubModel[]> {
  // Ollama doesn't have a public search API — use known popular models
  const known = [
    { name: 'qwen3:4b', desc: 'Qwen3 4B — fast thinking model', size: 2.6e9 },
    { name: 'qwen3:8b', desc: 'Qwen3 8B — balanced quality/speed', size: 4.9e9 },
    { name: 'qwen3:14b', desc: 'Qwen3 14B — strong reasoning', size: 9.0e9 },
    { name: 'qwen3:32b', desc: 'Qwen3 32B — near frontier quality', size: 19.8e9 },
    { name: 'llama3.1:8b', desc: 'Meta Llama 3.1 8B Instruct', size: 4.7e9 },
    { name: 'llama3.1:70b', desc: 'Meta Llama 3.1 70B Instruct', size: 40e9 },
    { name: 'gemma3:12b', desc: 'Google Gemma 3 12B IT', size: 8.1e9 },
    { name: 'mistral:7b', desc: 'Mistral 7B Instruct v0.3', size: 4.1e9 },
    { name: 'codellama:7b', desc: 'Code Llama 7B', size: 3.8e9 },
    { name: 'deepseek-coder-v2:16b', desc: 'DeepSeek Coder V2 16B', size: 8.9e9 },
    { name: 'phi4:14b', desc: 'Microsoft Phi-4 14B', size: 9.1e9 },
    { name: 'nomic-embed-text', desc: 'Nomic Embed Text v1.5 (embedding)', size: 274e6 },
    { name: 'snowflake-arctic-embed:xs', desc: 'Snowflake Arctic Embed XS (embedding)', size: 110e6 },
  ];

  const q = query.toLowerCase();
  const filtered = q ? known.filter(m =>
    m.name.toLowerCase().includes(q) || m.desc.toLowerCase().includes(q)
  ) : known;

  return filtered.map(m => ({
    id: `ollama:${m.name}`,
    name: m.name,
    author: 'ollama',
    description: m.desc,
    downloads: 0,
    likes: 0,
    tags: ['ollama'],
    lastModified: '',
    source: 'ollama' as const,
    size: m.size,
  }));
}

// ---------------------------------------------------------------------------
// Download to Ollama (pull)
// ---------------------------------------------------------------------------

export async function downloadToOllama(
  modelName: string,
  ollamaUrl: string = 'http://localhost:11434',
  onProgress?: (progress: DownloadProgress) => void
): Promise<void> {
  const progress: DownloadProgress = {
    modelId: modelName,
    filename: modelName,
    status: 'downloading',
    bytesDownloaded: 0,
    bytesTotal: 0,
    startedAt: Date.now(),
  };
  onProgress?.(progress);

  const resp = await fetch(`${ollamaUrl}/api/pull`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: modelName, stream: true }),
  });
  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`Ollama pull failed: ${resp.status} ${text}`);
  }

  const reader = resp.body?.getReader();
  if (!reader) throw new Error('No response body');
  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';
    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const json = JSON.parse(line);
        progress.status = json.status === 'success' ? 'complete' : 'downloading';
        if (json.completed) progress.bytesDownloaded = json.completed;
        if (json.total) progress.bytesTotal = json.total;
        if (progress.startedAt) {
          const elapsed = (Date.now() - progress.startedAt) / 1000;
          if (elapsed > 0) progress.speed = progress.bytesDownloaded / elapsed;
        }
        onProgress?.({ ...progress });
      } catch { /* skip */ }
    }
  }

  progress.status = 'complete';
  onProgress?.(progress);
}

// ---------------------------------------------------------------------------
// Download from HuggingFace (direct file download)
// ---------------------------------------------------------------------------

export async function downloadFromHuggingFace(
  downloadUrl: string,
  onProgress?: (progress: DownloadProgress) => void
): Promise<ArrayBuffer> {
  const filename = downloadUrl.split('/').pop() || 'model';
  const progress: DownloadProgress = {
    modelId: downloadUrl,
    filename,
    status: 'downloading',
    bytesDownloaded: 0,
    bytesTotal: 0,
    startedAt: Date.now(),
  };
  onProgress?.(progress);

  const resp = await fetch(downloadUrl);
  if (!resp.ok) throw new Error(`Download failed: ${resp.status}`);

  const contentLength = resp.headers.get('content-length');
  progress.bytesTotal = contentLength ? parseInt(contentLength) : 0;

  const reader = resp.body?.getReader();
  if (!reader) throw new Error('No body');

  const chunks: Uint8Array[] = [];
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    progress.bytesDownloaded += value.length;
    const elapsed = (Date.now() - progress.startedAt) / 1000;
    if (elapsed > 0) progress.speed = progress.bytesDownloaded / elapsed;
    onProgress?.({ ...progress });
  }

  progress.status = 'complete';
  onProgress?.(progress);

  // Merge chunks
  const total = progress.bytesDownloaded;
  const result = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.length;
  }
  return result.buffer;
}

// ---------------------------------------------------------------------------
// Format helpers
// ---------------------------------------------------------------------------

export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1048576) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1073741824) return `${(bytes / 1048576).toFixed(1)} MB`;
  return `${(bytes / 1073741824).toFixed(1)} GB`;
}

export function formatSpeed(bytesPerSec: number): string {
  return `${formatSize(bytesPerSec)}/s`;
}
