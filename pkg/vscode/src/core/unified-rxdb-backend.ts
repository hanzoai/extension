/**
 * Unified RxDB Backend with SQLite + Vector Store capabilities
 * Provides both relational and vector search in one database
 */

import { 
    createRxDatabase, 
    RxDatabase, 
    RxCollection,
    addRxPlugin
} from 'rxdb';
import { getRxStorageDexie } from 'rxdb/plugins/storage-dexie';
import { RxDBQueryBuilderPlugin } from 'rxdb/plugins/query-builder';
import { RxDBLeaderElectionPlugin } from 'rxdb/plugins/leader-election';
import * as path from 'path';

import { fetchPolyfill as fetch } from '../utils/fetch-polyfill';

// Add RxDB plugins
addRxPlugin(RxDBQueryBuilderPlugin);
addRxPlugin(RxDBLeaderElectionPlugin);

// Enhanced schema with vector capabilities
const documentsSchema = {
    version: 0,
    primaryKey: 'id',
    type: 'object',
    properties: {
        id: {
            type: 'string',
            maxLength: 200
        },
        // Content fields
        content: {
            type: 'string'
        },
        title: {
            type: 'string'
        },
        type: {
            type: 'string',
            enum: ['document', 'code', 'chat', 'note', 'reference']
        },
        
        // Vector embedding (384 dimensions for all-MiniLM-L6-v2)
        embedding: {
            type: 'array',
            items: {
                type: 'number'
            },
            maxItems: 1536, // Support up to OpenAI ada-002 size
            minItems: 0
        },
        
        // Metadata for SQL-like queries
        metadata: {
            type: 'object',
            properties: {
                author: { type: 'string' },
                project: { type: 'string' },
                language: { type: 'string' },
                framework: { type: 'string' },
                created: { type: 'number' },
                updated: { type: 'number' },
                size: { type: 'number' },
                tokens: { type: 'number' }
            }
        },
        
        // Relationships
        references: {
            type: 'array',
            ref: 'documents',
            items: {
                type: 'string'
            }
        },
        
        // Tags for categorization
        tags: {
            type: 'array',
            items: {
                type: 'string'
            }
        },
        
        // Full-text search field
        searchText: {
            type: 'string'
        }
    },
    required: ['id', 'content', 'type'],
    indexes: [
        'type',
        'metadata.author',
        'metadata.project',
        ['type', 'metadata.project'],
        'metadata.created',
        'tags'
    ],
    methods: {
        // Calculate similarity with another document
        similarity: function(this: any, otherEmbedding: number[]): number {
            if (!this.embedding || !otherEmbedding) return 0;
            
            let dotProduct = 0;
            let normA = 0;
            let normB = 0;
            
            for (let i = 0; i < this.embedding.length; i++) {
                dotProduct += this.embedding[i] * otherEmbedding[i];
                normA += this.embedding[i] * this.embedding[i];
                normB += otherEmbedding[i] * otherEmbedding[i];
            }
            
            normA = Math.sqrt(normA);
            normB = Math.sqrt(normB);
            
            return normA && normB ? dotProduct / (normA * normB) : 0;
        }
    }
};

// Embedding server interface
export interface EmbeddingServer {
    embed(text: string): Promise<number[]>;
    embedBatch(texts: string[]): Promise<number[][]>;
    model: string;
    dimension: number;
}

// Local embedding server using ONNX Runtime
export class LocalEmbeddingServer implements EmbeddingServer {
    model: string = 'all-MiniLM-L6-v2';
    dimension: number = 384;
    private ort: any;
    private session: any;
    private tokenizer: any;
    
    async initialize(): Promise<void> {
        try {
            // Dynamic import for optional dependency
            try {
                this.ort = require('onnxruntime-node');
            } catch {
                console.warn('ONNX Runtime not available, using mock embeddings');
                return;
            }
            
            let transformersModule;
            try {
                transformersModule = require('@xenova/transformers');
            } catch {
                console.warn('Transformers not available, using mock embeddings');
                return;
            }
            
            const { AutoTokenizer } = transformersModule;
            
            // Load model
            const modelPath = path.join(__dirname, '../../models/all-MiniLM-L6-v2.onnx');
            this.session = await this.ort.InferenceSession.create(modelPath);
            this.tokenizer = await AutoTokenizer.from_pretrained('sentence-transformers/all-MiniLM-L6-v2');
            
            console.log('Local embedding server initialized with all-MiniLM-L6-v2');
        } catch (error) {
            console.warn('Local embedding server not available, using mock embeddings:', error);
        }
    }
    
    async embed(text: string): Promise<number[]> {
        if (!this.session) {
            // Fallback to deterministic mock embeddings
            return this.mockEmbed(text);
        }
        
        // Tokenize
        const encoded = await this.tokenizer(text, {
            padding: true,
            truncation: true,
            return_tensors: 'pt'
        });
        
        // Run inference
        const feeds = {
            input_ids: new this.ort.Tensor('int64', encoded.input_ids.data, encoded.input_ids.shape),
            attention_mask: new this.ort.Tensor('int64', encoded.attention_mask.data, encoded.attention_mask.shape)
        };
        
        const results = await this.session.run(feeds);
        const embeddings = results.last_hidden_state.data;
        
        // Mean pooling
        const pooled = new Float32Array(this.dimension);
        const seqLength = encoded.input_ids.shape[1];
        
        for (let i = 0; i < this.dimension; i++) {
            let sum = 0;
            for (let j = 0; j < seqLength; j++) {
                sum += embeddings[j * this.dimension + i];
            }
            pooled[i] = sum / seqLength;
        }
        
        // Normalize
        let norm = 0;
        for (let i = 0; i < pooled.length; i++) {
            norm += pooled[i] * pooled[i];
        }
        norm = Math.sqrt(norm);
        
        for (let i = 0; i < pooled.length; i++) {
            pooled[i] /= norm;
        }
        
        return Array.from(pooled);
    }
    
    async embedBatch(texts: string[]): Promise<number[][]> {
        return Promise.all(texts.map(text => this.embed(text)));
    }
    
    private mockEmbed(text: string): number[] {
        // Deterministic mock embedding based on text
        const crypto = require('crypto');
        const hash = crypto.createHash('sha256').update(text).digest();
        const embedding = new Float32Array(this.dimension);
        
        for (let i = 0; i < this.dimension; i++) {
            embedding[i] = (hash[i % hash.length] / 255) * 2 - 1;
        }
        
        return Array.from(embedding);
    }
}

// Cloud embedding server (OpenAI, Cohere, etc.)
export class CloudEmbeddingServer implements EmbeddingServer {
    model: string;
    dimension: number;
    private apiKey: string;
    private provider: 'openai' | 'cohere' | 'hanzo';
    
    constructor(provider: 'openai' | 'cohere' | 'hanzo', apiKey: string) {
        this.provider = provider;
        this.apiKey = apiKey;
        
        switch (provider) {
            case 'openai':
                this.model = 'text-embedding-ada-002';
                this.dimension = 1536;
                break;
            case 'cohere':
                this.model = 'embed-english-v2.0';
                this.dimension = 4096;
                break;
            case 'hanzo':
                this.model = 'hanzo-embed-v1';
                this.dimension = 768;
                break;
        }
    }
    
    async embed(text: string): Promise<number[]> {
        const response = await this.callAPI([text]);
        return response[0];
    }
    
    async embedBatch(texts: string[]): Promise<number[][]> {
        return this.callAPI(texts);
    }
    
    private async callAPI(texts: string[]): Promise<number[][]> {
        let url: string;
        let body: any;
        let headers: any = {
            'Content-Type': 'application/json'
        };
        
        switch (this.provider) {
            case 'openai':
                url = 'https://api.openai.com/v1/embeddings';
                headers['Authorization'] = `Bearer ${this.apiKey}`;
                body = {
                    model: this.model,
                    input: texts
                };
                break;
                
            case 'cohere':
                url = 'https://api.cohere.ai/v1/embed';
                headers['Authorization'] = `Bearer ${this.apiKey}`;
                body = {
                    model: this.model,
                    texts: texts
                };
                break;
                
            case 'hanzo':
                url = 'https://api.hanzo.ai/v1/embeddings';
                headers['X-API-Key'] = this.apiKey;
                body = {
                    model: this.model,
                    inputs: texts
                };
                break;
        }
        
        const response = await fetch(url, {
            method: 'POST',
            headers,
            body: JSON.stringify(body)
        });
        
        if (!response.ok) {
            throw new Error(`Embedding API error: ${response.statusText}`);
        }
        
        const data = await response.json();
        
        // Extract embeddings based on provider format
        switch (this.provider) {
            case 'openai':
                return data.data.map((item: any) => item.embedding);
            case 'cohere':
                return data.embeddings;
            case 'hanzo':
                return data.embeddings;
            default:
                throw new Error(`Unknown provider: ${this.provider}`);
        }
    }
}

// Main unified backend
export class UnifiedRxDBBackend {
    private db?: RxDatabase;
    private documents?: RxCollection;
    private embeddingServer: EmbeddingServer;
    private dbPath: string;
    
    constructor(storagePath: string, embeddingServer?: EmbeddingServer) {
        this.dbPath = path.join(storagePath, 'hanzo-unified.db');
        this.embeddingServer = embeddingServer || new LocalEmbeddingServer();
    }
    
    async initialize(): Promise<void> {
        // Initialize embedding server if needed
        if (this.embeddingServer instanceof LocalEmbeddingServer) {
            await this.embeddingServer.initialize();
        }
        
        // Create database
        this.db = await createRxDatabase({
            name: this.dbPath,
            storage: getRxStorageDexie(),
            password: 'hanzo-unified-2024',
            multiInstance: true,
            eventReduce: true,
            cleanupPolicy: {
                minimumDeletedTime: 1000 * 60 * 60 * 24 * 7, // 7 days
                minimumCollectionAge: 1000 * 60 * 60 * 24, // 1 day
                runEach: 1000 * 60 * 60 * 4 // every 4 hours
            }
        });
        
        // Create collections
        const collections = await this.db.addCollections({
            documents: {
                schema: documentsSchema,
                methods: {
                    // Vector search method
                    async findSimilar(this: any, limit: number = 10): Promise<any[]> {
                        if (!this.embedding) return [];
                        
                        const allDocs = await this.collection.find().exec();
                        const results = allDocs
                            .filter((doc: any) => doc.id !== this.id && doc.embedding)
                            .map((doc: any) => ({
                                document: doc,
                                score: doc.similarity(this.embedding)
                            }))
                            .sort((a: any, b: any) => b.score - a.score)
                            .slice(0, limit);
                            
                        return results;
                    }
                }
            }
        });
        
        this.documents = collections.documents;
        
        // Set up hooks for automatic embedding
        this.documents.preInsert(async (docData: any) => {
            if (!docData.embedding && docData.content) {
                docData.embedding = await this.embeddingServer.embed(docData.content);
            }
            
            // Create search text for full-text search
            docData.searchText = `${docData.title || ''} ${docData.content} ${(docData.tags || []).join(' ')}`.toLowerCase();
            
            // Set timestamps
            docData.metadata = docData.metadata || {};
            docData.metadata.created = docData.metadata.created || Date.now();
            docData.metadata.updated = Date.now();
            
            // Calculate tokens (rough estimate)
            docData.metadata.tokens = Math.ceil(docData.content.length / 4);
        }, false);
        
        this.documents.preSave(async (docData: any, docOld: any) => {
            // Update embedding if content changed
            if (docOld && docData.content !== docOld.content) {
                docData.embedding = await this.embeddingServer.embed(docData.content);
            }
            
            // Update search text
            docData.searchText = `${docData.title || ''} ${docData.content} ${(docData.tags || []).join(' ')}`.toLowerCase();
            
            // Update timestamp
            docData.metadata = docData.metadata || {};
            docData.metadata.updated = Date.now();
        }, false);
        
        console.log('Unified RxDB backend initialized with embedding support');
    }
    
    // SQL-like operations
    async query(params: {
        type?: string;
        author?: string;
        project?: string;
        tags?: string[];
        dateRange?: { start: number; end: number };
        limit?: number;
        orderBy?: string;
        direction?: 'asc' | 'desc';
    }): Promise<any[]> {
        let query = this.documents!.find();
        
        if (params.type) {
            query = query.where('type').eq(params.type);
        }
        
        if (params.author) {
            query = query.where('metadata.author').eq(params.author);
        }
        
        if (params.project) {
            query = query.where('metadata.project').eq(params.project);
        }
        
        if (params.dateRange) {
            query = query.where('metadata.created')
                .gte(params.dateRange.start)
                .lte(params.dateRange.end);
        }
        
        if (params.orderBy) {
            query = query.sort({ [params.orderBy]: params.direction || 'desc' });
        }
        
        if (params.limit) {
            query = query.limit(params.limit);
        }
        
        const results = await query.exec();
        
        // Filter by tags if specified
        if (params.tags && params.tags.length > 0) {
            return results.filter((doc: any) => {
                const docTags = doc.tags || [];
                return params.tags!.some(tag => docTags.includes(tag));
            });
        }
        
        return results;
    }
    
    // Vector search operations
    async vectorSearch(queryText: string, options: {
        filter?: any;
        limit?: number;
        threshold?: number;
    } = {}): Promise<Array<{ document: any; score: number }>> {
        // Generate embedding for query
        const queryEmbedding = await this.embeddingServer.embed(queryText);
        
        // Get candidates based on filter
        let candidates = await this.documents!.find().exec();
        
        if (options.filter) {
            candidates = await this.query(options.filter);
        }
        
        // Calculate similarities
        const results = candidates
            .filter((doc: any) => doc.embedding)
            .map((doc: any) => ({
                document: doc,
                score: this.cosineSimilarity(queryEmbedding, doc.embedding)
            }))
            .filter(result => !options.threshold || result.score >= options.threshold)
            .sort((a, b) => b.score - a.score)
            .slice(0, options.limit || 10);
            
        return results;
    }
    
    // Hybrid search (SQL + Vector)
    async hybridSearch(query: string, sqlParams: any = {}, vectorWeight: number = 0.5): Promise<any[]> {
        // SQL search
        const sqlResults = await this.query({
            ...sqlParams,
            limit: 100 // Get more candidates
        });
        
        // Vector search
        const vectorResults = await this.vectorSearch(query, {
            limit: 100
        });
        
        // Combine results with weighted scoring
        const scoreMap = new Map<string, number>();
        
        // Add SQL results (binary scoring)
        sqlResults.forEach((doc: any) => {
            scoreMap.set(doc.id, 1 - vectorWeight);
        });
        
        // Add vector scores
        vectorResults.forEach(({ document, score }) => {
            const currentScore = scoreMap.get(document.id) || 0;
            scoreMap.set(document.id, currentScore + score * vectorWeight);
        });
        
        // Get all unique documents and sort by combined score
        const allIds = Array.from(scoreMap.keys());
        const results = await Promise.all(
            allIds.map(async id => {
                const doc = await this.documents!.findOne(id).exec();
                return {
                    document: doc,
                    score: scoreMap.get(id)!
                };
            })
        );
        
        return results
            .filter(r => r.document)
            .sort((a, b) => b.score - a.score);
    }
    
    // Full-text search
    async fullTextSearch(searchText: string, limit: number = 20): Promise<any[]> {
        const normalizedSearch = searchText.toLowerCase();
        
        const results = await this.documents!
            .find()
            .where('searchText')
            .regex(normalizedSearch.split(' ').join('.*'))
            .limit(limit)
            .exec();
            
        return results;
    }
    
    // Graph-like operations
    async findConnected(documentId: string, depth: number = 2): Promise<any[]> {
        const visited = new Set<string>();
        const queue: Array<{ id: string; level: number }> = [{ id: documentId, level: 0 }];
        const results: any[] = [];
        
        while (queue.length > 0) {
            const { id, level } = queue.shift()!;
            
            if (visited.has(id) || level > depth) continue;
            visited.add(id);
            
            const doc = await this.documents!.findOne(id).exec();
            if (!doc) continue;
            
            results.push(doc);
            
            // Add references to queue
            if (doc.references && level < depth) {
                doc.references.forEach((refId: string) => {
                    if (!visited.has(refId)) {
                        queue.push({ id: refId, level: level + 1 });
                    }
                });
            }
        }
        
        return results;
    }
    
    // Aggregation operations
    async aggregate(pipeline: any[]): Promise<any[]> {
        // RxDB doesn't have native aggregation, so we implement in memory
        const allDocs = await this.documents!.find().exec();
        
        // Simple aggregation implementation
        const groups = new Map<string, any[]>();
        
        // Group stage
        if (pipeline[0]?.$group) {
            const groupBy = pipeline[0].$group._id;
            allDocs.forEach((doc: any) => {
                const key = doc[groupBy] || 'null';
                if (!groups.has(key)) {
                    groups.set(key, []);
                }
                groups.get(key)!.push(doc);
            });
        }
        
        // Calculate aggregates
        const results: any[] = [];
        groups.forEach((docs, key) => {
            const result: any = { _id: key };
            
            // Count
            if (pipeline[0]?.$group.count) {
                result.count = docs.length;
            }
            
            // Average
            if (pipeline[0]?.$group.avgTokens) {
                const sum = docs.reduce((acc, doc) => acc + (doc.metadata?.tokens || 0), 0);
                result.avgTokens = sum / docs.length;
            }
            
            results.push(result);
        });
        
        return results;
    }
    
    // Backup and restore
    async exportToJSON(): Promise<any> {
        const docs = await this.documents!.find().exec();
        return {
            documents: docs.map((d: any) => d.toJSON()),
            metadata: {
                exportDate: new Date().toISOString(),
                documentCount: docs.length,
                embeddingModel: this.embeddingServer.model,
                embeddingDimension: this.embeddingServer.dimension
            }
        };
    }
    
    async importFromJSON(data: any): Promise<void> {
        if (data.documents) {
            await this.documents!.bulkInsert(data.documents);
        }
    }
    
    // Helper methods
    private cosineSimilarity(a: number[], b: number[]): number {
        if (a.length !== b.length) return 0;
        
        let dotProduct = 0;
        let normA = 0;
        let normB = 0;
        
        for (let i = 0; i < a.length; i++) {
            dotProduct += a[i] * b[i];
            normA += a[i] * a[i];
            normB += b[i] * b[i];
        }
        
        normA = Math.sqrt(normA);
        normB = Math.sqrt(normB);
        
        return normA && normB ? dotProduct / (normA * normB) : 0;
    }
}