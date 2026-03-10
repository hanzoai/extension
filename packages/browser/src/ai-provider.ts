// AI Provider — Pluggable backend for chat/completion/embeddings
// Supports: Hanzo Cloud, Ollama, LM Studio, Hanzo Desktop, custom OpenAI-compatible endpoints

export interface AIMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface AICompletionOptions {
  temperature?: number;
  top_p?: number;
  max_tokens?: number;
  stop?: string[];
  stream?: boolean;
}

export interface AIModel {
  id: string;
  name: string;
  provider: string;
  size?: number;
  context_length?: number;
  capabilities?: string[];
}

export interface AIProviderStatus {
  id: string;
  name: string;
  type: 'cloud' | 'local';
  available: boolean;
  url?: string;
  models: AIModel[];
  requiresAuth: boolean;
  authenticated?: boolean;
}

export interface AIProvider {
  id: string;
  name: string;
  type: 'cloud' | 'local';

  discover(): Promise<boolean>;
  listModels(): Promise<AIModel[]>;
  chat(model: string, messages: AIMessage[], options?: AICompletionOptions): Promise<string>;
  chatStream?(model: string, messages: AIMessage[], onToken: (token: string) => void, options?: AICompletionOptions): Promise<string>;
  embed?(model: string, input: string): Promise<number[]>;
  getStatus(): AIProviderStatus;
}

// ---------------------------------------------------------------------------
// Hanzo Cloud Provider (api.hanzo.ai / llm.hanzo.ai)
// ---------------------------------------------------------------------------

export class HanzoCloudProvider implements AIProvider {
  id = 'hanzo-cloud';
  name = 'Hanzo Cloud';
  type = 'cloud' as const;
  private baseUrl = 'https://llm.hanzo.ai/v1';
  private token: string | null = null;
  private models: AIModel[] = [];
  private available = false;

  setToken(token: string | null) {
    this.token = token;
  }

  async discover(): Promise<boolean> {
    try {
      const headers: Record<string, string> = {};
      if (this.token) headers['Authorization'] = `Bearer ${this.token}`;
      const resp = await fetch(`${this.baseUrl}/models`, { headers, signal: AbortSignal.timeout(5000) });
      this.available = resp.ok;
      if (resp.ok) {
        const data = await resp.json();
        this.models = (data.data || []).map((m: any) => ({
          id: m.id,
          name: m.id,
          provider: this.id,
        }));
      }
      return this.available;
    } catch {
      this.available = false;
      return false;
    }
  }

  async listModels(): Promise<AIModel[]> {
    if (!this.models.length) await this.discover();
    return this.models;
  }

  async chat(model: string, messages: AIMessage[], options?: AICompletionOptions): Promise<string> {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (this.token) headers['Authorization'] = `Bearer ${this.token}`;
    const body: any = { model, messages, stream: false };
    if (options?.temperature !== undefined) body.temperature = options.temperature;
    if (options?.max_tokens !== undefined) body.max_tokens = options.max_tokens;
    if (options?.top_p !== undefined) body.top_p = options.top_p;
    if (options?.stop) body.stop = options.stop;

    const resp = await fetch(`${this.baseUrl}/chat/completions`, {
      method: 'POST', headers, body: JSON.stringify(body),
      signal: AbortSignal.timeout(120000),
    });
    if (!resp.ok) {
      const text = await resp.text();
      throw new Error(`Hanzo Cloud: ${resp.status} ${text}`);
    }
    const data = await resp.json();
    return data.choices?.[0]?.message?.content || '';
  }

  async embed(model: string, input: string): Promise<number[]> {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (this.token) headers['Authorization'] = `Bearer ${this.token}`;
    const resp = await fetch(`${this.baseUrl}/embeddings`, {
      method: 'POST', headers,
      body: JSON.stringify({ model, input }),
      signal: AbortSignal.timeout(30000),
    });
    if (!resp.ok) throw new Error(`Hanzo Cloud embed: ${resp.status}`);
    const data = await resp.json();
    return data.data?.[0]?.embedding || [];
  }

  getStatus(): AIProviderStatus {
    return {
      id: this.id, name: this.name, type: this.type,
      available: this.available, url: this.baseUrl,
      models: this.models, requiresAuth: true, authenticated: !!this.token,
    };
  }
}

// ---------------------------------------------------------------------------
// OpenAI-Compatible Local Provider (Ollama, LM Studio, Hanzo Desktop, custom)
// ---------------------------------------------------------------------------

export class OpenAICompatibleProvider implements AIProvider {
  id: string;
  name: string;
  type = 'local' as const;
  private baseUrl: string;
  private apiKey: string | null;
  private models: AIModel[] = [];
  private available = false;

  constructor(id: string, name: string, baseUrl: string, apiKey?: string) {
    this.id = id;
    this.name = name;
    this.baseUrl = baseUrl.replace(/\/$/, '');
    this.apiKey = apiKey || null;
  }

  private headers(): Record<string, string> {
    const h: Record<string, string> = { 'Content-Type': 'application/json' };
    if (this.apiKey) h['Authorization'] = `Bearer ${this.apiKey}`;
    return h;
  }

  async discover(): Promise<boolean> {
    try {
      const resp = await fetch(`${this.baseUrl}/models`, {
        headers: this.headers(),
        signal: AbortSignal.timeout(3000),
      });
      this.available = resp.ok;
      if (resp.ok) {
        const data = await resp.json();
        this.models = (data.data || data.models || []).map((m: any) => ({
          id: m.id || m.name || m.model,
          name: m.id || m.name || m.model,
          provider: this.id,
          size: m.size,
        }));
      }
      return this.available;
    } catch {
      this.available = false;
      return false;
    }
  }

  async listModels(): Promise<AIModel[]> {
    if (!this.models.length) await this.discover();
    return this.models;
  }

  async chat(model: string, messages: AIMessage[], options?: AICompletionOptions): Promise<string> {
    const body: any = { model, messages, stream: false };
    if (options?.temperature !== undefined) body.temperature = options.temperature;
    if (options?.max_tokens !== undefined) body.max_tokens = options.max_tokens;
    if (options?.top_p !== undefined) body.top_p = options.top_p;
    if (options?.stop) body.stop = options.stop;

    const resp = await fetch(`${this.baseUrl}/chat/completions`, {
      method: 'POST', headers: this.headers(), body: JSON.stringify(body),
      signal: AbortSignal.timeout(120000),
    });
    if (!resp.ok) {
      const text = await resp.text();
      throw new Error(`${this.name}: ${resp.status} ${text}`);
    }
    const data = await resp.json();
    return data.choices?.[0]?.message?.content || '';
  }

  async chatStream(model: string, messages: AIMessage[], onToken: (token: string) => void, options?: AICompletionOptions): Promise<string> {
    const body: any = { model, messages, stream: true };
    if (options?.temperature !== undefined) body.temperature = options.temperature;
    if (options?.max_tokens !== undefined) body.max_tokens = options.max_tokens;

    const resp = await fetch(`${this.baseUrl}/chat/completions`, {
      method: 'POST', headers: this.headers(), body: JSON.stringify(body),
    });
    if (!resp.ok) throw new Error(`${this.name}: ${resp.status}`);

    const reader = resp.body?.getReader();
    if (!reader) throw new Error('No response body');

    const decoder = new TextDecoder();
    let buffer = '';
    let full = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';
      for (const line of lines) {
        if (!line.startsWith('data: ') || line === 'data: [DONE]') continue;
        try {
          const json = JSON.parse(line.slice(6));
          const content = json.choices?.[0]?.delta?.content;
          if (content) { onToken(content); full += content; }
        } catch { /* skip */ }
      }
    }
    return full;
  }

  async embed(model: string, input: string): Promise<number[]> {
    const resp = await fetch(`${this.baseUrl}/embeddings`, {
      method: 'POST', headers: this.headers(),
      body: JSON.stringify({ model, input }),
      signal: AbortSignal.timeout(30000),
    });
    if (!resp.ok) throw new Error(`${this.name} embed: ${resp.status}`);
    const data = await resp.json();
    return data.data?.[0]?.embedding || [];
  }

  getStatus(): AIProviderStatus {
    return {
      id: this.id, name: this.name, type: this.type,
      available: this.available, url: this.baseUrl,
      models: this.models, requiresAuth: !!this.apiKey,
    };
  }
}

// ---------------------------------------------------------------------------
// Ollama-Native Provider (uses Ollama-specific API, not OpenAI compat)
// ---------------------------------------------------------------------------

export class OllamaNativeProvider implements AIProvider {
  id = 'ollama';
  name = 'Ollama';
  type = 'local' as const;
  private baseUrl = 'http://localhost:11434';
  private models: AIModel[] = [];
  private available = false;

  async discover(): Promise<boolean> {
    const ports = [11434, 11435, 11436, 11437, 11438, 11439, 11440];
    for (const port of ports) {
      try {
        const resp = await fetch(`http://localhost:${port}`, { signal: AbortSignal.timeout(2000) });
        if (resp.ok) {
          const text = await resp.text();
          if (text.includes('Ollama')) {
            this.baseUrl = `http://localhost:${port}`;
            this.available = true;
            return true;
          }
        }
      } catch { /* next */ }
    }
    this.available = false;
    return false;
  }

  async listModels(): Promise<AIModel[]> {
    try {
      const resp = await fetch(`${this.baseUrl}/api/tags`, { signal: AbortSignal.timeout(5000) });
      if (!resp.ok) return [];
      const data = await resp.json();
      this.models = (data.models || []).map((m: any) => ({
        id: m.name, name: m.name, provider: this.id,
        size: m.size,
        capabilities: m.details?.families || [],
      }));
      return this.models;
    } catch {
      return [];
    }
  }

  async chat(model: string, messages: AIMessage[], options?: AICompletionOptions): Promise<string> {
    const body: any = { model, messages, stream: false };
    if (options?.temperature !== undefined) body.options = { ...body.options, temperature: options.temperature };
    if (options?.max_tokens !== undefined) body.options = { ...body.options, num_predict: options.max_tokens };
    if (options?.top_p !== undefined) body.options = { ...body.options, top_p: options.top_p };

    const resp = await fetch(`${this.baseUrl}/api/chat`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body), signal: AbortSignal.timeout(120000),
    });
    if (!resp.ok) throw new Error(`Ollama: ${resp.status}`);
    const data = await resp.json();
    return data.message?.content || '';
  }

  async chatStream(model: string, messages: AIMessage[], onToken: (token: string) => void, options?: AICompletionOptions): Promise<string> {
    const body: any = { model, messages, stream: true };
    if (options?.temperature !== undefined) body.options = { ...body.options, temperature: options.temperature };
    if (options?.max_tokens !== undefined) body.options = { ...body.options, num_predict: options.max_tokens };

    const resp = await fetch(`${this.baseUrl}/api/chat`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!resp.ok) throw new Error(`Ollama stream: ${resp.status}`);

    const reader = resp.body?.getReader();
    if (!reader) throw new Error('No body');
    const decoder = new TextDecoder();
    let buffer = '', full = '';

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
          if (json.message?.content) { onToken(json.message.content); full += json.message.content; }
        } catch { /* skip */ }
      }
    }
    return full;
  }

  async embed(model: string, input: string): Promise<number[]> {
    const resp = await fetch(`${this.baseUrl}/api/embeddings`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model, prompt: input }),
      signal: AbortSignal.timeout(30000),
    });
    if (!resp.ok) throw new Error(`Ollama embed: ${resp.status}`);
    const data = await resp.json();
    return data.embedding || [];
  }

  getStatus(): AIProviderStatus {
    return {
      id: this.id, name: this.name, type: this.type,
      available: this.available, url: this.baseUrl,
      models: this.models, requiresAuth: false,
    };
  }
}

// ---------------------------------------------------------------------------
// Provider Registry
// ---------------------------------------------------------------------------

export class AIProviderRegistry {
  private providers: Map<string, AIProvider> = new Map();

  register(provider: AIProvider): void {
    this.providers.set(provider.id, provider);
  }

  get(id: string): AIProvider | undefined {
    return this.providers.get(id);
  }

  getAll(): AIProvider[] {
    return Array.from(this.providers.values());
  }

  async discoverAll(): Promise<AIProviderStatus[]> {
    const results = await Promise.allSettled(
      this.getAll().map(async (p) => {
        await p.discover();
        return p.getStatus();
      })
    );
    return results
      .filter((r): r is PromiseFulfilledResult<AIProviderStatus> => r.status === 'fulfilled')
      .map(r => r.value);
  }

  async listAllModels(): Promise<AIModel[]> {
    const results = await Promise.allSettled(
      this.getAll().map(p => p.listModels())
    );
    return results
      .filter((r): r is PromiseFulfilledResult<AIModel[]> => r.status === 'fulfilled')
      .flatMap(r => r.value);
  }

  async chat(providerId: string, model: string, messages: AIMessage[], options?: AICompletionOptions): Promise<string> {
    const provider = this.providers.get(providerId);
    if (!provider) throw new Error(`Provider "${providerId}" not found`);
    return provider.chat(model, messages, options);
  }

  // Auto-select: try preferred provider, fall back through available ones
  async autoChat(model: string, messages: AIMessage[], preferredProvider?: string, options?: AICompletionOptions): Promise<{ content: string; provider: string }> {
    // Try preferred first
    if (preferredProvider) {
      const p = this.providers.get(preferredProvider);
      if (p) {
        const status = p.getStatus();
        if (status.available) {
          const content = await p.chat(model, messages, options);
          return { content, provider: p.id };
        }
      }
    }

    // Try each available provider
    for (const p of this.getAll()) {
      const status = p.getStatus();
      if (!status.available) continue;
      const hasModel = status.models.some(m => m.id === model || m.name === model);
      if (!hasModel && status.models.length > 0) continue;
      try {
        const content = await p.chat(model, messages, options);
        return { content, provider: p.id };
      } catch {
        continue;
      }
    }
    throw new Error(`No available provider for model "${model}"`);
  }
}

// ---------------------------------------------------------------------------
// Default registry with built-in providers
// ---------------------------------------------------------------------------

export function createDefaultRegistry(): AIProviderRegistry {
  const registry = new AIProviderRegistry();

  // Cloud
  registry.register(new HanzoCloudProvider());

  // Local
  registry.register(new OllamaNativeProvider());
  registry.register(new OpenAICompatibleProvider('lmstudio', 'LM Studio', 'http://localhost:1234/v1'));
  registry.register(new OpenAICompatibleProvider('hanzo-desktop', 'Hanzo Desktop', 'http://localhost:11435/v1'));

  return registry;
}

export const defaultRegistry = createDefaultRegistry();
