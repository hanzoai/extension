// Ollama Client — Connect to local Ollama LLM server
// Supports model discovery, chat completion (streaming), embeddings, and model management.

export interface OllamaModel {
  name: string;
  model: string;
  size: number;
  digest: string;
  modified_at: string;
  details?: {
    family: string;
    parameter_size: string;
    quantization_level: string;
  };
}

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface ChatOptions {
  temperature?: number;
  top_p?: number;
  num_predict?: number;
  stream?: boolean;
  stop?: string[];
}

export class OllamaClient {
  private baseUrl: string = 'http://localhost:11434';
  private connected: boolean = false;
  private cachedModels: OllamaModel[] = [];
  private lastModelFetch: number = 0;

  async discover(): Promise<boolean> {
    const ports = [11434, 11435, 11436, 11437, 11438, 11439, 11440];
    for (const port of ports) {
      const url = `http://localhost:${port}`;
      try {
        const resp = await fetch(url, { signal: AbortSignal.timeout(2000) });
        if (resp.ok) {
          const text = await resp.text();
          if (text.includes('Ollama')) {
            this.baseUrl = url;
            this.connected = true;
            console.log(`[Hanzo AI] Ollama discovered at ${url}`);
            return true;
          }
        }
      } catch {
        // try next port
      }
    }
    // Also try 127.0.0.1 on default port
    try {
      const resp = await fetch('http://127.0.0.1:11434', { signal: AbortSignal.timeout(2000) });
      if (resp.ok) {
        const text = await resp.text();
        if (text.includes('Ollama')) {
          this.baseUrl = 'http://127.0.0.1:11434';
          this.connected = true;
          return true;
        }
      }
    } catch {
      // not available
    }
    this.connected = false;
    return false;
  }

  async healthCheck(): Promise<{ ok: boolean; version?: string }> {
    try {
      const resp = await fetch(this.baseUrl, { signal: AbortSignal.timeout(3000) });
      if (!resp.ok) return { ok: false };
      // Try version endpoint
      try {
        const vResp = await fetch(`${this.baseUrl}/api/version`, { signal: AbortSignal.timeout(3000) });
        if (vResp.ok) {
          const data = await vResp.json();
          this.connected = true;
          return { ok: true, version: data.version };
        }
      } catch {
        // version endpoint may not exist on older Ollama
      }
      this.connected = true;
      return { ok: true };
    } catch {
      this.connected = false;
      return { ok: false };
    }
  }

  async listModels(): Promise<OllamaModel[]> {
    // Cache for 10 seconds
    if (this.cachedModels.length && Date.now() - this.lastModelFetch < 10000) {
      return this.cachedModels;
    }
    try {
      const resp = await fetch(`${this.baseUrl}/api/tags`, { signal: AbortSignal.timeout(5000) });
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const data = await resp.json();
      this.cachedModels = (data.models || []).map((m: any) => ({
        name: m.name,
        model: m.model || m.name,
        size: m.size || 0,
        digest: m.digest || '',
        modified_at: m.modified_at || '',
        details: m.details ? {
          family: m.details.family || '',
          parameter_size: m.details.parameter_size || '',
          quantization_level: m.details.quantization_level || '',
        } : undefined,
      }));
      this.lastModelFetch = Date.now();
      this.connected = true;
      return this.cachedModels;
    } catch (error: any) {
      console.error('[Hanzo AI] Ollama listModels failed:', error.message);
      return [];
    }
  }

  async pullModel(
    name: string,
    onProgress?: (status: string, completed?: number, total?: number) => void
  ): Promise<void> {
    const resp = await fetch(`${this.baseUrl}/api/pull`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, stream: true }),
    });
    if (!resp.ok) {
      const text = await resp.text();
      throw new Error(`Pull failed: ${resp.status} ${text}`);
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
          onProgress?.(json.status || '', json.completed, json.total);
        } catch {
          // malformed line, skip
        }
      }
    }
    // Invalidate cache
    this.lastModelFetch = 0;
  }

  async deleteModel(name: string): Promise<void> {
    const resp = await fetch(`${this.baseUrl}/api/delete`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name }),
    });
    if (!resp.ok) {
      const text = await resp.text();
      throw new Error(`Delete failed: ${resp.status} ${text}`);
    }
    this.lastModelFetch = 0;
  }

  async chat(model: string, messages: ChatMessage[], options?: ChatOptions): Promise<string> {
    const body: any = {
      model,
      messages,
      stream: false,
    };
    if (options?.temperature !== undefined) body.options = { ...body.options, temperature: options.temperature };
    if (options?.top_p !== undefined) body.options = { ...body.options, top_p: options.top_p };
    if (options?.num_predict !== undefined) body.options = { ...body.options, num_predict: options.num_predict };
    if (options?.stop) body.options = { ...body.options, stop: options.stop };

    const resp = await fetch(`${this.baseUrl}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(120000),
    });
    if (!resp.ok) {
      const text = await resp.text();
      throw new Error(`Chat failed: ${resp.status} ${text}`);
    }
    const data = await resp.json();
    return data.message?.content || '';
  }

  async chatStream(
    model: string,
    messages: ChatMessage[],
    onToken: (token: string) => void,
    options?: ChatOptions
  ): Promise<string> {
    const body: any = {
      model,
      messages,
      stream: true,
    };
    if (options?.temperature !== undefined) body.options = { ...body.options, temperature: options.temperature };
    if (options?.top_p !== undefined) body.options = { ...body.options, top_p: options.top_p };
    if (options?.num_predict !== undefined) body.options = { ...body.options, num_predict: options.num_predict };
    if (options?.stop) body.options = { ...body.options, stop: options.stop };

    const resp = await fetch(`${this.baseUrl}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!resp.ok) {
      const text = await resp.text();
      throw new Error(`Chat stream failed: ${resp.status} ${text}`);
    }

    const reader = resp.body?.getReader();
    if (!reader) throw new Error('No response body');

    const decoder = new TextDecoder();
    let buffer = '';
    let fullResponse = '';

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
          if (json.message?.content) {
            onToken(json.message.content);
            fullResponse += json.message.content;
          }
          if (json.done) break;
        } catch {
          // skip malformed
        }
      }
    }
    return fullResponse;
  }

  async generate(model: string, prompt: string, options?: ChatOptions): Promise<string> {
    const body: any = {
      model,
      prompt,
      stream: false,
    };
    if (options?.temperature !== undefined) body.options = { ...body.options, temperature: options.temperature };
    if (options?.num_predict !== undefined) body.options = { ...body.options, num_predict: options.num_predict };

    const resp = await fetch(`${this.baseUrl}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(120000),
    });
    if (!resp.ok) {
      const text = await resp.text();
      throw new Error(`Generate failed: ${resp.status} ${text}`);
    }
    const data = await resp.json();
    return data.response || '';
  }

  async embed(model: string, input: string): Promise<number[]> {
    const resp = await fetch(`${this.baseUrl}/api/embeddings`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model, prompt: input }),
      signal: AbortSignal.timeout(30000),
    });
    if (!resp.ok) {
      const text = await resp.text();
      throw new Error(`Embed failed: ${resp.status} ${text}`);
    }
    const data = await resp.json();
    return data.embedding || [];
  }

  setBaseUrl(url: string): void {
    this.baseUrl = url.replace(/\/$/, '');
    this.connected = false;
    this.lastModelFetch = 0;
  }

  getStatus(): { connected: boolean; url: string; models: string[] } {
    return {
      connected: this.connected,
      url: this.baseUrl,
      models: this.cachedModels.map(m => m.name),
    };
  }
}

export const ollamaClient = new OllamaClient();
export default OllamaClient;
