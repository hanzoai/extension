/**
 * Backend abstraction layer for local vs cloud deployment
 * Supports switching between local and Hanzo Cloud services
 */

import * as vscode from 'vscode';
import { GraphDatabase } from './graph-db';
import { VectorStore } from './vector-store';
import { DocumentStore } from './document-store';
import { ASTIndex } from './ast-index';
import { UnifiedRxDBBackend, LocalEmbeddingServer, CloudEmbeddingServer } from './unified-rxdb-backend';

import { fetchPolyfill as fetch } from '../utils/fetch-polyfill';

export interface BackendConfig {
    mode: 'local' | 'cloud';
    apiKey?: string;
    endpoint?: string;
    authToken?: string;
}

export interface LLMProvider {
    name: string;
    type: 'openai' | 'anthropic' | 'ollama' | 'lmstudio' | 'hanzo';
    endpoint: string;
    apiKey?: string;
    models: string[];
}

export interface EmbeddingProvider {
    name: string;
    type: 'openai' | 'cohere' | 'sentence-transformers' | 'hanzo';
    endpoint: string;
    apiKey?: string;
    model: string;
    dimension: number;
}

/**
 * Abstract backend interface for all services
 */
export interface IBackend {
    // Graph operations
    graphAddNode(node: any): Promise<void>;
    graphAddEdge(edge: any): Promise<void>;
    graphQuery(query: any): Promise<any[]>;
    graphFindPath(from: string, to: string): Promise<any[]>;
    
    // Vector operations
    vectorIndex(content: string, metadata: any): Promise<string>;
    vectorSearch(query: string, options?: any): Promise<any[]>;
    vectorGetSimilar(id: string, topK?: number): Promise<any[]>;
    
    // Document operations
    documentAdd(chatId: string, content: string, type: string, metadata?: any): Promise<string>;
    documentSearch(query: string, options?: any): Promise<any[]>;
    documentGet(id: string): Promise<any>;
    
    // AST operations
    astIndex(filePath: string): Promise<void>;
    astSearch(query: string, options?: any): Promise<any[]>;
    
    // LLM operations
    llmComplete(prompt: string, options?: any): Promise<string>;
    llmEmbed(text: string): Promise<number[]>;
    
    // Storage operations
    save(): Promise<void>;
    load(): Promise<void>;
}

/**
 * Local backend implementation
 */
export class LocalBackend implements IBackend {
    private graphDb: GraphDatabase;
    private vectorStore: VectorStore;
    private documentStore: DocumentStore;
    private astIndexInstance: ASTIndex;
    private llmProviders: Map<string, LLMProvider> = new Map();
    private embeddingProvider?: EmbeddingProvider;
    private context: vscode.ExtensionContext;
    private rxdbBackend?: UnifiedRxDBBackend;
    private useRxDB: boolean;
    
    constructor(context: vscode.ExtensionContext) {
        this.context = context;
        
        // Check if RxDB should be used
        const config = vscode.workspace.getConfiguration('hanzo');
        this.useRxDB = config.get<boolean>('useRxDB', true);
        
        if (this.useRxDB) {
            // Initialize RxDB backend
            const embeddingProvider = this.createEmbeddingProvider();
            this.rxdbBackend = new UnifiedRxDBBackend(
                context.globalStorageUri.fsPath,
                embeddingProvider
            );
            this.rxdbBackend.initialize().catch(console.error);
        }
        
        // Still initialize in-memory backends for compatibility
        this.graphDb = new GraphDatabase();
        this.vectorStore = new VectorStore();
        this.documentStore = new DocumentStore(context.globalStorageUri.fsPath);
        this.astIndexInstance = new ASTIndex();
        
        this.initializeProviders();
    }
    
    private createEmbeddingProvider(): any {
        const config = vscode.workspace.getConfiguration('hanzo.embedding');
        const provider = config.get<string>('provider', 'local');
        
        switch (provider) {
            case 'openai':
                const openaiKey = config.get<string>('openaiApiKey');
                if (openaiKey) {
                    return new CloudEmbeddingServer('openai', openaiKey);
                }
                break;
            case 'cohere':
                const cohereKey = config.get<string>('cohereApiKey');
                if (cohereKey) {
                    return new CloudEmbeddingServer('cohere', cohereKey);
                }
                break;
            case 'hanzo':
                const hanzoKey = config.get<string>('apiKey') || vscode.workspace.getConfiguration('hanzo').get<string>('apiKey');
                if (hanzoKey) {
                    return new CloudEmbeddingServer('hanzo', hanzoKey);
                }
                break;
        }
        
        // Default to local
        return new LocalEmbeddingServer();
    }
    
    private async initializeProviders() {
        // Check for local LLM providers
        await this.detectOllama();
        await this.detectLMStudio();
        await this.loadHanzoModels();
    }
    
    private async detectOllama() {
        try {
            const response = await fetch('http://localhost:11434/api/tags');
            if (response.ok) {
                const data = await response.json();
                this.llmProviders.set('ollama', {
                    name: 'Ollama',
                    type: 'ollama',
                    endpoint: 'http://localhost:11434',
                    models: data.models?.map((m: any) => m.name) || []
                });
                console.log('Ollama detected with models:', data.models);
            }
        } catch (error) {
            // Ollama not running
        }
    }
    
    private async detectLMStudio() {
        try {
            const response = await fetch('http://localhost:1234/v1/models');
            if (response.ok) {
                const data = await response.json();
                this.llmProviders.set('lmstudio', {
                    name: 'LM Studio',
                    type: 'lmstudio',
                    endpoint: 'http://localhost:1234/v1',
                    models: data.data?.map((m: any) => m.id) || []
                });
                console.log('LM Studio detected with models:', data.data);
            }
        } catch (error) {
            // LM Studio not running
        }
    }
    
    private async loadHanzoModels() {
        // Check for local Hanzo models
        const hanzoEndpoint = vscode.workspace.getConfiguration('hanzo').get<string>('localModelEndpoint');
        if (hanzoEndpoint) {
            this.llmProviders.set('hanzo-local', {
                name: 'Hanzo Local',
                type: 'hanzo',
                endpoint: hanzoEndpoint,
                models: ['zen1', 'zen1-mini', 'zen1-code']
            });
        }
    }
    
    // Graph operations
    async graphAddNode(node: any): Promise<void> {
        this.graphDb.addNode(node);
    }
    
    async graphAddEdge(edge: any): Promise<void> {
        this.graphDb.addEdge(edge);
    }
    
    async graphQuery(query: any): Promise<any[]> {
        return this.graphDb.queryNodes(query);
    }
    
    async graphFindPath(from: string, to: string): Promise<any[]> {
        return this.graphDb.findPath(from, to) || [];
    }
    
    // Vector operations
    async vectorIndex(content: string, metadata: any): Promise<string> {
        return await this.vectorStore.addDocument(content, metadata);
    }
    
    async vectorSearch(query: string, options?: any): Promise<any[]> {
        const results = await this.vectorStore.search(query, options);
        return results.map(r => ({
            ...r.document,
            score: r.score
        }));
    }
    
    async vectorGetSimilar(id: string, topK?: number): Promise<any[]> {
        const results = await this.vectorStore.getSimilar(id, topK);
        return results.map(r => ({
            ...r.document,
            score: r.score
        }));
    }
    
    // Document operations
    async documentAdd(chatId: string, content: string, type: string, metadata?: any): Promise<string> {
        return await this.documentStore.addDocument(chatId, content, type as any, metadata);
    }
    
    async documentSearch(query: string, options?: any): Promise<any[]> {
        return await this.documentStore.searchDocuments(query, options);
    }
    
    async documentGet(id: string): Promise<any> {
        return this.documentStore.getDocument(id);
    }
    
    // AST operations
    async astIndex(filePath: string): Promise<void> {
        await this.astIndexInstance.indexFile(filePath);
    }
    
    async astSearch(query: string, options?: any): Promise<any[]> {
        return this.astIndexInstance.searchSymbols(query, options);
    }
    
    // LLM operations
    async llmComplete(prompt: string, options: any = {}): Promise<string> {
        const provider = options.provider || this.getDefaultLLMProvider();
        
        if (!provider) {
            throw new Error('No LLM provider available');
        }
        
        switch (provider.type) {
            case 'ollama':
                return await this.ollamaComplete(prompt, options);
            case 'lmstudio':
                return await this.lmStudioComplete(prompt, options);
            case 'hanzo':
                return await this.hanzoComplete(prompt, options);
            default:
                throw new Error(`Unsupported provider: ${provider.type}`);
        }
    }
    
    async llmEmbed(text: string): Promise<number[]> {
        if (this.embeddingProvider) {
            return await this.generateEmbedding(text, this.embeddingProvider);
        }
        
        // Fallback to mock embeddings
        return this.generateMockEmbedding(text);
    }
    
    private async ollamaComplete(prompt: string, options: any): Promise<string> {
        const model = options.model || 'llama2';
        const response = await fetch('http://localhost:11434/api/generate', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                model,
                prompt,
                stream: false,
                options: {
                    temperature: options.temperature || 0.7,
                    max_tokens: options.maxTokens || 1000
                }
            })
        });
        
        if (!response.ok) {
            throw new Error(`Ollama error: ${response.statusText}`);
        }
        
        const data = await response.json();
        return data.response;
    }
    
    private async lmStudioComplete(prompt: string, options: any): Promise<string> {
        const response = await fetch('http://localhost:1234/v1/completions', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                model: options.model || 'local-model',
                prompt,
                temperature: options.temperature || 0.7,
                max_tokens: options.maxTokens || 1000
            })
        });
        
        if (!response.ok) {
            throw new Error(`LM Studio error: ${response.statusText}`);
        }
        
        const data = await response.json();
        return data.choices[0].text;
    }
    
    private async hanzoComplete(prompt: string, options: any): Promise<string> {
        const provider = this.llmProviders.get('hanzo-local');
        if (!provider) {
            throw new Error('Hanzo local model not configured');
        }
        
        const response = await fetch(`${provider.endpoint}/complete`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                model: options.model || 'zen1',
                prompt,
                temperature: options.temperature || 0.7,
                max_tokens: options.maxTokens || 1000
            })
        });
        
        if (!response.ok) {
            throw new Error(`Hanzo model error: ${response.statusText}`);
        }
        
        const data = await response.json();
        return data.text;
    }
    
    private async generateEmbedding(text: string, provider: EmbeddingProvider): Promise<number[]> {
        // Implementation depends on provider type
        // This is a placeholder
        return this.generateMockEmbedding(text);
    }
    
    private generateMockEmbedding(text: string): number[] {
        // Simple mock embedding for testing
        const embedding: number[] = [];
        for (let i = 0; i < 384; i++) {
            embedding.push(Math.random() * 2 - 1);
        }
        return embedding;
    }
    
    private getDefaultLLMProvider(): LLMProvider | undefined {
        // Priority: Hanzo > Ollama > LM Studio
        return this.llmProviders.get('hanzo-local') ||
               this.llmProviders.get('ollama') ||
               this.llmProviders.get('lmstudio');
    }
    
    // Storage operations
    async save(): Promise<void> {
        await this.documentStore.initialize(); // This saves
    }
    
    async load(): Promise<void> {
        await this.documentStore.initialize(); // This loads
    }
}

/**
 * Cloud backend implementation
 */
export class CloudBackend implements IBackend {
    private apiKey: string;
    private endpoint: string;
    private authToken?: string;
    
    constructor(config: BackendConfig) {
        this.apiKey = config.apiKey || '';
        this.endpoint = config.endpoint || 'https://api.hanzo.ai';
        this.authToken = config.authToken;
    }
    
    private async request(path: string, method: string = 'GET', body?: any): Promise<any> {
        const headers: any = {
            'Content-Type': 'application/json',
            'X-API-Key': this.apiKey
        };
        
        if (this.authToken) {
            headers['Authorization'] = `Bearer ${this.authToken}`;
        }
        
        const response = await fetch(`${this.endpoint}${path}`, {
            method,
            headers,
            body: body ? JSON.stringify(body) : undefined
        });
        
        if (!response.ok) {
            throw new Error(`Cloud API error: ${response.statusText}`);
        }
        
        return await response.json();
    }
    
    // Graph operations
    async graphAddNode(node: any): Promise<void> {
        await this.request('/graph/nodes', 'POST', node);
    }
    
    async graphAddEdge(edge: any): Promise<void> {
        await this.request('/graph/edges', 'POST', edge);
    }
    
    async graphQuery(query: any): Promise<any[]> {
        return await this.request('/graph/query', 'POST', query);
    }
    
    async graphFindPath(from: string, to: string): Promise<any[]> {
        return await this.request('/graph/path', 'POST', { from, to });
    }
    
    // Vector operations
    async vectorIndex(content: string, metadata: any): Promise<string> {
        const result = await this.request('/vector/index', 'POST', { content, metadata });
        return result.id;
    }
    
    async vectorSearch(query: string, options?: any): Promise<any[]> {
        return await this.request('/vector/search', 'POST', { query, ...options });
    }
    
    async vectorGetSimilar(id: string, topK?: number): Promise<any[]> {
        return await this.request('/vector/similar', 'POST', { id, topK });
    }
    
    // Document operations
    async documentAdd(chatId: string, content: string, type: string, metadata?: any): Promise<string> {
        const result = await this.request('/documents', 'POST', { chatId, content, type, metadata });
        return result.id;
    }
    
    async documentSearch(query: string, options?: any): Promise<any[]> {
        return await this.request('/documents/search', 'POST', { query, ...options });
    }
    
    async documentGet(id: string): Promise<any> {
        return await this.request(`/documents/${id}`);
    }
    
    // AST operations
    async astIndex(filePath: string): Promise<void> {
        await this.request('/ast/index', 'POST', { filePath });
    }
    
    async astSearch(query: string, options?: any): Promise<any[]> {
        return await this.request('/ast/search', 'POST', { query, ...options });
    }
    
    // LLM operations
    async llmComplete(prompt: string, options?: any): Promise<string> {
        const result = await this.request('/llm/complete', 'POST', { prompt, ...options });
        return result.text;
    }
    
    async llmEmbed(text: string): Promise<number[]> {
        const result = await this.request('/llm/embed', 'POST', { text });
        return result.embedding;
    }
    
    // Storage operations
    async save(): Promise<void> {
        // Cloud automatically persists
    }
    
    async load(): Promise<void> {
        // Cloud automatically loads
    }
}

/**
 * Backend factory
 */
export class BackendFactory {
    static create(context: vscode.ExtensionContext, config?: BackendConfig): IBackend {
        const mode = config?.mode || vscode.workspace.getConfiguration('hanzo').get<string>('backendMode', 'local');
        
        if (mode === 'cloud') {
            if (!config?.apiKey) {
                throw new Error('API key required for cloud mode');
            }
            return new CloudBackend(config);
        }
        
        return new LocalBackend(context);
    }
}