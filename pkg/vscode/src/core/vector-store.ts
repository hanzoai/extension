/**
 * Local vector store implementation using in-memory storage
 * For production, this would use LanceDB or similar embedded vector database
 */

import * as crypto from 'crypto';

export interface VectorDocument {
    id: string;
    content: string;
    embedding?: number[];
    metadata: Record<string, any>;
    timestamp: Date;
}

export interface SearchResult {
    document: VectorDocument;
    score: number;
}

export class VectorStore {
    private documents: Map<string, VectorDocument> = new Map();
    private embeddings: Map<string, number[]> = new Map();
    
    constructor() {}
    
    /**
     * Add a document to the vector store
     */
    async addDocument(content: string, metadata: Record<string, any> = {}): Promise<string> {
        const id = this.generateId(content);
        const doc: VectorDocument = {
            id,
            content,
            metadata,
            timestamp: new Date()
        };
        
        // Generate embedding (mock for now - would use real embedding model)
        const embedding = await this.generateEmbedding(content);
        doc.embedding = embedding;
        
        this.documents.set(id, doc);
        this.embeddings.set(id, embedding);
        
        return id;
    }
    
    /**
     * Add multiple documents in batch
     */
    async addDocuments(documents: Array<{ content: string; metadata?: Record<string, any> }>): Promise<string[]> {
        const ids: string[] = [];
        
        for (const doc of documents) {
            const id = await this.addDocument(doc.content, doc.metadata || {});
            ids.push(id);
        }
        
        return ids;
    }
    
    /**
     * Update a document
     */
    async updateDocument(id: string, content?: string, metadata?: Record<string, any>): Promise<void> {
        const doc = this.documents.get(id);
        if (!doc) {
            throw new Error(`Document ${id} not found`);
        }
        
        if (content && content !== doc.content) {
            doc.content = content;
            doc.embedding = await this.generateEmbedding(content);
            this.embeddings.set(id, doc.embedding);
        }
        
        if (metadata) {
            doc.metadata = { ...doc.metadata, ...metadata };
        }
        
        doc.timestamp = new Date();
    }
    
    /**
     * Delete a document
     */
    deleteDocument(id: string): boolean {
        const deleted = this.documents.delete(id);
        this.embeddings.delete(id);
        return deleted;
    }
    
    /**
     * Get a document by ID
     */
    getDocument(id: string): VectorDocument | undefined {
        return this.documents.get(id);
    }
    
    /**
     * Search for similar documents
     */
    async search(query: string, options: {
        topK?: number;
        threshold?: number;
        filter?: Record<string, any>;
    } = {}): Promise<SearchResult[]> {
        const { topK = 10, threshold = 0.0, filter } = options;
        
        // Generate query embedding
        const queryEmbedding = await this.generateEmbedding(query);
        
        // Calculate similarities
        const results: SearchResult[] = [];
        
        for (const [id, doc] of this.documents) {
            // Apply metadata filter if provided
            if (filter && !this.matchesFilter(doc.metadata, filter)) {
                continue;
            }
            
            const docEmbedding = this.embeddings.get(id);
            if (!docEmbedding) continue;
            
            const score = this.cosineSimilarity(queryEmbedding, docEmbedding);
            
            if (score >= threshold) {
                results.push({ document: doc, score });
            }
        }
        
        // Sort by score and return top K
        results.sort((a, b) => b.score - a.score);
        return results.slice(0, topK);
    }
    
    /**
     * Search by metadata
     */
    searchByMetadata(filter: Record<string, any>): VectorDocument[] {
        const results: VectorDocument[] = [];
        
        for (const doc of this.documents.values()) {
            if (this.matchesFilter(doc.metadata, filter)) {
                results.push(doc);
            }
        }
        
        return results;
    }
    
    /**
     * Get similar documents to a given document
     */
    async getSimilar(id: string, topK: number = 10): Promise<SearchResult[]> {
        const doc = this.documents.get(id);
        if (!doc) {
            throw new Error(`Document ${id} not found`);
        }
        
        const embedding = this.embeddings.get(id);
        if (!embedding) {
            throw new Error(`Embedding for document ${id} not found`);
        }
        
        const results: SearchResult[] = [];
        
        for (const [otherId, otherDoc] of this.documents) {
            if (otherId === id) continue;
            
            const otherEmbedding = this.embeddings.get(otherId);
            if (!otherEmbedding) continue;
            
            const score = this.cosineSimilarity(embedding, otherEmbedding);
            results.push({ document: otherDoc, score });
        }
        
        results.sort((a, b) => b.score - a.score);
        return results.slice(0, topK);
    }
    
    /**
     * Get statistics about the vector store
     */
    getStats(): {
        documentCount: number;
        totalSize: number;
        averageDocumentLength: number;
        metadataKeys: string[];
    } {
        let totalLength = 0;
        const metadataKeys = new Set<string>();
        
        for (const doc of this.documents.values()) {
            totalLength += doc.content.length;
            Object.keys(doc.metadata).forEach(key => metadataKeys.add(key));
        }
        
        return {
            documentCount: this.documents.size,
            totalSize: totalLength,
            averageDocumentLength: this.documents.size > 0 ? totalLength / this.documents.size : 0,
            metadataKeys: Array.from(metadataKeys)
        };
    }
    
    /**
     * Clear all documents
     */
    clear(): void {
        this.documents.clear();
        this.embeddings.clear();
    }
    
    /**
     * Export all documents
     */
    export(): VectorDocument[] {
        return Array.from(this.documents.values());
    }
    
    /**
     * Import documents
     */
    async import(documents: VectorDocument[]): Promise<void> {
        for (const doc of documents) {
            this.documents.set(doc.id, doc);
            if (doc.embedding) {
                this.embeddings.set(doc.id, doc.embedding);
            } else {
                const embedding = await this.generateEmbedding(doc.content);
                this.embeddings.set(doc.id, embedding);
            }
        }
    }
    
    // Private helper methods
    
    private generateId(content: string): string {
        return crypto.createHash('sha256').update(content).digest('hex').substring(0, 16);
    }
    
    /**
     * Generate embedding for text (mock implementation)
     * In production, this would use a real embedding model
     */
    private async generateEmbedding(text: string): Promise<number[]> {
        // Mock embedding - in reality would use OpenAI, Cohere, or local model
        const embedding: number[] = [];
        const dimension = 384; // Common embedding dimension
        
        // Simple deterministic mock based on text content
        const hash = crypto.createHash('sha256').update(text).digest();
        for (let i = 0; i < dimension; i++) {
            // Generate pseudo-random values based on hash
            const byte = hash[i % hash.length];
            embedding.push((byte / 255) * 2 - 1); // Normalize to [-1, 1]
        }
        
        return embedding;
    }
    
    /**
     * Calculate cosine similarity between two vectors
     */
    private cosineSimilarity(a: number[], b: number[]): number {
        if (a.length !== b.length) {
            throw new Error('Vectors must have the same dimension');
        }
        
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
        
        if (normA === 0 || normB === 0) {
            return 0;
        }
        
        return dotProduct / (normA * normB);
    }
    
    /**
     * Check if metadata matches filter criteria
     */
    private matchesFilter(metadata: Record<string, any>, filter: Record<string, any>): boolean {
        for (const [key, value] of Object.entries(filter)) {
            if (metadata[key] !== value) {
                return false;
            }
        }
        return true;
    }
}