/**
 * AI Provider Management
 * Unified interface for all LLM providers
 */

import { EventEmitter } from 'events';
import { AnthropicProvider } from './providers/anthropic';
import { OpenAIProvider } from './providers/openai';
import { GeminiProvider } from './providers/gemini';
import { LocalProvider } from './providers/local';
import { HanzoProvider } from './providers/hanzo';

export interface AIProvider {
  name: string;
  type: 'anthropic' | 'openai' | 'gemini' | 'grok' | 'local' | 'hanzo';
  supportedModels: string[];
  supportsTools: boolean;
  supportsStreaming: boolean;
  supportsVision: boolean;
  maxTokens: number;
  
  // Core methods
  complete(params: CompletionParams): Promise<CompletionResponse>;
  stream(params: CompletionParams): AsyncIterableIterator<StreamChunk>;
  embed(params: EmbeddingParams): Promise<EmbeddingResponse>;
  
  // Authentication
  isAuthenticated(): boolean;
  authenticate(credentials: any): Promise<void>;
  
  // Cost estimation
  estimateCost(tokens: number): number;
}

export interface CompletionParams {
  messages: Message[];
  model?: string;
  temperature?: number;
  maxTokens?: number;
  tools?: Tool[];
  systemPrompt?: string;
  stream?: boolean;
}

export interface Message {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | ContentBlock[];
  toolCalls?: ToolCall[];
  toolResults?: ToolResult[];
}

export interface ContentBlock {
  type: 'text' | 'image' | 'code' | 'file';
  content: string;
  language?: string;
  path?: string;
}

export interface Tool {
  name: string;
  description: string;
  parameters: {
    type: 'object';
    properties: Record<string, any>;
    required?: string[];
  };
}

export interface ToolCall {
  id: string;
  name: string;
  arguments: any;
}

export interface ToolResult {
  id: string;
  result: any;
  error?: string;
}

export interface CompletionResponse {
  content: string;
  usage: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
  model: string;
  toolCalls?: ToolCall[];
  finishReason: 'stop' | 'tool_calls' | 'length' | 'error';
}

export interface StreamChunk {
  type: 'content' | 'tool_call' | 'usage' | 'error' | 'done';
  content?: string;
  toolCall?: ToolCall;
  usage?: CompletionResponse['usage'];
  error?: string;
}

export interface EmbeddingParams {
  texts: string[];
  model?: string;
}

export interface EmbeddingResponse {
  embeddings: number[][];
  model: string;
  usage: {
    totalTokens: number;
  };
}

export class AIProviderManager extends EventEmitter {
  private providers: Map<string, AIProvider> = new Map();
  private defaultProvider: string = 'anthropic';
  
  constructor() {
    super();
    this.initializeProviders();
  }
  
  private initializeProviders(): void {
    // Register built-in providers
    this.registerProvider(new AnthropicProvider());
    this.registerProvider(new OpenAIProvider());
    this.registerProvider(new GeminiProvider());
    this.registerProvider(new LocalProvider());
    this.registerProvider(new HanzoProvider());
  }
  
  registerProvider(provider: AIProvider): void {
    this.providers.set(provider.type, provider);
    this.emit('provider:registered', provider);
  }
  
  getProvider(type?: string): AIProvider {
    const providerType = type || this.defaultProvider;
    const provider = this.providers.get(providerType);
    
    if (!provider) {
      throw new Error(`Provider '${providerType}' not found`);
    }
    
    return provider;
  }
  
  listProviders(): AIProvider[] {
    return Array.from(this.providers.values());
  }
  
  getAuthenticatedProviders(): AIProvider[] {
    return this.listProviders().filter(p => p.isAuthenticated());
  }
  
  setDefaultProvider(type: string): void {
    if (!this.providers.has(type)) {
      throw new Error(`Provider '${type}' not found`);
    }
    this.defaultProvider = type;
  }
  
  async complete(params: CompletionParams, providerType?: string): Promise<CompletionResponse> {
    const provider = this.getProvider(providerType);
    
    if (!provider.isAuthenticated()) {
      throw new Error(`Provider '${provider.name}' is not authenticated`);
    }
    
    this.emit('completion:start', { provider, params });
    
    try {
      const response = await provider.complete(params);
      this.emit('completion:success', { provider, params, response });
      return response;
    } catch (error) {
      this.emit('completion:error', { provider, params, error });
      throw error;
    }
  }
  
  async *stream(params: CompletionParams, providerType?: string): AsyncIterableIterator<StreamChunk> {
    const provider = this.getProvider(providerType);
    
    if (!provider.isAuthenticated()) {
      throw new Error(`Provider '${provider.name}' is not authenticated`);
    }
    
    if (!provider.supportsStreaming) {
      throw new Error(`Provider '${provider.name}' does not support streaming`);
    }
    
    this.emit('stream:start', { provider, params });
    
    try {
      for await (const chunk of provider.stream(params)) {
        this.emit('stream:chunk', { provider, chunk });
        yield chunk;
      }
      this.emit('stream:complete', { provider });
    } catch (error) {
      this.emit('stream:error', { provider, error });
      throw error;
    }
  }
  
  async embed(params: EmbeddingParams, providerType?: string): Promise<EmbeddingResponse> {
    const provider = this.getProvider(providerType);
    
    if (!provider.isAuthenticated()) {
      throw new Error(`Provider '${provider.name}' is not authenticated`);
    }
    
    return provider.embed(params);
  }
  
  estimateCost(tokens: number, providerType?: string): number {
    const provider = this.getProvider(providerType);
    return provider.estimateCost(tokens);
  }
}

// Global instance
export const aiProviderManager = new AIProviderManager();